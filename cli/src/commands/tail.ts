import type { FlagSpecs } from '../args.ts'
import { CliError, type CommandContext } from '../command.ts'
import { resolveCredentials } from '../config.ts'
import { err, note, out, style } from '../term.ts'

/**
 * Live event streaming.
 *
 * `WorkspaceHubActor` fans committed events out over a WebSocket per workspace,
 * so `tail` is a socket rather than a poll — which is the difference between
 * seeing a bounce as it happens and seeing it up to a poll interval later.
 *
 * The socket is expected to drop: the hub hibernates between events and
 * networks are networks. Reconnecting with backoff and a short buffer replay is
 * therefore normal operation, not error handling, and the reconnect is
 * announced quietly rather than as a failure.
 */

export const tailFlags: FlagSpecs = {
  filter: {
    kind: 'list',
    describe: 'Only show these event types, e.g. email.bounced,email.complained',
  },
  json: { kind: 'boolean', describe: 'One JSON object per line' },
  once: { kind: 'boolean', describe: 'Exit when the stream closes instead of reconnecting' },
}

interface LiveEvent {
  type: string
  at: string
  data: Record<string, unknown>
}

const COLOR: Record<string, (s: string) => string> = {
  'email.delivered': style.green,
  'email.sent': style.cyan,
  'email.opened': style.blue,
  'email.clicked': style.magenta,
  'email.bounced': style.red,
  'email.failed': style.red,
  'email.complained': style.red,
  'email.delivery_delayed': style.yellow,
}

const describe = (event: LiveEvent): string => {
  const data = event.data
  const recipient = Array.isArray(data.to) ? data.to.join(', ') : (data.to as string | undefined)
  const parts = [
    recipient ?? (data.email as string | undefined) ?? '',
    (data.subject as string | undefined) ?? '',
  ].filter((part) => part !== '')
  return parts.join(style.dim(' · '))
}

export const tail = async (ctx: CommandContext) => {
  if (typeof WebSocket === 'undefined') {
    throw new CliError('This Node build has no global WebSocket.', {
      hint: 'Node 22 or newer, or run Node 20 with --experimental-websocket.',
    })
  }

  const credentials = await resolveCredentials(ctx.global)
  const wanted = new Set(ctx.args.flags.filter as string[])
  const asJson = ctx.args.flags.json === true
  const once = ctx.args.flags.once === true

  const url = new URL(`${credentials.baseUrl.replace(/\/+$/, '')}/v1/logs/stream`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  // Browsers forbid headers on a WebSocket handshake, so every WebSocket API
  // that follows the browser shape does too. The key therefore travels as the
  // subprotocol, which is the one field the handshake does expose.
  const protocols = ['mailysend.v1', `bearer.${credentials.apiKey}`]

  if (!asJson) note(`Streaming ${url.host}. Ctrl-C to stop.`)

  let attempt = 0
  let stopping = false
  const stop = () => {
    stopping = true
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  while (!stopping) {
    const closed = await new Promise<'clean' | 'error'>((resolve) => {
      const socket = new WebSocket(url, protocols)

      socket.addEventListener('open', () => {
        attempt = 0
      })

      socket.addEventListener('message', (event) => {
        const payload = safeParse(String((event as MessageEvent).data))
        if (payload?.type !== 'events') return
        for (const item of payload.events ?? []) {
          if (wanted.size > 0 && !wanted.has(item.type)) continue
          if (asJson) {
            out(JSON.stringify(item))
            continue
          }
          const paint = COLOR[item.type] ?? style.gray
          out(
            `${style.dim(item.at.slice(11, 19))}  ${paint(item.type.padEnd(24))}  ${describe(item)}`,
          )
        }
      })

      socket.addEventListener('error', () => resolve('error'))
      socket.addEventListener('close', () => resolve('clean'))

      const watchdog = setInterval(() => {
        if (!stopping) return
        clearInterval(watchdog)
        socket.close()
      }, 200)
      watchdog.unref?.()
    })

    if (stopping || once) break

    // Capped exponential backoff. A hub that is down stays down for a while,
    // and a tight reconnect loop turns one outage into two.
    attempt++
    const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6))
    if (closed === 'error' && !asJson) err(style.dim(`  reconnecting in ${delay / 1000}s`))
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
}

const safeParse = (text: string): { type?: string; events?: LiveEvent[] } | null => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
