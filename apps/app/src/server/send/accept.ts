import { apiError, type SendEmailRequest } from '@mailysend/contracts'
import {
  kvKey,
  MAX_SCHEDULE_MS,
  newId,
  normalizeForSuppression,
  parseAddress,
  parseAddresses,
  parseScheduledAt,
  r2Key,
  rootDomain,
} from '@mailysend/core'
import type { Ctx } from '../context.ts'
import { normalizeSubject, snippetOf, writeMailMessage } from '../services/mail.ts'
import { type Envelope, INLINE_LIMIT, type SendJob } from './envelope.ts'

/**
 * The synchronous half of the send path.
 *
 * Everything here is cheap and deterministic: authenticate, validate, reserve
 * idempotency, check the domain, check suppressions, resolve the schedule,
 * **mint the id**, spool, insert, enqueue, return. No provider is contacted.
 *
 * The id being minted *here* — before anything touches a network — is the
 * decision the whole multi-provider design rests on. The id we hand back is
 * ours, so it survives a failover, a provider migration, and a provider that
 * loses its own id. `provider_message_id` is recorded later and is queryable,
 * but it is never the identity of a message.
 */

export interface AcceptResult {
  id: string
  created_at: string
  /** Recipients dropped because they were suppressed, if any survived. */
  suppressed: string[]
}

interface DomainRow {
  id: string
  name: string
  status: string
  dkim_selector: string
  dkim_private_key: string | null
  custom_return_path: string
  open_tracking: number
  click_tracking: number
  /** The transport this domain is bound to, when it names one. */
  provider: string | null
}

/** Resolve and cache the sending domain for a `from` address. */
async function resolveDomain(ctx: Ctx, fromAddress: string): Promise<DomainRow> {
  const parsed = parseAddress(fromAddress)
  if (!parsed) throw apiError('invalid_from_address', { param: 'from' })
  const domain = parsed.address.split('@')[1]?.toLowerCase()
  if (!domain) throw apiError('invalid_from_address', { param: 'from' })

  const cacheKey = kvKey.domain(ctx.workspace.id, domain)
  let row = await ctx.cache.get<DomainRow>(cacheKey, 'json')
  if (!row) {
    // A subdomain send (`mail.example.com`) is legitimate on a verified apex,
    // so fall back to the registrable domain rather than rejecting it.
    row =
      (await ctx.sql
        .prepare(
          `SELECT id, name, status, dkim_selector, dkim_private_key, custom_return_path,
                  open_tracking, click_tracking, provider
             FROM domains WHERE workspace_id = ? AND name IN (?, ?)
            ORDER BY length(name) DESC LIMIT 1`,
        )
        .bind(ctx.workspace.id, domain, rootDomain(domain))
        .first<DomainRow>()) ?? null
    if (row) await ctx.cache.put(cacheKey, JSON.stringify(row), { expirationTtl: 300 })
  }

  if (!row) {
    throw apiError('invalid_from_address', {
      message: `The domain \`${domain}\` is not registered in this workspace. Add it under Domains, or send from a verified domain.`,
      param: 'from',
    })
  }
  if (row.status !== 'verified' && ctx.actor.environment === 'live') {
    throw apiError('domain_not_verified', {
      message: `\`${row.name}\` is registered but not verified yet. Publish its DNS records, then press Verify.`,
      param: 'from',
    })
  }
  return row
}

/** Suppression is the one KV read on every send, which is why it lives in KV. */
async function filterSuppressed(ctx: Ctx, recipients: string[]): Promise<string[]> {
  const hits = await Promise.all(
    recipients.map(async (address) => {
      const key = kvKey.suppression(ctx.workspace.id, normalizeForSuppression(address))
      return (await ctx.suppressions.get(key)) ? address : null
    }),
  )
  return hits.filter((v): v is string => v !== null)
}

