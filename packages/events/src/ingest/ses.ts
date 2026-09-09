import type { NormalizedEvent, NormalizedEventType } from '@mailysend/contracts'
import { classifyBounce } from '../bounce.ts'
import { eventId } from '../identity.ts'

/**
 * Amazon SES, delivered over SNS.
 *
 * SES emits one notification per *event*, but a bounce notification can carry
 * several recipients — so one SNS message can become several normalized events.
 * That is the main structural difference from the Cloudflare path and the
 * reason this normalizer returns an array.
 */

export interface SnsEnvelope {
  Type: string
  Message: string
  MessageId: string
  TopicArn?: string
  SubscribeURL?: string
  Token?: string
}

export interface SesNotification {
  eventType?: string
  notificationType?: string
  mail: {
    messageId: string
    timestamp: string
    destination: string[]
    /** Our own id, carried through as an SES message tag. */
    tags?: Record<string, string[]>
    headers?: { name: string; value: string }[]
  }
  bounce?: {
    bounceType: string
    bounceSubType: string
    timestamp: string
    bouncedRecipients: {
      emailAddress: string
      status?: string
      diagnosticCode?: string
      action?: string
    }[]
  }
  complaint?: {
    timestamp: string
    complainedRecipients: { emailAddress: string }[]
    complaintFeedbackType?: string
  }
  delivery?: {
    timestamp: string
    recipients: string[]
    smtpResponse?: string
    processingTimeMillis?: number
  }
  deliveryDelay?: {
    timestamp: string
    delayType: string
    delayedRecipients: { emailAddress: string; diagnosticCode?: string }[]
  }
  send?: Record<string, never>
  reject?: { reason: string }
  open?: { timestamp: string; userAgent?: string; ipAddress?: string }
  click?: { timestamp: string; link: string; userAgent?: string; ipAddress?: string }
}

/**
 * Recovers our email id from the notification.
 *
 * Two paths, because SES drops tags on some event types: the message tag we set
 * at send time, and the `X-MailySend-Id` header we stamp into every message.
 * The header is the more reliable of the two, which is why it exists.
 */
export const extractSesEmailId = (notification: SesNotification): string | null => {
  const tag = notification.mail.tags?.mailysend_id?.[0]
  if (tag) return tag
  const header = notification.mail.headers?.find((h) => h.name.toLowerCase() === 'x-mailysend-id')
  return header?.value ?? null
}

export async function normalizeSesNotification(
  notification: SesNotification,
  context: { workspaceId: string; emailId?: string | null },
): Promise<NormalizedEvent[]> {
  const kind = notification.eventType ?? notification.notificationType ?? ''
  const providerMessageId = notification.mail.messageId
  const emailId = context.emailId ?? extractSesEmailId(notification)

  const build = async (
    type: NormalizedEventType,
    recipient: string,
    occurredAt: string,
    extra: Partial<NormalizedEvent> = {},
  ): Promise<NormalizedEvent> => ({
    event_id: await eventId({ provider: 'ses', providerMessageId, type, recipient, occurredAt }),
    workspace_id: context.workspaceId,
    email_id: emailId,
    type,
    recipient: recipient.toLowerCase(),
    occurred_at: new Date(occurredAt).toISOString(),
    provider: 'ses',
    provider_message_id: providerMessageId,
    ...extra,
  })

  switch (kind) {
    case 'Send':
      return Promise.all(
        notification.mail.destination.map((r) => build('sent', r, notification.mail.timestamp)),
      )

    case 'Delivery':
      return Promise.all(
        (notification.delivery?.recipients ?? notification.mail.destination).map((r) =>
          build('delivered', r, notification.delivery!.timestamp, {
            smtp_response: notification.delivery?.smtpResponse ?? null,
          }),
        ),
      )

    case 'Bounce':
      return Promise.all(
        (notification.bounce?.bouncedRecipients ?? []).map((r) =>
          build('bounced', r.emailAddress, notification.bounce!.timestamp, {
            smtp_code: r.status ?? null,
            diagnostic: r.diagnosticCode ?? null,
            bounce_class: classifyBounce({
              smtpCode: r.status,
              diagnostic: r.diagnosticCode,
              providerType: notification.bounce!.bounceType,
              providerSubType: notification.bounce!.bounceSubType,
            }).class,
          }),
        ),
      )

    case 'Complaint':
      return Promise.all(
        (notification.complaint?.complainedRecipients ?? []).map((r) =>
          build('complained', r.emailAddress, notification.complaint!.timestamp, {
            diagnostic: notification.complaint?.complaintFeedbackType ?? null,
          }),
        ),
      )

    case 'DeliveryDelay':
      return Promise.all(
        (notification.deliveryDelay?.delayedRecipients ?? []).map((r) =>
          build('delivery_delayed', r.emailAddress, notification.deliveryDelay!.timestamp, {
            diagnostic: r.diagnosticCode ?? notification.deliveryDelay?.delayType ?? null,
          }),
        ),
      )

    case 'Reject':
      return Promise.all(
        notification.mail.destination.map((r) =>
          build('rejected', r, notification.mail.timestamp, {
            diagnostic: notification.reject?.reason ?? null,
          }),
        ),
      )

    // SES's own open and click tracking is deliberately ignored: we inject our
    // own pixel and rewrite our own links, so accepting SES's version too would
    // double-count every engagement on that transport.
    case 'Open':
    case 'Click':
      return []

    default:
      return []
  }
}

/**
 * SNS subscription confirmation.
 *
 * The URL is fetched rather than blindly trusted, and only for topics we were
 * configured to expect — an unauthenticated confirm endpoint would let anyone
 * attach our ingestion to a topic they control and inject fabricated events.
 */
export const isSubscriptionConfirmation = (envelope: SnsEnvelope): boolean =>
  envelope.Type === 'SubscriptionConfirmation'
