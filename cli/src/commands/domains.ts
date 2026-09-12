import { ApiClient } from '../api.ts'
import type { FlagSpecs } from '../args.ts'
import { CliError, type CommandContext } from '../command.ts'
import { resolveCredentials } from '../config.ts'
import { note, ok, out, Progress, style, table, warn } from '../term.ts'

export const domainsFlags: FlagSpecs = {
  wait: { kind: 'boolean', short: 'w', describe: 'Poll until the domain verifies or fails' },
  timeout: { kind: 'number', describe: 'Give up after this many seconds', default: 600 },
  json: { kind: 'boolean', describe: 'Print the domain record as JSON' },
}

export const domainsSetFlags: FlagSpecs = {
  provider: {
    kind: 'string',
    describe: 'Pin this domain to one transport: cloudflare, ses, resend, smtp, or none',
  },
  unset: { kind: 'boolean', describe: 'Return the domain to the workspace routing rules' },
  json: { kind: 'boolean', describe: 'Print the updated domain record as JSON' },
}

const PROVIDERS = ['cloudflare', 'ses', 'resend', 'smtp'] as const

interface DnsRecord {
  record: string
  name: string
  value: string
  status: string
  priority?: number
  purpose?: string
  provider?: string
}

interface Domain {
  id: string
  name: string
  status: string
  provider?: string | null
  records?: DnsRecord[]
  dkim_ready?: boolean
  spf_ready?: boolean
  dmarc_policy?: string
}

const STATUS_STYLE: Record<string, (s: string) => string> = {
  verified: style.green,
  pending: style.yellow,
  not_started: style.dim,
  failed: style.red,
  temporary_failure: style.yellow,
}

const paint = (status: string) => (STATUS_STYLE[status] ?? style.gray)(status)

/** Long DNS values (a DKIM public key) are unreadable and uncopyable in full. */
const truncate = (value: string, max = 48) =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`

export const showRecords = (domain: Domain) => {
  const records = domain.records ?? []
  if (records.length === 0) {
    warn('No DNS records returned for this domain yet.')
    return
  }

  out()
  table(
    [{ header: 'type' }, { header: 'name' }, { header: 'value' }, { header: 'status' }],
    records.map((record) => [
      record.record,
      record.name,
      truncate(record.value),
      paint(record.status),
    ]),
  )
  out()
  note(
    'Values are truncated for width — `mailysend domains verify <id> --json` prints them in full.',
  )
}

const findDomain = async (client: ApiClient, target: string): Promise<Domain> => {
  if (target.startsWith('dom_')) return client.get<Domain>(`/domains/${target}`)
  const list = await client.get<{ data: Domain[] }>('/domains')
  const found = list.data?.find((d) => d.name.toLowerCase() === target.toLowerCase())
  if (!found) throw new CliError(`No domain named ${target} in this workspace.`)
  return found
}

export const domainsVerify = async (ctx: CommandContext) => {
  const target = ctx.args.positionals[2]
  if (!target) throw new CliError('Which domain? `mailysend domains verify acme.com`')

  const client = new ApiClient(await resolveCredentials(ctx.global))
  const domain = await findDomain(client, target)

  const verify = () => client.post<Domain>(`/domains/${domain.id}/verify`)
  let current = await verify()

  // `--wait` is honoured before `--json` returns: a script that asked to wait
  // and got the first, still-pending answer would have been told the domain
  // failed to verify when it had not finished trying.
  if (ctx.args.flags.wait === true && current.status !== 'verified') {
    const deadline = Date.now() + Number(ctx.args.flags.timeout ?? 600) * 1000
    const progress = new Progress(`Waiting for ${domain.name} to verify`)
    // Fixed 15s between checks: DNS propagation is measured in minutes and
    // polling harder only annoys the resolver.
    while (Date.now() < deadline && current.status !== 'verified' && current.status !== 'failed') {
      await new Promise((resolve) => setTimeout(resolve, 15_000))
      current = await verify()
    }
    progress.stop()
  }

  if (ctx.args.flags.json === true) {
    out(JSON.stringify(current, null, 2))
    return
  }

  out()
  out(`${style.bold(current.name)}  ${paint(current.status)}`)
  showRecords(current)

  if (current.status === 'verified') {
    ok(`${current.name} is verified and can send.`)
    if (current.dmarc_policy === 'missing') {
      warn('No DMARC record. Mail will deliver, but alignment is unenforced.')
    }
    return
  }

  note('Add the records above at your DNS provider, then run this again.')
  if (ctx.args.flags.wait !== true) note('`--wait` polls until it verifies.')
}

/**
 * Binds one domain to one transport — the migration move, and the way back.
 *
 * This is a thin command over `PATCH /v1/domains/:id`, which the dashboard
 * already exposes. `--provider none` (or `--unset`) sends `null`, which returns
 * the domain to the workspace's routing rules; a cutover you cannot reverse
 * from the same tool you did it with is not a cutover anyone should run.
 */
export const domainsSet = async (ctx: CommandContext) => {
  const target = ctx.args.positionals[2]
  if (!target) {
    throw new CliError('Which domain? `mailysend domains set acme.com --provider resend`')
  }

  const raw = ctx.args.flags.provider as string | undefined
  const unset = ctx.args.flags.unset === true || raw === 'none'
  if (!unset && raw === undefined) {
    throw new CliError('Pass --provider <cloudflare|ses|resend|smtp>, or --provider none.')
  }
  if (!unset && !PROVIDERS.includes(raw as (typeof PROVIDERS)[number])) {
    throw new CliError(`Unknown provider: ${raw}`, {
      hint: `One of ${PROVIDERS.join(', ')} — or \`none\` to unpin.`,
    })
  }

  const client = new ApiClient(await resolveCredentials(ctx.global))
  const domain = await findDomain(client, target)
  const updated = await client.patch<Domain>(`/domains/${domain.id}`, {
    provider: unset ? null : raw,
  })

  if (ctx.args.flags.json === true) {
    out(JSON.stringify(updated, null, 2))
    return
  }

  out()
  if (unset) {
    ok(`${updated.name} follows the workspace routing rules again.`)
    note('`mailysend traffic` shows what those rules currently split.')
    return
  }
  ok(`${updated.name} now sends through ${style.cyan(String(updated.provider ?? raw))}.`)
  note('Records that differ by transport are reissued — run `mailysend domains verify` to see.')
}
