import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { api } from './server/api/index.ts'
import { consumeBroadcastPages } from './server/consumers/broadcast.ts'
import { consumeEventQueue } from './server/consumers/events.ts'
import { consumeInbound } from './server/consumers/inbound.ts'
import { consumeWebhooks } from './server/consumers/webhooks.ts'
import { runCron } from './server/cron.ts'
import { type Env, runWithEnv } from './server/env.ts'
import { handleInboundEmail } from './server/inbound-handler.ts'
import { consumeSend } from './server/send/consumer.ts'
import { handleClick, handleOpen, handleUnsubscribe } from './server/tracking.ts'

/**
 * The single server entry.
 *
 * One Worker serves the marketing site, the dashboard, the REST API, the MCP
 * endpoint and the tracking routes, because the one-click deploy has to
 * provision one thing. The split into `apps/track` exists for the hosted
 * product's cold-start budget, not because the code needs to be apart.
 *
 * Routing order is deliberate: the cheap, high-volume paths (tracking) are
 * matched before anything that could touch a database, and the API is matched
 * before the React handler so a `/v1` request never pays for SSR.
 */

const startHandler = createStartHandler(defaultStreamHandler)

async function route(request: Request, env: Env, _ctx: ExecutionContextLike): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url

  // --- tracking ------------------------------------------------------------
  if (pathname.startsWith('/o/')) return handleOpen(request, env, pathname.slice(3))
  if (pathname.startsWith('/c/')) return handleClick(request, env, pathname.slice(3))
  if (pathname.startsWith('/u/')) return handleUnsubscribe(request, env, pathname.slice(3))

  // --- api -----------------------------------------------------------------
  if (pathname === '/v1' || pathname.startsWith('/v1/')) return api.fetch(request, env)

  // Sign-out is a plain form POST rather than a `fetch` to `/v1`, because the
  // moment somebody most wants out is the moment the client bundle has broken.
  // It answers with a redirect so a browser lands somewhere, and clears the
  // cookie even if the session row is already gone.
  if (pathname === '/auth/sign-out' && request.method === 'POST') {
    const response = await api.fetch(
      new Request(`${url.origin}/v1/auth/session`, {
        method: 'DELETE',
        headers: request.headers,
      }),
      env,
    )
    return new Response(null, {
      status: 303,
      headers: {
        location: '/sign-in',
        ...(response.headers.get('set-cookie')
          ? { 'set-cookie': response.headers.get('set-cookie') as string }
          : {}),
      },
    })
  }

  if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
    const { handleMcp } = await import('./server/mcp.ts')
    return handleMcp(request)
  }

  // The API reference reads the same OpenAPI document the SDKs generate from,
  // so a drifted endpoint is visible on the docs page rather than only in a
  // failing SDK build.
  if (pathname === '/reference') {
    const { Scalar } = await import('@scalar/hono-api-reference')
    return Scalar({ url: '/v1/openapi.json', pageTitle: 'MailySend API' })(
      { req: { raw: request } } as never,
      async () => {},
    ) as unknown as Response
  }

  return startHandler(request)
}

/**
 * On Workers the runtime hands us `env` and `ctx`. On Node it hands us neither,
 * so the first request builds them — one seam, resolved here, instead of a
 * runtime check in every handler.
 */
async function resolve(
  env: Env | undefined,
  ctx: ExecutionContextLike | undefined,
): Promise<{ env: Env; ctx: ExecutionContextLike }> {
  if (env?.DB) return { env, ctx: ctx ?? passthroughCtx }
  const runtime = await import('./server/node-runtime.ts')
  return { env: await runtime.startNodeRuntime(), ctx: runtime.nodeCtx }
}

const passthroughCtx: ExecutionContextLike = {
  waitUntil(promise) {
    promise.catch((err) => console.error('[background]', err))
  },
}

export default {
  async fetch(
    request: Request,
    maybeEnv?: Env,
    maybeCtx?: ExecutionContextLike,
  ): Promise<Response> {
    const { env, ctx } = await resolve(maybeEnv, maybeCtx)
    // Request-scoped, not module-scoped: a module-level variable would leak one
    // request's workspace into another under concurrency, which on Workers is
    // the default rather than the exception.
    return runWithEnv(env, ctx, () => route(request, env, ctx))
  },

  async queue(batch: QueueBatchLike, env: Env, ctx: ExecutionContextLike): Promise<void> {
    return runWithEnv(env, ctx, async () => {
      switch (batch.queue) {
        case 'ms-send':
        case 'ms-send-bulk':
          return consumeSend(batch as never, env)
        case 'ms-events-cf':
        case 'ms-events-raw':
        case 'ms-events-norm':
          return consumeEventQueue(batch as never, env)
        case 'ms-webhooks':
          return consumeWebhooks(batch as never, env)
        case 'ms-broadcast-pages':
          return consumeBroadcastPages(batch as never, env)
        case 'ms-inbound':
          return consumeInbound(batch as never, env)
        default: {
          const { consumeMisc } = await import('./server/consumers/misc.ts')
          return consumeMisc(batch as never, env)
        }
      }
    })
  },

  /** Cloudflare's inbound mail handler. Deliberately does almost nothing. */
  async email(message: EmailMessageLike, env: Env, ctx: ExecutionContextLike): Promise<void> {
    return runWithEnv(env, ctx, () => handleInboundEmail(message, env))
  },

  async scheduled(event: { cron: string }, env: Env, ctx: ExecutionContextLike): Promise<void> {
    return runWithEnv(env, ctx, () => runCron(event.cron, env))
  },
}

/** Re-exported so `wrangler.jsonc` can bind them by class name. */
export {
  AutomationCohortActor as AutomationCohortDO,
  AutomationRunActor as AutomationRunDO,
  BroadcastActor as BroadcastDO,
  BroadcastCounterActor as BroadcastCounterDO,
  MailboxActor as MailboxDO,
  ScheduleShardActor as ScheduleShardDO,
  SegmentActor as SegmentDO,
  SendingDomainActor as SendingDomainDO,
  WebhookEndpointActor as WebhookEndpointDO,
  WorkspaceHubActor as WorkspaceHubDO,
} from '@mailysend/durable'

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException?(): void
}
interface QueueBatchLike {
  queue: string
  messages: unknown[]
}
interface EmailMessageLike {
  from: string
  to: string
  raw: ReadableStream
  rawSize: number
  headers: Headers
  setReject(reason: string): void
}
