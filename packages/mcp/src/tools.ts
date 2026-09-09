import { ApiError } from '@mailysend/contracts'
import type { z } from 'zod'
import type { ConfirmationGate, RedeemFailure } from './confirmation.ts'
import {
  CreateContactInput,
  GetAnalyticsInput,
  GetEmailInput,
  GetThreadInput,
  type JsonSchema,
  jsonSchema,
  ListDomainsInput,
  ListEmailsInput,
  ReplyToThreadInput,
  ReplyToThreadOutput,
  SearchThreadsInput,
  SendEmailInput,
  SendEmailOutput,
  withConfirmationToken,
} from './schemas.ts'
import type {
  AuthContext,
  ConfirmationSummary,
  McpBackend,
  Permission,
  SendingToolName,
} from './types.ts'

/**
 * The nine tools.
 *
 * Nine is a decision, not an accident. An MCP server that mirrors every REST
 * endpoint gives a model a hundred near-identical choices and it picks wrong;
 * these are the nine things an assistant actually needs to do with a mail
 * account, and each one is the whole job rather than a step in it.
 */

export type ToolName =
  | 'send_email'
  | 'list_emails'
  | 'get_email'
  | 'search_threads'
  | 'get_thread'
  | 'reply_to_thread'
  | 'list_domains'
  | 'get_analytics'
  | 'create_contact'

export const TOOL_NAMES: readonly ToolName[] = [
  'send_email',
  'list_emails',
  'get_email',
  'search_threads',
  'get_thread',
  'reply_to_thread',
  'list_domains',
  'get_analytics',
  'create_contact',
] as const

export const SENDING_TOOLS: readonly SendingToolName[] = ['send_email', 'reply_to_thread'] as const

export interface ToolResult {
  content: { type: 'text'; text: string }[]
  structuredContent?: unknown
  isError?: boolean
}

export interface ToolContext {
  auth: AuthContext
  backend: McpBackend
  confirmations: ConfirmationGate
  approvalChannel: string
}

export interface ToolDescriptor {
  name: ToolName
  title: string
  description: string
  inputSchema: JsonSchema
  outputSchema?: JsonSchema
  annotations: {
    title: string
    readOnlyHint: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint: boolean
  }
  /**
   * Machine-readable, so a client can refuse to auto-approve a tool without
   * parsing English out of `description`.
   */
  'x-mailysend-confirmation'?: 'required'
  _meta?: Record<string, unknown>
  /** `sending_access` keys are scoped to the two sending tools. */
  permission: Permission | 'any'
  handler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
}

const text = (value: string): { type: 'text'; text: string }[] => [{ type: 'text', text: value }]

const ok = (message: string, structured: unknown): ToolResult => ({
  content: text(message),
  structuredContent: structured,
})

const failure = (message: string, structured?: unknown): ToolResult => ({
  content: text(message),
  ...(structured === undefined ? {} : { structuredContent: structured }),
  isError: true,
})

const parseArgs = <T extends z.ZodType>(
  schema: T,
  args: unknown,
): { ok: true; value: z.infer<T> } | { ok: false; result: ToolResult } => {
  const parsed = schema.safeParse(args)
  if (parsed.success) return { ok: true, value: parsed.data }
  const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
  return {
    ok: false,
    result: failure(`Invalid arguments.\n${issues.join('\n')}`, {
      status: 'invalid_arguments',
      issues,
    }),
  }
}

const notFound = (what: string) => failure(new ApiError('not_found', { message: what }).message)

// ---------------------------------------------------------------------------
// Confirmation plumbing shared by the two sending tools
// ---------------------------------------------------------------------------

const asList = (value: string | string[] | undefined | null): string[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]

