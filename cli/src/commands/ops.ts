import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ApiClient } from '../api.ts'
import type { FlagSpecs } from '../args.ts'
import { CliError, type CommandContext } from '../command.ts'
import { readState, resolveCredentials, writeState } from '../config.ts'
import { confirm, kv, note, ok, out, Progress, style, table } from '../term.ts'

// ---------------------------------------------------------------------------
// traffic
// ---------------------------------------------------------------------------

export const trafficFlags: FlagSpecs = {
  set: { kind: 'list', describe: 'Weights as provider=percent, e.g. ses=80,resend=20' },
  pause: { kind: 'string', describe: 'Disable one provider' },
  resume: { kind: 'string', describe: 'Re-enable one provider' },
  json: { kind: 'boolean', describe: 'Print the routing table as JSON' },
}

interface ProviderConfig {
  provider: string
  priority: number
  weight: number
  enabled: boolean
}

interface ProviderList {
  data: ProviderConfig[]
  /** Which transports the deployment's environment could stand up on its own. */
  environment_fallback?: string[]
  /** What a send would leave through if nothing below is enabled. */
  default_provider?: string | null
}

/**
 * Shows or shifts the split between transports.
 *
 * The routing table is `GET /v1/providers`, and a change is one
 * `PUT /v1/providers/:name` per provider — this used to call a
 * `/v1/settings/providers` that has never existed, so every invocation was a
 * 404 rather than a routing change.
 *
 * Weights are still given as a complete table rather than a delta, because a
 * partial update is ambiguous the moment two people run this at once: "set ses
 * to 80" has no answer unless you also say what the rest became. What changed
 * is that applying it is now a sequence of writes rather than one, so the
 * refusal below — never disable every provider — is checked before the first
 * one goes out.
 */
export const traffic = async (ctx: CommandContext) => {
  const client = new ApiClient(await resolveCredentials(ctx.global))
  const current = await client.get<ProviderList>('/providers')
  const entries = new Map(current.data.map((entry) => [entry.provider, { ...entry }]))

  const assignments = ctx.args.flags.set as string[]
  const pause = ctx.args.flags.pause as string | undefined
  const resume = ctx.args.flags.resume as string | undefined

  if (assignments.length > 0 || pause || resume) {
    const touched = new Set<string>()
    for (const assignment of assignments) {
      const [provider, raw] = assignment.split('=')
      const weight = Number(raw)
      if (!provider || !Number.isFinite(weight) || weight < 0) {
        throw new CliError(`--set expects provider=percent, got "${assignment}"`)
      }
      const entry = entries.get(provider)
      if (!entry) throw new CliError(unconfigured(provider, current))
      entry.weight = Math.round(weight)
      entry.enabled = weight > 0
      touched.add(provider)
    }
    for (const [name, enabled] of [
      [pause, false],
      [resume, true],
    ] as [string | undefined, boolean][]) {
      if (!name) continue
      const entry = entries.get(name)
      if (!entry) throw new CliError(unconfigured(name, current))
      entry.enabled = enabled
      touched.add(name)
    }

    const total = [...entries.values()]
      .filter((e) => e.enabled)
      .reduce((sum, e) => sum + e.weight, 0)
    if (total === 0) throw new CliError('That would disable every provider — mail would stop.')

    // Checked first, written second. A half-applied table is a routing rule
    // nobody chose, and the check above is the whole reason this command
    // reads before it writes.
    for (const name of touched) {
      const entry = entries.get(name) as ProviderConfig
      await client.put(`/providers/${encodeURIComponent(name)}`, {
        enabled: entry.enabled,
        weight: entry.weight,
        priority: entry.priority,
      })
    }
  }

  const table_ = [...entries.values()].sort((a, b) => a.priority - b.priority)
  if (ctx.args.flags.json === true) {
    out(JSON.stringify(table_, null, 2))
    return
  }

  if (table_.length === 0) {
    out()
    // An empty table does not mean sending is off — it means nothing has been
    // configured and the deployment's own environment is carrying it.
    note(
      current.default_provider
        ? `No provider is configured; sending falls back to ${style.cyan(current.default_provider)} from this deployment's environment.`
        : 'No provider is configured and this deployment can stand up none — only Test mode will send.',
    )
    return
  }

  const active = table_.filter((entry) => entry.enabled)
  const total = active.reduce((sum, entry) => sum + entry.weight, 0) || 1

  out()
  table(
    [
      { header: 'provider' },
      { header: 'priority', align: 'right' },
      { header: 'share', align: 'right' },
      { header: 'state' },
    ],
    table_.map((entry) => [
      entry.provider,
      String(entry.priority),
      entry.enabled ? `${Math.round((entry.weight / total) * 100)}%` : style.dim('—'),
      entry.enabled ? style.green('sending') : style.dim('paused'),
    ]),
  )
  out()
  note('Selection is hash(email_id) % weight, so a retry always reaches the same provider.')
}

