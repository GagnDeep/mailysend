import { ApiClient } from '../api.ts'
import type { FlagSpecs } from '../args.ts'
import { CliError, type CommandContext } from '../command.ts'
import { readState, resolveCredentials, statePath, writeState } from '../config.ts'
import { kv, note, ok, out, Progress, plural, style, warn } from '../term.ts'

/**
 * Migration off Resend.
 *
 * The property that matters is resumability, and it is not a nicety: an import
 * is a long sequence of *creates*, so a run that dies halfway and restarts from
 * zero does not merely waste time — it duplicates every contact it already
 * moved. There is no natural idempotency key to lean on either, because the
 * destination mints its own ids.
 *
 * So the checkpoint is a source-id → destination-id map, written after every
 * page rather than at the end. A re-run skips anything already in the map, which
 * makes the import idempotent by construction: interrupt it as often as you
 * like, run it twice for luck, and the destination ends up with one of each.
 *
 * The checkpoint is keyed by the Resend key's fingerprint so two accounts
 * migrated from one machine cannot read each other's progress.
 */

const RESEND_API = 'https://api.resend.com'

export const importResendFlags: FlagSpecs = {
  'resend-key': { kind: 'string', describe: 'Resend API key (or RESEND_API_KEY)' },
  only: { kind: 'list', describe: 'Limit to some resources: audiences,contacts,domains,templates' },
  restart: { kind: 'boolean', describe: 'Discard the checkpoint and import from scratch' },
  'dry-run': { kind: 'boolean', short: 'n', describe: 'Report what would be imported' },
}

type Resource = 'audiences' | 'contacts' | 'domains' | 'templates'

const ALL: Resource[] = ['audiences', 'contacts', 'domains', 'templates']

interface Checkpoint {
  version: 1
  account: string
  startedAt: string
  updatedAt: string
  /** Source id → destination id, per resource. Presence means "already done". */
  migrated: Record<Resource, Record<string, string>>
  /** Audiences whose contact pages are fully walked. */
  completed: Record<string, boolean>
}

const emptyCheckpoint = (account: string): Checkpoint => ({
  version: 1,
  account,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  migrated: { audiences: {}, contacts: {}, domains: {}, templates: {} },
  completed: {},
})

/**
 * The checkpoint file name carries a fingerprint of the source key rather than
 * the key: the file is 0600, but a key in a filename also reaches shell
 * history, `ps` output and backup indexes.
 */
