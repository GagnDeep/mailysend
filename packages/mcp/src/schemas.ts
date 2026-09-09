import {
  CreateContactRequest,
  EmailId,
  EmailStatus,
  emailAddress,
  paginationQuery,
  SendEmailRequest,
  StatsQuery,
  ThreadId,
} from '@mailysend/contracts'
import { z } from 'zod'

/**
 * Tool schemas, derived from the API contracts rather than restated.
 *
 * An MCP tool whose input schema drifts from the endpoint behind it produces
 * the worst kind of agent failure: a call that validates locally and then 422s
 * remotely, which the model retries verbatim. Generating from the same Zod
 * objects the HTTP API validates against makes that class of bug impossible.
 */

const JSON_SCHEMA_OPTIONS = { io: 'input', unrepresentable: 'any' } as const

export type JsonSchema = Record<string, unknown>

/**
 * `$schema` is dropped because MCP embeds the schema as a value inside a larger
 * document; a nested `$schema` keyword confuses strict validators.
 */
export const jsonSchema = (schema: z.ZodType): JsonSchema => {
  const { $schema, ...rest } = z.toJSONSchema(schema, JSON_SCHEMA_OPTIONS) as JsonSchema
  void $schema
  return rest
}

const CONFIRMATION_TOKEN_DESCRIPTION =
  "The `confirmation.token` returned by this tool's previous `confirmation_required` " +
  'result, once a person has approved it. Omit it on the first call: the first call ' +
  'never sends. Tokens cannot be constructed, are bound to the exact message, and are ' +
  'spendable only after out-of-band human approval.'

/** Adds the second-call field to a sending tool's schema without touching the contract. */
export const withConfirmationToken = (schema: JsonSchema): JsonSchema => ({
  ...schema,
  properties: {
    ...((schema.properties as Record<string, unknown>) ?? {}),
    confirmation_token: { type: 'string', description: CONFIRMATION_TOKEN_DESCRIPTION },
  },
})

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const ListEmailsInput = paginationQuery.extend({ status: EmailStatus.optional() })

export const GetEmailInput = z.object({ email_id: EmailId })

export const SearchThreadsInput = z.object({
  query: z.string().min(1).max(512).describe('An FTS5 query over subject, snippet and sender.'),
  limit: z.number().int().min(1).max(50).default(20),
})

export const GetThreadInput = z.object({ thread_id: ThreadId })

/**
 * There is no `reply` contract to reuse — replying is a send whose envelope is
 * derived from a thread — so this composes the same primitives the API does.
 */
export const ReplyToThreadInput = z
  .object({
    thread_id: ThreadId,
    text: z.string().max(2_000_000).optional(),
    html: z.string().max(2_000_000).optional(),
    from: emailAddress.optional(),
    subject: z.string().max(998).optional(),
    cc: z.array(emailAddress).max(50).optional(),
    bcc: z.array(emailAddress).max(50).optional(),
  })
  .refine((v) => Boolean(v.text || v.html), { message: 'provide one of `text` or `html`' })

export const ListDomainsInput = z.object({})

export const GetAnalyticsInput = StatsQuery

export const CreateContactInput = CreateContactRequest

export const SendEmailInput = SendEmailRequest

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/**
 * Every sending tool can answer in one of two shapes, and `status` is the
 * discriminator. Declaring both in `outputSchema` is how a client learns that
 * `confirmation_required` is a normal outcome rather than a malformed result.
 */
export const ConfirmationSummaryOutput = z.object({
  tool: z.string(),
  from: z.string().nullable(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  bcc: z.array(z.string()),
  reply_to: z.array(z.string()),
  subject: z.string(),
  preview: z.string(),
  attachment_count: z.number().int(),
  tag_count: z.number().int(),
  scheduled_at: z.string().nullable(),
  template_id: z.string().nullable(),
  thread_id: z.string().nullable(),
})

export const ConfirmationRequiredOutput = z.object({
  status: z.literal('confirmation_required'),
  confirmation: z.object({
    token: z.string(),
    expires_at: z.string(),
    approved: z.literal(false),
    approval_channel: z.string(),
    summary: ConfirmationSummaryOutput,
  }),
})

export const ConfirmationRejectedOutput = z.object({
  status: z.literal('confirmation_rejected'),
  reason: z.enum([
    'invalid_token',
    'expired',
    'wrong_tool',
    'wrong_workspace',
    'payload_changed',
    'not_approved',
    'already_used',
  ]),
  message: z.string(),
})

export const SendEmailOutput = z.union([
  z.object({ status: z.literal('sent'), id: z.string(), created_at: z.string().optional() }),
  ConfirmationRequiredOutput,
  ConfirmationRejectedOutput,
])

export const ReplyToThreadOutput = z.union([
  z.object({ status: z.literal('sent'), id: z.string(), thread_id: z.string() }),
  ConfirmationRequiredOutput,
  ConfirmationRejectedOutput,
])
