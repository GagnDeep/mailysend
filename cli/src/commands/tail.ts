import { ApiClient } from '../api.ts'
import type { FlagSpecs } from '../args.ts'
import type { CommandContext } from '../command.ts'
import { CliError } from '../command.ts'
import { resolveCredentials } from '../config.ts'
import { err, note, out, style } from '../term.ts'

/**
 * Follows the message log.
 *
 * This used to open a WebSocket to `wss://…/v1/logs/stream` with the API key in
 * the subprotocol. There is no such route. The deployment's live socket is
 * `GET /v1/live`, and it is deliberately session-cookie only — the comment in
 * `apps/app/src/server/live.ts` says why: a socket is a standing subscription
 * to a workspace's activity, exactly as privileged as the dashboard, and an API
 * key has no business holding one open. Reaching for it from here would have
 * meant widening that boundary to make a command's implementation convenient,
 * which is the wrong direction.
 *
 * So this polls `GET /v1/logs`, which is the endpoint that exists, takes an API
 * key, and supports every filter below. Message ids are ULIDs, so "what is new"
 * is `id > the highest id I have seen` — no timestamps, no overlap window, and
 * no duplicate line if two messages land in the same millisecond.
 *
 * The first poll prints the last few rows and then goes quiet, because a tail
 * that opens on an empty screen looks broken.
 */

export const tailFlags: FlagSpecs = {
  status: {
    kind: 'list',
    describe: 'Only these delivery states, e.g. bounced,complained',
  },
  recipient: { kind: 'string', describe: 'Only mail to this address' },
  domain: { kind: 'string', describe: 'Only mail from this domain id' },
  provider: { kind: 'string', describe: 'Only mail sent through this transport' },
  tag: { kind: 'string', describe: 'Only messages carrying this tag name' },
  interval: { kind: 'number', describe: 'Seconds between polls', default: 3 },
  since: { kind: 'number', describe: 'How many recent messages to print first', default: 10 },
  json: { kind: 'boolean', describe: 'One JSON object per line' },
  once: { kind: 'boolean', describe: 'Print one page and exit instead of following' },
}

interface LogEntry {
  id: string
  from: string
  to: string[]
  subject: string
  status: string
  provider?: string | null
  opens?: number
  clicks?: number
  error?: string | null
  bounce_class?: string | null
  created_at: string
}

const COLOR: Record<string, (s: string) => string> = {
  delivered: style.green,
  sent: style.cyan,
  queued: style.gray,
  scheduled: style.gray,
  opened: style.blue,
  clicked: style.magenta,
  bounced: style.red,
  failed: style.red,
  complained: style.red,
  delayed: style.yellow,
  canceled: style.dim,
}

const describe = (entry: LogEntry): string => {
  const parts = [
    entry.to.join(', '),
    entry.subject,
    entry.error ?? entry.bounce_class ?? '',
  ].filter((part) => part !== '')
  return parts.join(style.dim(' · '))
}

const render = (entry: LogEntry, asJson: boolean) => {
  if (asJson) {
    out(JSON.stringify(entry))
    return
  }
  const paint = COLOR[entry.status] ?? style.gray
  const at = entry.created_at.slice(11, 19)
  out(`${style.dim(at)}  ${paint(entry.status.padEnd(12))}  ${describe(entry)}`)
}

export const tail = async (ctx: CommandContext) => {
  const credentials = await resolveCredentials(ctx.global)
  const client = new ApiClient(credentials)

  const asJson = ctx.args.flags.json === true
  const once = ctx.args.flags.once === true
  const interval = Math.max(1, Number(ctx.args.flags.interval ?? 3)) * 1000
  const backfill = Math.max(0, Math.min(100, Number(ctx.args.flags.since ?? 10)))

  const statuses = ctx.args.flags.status as string[]
  const query: Record<string, string | number | undefined> = {
    limit: 50,
    ...(statuses.length > 0 ? { status: statuses.join(',') } : {}),
    ...(ctx.args.flags.recipient === undefined
      ? {}
      : { recipient: String(ctx.args.flags.recipient) }),
    ...(ctx.args.flags.domain === undefined ? {} : { domain_id: String(ctx.args.flags.domain) }),
    ...(ctx.args.flags.provider === undefined ? {} : { provider: String(ctx.args.flags.provider) }),
    ...(ctx.args.flags.tag === undefined ? {} : { tag: String(ctx.args.flags.tag) }),
  }

  const poll = () => client.get<{ data: LogEntry[] }>('/logs', query)

  let first: LogEntry[]
  try {
    first = (await poll()).data ?? []
  } catch (error) {
    // The very first call is where a wrong base URL, a revoked key or a
    // deployment that is not up yet shows itself. Later failures are treated as
    // weather; this one is not.
    throw error instanceof CliError
      ? error
      : new CliError(`Could not read the log at ${credentials.baseUrl}.`, {
          hint: error instanceof Error ? error.message : String(error),
        })
  }

  // The API returns newest first; a tail reads oldest first.
  const opening = first.slice(0, once ? first.length : backfill).reverse()
  for (const entry of opening) render(entry, asJson)
  let seen = first[0]?.id ?? ''

  if (once) return

  if (!asJson) {
    note(`Following ${credentials.baseUrl}. Ctrl-C to stop.`)
  }

  let stopping = false
  const stop = () => {
    stopping = true
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  let quiet = 0
  while (!stopping) {
    await new Promise((resolve) => setTimeout(resolve, interval))
    if (stopping) break

    let page: LogEntry[]
    try {
      page = (await poll()).data ?? []
      quiet = 0
    } catch (error) {
      // A deployment redeploying, a laptop changing networks: transient, and a
      // tail that exits on the first blip is a tail nobody leaves running. It
      // is still said out loud, on stderr, so a pipe stays clean.
      quiet++
      if (!asJson) err(style.dim(`  ${(error as Error).message} — retrying`))
      if (quiet >= 20) throw error
      continue
    }

    const fresh = page.filter((entry) => entry.id > seen).reverse()
    for (const entry of fresh) render(entry, asJson)
    if (page[0]) seen = page[0].id > seen ? page[0].id : seen
  }
}