export const accountFingerprint = (key: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const resendGet = async <T>(key: string, path: string): Promise<T> => {
  const response = await fetch(`${RESEND_API}${path}`, {
    headers: { authorization: `Bearer ${key}` },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new CliError(`Resend ${path} returned ${response.status}`, {
      hint: body.slice(0, 300),
    })
  }
  return (await response.json()) as T
}

interface ResendList<T> {
  data?: T[]
}

interface ResendAudience {
  id: string
  name: string
}
interface ResendContact {
  id: string
  email: string
  first_name?: string | null
  last_name?: string | null
  unsubscribed?: boolean
}
interface ResendDomain {
  id: string
  name: string
  region?: string
}

export interface ImportSummary {
  audiences: number
  contacts: number
  domains: number
  templates: number
  skipped: number
}

/**
 * Split from the command so the resume logic is testable without a network or
 * a terminal: everything stateful is a parameter.
 */
export const runImport = async (options: {
  checkpoint: Checkpoint
  save: (checkpoint: Checkpoint) => Promise<void>
  resources: Resource[]
  source: {
    audiences(): Promise<ResendAudience[]>
    contacts(audienceId: string): Promise<ResendContact[]>
    domains(): Promise<ResendDomain[]>
  }
  destination: {
    createAudience(input: { name: string }): Promise<{ id: string }>
    createContact(input: Record<string, unknown>): Promise<{ id: string }>
    createDomain(input: { name: string; region?: string }): Promise<{ id: string }>
  }
  onProgress?: (label: string) => void
}): Promise<ImportSummary> => {
  const { checkpoint, save, resources, source, destination } = options
  const summary: ImportSummary = { audiences: 0, contacts: 0, domains: 0, templates: 0, skipped: 0 }

  const commit = async () => {
    checkpoint.updatedAt = new Date().toISOString()
    await save(checkpoint)
  }

  if (resources.includes('domains')) {
    for (const domain of await source.domains()) {
      if (checkpoint.migrated.domains[domain.id]) {
        summary.skipped++
        continue
      }
      const created = await destination.createDomain({
        name: domain.name,
        ...(domain.region === undefined ? {} : { region: domain.region }),
      })
      checkpoint.migrated.domains[domain.id] = created.id
      summary.domains++
      await commit()
    }
  }

  // Contacts depend on audiences having been mapped, so the order is fixed
  // even when the user asks for contacts alone — the map is read, not rebuilt.
  const wantsAudiences = resources.includes('audiences') || resources.includes('contacts')
  const audiences = wantsAudiences ? await source.audiences() : []

  if (resources.includes('audiences') || resources.includes('contacts')) {
    for (const audience of audiences) {
      if (!checkpoint.migrated.audiences[audience.id]) {
        const created = await destination.createAudience({ name: audience.name })
        checkpoint.migrated.audiences[audience.id] = created.id
        summary.audiences++
        await commit()
      } else {
        summary.skipped++
      }
    }
  }

  if (resources.includes('contacts')) {
    for (const audience of audiences) {
      const destinationId = checkpoint.migrated.audiences[audience.id]
      if (!destinationId) continue
      if (checkpoint.completed[audience.id]) {
        summary.skipped++
        continue
      }

      options.onProgress?.(`Contacts in ${audience.name}`)
      for (const contact of await source.contacts(audience.id)) {
        if (checkpoint.migrated.contacts[contact.id]) {
          summary.skipped++
          continue
        }
        const created = await destination.createContact({
          audience_id: destinationId,
          email: contact.email,
          ...(contact.first_name ? { first_name: contact.first_name } : {}),
          ...(contact.last_name ? { last_name: contact.last_name } : {}),
          ...(contact.unsubscribed ? { unsubscribed: true } : {}),
        })
        checkpoint.migrated.contacts[contact.id] = created.id
        summary.contacts++
        await commit()
      }

      checkpoint.completed[audience.id] = true
      await commit()
    }
  }

  return summary
}

export const importResend = async (ctx: CommandContext) => {
  const resendKey = (ctx.args.flags.resendKey as string | undefined) ?? process.env.RESEND_API_KEY
  if (!resendKey) {
    throw new CliError('A Resend API key is required.', {
      hint: 'Pass --resend-key re_… or set RESEND_API_KEY.',
    })
  }

  const requested = ctx.args.flags.only as string[]
  const resources = (requested.length > 0 ? requested : ALL).filter((name): name is Resource =>
    (ALL as string[]).includes(name),
  )
  if (resources.length === 0) throw new CliError(`--only takes any of: ${ALL.join(', ')}`)

  const account = accountFingerprint(resendKey)
  const stateName = `import-resend-${account}`
  const existing = ctx.args.flags.restart === true ? null : await readState<Checkpoint>(stateName)
  const checkpoint = existing ?? emptyCheckpoint(account)

  const alreadyDone =
    existing !== null &&
    resources.every((resource) =>
      resource === 'contacts'
        ? Object.keys(checkpoint.migrated.audiences).every((id) => checkpoint.completed[id])
        : Object.keys(checkpoint.migrated[resource]).length > 0,
    )

  if (existing) {
    const counts = ALL.map((r) => Object.keys(checkpoint.migrated[r]).length).reduce(
      (a, b) => a + b,
    )
    note(
      `Resuming an import started ${existing.startedAt}; ${plural(counts, 'record')} already moved.`,
    )
  }

  if (ctx.args.flags.dryRun === true) {
    out()
    kv([
      ['account', account],
      ['resources', resources.join(', ')],
      ['checkpoint', statePath(stateName)],
      [
        'already moved',
        ALL.map((r) => `${r} ${Object.keys(checkpoint.migrated[r]).length}`).join(', '),
      ],
    ])
    out()
    note('Nothing was written (--dry-run).')
    return
  }

  const client = new ApiClient(await resolveCredentials(ctx.global))
  const progress = new Progress('Importing from Resend')

  const summary = await runImport({
    checkpoint,
    save: (value) => writeState(stateName, value),
    resources,
    onProgress: (label) => progress.update(label),
    source: {
      audiences: async () =>
        (await resendGet<ResendList<ResendAudience>>(resendKey, '/audiences')).data ?? [],
      contacts: async (audienceId) =>
        (await resendGet<ResendList<ResendContact>>(resendKey, `/audiences/${audienceId}/contacts`))
          .data ?? [],
      domains: async () =>
        (await resendGet<ResendList<ResendDomain>>(resendKey, '/domains')).data ?? [],
    },
    destination: {
      createAudience: (input) => client.post<{ id: string }>('/audiences', input),
      createContact: (input) => client.post<{ id: string }>('/contacts', input),
      createDomain: (input) => client.post<{ id: string }>('/domains', input),
    },
  })

  progress.stop()

  if (resources.includes('templates')) {
    // Resend has no template API to read from; saying so is more use than a
    // silent zero in the summary table.
    warn('Resend exposes no template API, so templates cannot be read automatically.')
    note('  Export them from the Resend dashboard and run `mailysend templates push`.')
  }

  out()
  kv([
    ['domains', String(summary.domains)],
    ['audiences', String(summary.audiences)],
    ['contacts', String(summary.contacts)],
    ['already present', style.dim(String(summary.skipped))],
  ])
  out()

  if (alreadyDone && summary.audiences + summary.contacts + summary.domains === 0) {
    ok('Nothing left to import — this account was already migrated.')
  } else {
    ok('Import complete.')
  }
  note(`Checkpoint: ${statePath(stateName)}`)
}