/**
 * Idempotency reservation.
 *
 * The atomic operation is the SQL insert, not the KV write — KV is
 * eventually consistent and two simultaneous retries can both read "absent".
 * `INSERT … ON CONFLICT DO NOTHING` with a changes check is the reservation;
 * KV only caches the completed response so a repeat is cheap.
 */
async function reserveIdempotency(
  ctx: Ctx,
  key: string,
  requestHash: string,
): Promise<{ replay: unknown } | { reserved: true }> {
  const now = new Date()
  const expires = new Date(now.getTime() + 86_400_000).toISOString()

  const res = await ctx.sql
    .prepare(
      `INSERT INTO idempotency_keys (workspace_id, key, request_hash, status, expires_at, created_at)
       VALUES (?, ?, ?, 'in_flight', ?, ?)
       ON CONFLICT (workspace_id, key) DO NOTHING`,
    )
    .bind(ctx.workspace.id, key, requestHash, expires, now.toISOString())
    .run()

  if (res.meta.changes > 0) return { reserved: true }

  const existing = await ctx.sql
    .prepare(
      `SELECT request_hash, response_body, status FROM idempotency_keys
        WHERE workspace_id = ? AND key = ?`,
    )
    .bind(ctx.workspace.id, key)
    .first<{ request_hash: string; response_body: string | null; status: string }>()

  if (!existing) return { reserved: true }
  if (existing.request_hash !== requestHash) throw apiError('idempotency_key_conflict')
  if (existing.status === 'in_flight' || !existing.response_body) {
    throw apiError('concurrent_idempotent_requests')
  }
  return { replay: JSON.parse(existing.response_body) }
}

async function completeIdempotency(ctx: Ctx, key: string, body: unknown): Promise<void> {
  await ctx.sql
    .prepare(
      `UPDATE idempotency_keys SET response_body = ?, status = 'complete'
        WHERE workspace_id = ? AND key = ?`,
    )
    .bind(JSON.stringify(body), ctx.workspace.id, key)
    .run()
}

export interface AcceptOptions {
  idempotencyKey?: string | null
  broadcastId?: string
  automationId?: string
  contactId?: string
  /**
   * Deliver before answering, rather than handing the message to a queue.
   *
   * What somebody pressing Send in the composer wants is the send, and what a
   * queue gives them is a hop that has to exist and has to be consumed —
   * Cloudflare Queues are not on every plan, and a deployment whose consumer is
   * not attached leaves every message at `sending` with nothing to show for it.
   * Bulk traffic still queues, because that is what a queue is good at.
   */
  immediate?: boolean
}

