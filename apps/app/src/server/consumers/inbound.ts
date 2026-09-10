import { doName, newId, r2Key, sha256Hex, verifyReplyToken } from '@mailysend/core'
import type { QueueBatch } from '@mailysend/platform'
import PostalMime from 'postal-mime'
import { tenancyFor } from '../context.ts'
import type { Env } from '../env.ts'
import { parseAuthResults } from '../inbound-handler.ts'
import {
  type MailAttachmentInput,
  normalizeSubject,
  snippetOf,
  writeMailMessage,
} from '../services/mail.ts'

/**
 * Inbound mail.
 *
 * The `email()` handler does the absolute minimum — read a few headers, stream
 * the raw bytes into R2, enqueue — because it runs inside Cloudflare's mail
 * pipeline and a slow handler there is a deferred message. Everything
 * expensive, including MIME parsing, happens here where the CPU budget is
 * generous.
 *
 * Two records come out of every message: the mailbox actor's index, which is
 * the threading oracle and backs the MCP search tool, and the SQL conversation
 * model, which is what the dashboard reads. Only the first of those was being
 * written, and `inbound_threads` had no writer at all — so every listing
 * filtered its results against an empty table and the inbox was structurally
 * incapable of showing anything.
 */

export interface InboundJob {
  workspace_id: string
  inbound_id: string
  raw_key: string
  to: string
  from: string
  /** SPF/DKIM/DMARC as the receiving edge saw them; unavailable to us later. */
  auth?: { spf: string | null; dkim: string | null; dmarc: string | null }
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

  const raw = await object.arrayBuffer()
  const parsed = await PostalMime.parse(raw)

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

  const references = parseReferences(parsed.references)
  const actor = env.MAILBOX.get(doName('Mailbox', job.workspace_id, mailbox.id))
  const resolution = await actor.resolveThread({
    replyTokenThreadId,
    inReplyTo: parsed.inReplyTo ?? null,
    references,
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

  const attachments: MailAttachmentInput[] = []
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
      contentType: attachment.mimeType ?? 'application/octet-stream',
      size: (attachment.content as ArrayBuffer).byteLength,
      contentId: attachment.contentId?.replace(/^<|>$/g, '') ?? null,
      inline: attachment.disposition === 'inline',
      blobKey: key,
    })
  }

  const snippet = snippetOf(parsed.text, parsed.html)
  // The header the queue carried wins: it was read at the edge, where the
  // connecting IP still existed. Falling back to the parsed copy covers a
  // message replayed from R2 by a runtime with no mail pipeline of its own.
  const auth =
    job.auth ?? parseAuthResults(headerValue(parsed.headers, 'authentication-results') ?? null)

  await actor.appendMessage({
    threadId,
    message: {
      id: job.inbound_id,
      thread_id: threadId,
      message_id_header: parsed.messageId ?? null,
      in_reply_to: parsed.inReplyTo ?? null,
      matched_by: resolution.matchedBy,
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
          spf, dkim, dmarc, parse_status, matched_by, received_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'parsed', ?,?)
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
      auth.spf,
      auth.dkim,
      auth.dmarc,
      resolution.matchedBy,
      job.received_at,
    )
    .run()

  // The conversation model — the half that was missing. Without this row the
  // thread does not exist as far as any listing, search or reading pane is
  // concerned, however completely the actor indexed it.
  await writeMailMessage(
    sql,
    {
      id: job.inbound_id,
      workspaceId: job.workspace_id,
      threadId,
      direction: 'in',
      environment: 'live',
      mailboxId: mailbox.id,
      sourceId: job.inbound_id,
      messageIdHeader: parsed.messageId ?? null,
      inReplyTo: parsed.inReplyTo ?? null,
      references,
      fromAddress: parsed.from?.address ?? job.from,
      fromName: parsed.from?.name ?? null,
      to: (parsed.to ?? []).map((a) => a.address ?? '').filter(Boolean),
      cc: (parsed.cc ?? []).map((a) => a.address ?? '').filter(Boolean),
      replyTo: parsed.replyTo?.[0]?.address ?? null,
      subject: parsed.subject ?? '',
      snippet,
      sizeBytes: raw.byteLength,
      bodyKey,
      rawKey: job.raw_key,
      spf: auth.spf,
      dkim: auth.dkim,
      dmarc: auth.dmarc,
      matchedBy: resolution.matchedBy,
      at: job.received_at,
      attachments,
      unread: true,
    },
    {
      id: threadId,
      workspaceId: job.workspace_id,
      mailboxId: mailbox.id,
      environment: 'live',
      subject: parsed.subject || '(no subject)',
      subjectNormalized,
      participants,
      folder: 'inbox',
      lastMessageAt: job.received_at,
      lastDirection: 'in',
      snippet,
      hasAttachments: attachments.length > 0,
    },
  )

  await env.AUTOMATION_QUEUE.send({
    type: 'inbound.received',
    workspace_id: job.workspace_id,
    thread_id: threadId,
    message_id: job.inbound_id,
  })

  // The Mail surface subscribes to this hub, so a message that arrives while
  // someone is reading appears without a refresh. `inbound.received` is not a
  // delivery event and deliberately does not go through the events queue — it
  // has no place on the message state ladder.
  const hub = env.WORKSPACE_HUB.get(doName('WorkspaceHub', job.workspace_id))
  await hub.publish([
    {
      type: 'inbound.received',
      at: job.received_at,
      data: { thread_id: threadId, message_id: job.inbound_id, mailbox_id: mailbox.id },
    },
  ])
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

  // A message we could not parse still belongs in the inbox, in its own thread,
  // with the raw bytes one click away. Hiding it until someone reads the logs
  // is how "we never lose mail" quietly stops being true.
  const threadId = newId('thread')
  await writeMailMessage(
    sql,
    {
      id: job.inbound_id,
      workspaceId: job.workspace_id,
      threadId,
      direction: 'in',
      environment: 'live',
      sourceId: job.inbound_id,
      fromAddress: job.from,
      to: [job.to],
      subject: '(unparsed message)',
      snippet: `MIME parsing failed: ${String(err).slice(0, 200)}`,
      rawKey: job.raw_key,
      parseStatus: 'raw_only',
      matchedBy: 'new',
      at: job.received_at,
      unread: true,
    },
    {
      id: threadId,
      workspaceId: job.workspace_id,
      environment: 'live',
      subject: '(unparsed message)',
      subjectNormalized: '(unparsed message)',
      participants: [job.from, job.to],
      folder: 'inbox',
      lastMessageAt: job.received_at,
      lastDirection: 'in',
      snippet: 'MIME parsing failed. The original bytes are intact.',
      hasAttachments: false,
    },
  ).catch((writeErr) => {
    console.warn('[inbound] could not index the unparsed message', writeErr)
    return false
  })
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

/** postal-mime hands headers back as a list, not a map. */
const headerValue = (
  headers: { key: string; value: string }[] | undefined,
  name: string,
): string | undefined => headers?.find((h) => h.key.toLowerCase() === name)?.value

const parseReferences = (value: string | string[] | undefined): string[] =>
  Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []

/** Inbound filenames are attacker-controlled; the blob layer also rejects these. */
const sanitizeFilename = (name: string): string =>
  name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100) || 'attachment'

export { sha256Hex }
