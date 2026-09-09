import type { Contact, Domain } from '@mailysend/contracts'
import { hashApiKey, newId } from '@mailysend/core'
import { mcpHttpHandler } from '../src/http.ts'
import { McpServer } from '../src/server.ts'
import type {
  AnalyticsSummary,
  AuthContext,
  AuthPort,
  Email,
  McpBackend,
  Permission,
  ThreadDetail,
  ThreadHit,
} from '../src/types.ts'

export const LIVE_KEY = 'ms_live_testkeytestkeytestkey01'
export const SENDING_KEY = 'ms_live_sendingonlysendingonly'

export const ids = {
  email: newId('email'),
  thread: newId('thread'),
  contact: newId('contact'),
  domain: newId('domain'),
  audience: newId('audience'),
}

export const email = (): Email => ({
  object: 'email',
  id: ids.email,
  to: ['ada@example.com'],
  from: 'team@mailysend.com',
  created_at: '2026-09-09T10:00:00.000Z',
  subject: 'Your receipt',
  bcc: null,
  cc: null,
  reply_to: null,
  last_event: 'delivered',
})

export const domain = (): Domain => ({
  object: 'domain',
  id: ids.domain,
  name: 'mailysend.com',
  status: 'verified',
  created_at: '2026-09-01T00:00:00.000Z',
  region: 'global',
  open_tracking: true,
  click_tracking: true,
  custom_return_path: 'cf-bounce',
})

export const contact = (): Contact => ({
  object: 'contact',
  id: ids.contact,
  email: 'ada@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  created_at: '2026-09-09T10:00:00.000Z',
  unsubscribed: false,
})

export const thread = (): ThreadDetail => ({
  thread: {
    id: ids.thread,
    subject: 'Refund for order 4471',
    participants: ['ada@example.com'],
    message_count: 1,
    unread: true,
    last_message_at: '2026-09-09T09:00:00.000Z',
  },
  messages: [
    {
      object: 'inbound_message',
      id: 'inb_1',
      thread_id: ids.thread,
      from: 'ada@example.com',
      to: ['support@mailysend.com'],
      subject: 'Refund for order 4471',
      received_at: '2026-09-09T09:00:00.000Z',
      snippet: 'Could I get a refund on order 4471?',
      text: 'Could I get a refund on order 4471?',
      parse_status: 'parsed',
    },
  ],
})

export const analytics = (): AnalyticsSummary => ({
  range: { from: '2026-08-10', to: '2026-09-09', granularity: 'day' },
  audience_class: 'human',
  totals: {
    sent: 1000,
    delivered: 980,
    opened: 400,
    clicked: 90,
    bounced: 12,
    complained: 1,
    unsubscribed: 4,
    failed: 8,
  },
  rates: {
    delivery_rate: 0.98,
    open_rate: 0.408,
    click_rate: 0.092,
    bounce_rate: 0.012,
    complaint_rate: 0.001,
  },
})

export interface CallLog {
  sendEmail: { payload: unknown; idempotencyKey: string }[]
  replyToThread: { payload: unknown; idempotencyKey: string }[]
  listEmails: number
  createContact: number
}

export const fakeBackend = (): { backend: McpBackend; calls: CallLog } => {
  const calls: CallLog = { sendEmail: [], replyToThread: [], listEmails: 0, createContact: 0 }
  const backend: McpBackend = {
    async listEmails() {
      calls.listEmails++
      return { data: [email()], has_more: false, next_cursor: null }
    },
    async getEmail(_ctx: AuthContext, emailId: string) {
      return emailId === ids.email ? email() : null
    },
    async sendEmail(_ctx, payload, options) {
      calls.sendEmail.push({ payload, idempotencyKey: options.idempotencyKey })
      return { id: ids.email, created_at: '2026-09-09T10:00:00.000Z' }
    },
    async searchThreads(): Promise<ThreadHit[]> {
      return [
        {
          thread_id: ids.thread,
          message_id: 'inb_1',
          subject: 'Refund for order 4471',
          snippet: 'Could I get a refund',
          from: 'ada@example.com',
          received_at: '2026-09-09T09:00:00.000Z',
        },
      ]
    },
    async getThread(_ctx, threadId) {
      return threadId === ids.thread ? thread() : null
    },
    async replyToThread(_ctx, payload, options) {
      calls.replyToThread.push({ payload, idempotencyKey: options.idempotencyKey })
      return { id: 'msg_reply', thread_id: ids.thread }
    },
    async listDomains() {
      return [domain()]
    },
    async getAnalytics() {
      return analytics()
    },
    async createContact() {
      calls.createContact++
      return contact()
    },
  }
  return { backend, calls }
}

export const fakeAuth = async (): Promise<AuthPort> => {
  const table = new Map<string, { workspaceId: string; permission: Permission }>([
    [await hashApiKey(LIVE_KEY), { workspaceId: 'ws_test', permission: 'full_access' }],
    [await hashApiKey(SENDING_KEY), { workspaceId: 'ws_test', permission: 'sending_access' }],
  ])
  return {
    async resolve(hash) {
      return table.get(hash) ?? null
    },
  }
}

export interface Harness {
  server: McpServer
  handler: (request: Request) => Promise<Response>
  calls: CallLog
  clock: { value: number }
  post(body: unknown, init?: { key?: string | null; accept?: string }): Promise<Response>
  rpc(method: string, params?: unknown, init?: { key?: string | null }): Promise<any>
  call(name: string, args?: unknown, init?: { key?: string | null }): Promise<any>
}

export const harness = async (
  options: { ttlSeconds?: number; secret?: string } = {},
): Promise<Harness> => {
  const { backend, calls } = fakeBackend()
  const clock = { value: Date.parse('2026-09-09T10:00:00.000Z') }
  const server = new McpServer({
    backend,
    auth: await fakeAuth(),
    confirmationSecret: options.secret ?? 'server-side-secret-never-shared',
    confirmationTtlSeconds: options.ttlSeconds ?? 600,
    now: () => clock.value,
  })
  const handler = mcpHttpHandler(server)

  const post = (body: unknown, init: { key?: string | null; accept?: string } = {}) => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: init.accept ?? 'application/json',
    }
    const key = init.key === undefined ? LIVE_KEY : init.key
    if (key !== null) headers.authorization = `Bearer ${key}`
    return handler(
      new Request('https://api.mailysend.com/mcp', {
        method: 'POST',
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    )
  }

  const rpc = async (method: string, params?: unknown, init: { key?: string | null } = {}) => {
    const response = await post({ jsonrpc: '2.0', id: 1, method, params }, init)
    return (await response.json()) as any
  }

  const call = async (name: string, args: unknown = {}, init: { key?: string | null } = {}) => {
    const body = (await rpc('tools/call', { name, arguments: args }, init)) as {
      result?: any
      error?: any
    }
    return body.result
  }

  return { server, handler, calls, clock, post, rpc, call }
}

export const SEND_ARGS: Record<string, unknown> = {
  from: 'team@mailysend.com',
  to: 'ada@example.com',
  subject: 'Your receipt',
  text: 'Thanks for your order.',
}
