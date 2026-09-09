import type { NormalizedEvent, NormalizedEventType } from '@mailysend/contracts'
import { classifyBounce } from '../bounce.ts'
import { eventId } from '../identity.ts'

/**
 * Delivery Status Notifications.
 *
 * The fallback path, and the only lifecycle signal available on a raw SMTP
 * relay — which is exactly why the SMTP provider declares `reportsEvents:
 * false` and the UI says so rather than showing an empty timeline.
 *
 * A DSN is a `multipart/report; report-type=delivery-status` message delivered
 * to the return path. The machine-readable part (RFC 3464) carries the original
 * recipient, an action, a status code and a diagnostic; we parse that and
 * ignore the human-readable prose entirely.
 */

export interface DsnParseResult {
  /** Recovered from the returned headers. Null when the DSN omits the original message. */
  emailId: string | null
  originalMessageId: string | null
  recipients: {
    recipient: string
    action: 'failed' | 'delayed' | 'delivered' | 'relayed' | 'expanded'
    status: string | null
    diagnostic: string | null
    remoteMta: string | null
  }[]
}

const fieldValue = (block: string, name: string): string | null => {
  const m = block.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))
  return m ? m[1]!.trim() : null
}

/**
 * Parses the delivery-status part of a DSN.
 *
 * Written against the raw text rather than a MIME tree because the caller has
 * already extracted the part, and because DSNs in the wild are frequently
 * slightly malformed — a tolerant field scan recovers more of them than a
 * strict parser does.
 */
export function parseDsn(deliveryStatusPart: string, originalHeaders?: string): DsnParseResult {
  // Per-recipient blocks are separated by a blank line; the first block is the
  // per-message block and carries no Final-Recipient.
  const blocks = deliveryStatusPart.split(/\r?\n\r?\n/).filter((b) => b.trim())
  const recipients: DsnParseResult['recipients'] = []

  for (const block of blocks) {
    const finalRecipient =
      fieldValue(block, 'Final-Recipient') ?? fieldValue(block, 'Original-Recipient')
    if (!finalRecipient) continue

    const address = finalRecipient.includes(';')
      ? finalRecipient.split(';')[1]!.trim()
      : finalRecipient.trim()
    const action = (
      fieldValue(block, 'Action') ?? 'failed'
    ).toLowerCase() as DsnParseResult['recipients'][number]['action']
    const diagnostic = fieldValue(block, 'Diagnostic-Code')
    const remoteMta = fieldValue(block, 'Remote-MTA')

    recipients.push({
      recipient: address.toLowerCase(),
      action,
      status: fieldValue(block, 'Status'),
      diagnostic: diagnostic
        ? diagnostic.includes(';')
          ? diagnostic.split(';').slice(1).join(';').trim()
          : diagnostic
        : null,
      remoteMta: remoteMta
        ? remoteMta.includes(';')
          ? remoteMta.split(';')[1]!.trim()
          : remoteMta
        : null,
    })
  }

  // The returned original headers are where our id survives the round trip —
  // this is the payoff for stamping X-MailySend-Id and a derived Message-ID
  // into every outbound message regardless of transport.
  const emailId = originalHeaders?.match(/^X-MailySend-Id:\s*(\S+)/im)?.[1] ?? null
  const originalMessageId = originalHeaders?.match(/^Message-ID:\s*<([^>]+)>/im)?.[1] ?? null

  return { emailId, originalMessageId, recipients }
}

const ACTION_TO_TYPE: Record<string, NormalizedEventType | null> = {
  failed: 'bounced',
  delayed: 'delivery_delayed',
  delivered: 'delivered',
  // `relayed` means another MTA took responsibility and will not report back.
  // Treating it as delivered would be a claim we cannot support.
  relayed: null,
  expanded: null,
}

export async function normalizeDsn(
  parsed: DsnParseResult,
  context: { workspaceId: string; occurredAt: string; provider?: 'smtp' | 'cloudflare' },
): Promise<NormalizedEvent[]> {
  const provider = context.provider ?? 'smtp'
  const out: NormalizedEvent[] = []

  for (const r of parsed.recipients) {
    const type = ACTION_TO_TYPE[r.action]
    if (!type) continue

    const event: NormalizedEvent = {
      event_id: await eventId({
        provider,
        providerMessageId: parsed.originalMessageId,
        type,
        recipient: r.recipient,
        occurredAt: context.occurredAt,
      }),
      workspace_id: context.workspaceId,
      email_id: parsed.emailId,
      type,
      recipient: r.recipient,
      occurred_at: new Date(context.occurredAt).toISOString(),
      provider,
      provider_message_id: parsed.originalMessageId,
      smtp_code: r.status,
      diagnostic: r.diagnostic,
      smtp_response: r.diagnostic,
    }

    if (type === 'bounced') {
      const classified = classifyBounce({ smtpCode: r.status, diagnostic: r.diagnostic })
      event.bounce_class = classified.class
      // A DSN that says "delayed" but carries a 5.x status is a permanent
      // failure that the reporting MTA mislabelled; trust the code.
      if (!classified.permanent) event.type = 'delivery_delayed'
    }

    out.push(event)
  }

  return out
}

/** Detects whether an inbound message is a DSN rather than real mail. */
export const isDsn = (contentType: string, from: string): boolean =>
  /report-type=["']?delivery-status/i.test(contentType) ||
  /^(mailer-daemon|postmaster)@/i.test(from)
