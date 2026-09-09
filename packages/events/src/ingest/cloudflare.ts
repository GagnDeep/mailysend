import type { NormalizedEvent, NormalizedEventType } from '@mailysend/contracts'
import { classifyBounce } from '../bounce.ts'
import { eventId } from '../identity.ts'

/**
 * Cloudflare Queues event subscriptions.
 *
 * Since 2026-07-15 Cloudflare publishes email lifecycle events to a Queue,
 * scoped per sending domain. This is the deliverability backbone on the default
 * transport, and it is why MailySend needs no VERP scheme or return-path
 * mailbox parsing on that path — the events arrive structured, in-account, with
 * no webhook endpoint to secure.
 *
 * The event names map almost one-to-one onto our normalized vocabulary, which
 * is not a coincidence: both are modelled on the SMTP outcomes underneath.
 */

export interface CloudflareEmailEvent {
  type:
    | 'message.delivered'
    | 'message.deferred'
    | 'message.bounced'
    | 'message.failed'
    | 'message.rejected'
    | 'message.complained'
  messageId: string
  timestamp: string | number
  recipient?: string
  to?: string
  domain?: string
  smtpResponse?: string
  smtpCode?: string
  reason?: string
  diagnosticCode?: string
  /** Present on some events; used only as a fallback for workspace attribution. */
  metadata?: Record<string, string>
}

const TYPE_MAP: Record<CloudflareEmailEvent['type'], NormalizedEventType> = {
  'message.delivered': 'delivered',
  'message.deferred': 'delivery_delayed',
  'message.bounced': 'bounced',
  'message.failed': 'failed',
  'message.rejected': 'rejected',
  'message.complained': 'complained',
}

export async function normalizeCloudflareEvent(
  raw: CloudflareEmailEvent,
  context: { workspaceId: string; emailId: string | null },
): Promise<NormalizedEvent> {
  const type = TYPE_MAP[raw.type]
  const recipient = (raw.recipient ?? raw.to ?? '').toLowerCase()
  const occurredAt = new Date(
    typeof raw.timestamp === 'number'
      ? raw.timestamp * (raw.timestamp > 1e12 ? 1 : 1000)
      : raw.timestamp,
  ).toISOString()

  const diagnostic = raw.diagnosticCode ?? raw.smtpResponse ?? raw.reason ?? null

  const event: NormalizedEvent = {
    event_id: await eventId({
      provider: 'cloudflare',
      providerMessageId: raw.messageId,
      type,
      recipient,
      occurredAt,
    }),
    workspace_id: context.workspaceId,
    email_id: context.emailId,
    type,
    recipient,
    occurred_at: occurredAt,
    provider: 'cloudflare',
    provider_message_id: raw.messageId,
    smtp_response: raw.smtpResponse ?? null,
    smtp_code: raw.smtpCode ?? null,
    diagnostic,
  }

  if (type === 'bounced' || type === 'failed' || type === 'rejected') {
    event.bounce_class = classifyBounce({
      smtpCode: raw.smtpCode,
      diagnostic,
    }).class
  }

  return event
}

/**
 * Cloudflare's own suppression list is invisible to us — we only learn an
 * address is on it when a send fails with `E_RECIPIENT_SUPPRESSED`. Mirroring
 * it inward as a first-class suppression with `reason='provider'` is what lets
 * the dashboard answer "why did this not send?" instead of showing an opaque
 * provider error.
 */
export const isProviderSuppression = (raw: CloudflareEmailEvent): boolean =>
  raw.type === 'message.rejected' && /suppress/i.test(raw.reason ?? raw.smtpResponse ?? '')
