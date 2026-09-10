import { DEFAULT_WORKSPACE, newId, r2Key, sha256Hex } from '@mailysend/core'
import type { Sql } from '@mailysend/platform'
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

/**
 * The one place that decides whether an address is deliverable.
 *
 * Exported because the queue consumer has to reach the same answer: it used to
 * run its own copy of the exact-address query, so the day the two drifted would
 * be the day a message was accepted at the door and then silently dropped after
 * the raw bytes were already in R2. One function, two callers.
 *
 * Exact address first, then the domain's catch-all. That order matters: a
 * mailbox with its own webhook, agent flag and threads must keep receiving its
 * own mail even when a catch-all exists beside it.
 */
export async function resolveMailbox(
  sql: Sql,
  workspaceId: string,
  recipient: string,
): Promise<{ id: string; address: string; matched: 'address' | 'catch_all' } | null> {
  const to = recipient.toLowerCase()
  const exact = await sql
    .prepare('SELECT id, address FROM inbound_mailboxes WHERE workspace_id = ? AND address = ?')
    .bind(workspaceId, to)
    .first<{ id: string; address: string }>()
  if (exact) return { ...exact, matched: 'address' }

  const domain = to.split('@')[1]
  if (!domain) return null

  // `domain` is denormalised and backfilled, but a row written before the
  // column existed and never touched since can still hold null — so the
  // fallback matches on the address suffix rather than missing the catch-all.
  const catchAll = await sql
    .prepare(
      `SELECT id, address FROM inbound_mailboxes
        WHERE workspace_id = ? AND is_catch_all = 1
          AND (domain = ? OR (domain IS NULL AND address LIKE ?))
        LIMIT 1`,
    )
    .bind(workspaceId, domain, `%@${domain}`)
    .first<{ id: string; address: string }>()
  return catchAll ? { ...catchAll, matched: 'catch_all' } : null
}

export async function handleInboundEmail(message: EmailMessageLike, env: Env): Promise<void> {
  const to = message.to.toLowerCase()
  const workspaceId = await resolveWorkspace(env, to)
  if (!workspaceId) {
    console.warn(`[inbound] rejected ${to} — no workspace owns that domain`)
    message.setReject(`550 5.1.1 No such mailbox: ${to}`)
    return
  }
  const sql = tenancyFor(env).db(workspaceId)

  // No `enabled` predicate: `inbound_mailboxes` has never had that column, so
  // this query threw inside Cloudflare's mail pipeline on every single inbound
  // message. Every one of them was deferred and then bounced.
  const mailbox = await resolveMailbox(sql, workspaceId, to)

  if (!mailbox) {
    // Rejecting at SMTP time is the honest answer: the sender gets an immediate
    // 550 naming the address, instead of silence that looks like delivery.
    //
    // It is also the failure an operator is most likely to hit — bind the
    // catch-all in Cloudflare, send a test from Gmail, watch nothing arrive —
    // and until now it left no trace anywhere: no log line, no row, nothing to
    // distinguish it from a Worker that was never invoked. Both now exist.
    console.warn(
      `[inbound] rejected ${to} — no mailbox and no catch-all on ${to.split('@')[1] ?? '?'}`,
    )
    await recordInboundReject(sql, workspaceId, to, message.from, 'no_mailbox')
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
    mailbox_id: mailbox.id,
    matched: mailbox.matched,
    auth: parseAuthResults(message.headers.get('authentication-results')),
    received_at: new Date().toISOString(),
  })
}

/**
 * A rejection somebody can find without `wrangler tail`.
 *
 * `message_events` is where the product already looks for "what happened to
 * this address", and an inbound rejection has exactly the shape it wants: a
 * type, a recipient, a time and a diagnostic. `message_id` is null because
 * there is no message — nothing was accepted — which is precisely the fact
 * being recorded.
 *
 * Never allowed to throw. This runs on the path to a `setReject` that has to
 * happen whether or not the database is reachable; a failure to write the
 * breadcrumb must not turn a clean 550 into a deferral.
 */
export async function recordInboundReject(
  sql: Sql,
  workspaceId: string,
  to: string,
  from: string,
  reason: 'no_mailbox' | 'mailbox_vanished',
): Promise<void> {
  try {
    const now = new Date().toISOString()
    await sql
      .prepare(
        `INSERT INTO message_events (event_id, workspace_id, message_id, type, recipient, occurred_at, diagnostic, created_at)
         VALUES (?,?,NULL,'inbound.rejected',?,?,?,?)
         ON CONFLICT (event_id) DO NOTHING`,
      )
      .bind(
        await sha256Hex(`inbound.rejected|${workspaceId}|${to}|${from}|${now}`),
        workspaceId,
        to,
        now,
        reason === 'no_mailbox'
          ? `550 5.1.1 No such mailbox: ${to}. Create it under the domain's Receiving tab, or turn on the catch-all there.`
          : `Accepted at the door, then the mailbox was gone before the message was filed: ${to}`,
        now,
      )
      .run()
  } catch (err) {
    console.error('[inbound] could not record the rejection', err)
  }
}