/** Enough of the body for a person to recognise the message, never the whole thing. */
const previewOf = (parts: (string | undefined)[]): string => {
  const source = parts.find((p) => p && p.trim().length > 0) ?? ''
  return source
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

const renderSummary = (summary: ConfirmationSummary, expiresAt: string): string => {
  const lines = [
    'This call did not send anything. It is a confirmation request.',
    '',
    `Tool:       ${summary.tool}`,
    `From:       ${summary.from ?? '(thread default)'}`,
    `To:         ${summary.to.join(', ') || '(thread participants)'}`,
  ]
  if (summary.cc.length > 0) lines.push(`Cc:         ${summary.cc.join(', ')}`)
  if (summary.bcc.length > 0) lines.push(`Bcc:        ${summary.bcc.join(', ')}`)
  if (summary.reply_to.length > 0) lines.push(`Reply-To:   ${summary.reply_to.join(', ')}`)
  lines.push(`Subject:    ${summary.subject || '(none)'}`)
  if (summary.thread_id) lines.push(`Thread:     ${summary.thread_id}`)
  if (summary.template_id) lines.push(`Template:   ${summary.template_id}`)
  if (summary.scheduled_at) lines.push(`Scheduled:  ${summary.scheduled_at}`)
  if (summary.attachment_count > 0) lines.push(`Attachments: ${summary.attachment_count}`)
  lines.push('', `Body preview: ${summary.preview || '(empty)'}`, '')
  lines.push(
    'A person must approve this in MailySend before it can be sent.',
    'You cannot approve it yourself, and repeating this call will not send it.',
    `The approval expires at ${expiresAt}.`,
  )
  return lines.join('\n')
}

const REJECTION_ADVICE: Record<RedeemFailure, string> = {
  invalid_token: 'Request a fresh confirmation by calling the tool without a token.',
  expired: 'Request a fresh confirmation by calling the tool without a token.',
  wrong_tool: 'Confirmations are bound to one tool. Request one from this tool.',
  wrong_workspace: 'Confirmations are bound to one workspace.',
  payload_changed: 'Call the tool again without a token to confirm the new message.',
  not_approved: 'Wait for a person to approve it. Do not retry in a loop.',
  already_used: 'The message was already sent. Do not send it again.',
}

/**
 * The single gate both sending tools go through.
 *
 * It returns either a confirmation request or a green light — there is no third
 * branch and no argument that skips it, which is the reason it is a function
 * every sender must call rather than a convention every sender must remember.
 */
const gate = async <T>(input: {
  tool: SendingToolName
  ctx: ToolContext
  token: string | undefined
  payload: T
  summary: ConfirmationSummary
}): Promise<{ cleared: true; idempotencyKey: string } | { cleared: false; result: ToolResult }> => {
  const { ctx, tool, payload, summary } = input

  if (!input.token) {
    const minted = await ctx.confirmations.mint({
      tool,
      workspaceId: ctx.auth.workspaceId,
      payload,
      summary,
    })
    const expiresAt = new Date(minted.expiresAt).toISOString()
    return {
      cleared: false,
      result: ok(renderSummary(summary, expiresAt), {
        status: 'confirmation_required',
        confirmation: {
          token: minted.token,
          expires_at: expiresAt,
          approved: false,
          approval_channel: ctx.approvalChannel,
          summary,
        },
      }),
    }
  }

  const redeemed = await ctx.confirmations.redeem({
    token: input.token,
    tool,
    workspaceId: ctx.auth.workspaceId,
    payload,
  })
  if (!redeemed.ok) {
    return {
      cleared: false,
      result: failure(`${redeemed.message} ${REJECTION_ADVICE[redeemed.reason]}`, {
        status: 'confirmation_rejected',
        reason: redeemed.reason,
        message: redeemed.message,
      }),
    }
  }

  return { cleared: true, idempotencyKey: redeemed.claims.nonce }
}

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

const readOnly = (title: string) => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
})