export async function acceptEmail(
  ctx: Ctx,
  request: SendEmailRequest,
  opts: AcceptOptions = {},
): Promise<AcceptResult> {
  const requestHash = await hashRequest(request)

  if (opts.idempotencyKey) {
    const reservation = await reserveIdempotency(ctx, opts.idempotencyKey, requestHash)
    if ('replay' in reservation) return reservation.replay as AcceptResult
  }

  const domain = await resolveDomain(ctx, request.from)

  const to = parseAddresses(request.to)
  const cc = request.cc ? parseAddresses(request.cc) : []
  const bcc = request.bcc ? parseAddresses(request.bcc) : []
  const all = [...to, ...cc, ...bcc]
  if (all.length === 0) throw apiError('invalid_to_address', { param: 'to' })
  if (all.length > 50) throw apiError('too_many_recipients', { param: 'to' })

  let suppressed: string[] = []
  if (!request.ignore_suppression) {
    suppressed = await filterSuppressed(
      ctx,
      all.map((a) => a.address),
    )
    // If *every* recipient is suppressed the send is refused outright — silently
    // accepting a message with nobody to deliver it to would show up in the
    // dashboard as a delivered email that nobody received.
    if (suppressed.length === all.length) {
      throw apiError('recipient_suppressed', {
        message:
          all.length === 1
            ? `\`${all[0]?.address}\` is on this workspace's suppression list.`
            : 'Every recipient of this message is on the suppression list.',
        param: 'to',
      })
    }
  }

  let scheduledAtIso: string | null = null
  if (request.scheduled_at) {
    const parsed = parseScheduledAt(request.scheduled_at)
    if (!parsed) {
      throw apiError('validation_error', {
        message:
          '`scheduled_at` must be an ISO 8601 timestamp or a relative time like `in 1 hour`.',
        param: 'scheduled_at',
      })
    }
    const delta = parsed.at.getTime() - Date.now()
    if (delta < -60_000) throw apiError('scheduling_in_past', { param: 'scheduled_at' })
    if (delta > MAX_SCHEDULE_MS) throw apiError('scheduling_too_far', { param: 'scheduled_at' })
    scheduledAtIso = parsed.at.toISOString()
  }

  const emailId = newId('email')
  const createdAt = new Date().toISOString()

  const pinned = (request.provider ?? domain.provider ?? null) as Envelope['provider'] | null

  const envelope: Envelope = {
    email_id: emailId,
    workspace_id: ctx.workspace.id,
    environment: ctx.actor.environment,
    request: request.ignore_suppression
      ? request
      : { ...request, ...withoutSuppressed(request, suppressed) },
    domain: {
      id: domain.id,
      name: domain.name,
      dkim_selector: domain.dkim_selector,
      dkim_private_key: domain.dkim_private_key,
      return_path: `${domain.custom_return_path}.${domain.name}`,
      open_tracking: Boolean(domain.open_tracking) && request.tracking?.opens !== false,
      click_tracking: Boolean(domain.click_tracking) && request.tracking?.clicks !== false,
    },
    ...(opts.broadcastId ? { broadcast_id: opts.broadcastId } : {}),
    ...(opts.automationId ? { automation_id: opts.automationId } : {}),
    ...(opts.contactId ? { contact_id: opts.contactId } : {}),
    /**
     * The binding decides the transport, unless the caller overrode it.
     *
     * A bound domain publishes one transport's records, so failing over to
     * another produces mail its own SPF does not authorise — silently
     * spam-foldered, which is worse than an error. An explicit `provider` on the
     * request still wins: that is a caller overriding their own configuration on
     * purpose.
     */
    ...(pinned ? { provider: pinned } : {}),
    created_at: createdAt,
  }

  const serialized = JSON.stringify(envelope)
  let job: SendJob
  if (serialized.length <= INLINE_LIMIT) {
    job = { kind: 'inline', email_id: emailId, workspace_id: ctx.workspace.id, envelope }
  } else {
    const key = r2Key.spool(ctx.workspace.id, emailId)
    await ctx.blob.put(key, serialized, { httpMetadata: { contentType: 'application/json' } })
    job = { kind: 'spooled', email_id: emailId, workspace_id: ctx.workspace.id, key }
  }

  const status = scheduledAtIso ? 'scheduled' : 'queued'
  await insertMessage(ctx, {
    emailId,
    envelope,
    status,
    scheduledAt: scheduledAtIso,
    createdAt,
    to,
    cc,
    bcc,
    tags: request.tags ?? [],
    sizeBytes: serialized.length,
  })

  // File the message in the conversation model before it goes anywhere. The
  // Message-ID is derived from the id we just minted (`mime.ts` stamps exactly
  // this string), so the thread linkage is known at accept time and a reply
  // that comes back tomorrow lands on a row that already exists.
  //
  // Broadcast and automation traffic is deliberately excluded: a hundred
  // thousand one-message conversations is not an inbox, and those messages
  // already have a home in the broadcast view.
  if (!opts.broadcastId && !opts.automationId) {
    await indexOutbound(ctx, { emailId, envelope, status, to, cc, bcc, createdAt }).catch((err) => {
      // The mail index is a read model. Failing to write it must never fail a
      // send that has already been accepted and enqueued.
      console.warn('[accept] could not index the outbound message', err)
    })
  }

  if (scheduledAtIso) {
    // Scheduled mail is handed to a shard actor rather than a delayed queue
    // message, because a delayed message cannot be cancelled and `DELETE
    // /v1/emails/:id` has to work.
    await scheduleLater(ctx, emailId, scheduledAtIso, job)
  } else if (opts.immediate || !ctx.env.SEND_QUEUE) {
    // Inline, and then the queue only if the failure was worth retrying. A
    // deployment with no queue binding at all takes this path whatever the
    // caller asked for: losing the message to a binding that is not there is
    // the one outcome nobody can act on.
    const { deliverNow } = await import('./consumer.ts')
    const outcome = await deliverNow(job, ctx.env)
    if (!outcome.delivered && outcome.retryable && ctx.env.SEND_QUEUE) {
      await ctx.env.SEND_QUEUE.send(job)
    }
  } else {
    await ctx.env.SEND_QUEUE.send(job)
  }

  const result: AcceptResult = { id: emailId, created_at: createdAt, suppressed }
  if (opts.idempotencyKey) ctx.background(completeIdempotency(ctx, opts.idempotencyKey, result))
  return result
}

