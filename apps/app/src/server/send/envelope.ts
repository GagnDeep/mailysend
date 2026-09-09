import type { SendEmailRequest } from '@mailysend/contracts'

/**
 * The spooled send envelope.
 *
 * Queue messages cap at 128 KB, and a message with a 2 MB HTML body and
 * attachments obviously does not fit — so the queue never carries the payload.
 * It carries a pointer, and the envelope itself lives in R2 under
 * `spool/<email_id>.json` with a 7-day lifecycle rule.
 *
 * Bodies under `INLINE_LIMIT` skip R2 entirely and ride inside the queue
 * message, which is the common transactional case and removes a round trip
 * from the hot path.
 */
export const INLINE_LIMIT = 8 * 1024

export interface Envelope {
  email_id: string
  workspace_id: string
  environment: 'live' | 'test'
  request: SendEmailRequest
  /** Resolved at accept time so the consumer never re-reads domain config. */
  domain: {
    id: string
    name: string
    dkim_selector: string
    dkim_private_key: string | null
    return_path: string
    open_tracking: boolean
    click_tracking: boolean
  }
  /** Set when the message belongs to a broadcast or automation. */
  broadcast_id?: string
  automation_id?: string
  contact_id?: string
  /** Pin to one transport. Set by `request.provider` or by broadcast policy. */
  provider?: 'cloudflare' | 'ses' | 'resend' | 'smtp'
  created_at: string
}

/** What actually rides the queue. Either the envelope inline, or a pointer. */
export type SendJob =
  | { kind: 'inline'; email_id: string; workspace_id: string; envelope: Envelope }
  | { kind: 'spooled'; email_id: string; workspace_id: string; key: string }
