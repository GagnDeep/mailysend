import { doName, newId, r2Key, sha256Hex, verifyReplyToken } from '@mailysend/core'
import type { QueueBatch } from '@mailysend/platform'
import PostalMime from 'postal-mime'
import { tenancyFor } from '../context.ts'
import type { Env } from '../env.ts'

/**
 * Inbound mail.
 *
 * The `email()` handler does the absolute minimum — read a few headers, stream
 * the raw bytes into R2, enqueue — because it runs inside Cloudflare's mail
 * pipeline and a slow handler there is a deferred message. Everything
 * expensive, including MIME parsing, happens here where the CPU budget is
 * generous.
 */

export interface InboundJob {
  workspace_id: string
  inbound_id: string
  raw_key: string
  to: string
  from: string
  received_at: string
}

/** Beyond this we store the message but do not attempt a full parse. */
const MAX_PARSE_BYTES = 25 * 1024 * 1024

export async function consumeInbound(batch: QueueBatch<InboundJob>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await handleInbound(message.body, env)
      message.ack()
    } catch (err) {
      console.error('[inbound] parse failed', err)
      if (message.attempts < 3) message.retry({ delaySeconds: 30 })
      else {
        // Mail is never silently lost. If parsing keeps failing the message is
        // still recorded with `parse_status = 'raw_only'` and the raw bytes are
        // in R2 — a user can download and read it, which is the floor.
        await recordRawOnly(message.body, env, err)
        message.ack()
      }
    }
  }
}

async function handleInbound(job: InboundJob, env: Env): Promise<void> {
  const sql = tenancyFor(env).db(job.workspace_id)

  const mailbox = await sql
    .prepare('SELECT id, address FROM inbound_mailboxes WHERE workspace_id = ? AND address = ?')
    .bind(job.workspace_id, job.to.toLowerCase())
    .first<{ id: string; address: string }>()
  if (!mailbox) return

  const object = await env.BUCKET.get(job.raw_key)
  if (!object) throw new Error(`raw inbound ${job.raw_key} is missing`)
  if (object.size > MAX_PARSE_BYTES) {
    await recordRawOnly(
      job,
      env,
      new Error(`message is ${object.size} bytes, over the parse ceiling`),
    )
    return
  }

  const parsed = await PostalMime.parse(await object.arrayBuffer())

  // Threading, in descending order of confidence. An invalid reply token never
  // drops mail — it falls through to the next signal and is flagged, because a
  // token that has expired or been re-signed is a routing hint, not an
  // authorisation.
  const replyTokenThreadId = await extractReplyToken(
    env,
    parsed.to?.map((a) => a.address ?? '') ?? [],
  )
  const subjectNormalized = normalizeSubject(parsed.subject ?? '')
  const participants = [
    parsed.from?.address ?? job.from,
    ...(parsed.to ?? []).map((a) => a.address ?? ''),
    ...(parsed.cc ?? []).map((a) => a.address ?? ''),
  ].filter(Boolean)

  const actor = env.MAILBOX.get(doName('Mailbox', job.workspace_id, mailbox.id))
  const resolution = await actor.resolveThread({
    replyTokenThreadId,
    inReplyTo: parsed.inReplyTo ?? null,
    references: parseReferences(parsed.references),
    subjectNormalized,
    participants,
    receivedAt: job.received_at,
  })
  const threadId = resolution.threadId ?? newId('thread')

  // Bodies and attachments live in R2 at the documented path; the actor keeps
  // only headers, a ≤2 KB snippet and the FTS index, so its SQLite stays small
  // enough to search quickly no matter how large the mailbox gets.
  const bodyKey = r2Key.inbound(job.workspace_id, threadId, `${job.inbound_id}.json`)
  await env.BUCKET.put(
    bodyKey,
    JSON.stringify({ html: parsed.html ?? null, text: parsed.text ?? null }),
    { httpMetadata: { contentType: 'application/json' } },
  )

  const attachments: { filename: string; content_type: string; size: number; key: string }[] = []
  for (const attachment of parsed.attachments ?? []) {
    const filename = attachment.filename ?? 'attachment'
    const key = r2Key.inbound(
      job.workspace_id,
      threadId,
      `${job.inbound_id}-${sanitizeFilename(filename)}`,
    )
    await env.BUCKET.put(key, attachment.content as ArrayBuffer, {
      httpMetadata: { contentType: attachment.mimeType ?? 'application/octet-stream' },
    })
    attachments.push({
      filename,
      content_type: attachment.mimeType ?? 'application/octet-stream',
      size: (attachment.content as ArrayBuffer).byteLength,
      key,
    })
  }

  const snippet = (parsed.text ?? stripTags(parsed.html ?? '')).slice(0, 2048)

  await actor.appendMessage({
    threadId,
    message: {
      id: job.inbound_id,
      thread_id: threadId,
      message_id_header: parsed.messageId ?? null,
      from_address: parsed.from?.address ?? job.from,
      to_addresses: JSON.stringify((parsed.to ?? []).map((a) => a.address)),
      subject: parsed.subject ?? '',
      snippet,
      body_key: bodyKey,
      attachments: JSON.stringify(attachments),
      received_at: job.received_at,
    } as never,
    subject: parsed.subject ?? '(no subject)',
    subjectNormalized,
    participants,
  })

  await sql
    .prepare(
      `INSERT INTO inbound_messages
         (id, workspace_id, mailbox_id, thread_id, message_id_header, in_reply_to,
          from_address, to_addresses, subject, snippet, raw_key, body_key,
          parse_status, matched_by, received_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'parsed', ?,?)
       ON CONFLICT (workspace_id, raw_key) DO NOTHING`,
    )
    .bind(
      job.inbound_id,
      job.workspace_id,
      mailbox.id,
      threadId,
      parsed.messageId ?? null,
      parsed.inReplyTo ?? null,
      parsed.from?.address ?? job.from,
      JSON.stringify((parsed.to ?? []).map((a) => a.address)),
      parsed.subject ?? '',
      snippet.slice(0, 500),
      job.raw_key,
      bodyKey,
      resolution.matchedBy,
      job.received_at,
    )
    .run()

  await env.AUTOMATION_QUEUE.send({
    type: 'inbound.received',
    workspace_id: job.workspace_id,
    thread_id: threadId,
    message_id: job.inbound_id,
  })
}