function withoutSuppressed(
  request: SendEmailRequest,
  suppressed: string[],
): Partial<SendEmailRequest> {
  if (suppressed.length === 0) return {}
  const drop = new Set(suppressed.map((s) => s.toLowerCase()))
  const keep = (list?: string[]) =>
    list?.filter((entry) => {
      const parsed = parseAddress(entry)
      return parsed
        ? !drop.has(entry.toLowerCase()) && !drop.has(parsed.address.toLowerCase())
        : true
    })
  return {
    to: keep(request.to) ?? request.to,
    ...(request.cc ? { cc: keep(request.cc) } : {}),
    ...(request.bcc ? { bcc: keep(request.bcc) } : {}),
  }
}

async function insertMessage(
  ctx: Ctx,
  args: {
    emailId: string
    envelope: Envelope
    status: string
    scheduledAt: string | null
    createdAt: string
    to: { address: string }[]
    cc: { address: string }[]
    bcc: { address: string }[]
    tags: { name: string; value: string }[]
    sizeBytes: number
  },
): Promise<void> {
  const { emailId, envelope, tags } = args
  const statements = [
    ctx.sql
      .prepare(
        `INSERT INTO messages (
           id, workspace_id, domain_id, from_address, to_addresses, cc_addresses, bcc_addresses,
           reply_to, subject, status, state_rank, environment, broadcast_id, automation_id,
           contact_id, template_id, scheduled_at, size_bytes, created_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        emailId,
        ctx.workspace.id,
        envelope.domain.id,
        envelope.request.from,
        JSON.stringify(args.to.map((a) => a.address)),
        args.cc.length ? JSON.stringify(args.cc.map((a) => a.address)) : null,
        args.bcc.length ? JSON.stringify(args.bcc.map((a) => a.address)) : null,
        envelope.request.reply_to ? JSON.stringify(envelope.request.reply_to) : null,
        envelope.request.subject,
        args.status,
        args.status === 'scheduled' ? 5 : 10,
        envelope.environment,
        envelope.broadcast_id ?? null,
        envelope.automation_id ?? null,
        envelope.contact_id ?? null,
        envelope.request.template_id ?? null,
        args.scheduledAt,
        args.sizeBytes,
        args.createdAt,
      ),
    ...tags.map((tag) =>
      ctx.sql
        .prepare(
          `INSERT INTO message_tags (workspace_id, message_id, name, value) VALUES (?,?,?,?)`,
        )
        .bind(ctx.workspace.id, emailId, tag.name, tag.value),
    ),
  ]
  await ctx.sql.batch(statements)
}

async function scheduleLater(ctx: Ctx, emailId: string, at: string, job: SendJob): Promise<void> {
  const { doName, stableBucket } = await import('@mailysend/core')
  const shard = stableBucket(emailId, 8)
  const stub = ctx.env.SCHEDULE_SHARD.get(doName('ScheduleShard', ctx.workspace.id, shard))
  // The shard holds only the due time; the job itself stays spooled, so the
  // actor's storage does not grow with message size.
  await ctx.blob.put(`sched/${ctx.workspace.id}/${emailId}.json`, JSON.stringify(job))
  await stub.schedule({ emailId, workspaceId: ctx.workspace.id, dueAt: Date.parse(at) })
}

/**
 * The idempotency fingerprint.
 *
 * Deliberately over the whole normalised body: a client that retries with the
 * same key but a changed body has a bug, and returning the first response
 * would hide it. Key order is normalised so that a differently-serialised but
 * identical request still matches.
 */
async function hashRequest(request: unknown): Promise<string> {
  const { sha256Hex } = await import('@mailysend/core')
  return sha256Hex(stableStringify(request))
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/**
 * The outbound half of the conversation model.
 *
 * Threading is by header only here: if the caller supplied `In-Reply-To` or
 * `References` — which the reply path always does — the message joins the
 * conversation it answers. Otherwise it starts one, filed under `sent`.
 */
async function indexOutbound(
  ctx: Ctx,
  args: {
    emailId: string
    envelope: Envelope
    status: string
    to: { address: string }[]
    cc: { address: string }[]
    bcc: { address: string }[]
    createdAt: string
  },
): Promise<void> {
  const { emailId, envelope, createdAt } = args
  const request = envelope.request
  const headers = request.headers ?? {}
  const inReplyTo = headerOf(headers, 'in-reply-to')
  const references = (headerOf(headers, 'references') ?? '').split(/\s+/).filter(Boolean)

  const { resolveThreadBySql } = await import('../services/mail.ts')
  const resolved = await resolveThreadBySql(ctx.sql, ctx.workspace.id, { inReplyTo, references })
  const threadId = resolved.threadId ?? newId('thread')

  const fromDomain = parseAddress(request.from)?.address.split('@')[1] ?? envelope.domain.name
  const snippet = snippetOf(request.text, request.html ?? request.react)
  const participants = [
    request.from,
    ...args.to.map((a) => a.address),
    ...args.cc.map((a) => a.address),
  ]

  await writeMailMessage(
    ctx.sql,
    {
      id: `mm_${emailId}`,
      workspaceId: ctx.workspace.id,
      threadId,
      direction: 'out',
      environment: envelope.environment,
      sourceId: emailId,
      // Exactly what `buildMime` will stamp. Deterministic on purpose: it is
      // what makes accept-time threading possible at all.
      messageIdHeader: `<${emailId}@${fromDomain}>`,
      inReplyTo,
      references,
      fromAddress: parseAddress(request.from)?.address ?? request.from,
      fromName: parseAddress(request.from)?.name ?? null,
      to: args.to.map((a) => a.address),
      cc: args.cc.map((a) => a.address),
      bcc: args.bcc.map((a) => a.address),
      replyTo: request.reply_to?.[0] ?? null,
      subject: request.subject,
      snippet,
      matchedBy: resolved.matchedBy,
      status: args.status,
      at: createdAt,
      unread: false,
    },
    {
      id: threadId,
      workspaceId: ctx.workspace.id,
      environment: envelope.environment,
      subject: request.subject,
      subjectNormalized: normalizeSubject(request.subject),
      participants,
      folder: 'sent',
      lastMessageAt: createdAt,
      lastDirection: 'out',
      snippet,
      hasAttachments: Boolean(request.attachments?.length),
    },
  )
}

/** Header names are case-insensitive; callers send every casing there is. */
const headerOf = (headers: Record<string, string>, name: string): string | null => {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value
  }
  return null
}
