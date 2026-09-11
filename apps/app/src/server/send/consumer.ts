import {
  DEFAULT_WORKSPACE,
  doName,
  KV_TTL,
  kvKey,
  newId,
  parseAddress,
  parseAddresses,
  r2Key,
  signTrackingToken,
} from '@mailysend/core'
import { eventId } from '@mailysend/events'
import type { QueueBatch, Sql } from '@mailysend/platform'
import { buildMime, type OutboundMessage, type ProviderName, SendError } from '@mailysend/providers'
import { injectTracking, injectUnsubscribe, renderTemplate } from '@mailysend/templates'
import { tenancyFor } from '../context.ts'
import type { Env } from '../env.ts'
import {
  normalizeSubject,
  resolveThreadBySql,
  snippetOf,
  updateOutboundStatus,
  writeMailMessage,
} from '../services/mail.ts'
import { buildRouter } from '../services/providers.ts'
import type { Envelope, SendJob } from './envelope.ts'

/**
 * The `ms-send` consumer.
 *
 * Everything expensive happens here, off the request path: rendering, tracking
 * injection, the governor reservation, the provider call, and the result write.
 *
 * The consumer is written so that being run twice on the same message is safe.
 * A queue is at-least-once, and redelivery after a partial failure is normal —
 * so the first thing it does is take a short conditional lease, and the last
 * thing it does is a monotonic status write.
 */

/** Long enough for a slow SMTP conversation, short enough that a dead worker's
 *  message is retried within one queue backoff rather than sitting for minutes. */
const LEASE_MS = 120_000

/** Said in the user's terms, because this string ends up in the log drawer. */
const RESERVATION_REASON = {
  daily_ceiling: 'the sending domain has reached its learned daily ceiling for today',
  rate: 'the sending rate governor is throttling this domain',
  circuit_open: 'the provider circuit breaker is open after repeated failures',
} as const

