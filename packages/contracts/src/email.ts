import { z } from 'zod'
import {
  Attachment,
  EmailId,
  emailAddress,
  emailAddressList,
  IsoDate,
  scheduledAt,
  Tag,
  TemplateId,
} from './primitives.ts'

/**
 * `POST /v1/emails` — the Resend-compatible send payload.
 *
 * Field names, types and optionality match Resend exactly so the `resend` npm
 * SDK works against us with nothing but `RESEND_BASE_URL` changed. Fields we
 * add (`template_id`, `template_data`, `provider`, `tracking`) are additive and
 * ignored by Resend's own SDK, which strips nothing.
 */
export const SendEmailRequest = z
  .object({
    from: emailAddress,
    to: emailAddressList,
    subject: z.string().min(1).max(998),

    bcc: emailAddressList.optional(),
    cc: emailAddressList.optional(),
    reply_to: emailAddressList.optional(),

    html: z.string().max(2_000_000).optional(),
    text: z.string().max(2_000_000).optional(),
    /** Pre-rendered React Email output. Resend's SDK renders client-side and sends html. */
    react: z.string().max(2_000_000).optional(),

    headers: z.record(z.string().max(128), z.string().max(2048)).optional(),
    attachments: z.array(Attachment).max(20).optional(),
    tags: z.array(Tag).max(20).optional(),
    scheduled_at: scheduledAt.optional(),

    // --- MailySend extensions ---------------------------------------------
    /** Render a stored template instead of supplying a body. */
    template_id: TemplateId.optional(),
    template_data: z.record(z.string(), z.unknown()).optional(),
    /** Pin this message to one transport, bypassing the workspace's routing rules. */
    provider: z.enum(['cloudflare', 'ses', 'resend', 'smtp']).optional(),
    tracking: z
      .object({ opens: z.boolean().optional(), clicks: z.boolean().optional() })
      .optional(),
    /** Suppression is skipped only for transactional mail that legally must send. */
    ignore_suppression: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.html || v.text || v.react || v.template_id), {
    message: 'provide one of `html`, `text`, `react` or `template_id`',
  })
  .refine((v) => v.to.length + (v.cc?.length ?? 0) + (v.bcc?.length ?? 0) <= 50, {
    // Deliberately not auto-split: splitting rewrites the To: header and
    // silently breaks Reply-All for every recipient.
    message: 'a single message may not exceed 50 recipients across to, cc and bcc',
  })
export type SendEmailRequest = z.infer<typeof SendEmailRequest>

/** Resend returns `{ id }` only. We add `created_at`, which its SDK ignores. */
export const SendEmailResponse = z.object({
  id: EmailId,
  created_at: IsoDate.optional(),
})

export const BatchSendRequest = z.array(SendEmailRequest).min(1).max(100)

export const BatchSendResponse = z.object({
  data: z.array(
    z.union([
      z.object({ id: EmailId }),
      // Partial success: one bad item does not fail the batch, and the caller
      // can tell which index failed without diffing arrays.
      z.object({
        index: z.number().int(),
        error: z.object({ name: z.string(), message: z.string() }),
      }),
    ]),
  ),
})

export const EmailStatus = z.enum([
  'queued',
  'scheduled',
  'sending',
  'sent',
  'delivered',
  'delivery_delayed',
  'bounced',
  'complained',
  'failed',
  'canceled',
])
export type EmailStatus = z.infer<typeof EmailStatus>

export const EmailEventType = z.enum([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.opened',
  'email.clicked',
  'email.failed',
  'email.scheduled',
  'email.canceled',
])
export type EmailEventType = z.infer<typeof EmailEventType>

export const Email = z.object({
  object: z.literal('email'),
  id: EmailId,
  to: z.array(z.string()),
  from: z.string(),
  created_at: IsoDate,
  subject: z.string(),
  bcc: z.array(z.string()).nullable(),
  cc: z.array(z.string()).nullable(),
  reply_to: z.array(z.string()).nullable(),
  last_event: EmailStatus,
  html: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  scheduled_at: IsoDate.nullable().optional(),
  tags: z.array(Tag).optional(),
  // --- MailySend extensions ---
  provider: z.string().optional(),
  provider_message_id: z.string().nullable().optional(),
  opens: z.number().int().optional(),
  clicks: z.number().int().optional(),
})

export const UpdateEmailRequest = z.object({ scheduled_at: scheduledAt })
