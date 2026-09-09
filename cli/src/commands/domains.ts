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

  if (ctx.args.flags.json === true) {
    out(JSON.stringify(current, null, 2))
    return
  }

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