export async function consumeSend(batch: QueueBatch<SendJob>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await handleOne(message.body, env)
      message.ack()
    } catch (err) {
      const transient = err instanceof SendError && err.kind !== 'permanent' && err.kind !== 'auth'
      if (transient && message.attempts < 5) {
        const delaySeconds = Math.min(2 ** message.attempts * 10, 900)
        console.warn(
          `[send] ${message.body.email_id} attempt ${message.attempts} failed, retrying in ${delaySeconds}s: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
        message.retry({ delaySeconds })
      } else {
        // Give up on the wire, but never silently: the message row is marked
        // failed so it shows in the log with a reason the user can act on.
        await markFailed(env, message.body, err)
        message.ack()
      }
    }
  }
}

/**
 * Deliver one message on the caller's own time, without a queue.
 *
 * A queue is the right shape for a broadcast and the wrong shape for a person
 * pressing Send: it adds a hop that can be missing (Queues are not on every
 * Cloudflare plan) or unattached, and when it is, the message sits at `sending`
 * forever with nothing to show for it. The dashboard's composer therefore
 * delivers inline and reports the outcome, and this is the same `handleOne` the
 * consumer runs — the lease, the router, the provider call and the status
 * write, once, with the same at-least-once guarantees.
 *
 * `retryable` says whether the queue should still be given a chance: a
 * transient failure deserves the retry schedule a queue provides, and a
 * permanent one has already been written to the message row.
 */
export async function deliverNow(
  job: SendJob,
  env: Env,
): Promise<{ delivered: boolean; retryable: boolean; error?: string }> {
  try {
    await handleOne(job, env)
    return { delivered: true, retryable: false }
  } catch (err) {
    const transient = err instanceof SendError && err.kind !== 'permanent' && err.kind !== 'auth'
    if (transient) {
      console.warn(`[send] ${job.email_id} could not be delivered inline: ${describe(err)}`)
      return { delivered: false, retryable: true, error: describe(err) }
    }
    await markFailed(env, job, err)
    return { delivered: false, retryable: false, error: describe(err) }
  }
}

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Messages that were leased and never given a verdict.
 *
 * `handleOne` claims a message by setting `status = 'sending'` and a lease, and
 * every path out of it — sent, failed, refused — clears that lease. A path that
 * never returns leaves neither: an evicted isolate, a killed process, a
 * redeploy mid-flight. The row then reads `sending` with no provider and no
 * error, forever, and it is the one state a reader can do nothing about, since
 * the message is not sent, not failed and not going to be retried.
 *
 * So the minute cron looks for leases that expired without anybody clearing
 * them. A spooled envelope is still in the bucket under a deterministic key, so
 * that message is simply delivered again — the lease guard makes a double
 * delivery impossible if the first one did in fact land. An inline envelope
 * lived only in the queue message, so there is nothing left to send: it is
 * failed with a reason that says so, rather than left pretending.
 *
 * `grace` is deliberately more than one lease: a slow SMTP conversation that
 * runs past its lease is still working, and stealing it would be the very
 * double-send the lease exists to prevent.
 */
export async function reclaimStuckSends(env: Env, workspaceId: string): Promise<number> {
  const sql = tenancyFor(env).db(workspaceId)
  const grace = Date.now() - LEASE_MS
  const { results } = await sql
    .prepare(
      `SELECT id FROM messages
         WHERE workspace_id = ? AND state_rank = 20 AND lease_until IS NOT NULL AND lease_until < ?
         ORDER BY lease_until ASC LIMIT 50`,
    )
    .bind(workspaceId, grace)
    .all<{ id: string }>()

  for (const row of results) {
    // Clear the lease first, so the redelivery below can claim it — and so two
    // overlapping cron ticks cannot both pick up the same message.
    const taken = await sql
      .prepare(
        `UPDATE messages SET lease_until = NULL WHERE id = ? AND workspace_id = ?
           AND state_rank = 20 AND lease_until IS NOT NULL AND lease_until < ?`,
      )
      .bind(row.id, workspaceId, grace)
      .run()
    if (taken.meta.changes === 0) continue

    const key = r2Key.spool(workspaceId, row.id)
    const spooled = await env.BUCKET.get(key)
    if (spooled) {
      await deliverNow({ kind: 'spooled', email_id: row.id, workspace_id: workspaceId, key }, env)
      continue
    }
    await markFailed(
      env,
      { kind: 'spooled', email_id: row.id, workspace_id: workspaceId, key },
      new SendError(
        'permanent',
        'cloudflare',
        'delivery was interrupted before the transport answered, and the message could not be confirmed either way. Send it again.',
      ),
    )
  }
  return results.length
}

async function handleOne(job: SendJob, env: Env): Promise<void> {
  const sql = tenancyFor(env).db(job.workspace_id)

  // --- lease ---------------------------------------------------------------
  // Conditional, so two concurrent deliveries of the same queue message cannot
  // both reach the provider. The `state_rank < 30` guard is what makes it also
  // correct for a redelivery *after* a successful send: the row has already
  // advanced past `sent`, so the second attempt claims nothing and returns.
  const now = Date.now()
  const lease = await sql
    .prepare(
      `UPDATE messages SET lease_until = ?, attempts = attempts + 1, status = 'sending', state_rank = 20
         WHERE id = ? AND workspace_id = ? AND state_rank < 30
           AND (lease_until IS NULL OR lease_until < ?)`,
    )
    .bind(now + LEASE_MS, job.email_id, job.workspace_id, now)
    .run()
  if (lease.meta.changes === 0) {
    // Somebody else holds it, or it is already past sending. Both are ordinary
    // — but they are also what a lost message looks like, so say which.
    console.log(`[send] ${job.email_id} was already claimed; nothing to do`)
    return
  }

  // Everything past this point owns the lease, and a failure has to give it
  // back. It used to keep it: an attempt that threw left `lease_until` set for
  // its full two minutes, the queue redelivered twenty seconds later, the
  // conditional claim above matched nothing, and this function returned quietly
  // and acked the message. The row then sat at `sending` forever — no provider,
  // no error, no further attempt — which is exactly the state that started this
  // investigation. Releasing on the way out is what makes a retry a retry.
  try {
    await attempt(job, env, sql)
  } catch (err) {
    await sql
      .prepare(
        `UPDATE messages SET lease_until = NULL
          WHERE id = ? AND workspace_id = ? AND state_rank < 30`,
      )
      .bind(job.email_id, job.workspace_id)
      .run()
      .catch(() => {})
    throw err
  }
}

/** The delivery itself. Runs holding the lease `handleOne` took. */
async function attempt(job: SendJob, env: Env, sql: Sql): Promise<void> {
  const envelope = await loadEnvelope(job, env)
  if (!envelope)
    throw new SendError('permanent', 'cloudflare', 'send envelope is missing from the spool')

  const outbound = await buildOutbound(envelope, env, sql)

  // --- governor ------------------------------------------------------------
  // The daily quota on Cloudflare's transport is unpublished and ramps with
  // reputation, so the actor learns it rather than being told. Asking before
  // sending turns a first big send into a slow one instead of thousands of
  // rejections and a reputation hit.
  const governor = env.SENDING_DOMAIN.get(
    doName('SendingDomain', job.workspace_id, envelope.domain.name),
  )
  const pinned = envelope.provider ?? 'cloudflare'
  const reservation = await governor.reserve(outbound.to.length, pinned)
  if (reservation.granted < outbound.to.length) {
    const reason: keyof typeof RESERVATION_REASON = reservation.reason ?? 'rate'
    throw new SendError('throttled', pinned, RESERVATION_REASON[reason], {
      retryAfterSeconds: Math.ceil(reservation.retryAfterMs / 1000) || 300,
    })
  }

  // --- send ----------------------------------------------------------------
  // Test mode is settled before any transport is built. A brand-new instance has
  // no binding, no credentials and no verified domain, and a test send there has
  // to work anyway — it is the only way to see the product function at all. If
  // the router were built first, "no sending provider is configured" would fire
  // on a send that was never going to touch a provider.
  if (envelope.environment === 'test') {
    // Test-mode traffic must produce a complete, inspectable timeline without
    // ever reaching a real mailbox — otherwise "test" means "untested".
    await recordSent(sql, env, envelope, {
      provider: 'cloudflare',
      providerMessageId: `test_${job.email_id}`,
      acceptedAt: new Date().toISOString(),
      smtpResponse: '250 2.0.0 Ok: queued (test mode, not delivered)',
    })
    // …and then deliver it to ourselves. This is what makes the inbox useful on
    // a brand-new instance: no domain, no DNS, no provider credentials, and a
    // message you compose still arrives, rendered, with its attachments and its
    // original MIME, because the bytes are the ones a provider would have been
    // handed.
    await deliverLoopback(sql, env, envelope, outbound).catch((err) => {
      console.warn('[send] test-mode loopback failed', err)
    })
    return
  }

  const router = await buildRouter(sql, job.workspace_id, env)
  if (router.providers.length === 0) {
    throw new SendError(
      'permanent',
      'cloudflare',
      'No sending provider is configured. Cloudflare Email is used by default, ' +
        'but this deployment has no send_email binding and no CLOUDFLARE_ACCOUNT_ID / ' +
        'CLOUDFLARE_API_TOKEN — add one in Settings → Transports, or send in Test mode.',
    )
  }

  /**
   * A pin the router cannot satisfy, named.
   *
   * `select()` returns `null` for an unsatisfiable pin, so `send` fell through
   * to "No sending provider is configured" — a lie when three transports are
   * configured and the domain is bound to a fourth. Checked here rather than in
   * the router because only this layer knows the pin came from a domain binding
   * and can say which domain to go and look at.
   */
  if (envelope.provider && !router.providers.some((p) => p.name === envelope.provider)) {
    throw new SendError(
      'permanent',
      envelope.provider,
      `\`${envelope.domain.name}\` is bound to the ${envelope.provider} transport, and this ` +
        `workspace has no working ${envelope.provider} configuration. Configure it under ` +
        'Settings → Transports, or rebind the domain to a transport that is configured. ' +
        'This send was not failed over, because the records published for this domain ' +
        'authorise that transport and no other.',
    )
  }

  try {
    const result = await router.send(outbound, envelope.provider ? { pin: envelope.provider } : {})
    await recordSent(sql, env, envelope, result)
    await governor.recordSuccess(result.provider)
  } catch (err) {
    if (err instanceof SendError) {
      if (err.kind === 'throttled') await governor.recordQuotaExceeded(err.provider)
      else if (err.kind !== 'permanent') await governor.recordFailure(err.provider)
      if (err.kind === 'suppressed') {
        // Cloudflare keeps its own suppression list that we cannot read. The
        // only signal is this failure, so mirror it inward — otherwise every
        // subsequent send to that address repeats the same wasted round trip.
        await mirrorSuppression(sql, env, envelope, err)
      }
    }
    throw err
  }
}