/**
 * A provider you cannot weight is usually one with no credentials yet, not a
 * typo — saying which ones *are* configured turns a dead end into the next step.
 */
const unconfigured = (name: string, list: ProviderList): string => {
  const configured = list.data.map((entry) => entry.provider)
  return configured.length === 0
    ? `No providers are configured yet. Add ${name} in Settings → Providers first.`
    : `${name} is not configured in this workspace. Configured: ${configured.join(', ')}.`
}

// ---------------------------------------------------------------------------
// rollback
// ---------------------------------------------------------------------------

export const rollbackFlags: FlagSpecs = {
  to: { kind: 'number', describe: 'Version to roll back to (default: previous)' },
  yes: { kind: 'boolean', short: 'y', describe: 'Skip the confirmation' },
}

export const rollback = async (ctx: CommandContext) => {
  const target = ctx.args.positionals[1]
  if (!target) {
    throw new CliError('What should be rolled back?', {
      hint: 'mailysend rollback <template-id-or-slug> [--to 3]',
    })
  }

  const client = new ApiClient(await resolveCredentials(ctx.global))
  const id = target.startsWith('tpl_')
    ? target
    : (await client.get<{ data: { id: string; slug: string }[] }>('/templates')).data.find(
        (t) => t.slug === target,
      )?.id

  if (!id) throw new CliError(`No template with id or slug "${target}".`)

  const versions = await client.get<{ data: { version: number; created_at: string }[] }>(
    `/templates/${id}/versions`,
  )
  const ordered = versions.data.sort((a, b) => b.version - a.version)
  const to = (ctx.args.flags.to as number | undefined) ?? ordered[1]?.version

  if (to === undefined) throw new CliError('There is no earlier version to roll back to.')

  // `--yes` documented a confirmation that did not exist, which made it the
  // more surprising half of the pair: a rollback changes what production is
  // sending on the next message, and it was doing that without asking.
  const current = ordered[0]?.version
  if (ctx.args.flags.yes !== true) {
    const what = current === undefined ? `${target}` : `${target} from v${current}`
    if (!(await confirm(`Roll ${what} back to v${to}?`))) {
      note('Nothing was rolled back.')
      return
    }
  }

  const result = await client.post<{ version: number }>(`/templates/${id}/rollback`, {
    version: to,
  })
  ok(`${target} is now serving v${result.version}.`)
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

export const exportFlags: FlagSpecs = {
  status: { kind: 'list', describe: 'Only these delivery states, e.g. bounced,complained' },
  from: { kind: 'string', describe: 'Start of the window, e.g. 2026-08-13' },
  to: { kind: 'string', describe: 'End of the window, e.g. 2026-09-12' },
  domain: { kind: 'string', describe: 'Only mail from this domain id' },
  provider: { kind: 'string', describe: 'Only mail sent through this transport' },
  recipient: { kind: 'string', describe: 'Only mail to this address' },
  tag: { kind: 'string', describe: 'Only messages carrying this tag name' },
  search: { kind: 'string', describe: 'Substring of the subject, sender or recipient' },
  format: { kind: 'string', describe: 'csv | ndjson', default: 'csv' },
  output: { kind: 'string', short: 'o', describe: 'Where to write the file' },
}

/**
 * Exports the message log.
 *
 * It used to advertise four resources — contacts, logs, events, suppressions —
 * and `POST /v1/exports`, and there has never been such a route. What exists is
 * `GET /v1/logs/export`, which queues a job, and the worker that writes one
 * file: the message log, filtered exactly as the log page filters it. So this
 * exports that, and the flags below are the filter set the server compiles,
 * one for one. Contacts already come out through `contacts export` in the
 * dashboard; promising them here would have been the same invention again.
 */
export const exportData = async (ctx: CommandContext) => {
  const client = new ApiClient(await resolveCredentials(ctx.global))

  const format = String(ctx.args.flags.format)
  if (format !== 'csv' && format !== 'ndjson') {
    throw new CliError(`--format is csv or ndjson, not "${format}".`)
  }

  const statuses = ctx.args.flags.status as string[]
  const query: Record<string, string | undefined> = {
    format,
    ...(statuses.length > 0 ? { status: statuses.join(',') } : {}),
    ...(ctx.args.flags.from === undefined ? {} : { from: String(ctx.args.flags.from) }),
    ...(ctx.args.flags.to === undefined ? {} : { to: String(ctx.args.flags.to) }),
    ...(ctx.args.flags.domain === undefined ? {} : { domain_id: String(ctx.args.flags.domain) }),
    ...(ctx.args.flags.provider === undefined ? {} : { provider: String(ctx.args.flags.provider) }),
    ...(ctx.args.flags.recipient === undefined
      ? {}
      : { recipient: String(ctx.args.flags.recipient) }),
    ...(ctx.args.flags.tag === undefined ? {} : { tag: String(ctx.args.flags.tag) }),
    ...(ctx.args.flags.search === undefined ? {} : { search: String(ctx.args.flags.search) }),
  }

  const job = await client.get<{ id: string; status: string }>('/logs/export', query)

  const progress = new Progress('Preparing the export')
  let state: { status: string; rows?: number; truncated?: boolean; max_rows?: number } = job

  // The job is asynchronous because the honest range here is millions of rows.
  // `queued` is also what a not-yet-written record looks like, which is why the
  // status route reports it rather than 404 — a poller that gave up on the
  // first miss would give up on every export.
  for (let attempt = 0; state.status === 'queued' || state.status === 'running'; attempt++) {
    if (attempt >= 150) {
      progress.stop()
      throw new CliError(`Export ${job.id} is still running.`, {
        hint: `Check it with: mailysend export --status … or GET /v1/exports/${job.id}`,
      })
    }
    await new Promise((r) => setTimeout(r, 2000))
    state = await client.get(`/exports/${job.id}`)
  }
  progress.stop()

  if (state.status !== 'complete')
    throw new CliError(`Export ${job.id} finished as "${state.status}".`)

  const destination = resolve(
    (ctx.args.flags.output as string | undefined) ??
      `messages-${new Date().toISOString().slice(0, 10)}.${format}`,
  )
  await mkdir(dirname(destination), { recursive: true })

  const response = await client.stream(`/exports/${job.id}/download`)
  if (!response.body) throw new CliError('The export came back empty.')
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destination))

  ok(`Wrote ${style.cyan(destination)}${state.rows === undefined ? '' : ` — ${state.rows} rows`}`)
  if (state.truncated) {
    // Said out loud, because a truncated file that looks complete is the worst
    // outcome this command has.
    note(`Cut off at ${state.max_rows} rows. Narrow the window with --from/--to and run it again.`)
  }
}

