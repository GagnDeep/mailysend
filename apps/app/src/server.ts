import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { api } from './server/api/index.ts'
import { actorFromSession } from './server/auth.ts'
import { configure, isClaimed } from './server/bootstrap.ts'
import { consumeBroadcastPages } from './server/consumers/broadcast.ts'
import { consumeEventQueue } from './server/consumers/events.ts'
import { consumeInbound } from './server/consumers/inbound.ts'
import { consumeWebhooks } from './server/consumers/webhooks.ts'
import { tenancyFor } from './server/context.ts'
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

const redirect = (location: string): Response =>
  new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } })

async function route(request: Request, env: Env, _ctx: ExecutionContextLike): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url

  // --- tracking ------------------------------------------------------------
  if (pathname.startsWith('/o/')) return handleOpen(request, env, pathname.slice(3))
  if (pathname.startsWith('/c/')) return handleClick(request, env, pathname.slice(3))
  if (pathname.startsWith('/u/')) return handleUnsubscribe(request, env, pathname.slice(3))

  // --- api -----------------------------------------------------------------
  // The live socket is matched before the router: an upgrade is not a response
  // Hono can produce, and the 101 has to come back from the actor that keeps
  // the socket.
  if (pathname === '/v1/live') {
    const { handleLiveSocket } = await import('./server/live.ts')
    return handleLiveSocket(request, env)
  }
  if (pathname === '/v1' || pathname.startsWith('/v1/')) return api.fetch(request, env)

  // --- first run, and the dashboard guard ----------------------------------
  //
  // Both of these were client-side and therefore too late. `/app` is `ssr:
  // true`, so the entire dashboard shell — sidebar, topbar, workspace name —
  // streamed to anonymous visitors and only bounced them after hydration; a
  // reader with JavaScript off never bounced at all. And a self-hosted instance
  // served the marketing site at its own root, which is somebody else's shop
  // window sitting where the operator expected their dashboard.
  if (pathname === '/app' || pathname.startsWith('/app/')) {
    const sql = tenancyFor(env).db('')
    if (!(await isClaimed(sql))) return redirect('/setup')
    if (!(await actorFromSession(request, sql))) {
      return redirect(`/sign-in?next=${encodeURIComponent(pathname + url.search)}`)
    }
  }

  if (pathname === '/' && env.MS_LANDING === 'app') {
    // The marketing pages stay reachable by URL — `/docs` is the reason anybody
    // self-hosts this in the first place — but they are not what the root of
    // your own instance should be.
    return redirect((await isClaimed(tenancyFor(env).db(''))) ? '/app' : '/setup')
  }

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
    const resolved = await resolve(maybeEnv, maybeCtx)
    // Migrations, the first workspace, and any value the deployment did not
    // configure — resolved here so a one-click deploy with no variables set
    // still answers its first request with a working instance.
    const env = await configure(resolved.env, request)
    const ctx = resolved.ctx
    // Request-scoped, not module-scoped: a module-level variable would leak one
    // request's workspace into another under concurrency, which on Workers is
    // the default rather than the exception.
    return runWithEnv(env, ctx, () => route(request, env, ctx))
  },

  async queue(batch: QueueBatchLike, rawEnv: Env, ctx: ExecutionContextLike): Promise<void> {
    const env = await configure(rawEnv)
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
  async email(message: EmailMessageLike, rawEnv: Env, ctx: ExecutionContextLike): Promise<void> {
    const env = await configure(rawEnv)
    return runWithEnv(env, ctx, () => handleInboundEmail(message, env))
  },

  async scheduled(event: { cron: string }, rawEnv: Env, ctx: ExecutionContextLike): Promise<void> {
    const env = await configure(rawEnv)
    return runWithEnv(env, ctx, () => runCron(event.cron, env))
  },
}

/**
 * Re-exported so `wrangler.jsonc` can bind them by class name.
 *
 * These used to be the actor classes themselves, which Workers accepts as
 * Durable Objects and then refuses to call: RPC requires `extends
 * DurableObject`, and says so only when a method is invoked. See
 * `server/durable-objects.ts`.
 */
export {
  AutomationCohortDO,
  AutomationRunDO,
  BroadcastCounterDO,
  BroadcastDO,
  MailboxDO,
  ScheduleShardDO,
  SegmentDO,
  SendingDomainDO,
  WebhookEndpointDO,
  WorkspaceHubDO,
} from './server/durable-objects.ts'

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