async function recordRawOnly(job: InboundJob, env: Env, err: unknown): Promise<void> {
  const sql = tenancyFor(env).db(job.workspace_id)
  await sql
    .prepare(
      `INSERT INTO inbound_messages
         (id, workspace_id, mailbox_id, thread_id, from_address, to_addresses, subject,
          snippet, raw_key, parse_status, matched_by, received_at)
       VALUES (?,?,'','',?,?,'','',?, 'raw_only', ?, ?)
       ON CONFLICT (workspace_id, raw_key) DO NOTHING`,
    )
    .bind(
      job.inbound_id,
      job.workspace_id,
      job.from,
      JSON.stringify([job.to]),
      job.raw_key,
      // `matched_by` doubles as the reason column here: a raw_only row was never
      // threaded, so recording *why* it could not be parsed is more useful than
      // recording a matching strategy that never ran.
      `parse_failed: ${String(err).slice(0, 200)}`,
      job.received_at,
    )
    .run()
}

/** `thr+<token>@domain` — the highest-confidence threading signal we mint. */
async function extractReplyToken(env: Env, recipients: string[]): Promise<string | null> {
  for (const address of recipients) {
    const local = address.split('@')[0]
    const token = local?.startsWith('thr+') ? local.slice(4) : null
    if (!token) continue
    const verified = await verifyReplyToken(env.MS_SECRET, token)
    if (verified) return verified.threadId
  }
  return null
}

const parseReferences = (value: string | string[] | undefined): string[] =>
  Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []

/** Strips every `Re:`/`Fwd:` prefix, including the localised ones people actually send. */
const normalizeSubject = (subject: string): string =>
  subject
    .replace(/^(\s*(re|aw|fwd?|fw|sv|vs|antw|res|rif)\s*(\[\d+\])?\s*:\s*)+/i, '')
    .trim()
    .toLowerCase()

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Inbound filenames are attacker-controlled; the blob layer also rejects these. */
const sanitizeFilename = (name: string): string =>
  name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100) || 'attachment'

export { sha256Hex }