// ---------------------------------------------------------------------------
// upgrade
// ---------------------------------------------------------------------------

export const upgradeFlags: FlagSpecs = {
  check: { kind: 'boolean', describe: 'Only report, never suggest installing' },
}

interface VersionCache {
  latest: string
  checkedAt: number
}

/**
 * The CLI reports and instructs; it never installs itself. A tool that
 * overwrites its own binary has to guess the package manager, the permissions
 * and whether it is inside a lockfile-managed project — and it guesses wrong
 * on exactly the machines where being wrong is expensive.
 */
export const upgrade = async (ctx: CommandContext, currentVersion: string) => {
  const cached = await readState<VersionCache>('version-check')
  const fresh = cached && Date.now() - cached.checkedAt < 3_600_000

  let latest = cached?.latest
  if (!fresh) {
    // `mailysend`, not `@mailysend/cli`. The CLI ships inside the `mailysend`
    // package as its `bin` — one name for the library and the command, which
    // is what every `npx mailysend …` in the docs assumes. `@mailysend/cli` is
    // a workspace build unit and has never been published; asking npm for it
    // returned a 404 and turned `upgrade` into an error message.
    const response = await fetch('https://registry.npmjs.org/mailysend/latest')
    if (!response.ok) throw new CliError(`The npm registry returned ${response.status}.`)
    latest = ((await response.json()) as { version: string }).version
    await writeState('version-check', { latest, checkedAt: Date.now() })
  }

  out()
  kv([
    ['installed', currentVersion],
    [
      'latest',
      latest === currentVersion ? style.green(String(latest)) : style.yellow(String(latest)),
    ],
  ])
  out()

  if (latest === currentVersion) {
    ok('Up to date.')
    return
  }
  if (ctx.args.flags.check === true) return
  note('To upgrade:')
  out(`  ${style.cyan('npm i -g mailysend@latest')}`)
}
