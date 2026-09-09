import { z } from 'zod'

/**
 * Shared primitives. Everything the API accepts or returns is built from these,
 * so a rule like "an id is a prefixed ULID" is stated once.
 */

/**
 * Ids are `<prefix>_<ulid>`: time-sortable, so the id doubles as a range key in
 * D1 indexes and as an R2 partition prefix. 26 chars of Crockford base32.
 */
export const ulidRe = /^[0-9A-HJKMNP-TV-Z]{26}$/
export const prefixedId = <P extends string>(prefix: P) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`), `must be a ${prefix}_ id`)
    .describe(`A ${prefix}_ prefixed identifier`)

export const EmailId = prefixedId('em')
export const DomainId = prefixedId('dom')
export const AudienceId = prefixedId('aud')
export const ContactId = prefixedId('con')
export const BroadcastId = prefixedId('bc')
export const TemplateId = prefixedId('tpl')
export const SegmentId = prefixedId('seg')
export const AutomationId = prefixedId('aut')
export const WebhookId = prefixedId('wh')
export const ApiKeyId = prefixedId('key')
export const ThreadId = prefixedId('thr')
export const MessageId = prefixedId('msg')
export const WorkspaceId = prefixedId('ws')
export const UserId = prefixedId('usr')

/**
 * Accepts either a bare address or `Display Name <addr@example.com>` — Resend
 * accepts both in `from`, and every real-world caller sends the second form.
 */
export const emailAddress = z
  .string()
  .min(3)
  .max(320)
  .refine(
    (v) => {
      const m = v.match(/<([^>]+)>\s*$/)
      const addr = (m?.[1] ?? v).trim()
      return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(addr)
    },
    { message: 'must be an email address, optionally as "Name <addr@example.com>"' },
  )

/** Anywhere Resend accepts `string | string[]`, so do we. */
export const emailAddressList = z
  .union([emailAddress, z.array(emailAddress).min(1).max(50)])
  .transform((v) => (Array.isArray(v) ? v : [v]))

/** Tags are echoed back on every event and become Analytics Engine blobs. */
export const Tag = z.object({
  name: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/, 'tag names may contain only letters, numbers, _ and -'),
  value: z
    .string()
    .max(256)
    .regex(/^[A-Za-z0-9_-]*$/, 'tag values may contain only letters, numbers, _ and -'),
})

export const Attachment = z
  .object({
    /** base64. Mutually exclusive with `path`. */
    content: z.union([z.string(), z.array(z.number().int().min(0).max(255))]).optional(),
    filename: z.string().min(1).max(255),
    /** Fetched server-side at render time. */
    path: z.string().url().optional(),
    content_type: z.string().max(255).optional(),
    /** Set for inline images referenced as `cid:<content_id>` in the HTML. */
    content_id: z.string().max(255).optional(),
  })
  .refine((a) => Boolean(a.content) !== Boolean(a.path), {
    message: 'provide exactly one of `content` or `path`',
  })

/** ISO-8601, or natural language Resend also accepts ("in 1 min", "tomorrow at 9am"). */
export const scheduledAt = z.string().min(2).max(120)

export const IsoDate = z.iso.datetime({ offset: true })

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Opaque keyset cursor. Never an offset — offsets get slower as data grows. */
  after: z.string().max(200).optional(),
  before: z.string().max(200).optional(),
})

export const listResponse = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    object: z.literal('list'),
    data: z.array(item),
    has_more: z.boolean(),
    next_cursor: z.string().nullable().optional(),
  })

/** Resend returns `{ object, id }` from every create. We match it byte for byte. */
export const createdResponse = <T extends string>(object: T, id: z.ZodTypeAny) =>
  z.object({ object: z.literal(object), id })

export const deletedResponse = <T extends string>(object: T, id: z.ZodTypeAny) =>
  z.object({ object: z.literal(object), id, deleted: z.literal(true) })
