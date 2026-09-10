import { DEFAULT_WORKSPACE, newId, r2Key } from '@mailysend/core'
import { tenancyFor } from './context.ts'
import type { Env } from './env.ts'

/**
 * The `email()` handler.
 *
 * This runs inside Cloudflare's mail pipeline, where a slow handler means a
 * deferred message and eventually a bounce. So it does exactly three things:
 * check the recipient exists, stream the raw bytes into R2 without buffering
 * them, and enqueue. Parsing happens in `ms-inbound`, where the CPU limit is
 * 60 seconds instead of a few milliseconds of goodwill.
 */

export interface EmailMessageLike {
  from: string
  to: string
  raw: ReadableStream
  rawSize: number
  headers: Headers
  setReject(reason: string): void
}

/**
 * Which workspace owns this recipient.
 *
 * Single-instance deployments have exactly one, and asking the database would
 * be a round trip to learn a constant. In multi-tenant mode the recipient's
 * domain is the only thing in the envelope that can name a tenant, so the
 * lookup goes through `domains` — an unrecognised domain resolves to nothing
 * and the message is rejected rather than filed under a stranger's workspace.
 */
async function resolveWorkspace(env: Env, recipient: string): Promise<string | null> {
  if (env.MS_MODE !== 'saas') return DEFAULT_WORKSPACE
  const domain = recipient.split('@')[1]?.toLowerCase()
  if (!domain) return null
  const sql = tenancyFor(env).db('')
  const row = await sql
    .prepare('SELECT workspace_id FROM domains WHERE name = ? LIMIT 1')
    .bind(domain)
    .first<{ workspace_id: string }>()
  return row?.workspace_id ?? null
}

/**
 * Authentication-Results, as the receiving edge saw it.
 *
 * Cloudflare has already run SPF, DKIM and DMARC by the time this handler is
 * called and records the outcome in the header. Re-deriving it later is
 * impossible — the connecting IP is gone — so the verdicts are captured here
 * and carried on the queue message. They were being discarded, which is why
 * three columns in `inbound_messages` had never held a value.
 */
export function parseAuthResults(header: string | null): {
  spf: string | null
  dkim: string | null
  dmarc: string | null
} {
  if (!header) return { spf: null, dkim: null, dmarc: null }
  const read = (method: string): string | null => {
    const match = new RegExp(`\\b${method}=([a-z]+)`, 'i').exec(header)
    return match?.[1]?.toLowerCase() ?? null
  }
  return { spf: read('spf'), dkim: read('dkim'), dmarc: read('dmarc') }
}

export async function handleInboundEmail(message: EmailMessageLike, env: Env): Promise<void> {
  const to = message.to.toLowerCase()
  const workspaceId = await resolveWorkspace(env, to)
  if (!workspaceId) {
    message.setReject(`550 5.1.1 No such mailbox: ${to}`)
    return
  }
  const sql = tenancyFor(env).db(workspaceId)

  // No `enabled` predicate: `inbound_mailboxes` has never had that column, so
  // this query threw inside Cloudflare's mail pipeline on every single inbound
  // message. Every one of them was deferred and then bounced.
  const mailbox = await sql
    .prepare('SELECT id FROM inbound_mailboxes WHERE workspace_id = ? AND address = ?')
    .bind(workspaceId, to)
    .first<{ id: string }>()

  if (!mailbox) {
    // Rejecting at SMTP time is the honest answer: the sender gets an immediate
    // 550 naming the address, instead of silence that looks like delivery.
    message.setReject(`550 5.1.1 No such mailbox: ${to}`)
    return
  }

  const inboundId = newId('inbound')
  const rawKey = r2Key.rawInbound(workspaceId, inboundId)

  // `message.raw` is a stream and is passed straight through — buffering a
  // 25 MB message here would be the one thing this handler must not do.
  await env.BUCKET.put(rawKey, message.raw, {
    httpMetadata: { contentType: 'message/rfc822' },
    customMetadata: { from: message.from, to, size: String(message.rawSize) },
  })

  await env.INBOUND_QUEUE.send({
    workspace_id: workspaceId,
    inbound_id: inboundId,
    raw_key: rawKey,
    to,
    from: message.from,
    auth: parseAuthResults(message.headers.get('authentication-results')),
    received_at: new Date().toISOString(),
  })
}