async function loadEnvelope(job: SendJob, env: Env): Promise<Envelope | null> {
  if (job.kind === 'inline') return job.envelope
  const object = await env.BUCKET.get(job.key)
  return object ? ((await object.json()) as Envelope) : null
}

async function buildOutbound(
  envelope: Envelope,
  env: Env,
  sql: import('@mailysend/platform').Sql,
): Promise<OutboundMessage> {
  const { request } = envelope

  let html = request.html ?? request.react ?? ''
  let text = request.text ?? ''
  let subject = request.subject

  if (request.template_id) {
    const version = await sql
      .prepare(
        `SELECT tv.subject, tv.html, tv.text, tv.ast, t.engine
           FROM template_versions tv
           JOIN templates t ON t.id = tv.template_id AND t.workspace_id = tv.workspace_id
          WHERE tv.workspace_id = ? AND tv.template_id = ? AND tv.version = t.current_version`,
      )
      .bind(envelope.workspace_id, request.template_id)
      .first<{
        subject: string | null
        html: string | null
        text: string | null
        ast: string | null
        engine: string
      }>()
    if (!version)
      throw new SendError(
        'permanent',
        'cloudflare',
        `template ${request.template_id} has no published version`,
      )
    const rendered = await renderTemplate({
      engine: version.engine as never,
      subject: version.subject ?? subject,
      html: version.html,
      text: version.text,
      ast: version.ast ? JSON.parse(version.ast) : undefined,
      data: request.template_data ?? {},
    })
    subject = rendered.subject
    html = rendered.html
    text = rendered.text
  }

  const recipients = parseAddresses(request.to)
  const trackingBase = (env.MS_TRACKING_URL ?? env.MS_PUBLIC_URL).replace(/\/$/, '')

  // --- unsubscribe ---------------------------------------------------------
  // Every message gets List-Unsubscribe headers, including transactional mail:
  // Gmail and Yahoo require one-click unsubscribe from bulk senders, and a
  // header that is sometimes present is worse than one that always is.
  const unsubToken = await signTrackingToken(env.MS_SECRET, {
    emailId: envelope.email_id,
    workspaceId: envelope.workspace_id,
  })
  const unsubUrl = `${trackingBase}/u/${unsubToken}`
  if (html)
    html = injectUnsubscribe(html, { url: unsubUrl, appendFooter: Boolean(envelope.broadcast_id) })

  // --- tracking ------------------------------------------------------------
  const links: { id: string; url: string }[] = []
  if (html && (envelope.domain.open_tracking || envelope.domain.click_tracking)) {
    const pixel = envelope.domain.open_tracking
      ? `${trackingBase}/o/${await signTrackingToken(env.MS_SECRET, {
          emailId: envelope.email_id,
          workspaceId: envelope.workspace_id,
        })}.gif`
      : undefined

    const pending: Promise<void>[] = []
    const rewritten = new Map<string, string>()
    if (envelope.domain.click_tracking) {
      // Two passes: collect the destinations, sign them, then rewrite. The
      // rewriter is synchronous by design (it is a pure string transform), so
      // signing has to happen before it runs.
      const seen = new Set<string>()
      for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
        const url = match[1]
        if (!url || seen.has(url) || !/^https?:/i.test(url)) continue
        seen.add(url)
        const linkId = newId('link')
        links.push({ id: linkId, url })
        pending.push(
          signTrackingToken(env.MS_SECRET, {
            emailId: envelope.email_id,
            workspaceId: envelope.workspace_id,
            linkId,
          }).then((token) => {
            rewritten.set(url, `${trackingBase}/c/${token}`)
          }),
        )
      }
      await Promise.all(pending)
    }

    html = injectTracking(html, {
      ...(pixel ? { pixelUrl: pixel } : {}),
      ...(envelope.domain.click_tracking
        ? { linkRewriter: (url: string) => rewritten.get(url) ?? url }
        : {}),
    })
  }

  // The link map is read by the tracking Worker, which has no database at all.
  if (links.length > 0) {
    await Promise.all(
      links.map((link) =>
        env.CACHE.put(kvKey.link(envelope.workspace_id, link.id), link.url, {
          expirationTtl: KV_TTL.link,
        }),
      ),
    )
  }

  const from = parseAddress(request.from)
  if (!from)
    throw new SendError('permanent', 'cloudflare', 'the `from` address could not be parsed')

  return {
    emailId: envelope.email_id,
    workspaceId: envelope.workspace_id,
    from,
    to: recipients,
    ...(request.cc ? { cc: parseAddresses(request.cc) } : {}),
    ...(request.bcc ? { bcc: parseAddresses(request.bcc) } : {}),
    ...(request.reply_to ? { replyTo: parseAddresses(request.reply_to) } : {}),
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
    headers: {
      ...(request.headers ?? {}),
      'List-Unsubscribe': `<${unsubUrl}>, <mailto:unsubscribe@${envelope.domain.name}?subject=unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    ...(request.attachments?.length
      ? {
          attachments: request.attachments.map((a) => ({
            filename: a.filename,
            contentType: a.content_type ?? 'application/octet-stream',
            content: decodeAttachment(a),
            ...(a.content_id ? { contentId: a.content_id } : {}),
          })),
        }
      : {}),
    returnPath: envelope.domain.return_path,
    ...(envelope.domain.dkim_private_key
      ? {
          dkim: {
            domain: envelope.domain.name,
            selector: envelope.domain.dkim_selector,
            privateKey: envelope.domain.dkim_private_key,
          },
        }
      : {}),
  }
}

function decodeAttachment(a: { content?: string | number[] }): Uint8Array {
  if (!a.content) return new Uint8Array()
  // The contract accepts a byte array as well as base64, because that is what
  // `fs.readFile` hands you and Resend's SDK passes it straight through.
  if (Array.isArray(a.content)) return Uint8Array.from(a.content)
  const binary = atob(a.content)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function recordSent(
  sql: import('@mailysend/platform').Sql,
  env: Env,
  envelope: Envelope,
  result: {
    provider: ProviderName
    providerMessageId: string | null
    acceptedAt: string
    smtpResponse?: string
  },
): Promise<void> {
  const sentAt = result.acceptedAt
  // `provider_message_id` is written in the same statement that advances the
  // state, and the state write is monotonic — so a later `delivered` event that
  // arrives before this row is committed still wins on rank, and a duplicate
  // consumer run cannot regress the status.
  await sql
    .prepare(
      `UPDATE messages
          SET status = 'sent', state_rank = 30, provider = ?, provider_message_id = ?,
              sent_at = ?, smtp_response = ?, lease_until = NULL
        WHERE id = ? AND workspace_id = ? AND state_rank < 30`,
    )
    .bind(
      result.provider,
      result.providerMessageId,
      sentAt,
      result.smtpResponse ?? null,
      envelope.email_id,
      envelope.workspace_id,
    )
    .run()

  // The reading pane shows a sent message's delivery state inline, which is the
  // one thing a mail client cannot do. It reads this column.
  await updateOutboundStatus(sql, envelope.workspace_id, envelope.email_id, 'sent')

  // One event per recipient: `delivered` is per-recipient downstream, so if
  // `sent` were per-message the two would not line up in the timeline.
  const recipients = envelope.request.to
  await env.EVENTS_QUEUE.send({
    source: 'normalized',
    events: await Promise.all(
      recipients.map(async (recipient) => ({
        event_id: await eventId({
          provider: result.provider,
          providerMessageId: result.providerMessageId,
          type: 'sent' as const,
          recipient,
          occurredAt: sentAt,
        }),
        workspace_id: envelope.workspace_id,
        email_id: envelope.email_id,
        type: 'sent' as const,
        recipient,
        occurred_at: sentAt,
        provider: result.provider,
        provider_message_id: result.providerMessageId,
        smtp_response: result.smtpResponse ?? null,
        broadcast_id: envelope.broadcast_id ?? null,
        automation_id: envelope.automation_id ?? null,
        contact_id: envelope.contact_id ?? null,
      })),
    ),
  })
}

async function mirrorSuppression(
  sql: import('@mailysend/platform').Sql,
  env: Env,
  envelope: Envelope,
  err: SendError,
): Promise<void> {
  const { normalizeForSuppression } = await import('@mailysend/core')
  const now = new Date().toISOString()
  for (const address of envelope.request.to) {
    const parsed = parseAddress(address)
    if (!parsed) continue
    const normalized = normalizeForSuppression(parsed.address)
    await sql
      .prepare(
        `INSERT INTO suppressions (workspace_id, email, original_email, reason, source, created_at)
         VALUES (?,?,?,'provider',?,?)
         ON CONFLICT (workspace_id, email) DO NOTHING`,
      )
      .bind(envelope.workspace_id, normalized, parsed.address, err.provider, now)
      .run()
    await env.SUPPRESSIONS.put(
      kvKey.suppression(envelope.workspace_id, normalized),
      JSON.stringify({ reason: 'provider', source: err.provider, at: now }),
    )
  }
}

async function markFailed(env: Env, job: SendJob, err: unknown): Promise<void> {
  const sql = tenancyFor(env).db(job.workspace_id)
  const message = err instanceof Error ? err.message : String(err)
  const kind = err instanceof SendError ? err.kind : 'unknown'
  // Said out loud, because until now it was not said anywhere a deployment can
  // read. A failed send wrote its reason to a database column and to nothing
  // else, so the Workers log for a message that never arrived showed a `POST
  // /v1/mail/send` returning 200, an `ms-send` consumer invocation, and no
  // indication that either had gone wrong — which is a bad position to debug a
  // send from, and the position this was debugged from twice.
  console.error(
    `[send] ${job.email_id} failed (${kind}${
      err instanceof SendError && err.provider ? ` via ${err.provider}` : ''
    }): ${message}`,
  )
  // The provider is recorded on failure as well as on success. Only `recordSent`
  // ever wrote this column, so a message that reached a transport and was
  // refused by it read as `unassigned` — indistinguishable from one that never
  // got as far as routing, which is precisely the distinction a reader needs.
  const failedProvider = err instanceof SendError ? err.provider : null
  await sql
    .prepare(
      `UPDATE messages
          SET status = 'failed', state_rank = 96, error_message = ?,
              provider = COALESCE(provider, ?), lease_until = NULL
        WHERE id = ? AND workspace_id = ? AND state_rank < 96`,
    )
    .bind(`${kind}: ${message}`, failedProvider, job.email_id, job.workspace_id)
    .run()

  await updateOutboundStatus(sql, job.workspace_id, job.email_id, 'failed').catch(() => {})

  const occurredAt = new Date().toISOString()
  const provider = err instanceof SendError ? err.provider : 'internal'
  await env.EVENTS_QUEUE.send({
    source: 'normalized',
    events: [
      {
        event_id: await eventId({
          provider,
          providerMessageId: null,
          type: 'failed',
          recipient: job.email_id,
          occurredAt,
        }),
        workspace_id: job.workspace_id ?? DEFAULT_WORKSPACE,
        email_id: job.email_id,
        type: 'failed' as const,
        recipient: job.email_id,
        occurred_at: occurredAt,
        provider,
        provider_message_id: null,
        diagnostic: message.slice(0, 2000),
      },
    ],
  })

  // The failure has to reach a human somewhere other than a row in `messages`.
  // A first send that fails during setup, or a sign-in code that never arrives,
  // is invisible if the only record is a column on the message nobody knows to
  // look for — so the most recent one is kept where `/v1/instance` can show it.
  try {
    const { writeInstanceSetting, LAST_SEND_ERROR_KEY } = await import('../bootstrap.ts')
    await writeInstanceSetting(
      tenancyFor(env).db(''),
      LAST_SEND_ERROR_KEY,
      `${occurredAt} ${provider}/${kind}: ${message.slice(0, 400)}`,
    )
  } catch (writeErr) {
    // Best-effort by design: a diagnostic that can fail a send is worse than
    // no diagnostic.
    console.warn('[send] could not record the last send error', writeErr)
  }
}

/**
 * Test-mode delivery, to ourselves.
 *
 * The message is built exactly as a provider would receive it — same MIME, same
 * headers, same attachments — and then filed as received mail. The Message-ID
 * is suffixed rather than reused: the delivered copy is a second message in the
 * conversation, and reusing the id would collide with the sent row on the
 * unique index that exists precisely to stop a message appearing twice.
 */
async function deliverLoopback(
  sql: import('@mailysend/platform').Sql,
  env: Env,
  envelope: Envelope,
  outbound: OutboundMessage,
): Promise<void> {
  const raw = buildMime(outbound)
  const inboundId = newId('inbound')
  const at = new Date().toISOString()

  const inReplyTo = outbound.headers?.['In-Reply-To'] ?? null
  const references = (outbound.headers?.References ?? '').split(/\s+/).filter(Boolean)
  const resolved = await resolveThreadBySql(sql, envelope.workspace_id, { inReplyTo, references })
  // A reply threads onto the conversation it answers; a fresh message starts
  // its own, because that is what the recipient's mailbox would show.
  const threadId = resolved.threadId ?? newId('thread')

  const rawKey = r2Key.rawInbound(envelope.workspace_id, inboundId)
  const bodyKey = r2Key.inbound(envelope.workspace_id, threadId, `${inboundId}.json`)
  await env.BUCKET.put(rawKey, raw, { httpMetadata: { contentType: 'message/rfc822' } })
  await env.BUCKET.put(
    bodyKey,
    JSON.stringify({ html: outbound.html ?? null, text: outbound.text ?? null }),
    { httpMetadata: { contentType: 'application/json' } },
  )

  const attachments = []
  for (const attachment of outbound.attachments ?? []) {
    const key = r2Key.inbound(
      envelope.workspace_id,
      threadId,
      `${inboundId}-${attachment.filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100)}`,
    )
    await env.BUCKET.put(key, attachment.content, {
      httpMetadata: { contentType: attachment.contentType },
    })
    attachments.push({
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.content.byteLength,
      contentId: attachment.contentId ?? null,
      inline: Boolean(attachment.contentId),
      blobKey: key,
    })
  }

  const snippet = snippetOf(outbound.text, outbound.html)
  const recipients = outbound.to.map((a) => a.address)

  await writeMailMessage(
    sql,
    {
      id: inboundId,
      workspaceId: envelope.workspace_id,
      threadId,
      direction: 'in',
      environment: 'test',
      sourceId: envelope.email_id,
      messageIdHeader: `<${envelope.email_id}.loopback@${outbound.from.domain}>`,
      inReplyTo: `<${envelope.email_id}@${outbound.from.domain}>`,
      references: [...references, `<${envelope.email_id}@${outbound.from.domain}>`],
      fromAddress: outbound.from.address,
      fromName: outbound.from.name ?? null,
      to: recipients,
      cc: outbound.cc?.map((a) => a.address) ?? [],
      subject: outbound.subject,
      snippet,
      sizeBytes: new TextEncoder().encode(raw).byteLength,
      bodyKey,
      rawKey,
      // Nothing authenticated this message because nothing transmitted it.
      // Saying `pass` would be the exact dishonesty the test mode exists to
      // avoid, so the verdicts stay null and the reader shows "none".
      matchedBy: resolved.matchedBy,
      at,
      attachments,
      unread: true,
    },
    {
      id: threadId,
      workspaceId: envelope.workspace_id,
      environment: 'test',
      subject: outbound.subject || '(no subject)',
      subjectNormalized: normalizeSubject(outbound.subject ?? ''),
      participants: [outbound.from.address, ...recipients],
      folder: 'inbox',
      lastMessageAt: at,
      lastDirection: 'in',
      snippet,
      hasAttachments: attachments.length > 0,
    },
  )

  const hub = env.WORKSPACE_HUB.get(doName('WorkspaceHub', envelope.workspace_id))
  await hub.publish([
    {
      type: 'inbound.received',
      at,
      data: { thread_id: threadId, message_id: inboundId, environment: 'test' },
    },
  ])
}
