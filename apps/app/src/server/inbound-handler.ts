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

export async function handleInboundEmail(message: EmailMessageLike, env: Env): Promise<void> {
  const to = message.to.toLowerCase()
  const workspaceId = DEFAULT_WORKSPACE
  const sql = tenancyFor(env).db(workspaceId)

  const mailbox = await sql
    .prepare(
      'SELECT id FROM inbound_mailboxes WHERE workspace_id = ? AND address = ? AND enabled = 1',
    )
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
    received_at: new Date().toISOString(),
  })
}