export const TOOLS: ToolDescriptor[] = [
  {
    name: 'send_email',
    title: 'Send an email',
    description:
      'Send an email through MailySend. This tool NEVER sends on the first call. Called ' +
      'without `confirmation_token` it returns a confirmation request describing exactly ' +
      'what would be sent; a person must approve it, and only then does a second call ' +
      'carrying that token and the identical message actually send.',
    inputSchema: withConfirmationToken(jsonSchema(SendEmailInput)),
    outputSchema: jsonSchema(SendEmailOutput),
    annotations: {
      title: 'Send an email',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    'x-mailysend-confirmation': 'required',
    _meta: { 'mailysend/confirmation': 'required', 'mailysend/self_approval': 'impossible' },
    permission: 'any',
    async handler(args, ctx) {
      const { confirmation_token: token, ...rest } = args
      const parsed = parseArgs(SendEmailInput, rest)
      if (!parsed.ok) return parsed.result

      const payload = parsed.value
      const summary: ConfirmationSummary = {
        tool: 'send_email',
        from: payload.from,
        to: asList(payload.to),
        cc: asList(payload.cc),
        bcc: asList(payload.bcc),
        reply_to: asList(payload.reply_to),
        subject: payload.subject,
        preview: previewOf([payload.text, payload.html, payload.react]),
        attachment_count: payload.attachments?.length ?? 0,
        tag_count: payload.tags?.length ?? 0,
        scheduled_at: payload.scheduled_at ?? null,
        template_id: payload.template_id ?? null,
        thread_id: null,
      }

      const cleared = await gate({
        tool: 'send_email',
        ctx,
        token: typeof token === 'string' ? token : undefined,
        payload,
        summary,
      })
      if (!cleared.cleared) return cleared.result

      const sent = await ctx.backend.sendEmail(ctx.auth, payload, {
        idempotencyKey: cleared.idempotencyKey,
      })
      return ok(`Sent. Message id ${sent.id}.`, {
        status: 'sent',
        id: sent.id,
        ...(sent.created_at ? { created_at: sent.created_at } : {}),
      })
    },
  },

  {
    name: 'reply_to_thread',
    title: 'Reply to an inbound thread',
    description:
      'Reply to an inbound conversation. Like `send_email`, the first call NEVER sends: it ' +
      'returns a confirmation request that a person must approve before a second call ' +
      'carrying the token can deliver the reply.',
    inputSchema: withConfirmationToken(jsonSchema(ReplyToThreadInput)),
    outputSchema: jsonSchema(ReplyToThreadOutput),
    annotations: {
      title: 'Reply to a thread',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    'x-mailysend-confirmation': 'required',
    _meta: { 'mailysend/confirmation': 'required', 'mailysend/self_approval': 'impossible' },
    permission: 'any',
    async handler(args, ctx) {
      const { confirmation_token: token, ...rest } = args
      const parsed = parseArgs(ReplyToThreadInput, rest)
      if (!parsed.ok) return parsed.result

      const payload = parsed.value
      const thread = await ctx.backend.getThread(ctx.auth, payload.thread_id)
      if (!thread) return notFound(`No thread ${payload.thread_id}.`)

      const summary: ConfirmationSummary = {
        tool: 'reply_to_thread',
        from: payload.from ?? null,
        to: thread.thread.participants,
        cc: payload.cc ?? [],
        bcc: payload.bcc ?? [],
        reply_to: [],
        subject: payload.subject ?? `Re: ${thread.thread.subject}`,
        preview: previewOf([payload.text, payload.html]),
        attachment_count: 0,
        tag_count: 0,
        scheduled_at: null,
        template_id: null,
        thread_id: payload.thread_id,
      }

      const cleared = await gate({
        tool: 'reply_to_thread',
        ctx,
        token: typeof token === 'string' ? token : undefined,
        payload,
        summary,
      })
      if (!cleared.cleared) return cleared.result

      const replied = await ctx.backend.replyToThread(ctx.auth, payload, {
        idempotencyKey: cleared.idempotencyKey,
      })
      return ok(`Replied on thread ${replied.thread_id}. Message id ${replied.id}.`, {
        status: 'sent',
        id: replied.id,
        thread_id: replied.thread_id,
      })
    },
  },

  {
    name: 'list_emails',
    title: 'List sent emails',
    description:
      'List messages this workspace has sent, newest first, with their delivery status. ' +
      'Paginate with the opaque `after` cursor rather than an offset.',
    inputSchema: jsonSchema(ListEmailsInput),
    annotations: readOnly('List sent emails'),
    permission: 'full_access',
    async handler(args, ctx) {
      const parsed = parseArgs(ListEmailsInput, args)
      if (!parsed.ok) return parsed.result
      const result = await ctx.backend.listEmails(ctx.auth, parsed.value)
      const lines = result.data.map(
        (e) => `${e.id}  ${e.last_event.padEnd(17)} ${e.to.join(', ')}  ${e.subject}`,
      )
      return ok(
        lines.length > 0 ? lines.join('\n') : 'No messages matched.',
        result as unknown as Record<string, unknown>,
      )
    },
  },

  {
    name: 'get_email',
    title: 'Get one email',
    description: 'Fetch one sent message by id, including its body and engagement counters.',
    inputSchema: jsonSchema(GetEmailInput),
    annotations: readOnly('Get one email'),
    permission: 'full_access',
    async handler(args, ctx) {
      const parsed = parseArgs(GetEmailInput, args)
      if (!parsed.ok) return parsed.result
      const email = await ctx.backend.getEmail(ctx.auth, parsed.value.email_id)
      if (!email) return notFound(`No message ${parsed.value.email_id}.`)
      return ok(
        `${email.id}\nTo: ${email.to.join(', ')}\nSubject: ${email.subject}\nStatus: ${email.last_event}`,
        email as unknown as Record<string, unknown>,
      )
    },
  },

  {
    name: 'search_threads',
    title: 'Search inbound threads',
    description:
      'Full-text search across inbound mail — subjects, snippets and senders. Answers from ' +
      'the mailbox FTS index in one hop, so it is cheap enough to use as a first move.',
    inputSchema: jsonSchema(SearchThreadsInput),
    annotations: readOnly('Search inbound threads'),
    permission: 'full_access',
    async handler(args, ctx) {
      const parsed = parseArgs(SearchThreadsInput, args)
      if (!parsed.ok) return parsed.result
      const hits = await ctx.backend.searchThreads(ctx.auth, parsed.value)
      const lines = hits.map(
        (h) => `${h.thread_id}  ${h.received_at}  ${h.from}\n  ${h.subject} — ${h.snippet}`,
      )
      return ok(lines.length > 0 ? lines.join('\n') : 'Nothing matched.', {
        object: 'list',
        data: hits,
      })
    },
  },

  {
    name: 'get_thread',
    title: 'Get an inbound thread',
    description: 'Fetch one inbound conversation with every message on it, oldest first.',
    inputSchema: jsonSchema(GetThreadInput),
    annotations: readOnly('Get an inbound thread'),
    permission: 'full_access',
    async handler(args, ctx) {
      const parsed = parseArgs(GetThreadInput, args)
      if (!parsed.ok) return parsed.result
      const thread = await ctx.backend.getThread(ctx.auth, parsed.value.thread_id)
      if (!thread) return notFound(`No thread ${parsed.value.thread_id}.`)
      const lines = thread.messages.map(
        (m) => `${m.received_at}  ${m.from}\n  ${m.text ?? m.snippet}`,
      )
      return ok(
        `${thread.thread.subject}\n${'-'.repeat(40)}\n${lines.join('\n\n')}`,
        thread as unknown as Record<string, unknown>,
      )
    },
  },

  {
    name: 'list_domains',
    title: 'List sending domains',
    description:
      "List this workspace's sending domains with verification status. Check this before " +
      'composing a `from` address: a message from an unverified domain is refused.',
    inputSchema: jsonSchema(ListDomainsInput),
    annotations: readOnly('List sending domains'),
    permission: 'full_access',
    async handler(args, ctx) {
      const parsed = parseArgs(ListDomainsInput, args ?? {})
      if (!parsed.ok) return parsed.result
      const domains = await ctx.backend.listDomains(ctx.auth)
      const lines = domains.map((d) => `${d.name.padEnd(32)} ${d.status}`)
      return ok(lines.length > 0 ? lines.join('\n') : 'No sending domains yet.', {
        object: 'list',
        data: domains,
      })
    },
  },

  {
    name: 'get_analytics',
    title: 'Get sending analytics',
    description:
      'Delivery, open, click, bounce and complaint figures over a date range. Open and click ' +
      'figures default to the `human` audience class, which excludes Apple MPP and scanner ' +
      'traffic — say so when you quote them.',
    inputSchema: jsonSchema(GetAnalyticsInput),
    annotations: readOnly('Get sending analytics'),
    permission: 'full_access',
    async handler(args, ctx) {
      const parsed = parseArgs(GetAnalyticsInput, args ?? {})
      if (!parsed.ok) return parsed.result
      const stats = await ctx.backend.getAnalytics(ctx.auth, parsed.value)
      const t = stats.totals
      return ok(
        [
          `${stats.range.from} → ${stats.range.to} (${stats.range.granularity}, ${stats.audience_class})`,
          `sent ${t.sent}  delivered ${t.delivered}  opened ${t.opened}  clicked ${t.clicked}`,
          `bounced ${t.bounced}  complained ${t.complained}  unsubscribed ${t.unsubscribed}`,
        ].join('\n'),
        stats as unknown as Record<string, unknown>,
      )
    },
  },

  {
    name: 'create_contact',
    title: 'Create a contact',
    description:
      'Add a contact to an audience. Creating a contact does not send anything, so it needs ' +
      'no confirmation.',
    inputSchema: jsonSchema(CreateContactInput),
    annotations: {
      title: 'Create a contact',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    permission: 'full_access',
    async handler(args, ctx) {
      const parsed = parseArgs(CreateContactInput, args)
      if (!parsed.ok) return parsed.result
      const contact = await ctx.backend.createContact(ctx.auth, parsed.value)
      return ok(
        `Created contact ${contact.id} for ${contact.email}.`,
        contact as unknown as Record<string, unknown>,
      )
    },
  },
]

export const TOOLS_BY_NAME = new Map<string, ToolDescriptor>(TOOLS.map((t) => [t.name, t]))
