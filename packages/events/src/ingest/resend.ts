import type { NormalizedEvent, NormalizedEventType } from '@mailysend/contracts'
import { classifyBounce } from '../bounce.ts'
import { eventId } from '../identity.ts'

/**
 * Resend webhooks, when Resend is configured as a transport.
 *
 * Resend's own event vocabulary is nearly identical to the one we expose,
 * because both are shaped by the same underlying SMTP outcomes. `email.opened`
 * and `email.clicked` are dropped for the same reason as SES's: we do our own
 * tracking injection, so accepting theirs as well would double-count.
 */

export interface ResendWebhookEvent {
  type: string
  created_at: string
  data: {
    email_id?: string
    to?: string[]
    from?: string
    subject?: string
    headers?: { name: string; value: string }[]
    bounce?: { message?: string; subType?: string; type?: string }
    click?: { link?: string; ipAddress?: string; userAgent?: string; timestamp?: string }
    tags?: Record<string, string>
  }
}

const TYPE_MAP: Record<string, NormalizedEventType> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
}

export const extractResendEmailId = (event: ResendWebhookEvent): string | null =>
  event.data.headers?.find((h) => h.name.toLowerCase() === 'x-mailysend-id')?.value ??
  event.data.tags?.mailysend_id ??
  null

export async function normalizeResendEvent(
  event: ResendWebhookEvent,
  context: { workspaceId: string; emailId?: string | null },
): Promise<NormalizedEvent[]> {
  const type = TYPE_MAP[event.type]
  if (!type) return []

  const providerMessageId = event.data.email_id ?? null
  const emailId = context.emailId ?? extractResendEmailId(event)
  const recipients = event.data.to ?? []

  return Promise.all(
    recipients.map(async (recipient) => {
      const base: NormalizedEvent = {
        event_id: await eventId({
          provider: 'resend',
          providerMessageId,
          type,
          recipient,
          occurredAt: event.created_at,
        }),
        workspace_id: context.workspaceId,
        email_id: emailId,
        type,
        recipient: recipient.toLowerCase(),
        occurred_at: new Date(event.created_at).toISOString(),
        provider: 'resend',
        provider_message_id: providerMessageId,
        diagnostic: event.data.bounce?.message ?? null,
      }
      if (type === 'bounced') {
        base.bounce_class = classifyBounce({
          diagnostic: event.data.bounce?.message,
          providerType: event.data.bounce?.type,
          providerSubType: event.data.bounce?.subType,
        }).class
      }
      return base
    }),
  )
}
