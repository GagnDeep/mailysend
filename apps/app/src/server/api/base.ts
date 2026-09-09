import { ApiError, apiError } from '@mailysend/contracts'
import { kvKey } from '@mailysend/core'
import { Hono } from 'hono'
import { z } from 'zod'
import { actorFromApiKey, actorFromSession, bearerToken } from '../auth.ts'
import { buildContext, type Ctx } from '../context.ts'
import { background, getEnv } from '../env.ts'

/**
 * The shape every `/v1` route group is built on.
 *
 * There is exactly one authentication middleware, one error serializer and one
 * rate limiter in the whole API, because the compatibility claim is only true
 * if it is true uniformly: a Resend SDK that gets a Resend-shaped 422 from
 * `/v1/emails` and something else from `/v1/domains` is not compatible.
 */

export type Vars = { ctx: Ctx }
export type App = Hono<{ Variables: Vars }>

export const createRouter = (): App => new Hono<{ Variables: Vars }>()

/** Resend-shaped error body, always, for every failure mode. */
export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    const body = err.toBody()
    return Response.json(body, {
      status: err.status,
      headers: err.retryAfter ? { 'retry-after': String(err.retryAfter) } : {},
    })
  }
  if (err instanceof z.ZodError) {
    const first = err.issues[0]
    const param = first?.path.join('.')
    const wrapped = apiError('validation_error', {
      message: first
        ? `${param ? `${param}: ` : ''}${first.message}`
        : 'The request body is invalid.',
      ...(param ? { param } : {}),
    })
    return Response.json(wrapped.toBody(), { status: 422 })
  }
  // Anything unclassified is a bug on our side. Log it with the real detail and
  // return the generic body — the caller gets nothing useful from a stack trace
  // and we get everything from the log.
  console.error('[api] unhandled error', err)
  return Response.json(apiError('internal_error').toBody(), { status: 500 })
}

/**
 * Rate limiting.
 *
 * A fixed window in KV rather than a token bucket in a Durable Object: the
 * limiter runs on every request including the ones that do nothing, so it must
 * cost one KV read, and a burst crossing a window boundary is a far smaller
 * problem than adding a DO round trip to every call.
 */
const RATE_LIMITS: Record<string, { requests: number; windowSeconds: number }> = {
  'emails:send': { requests: 600, windowSeconds: 60 },
  default: { requests: 1000, windowSeconds: 60 },
}

export async function enforceRateLimit(
  ctx: Ctx,
  bucket: keyof typeof RATE_LIMITS = 'default',
): Promise<void> {
  const limit = RATE_LIMITS[bucket] ?? RATE_LIMITS.default!
  const window = Math.floor(Date.now() / (limit.windowSeconds * 1000))
  const key = kvKey.rateLimit(ctx.workspace.id, `${bucket}:${window}`)
  const current = Number((await ctx.cache.get(key)) ?? '0')
  if (current >= limit.requests) {
    const resetIn = limit.windowSeconds - Math.floor((Date.now() / 1000) % limit.windowSeconds)
    throw apiError('rate_limit_exceeded', {
      message: `Rate limit of ${limit.requests} requests per ${limit.windowSeconds}s exceeded.`,
      retryAfter: resetIn,
    })
  }
  // Read-modify-write is not atomic in KV, so a genuinely simultaneous burst can
  // overshoot slightly. That is acceptable for a courtesy limit; the governor in
  // the send path is the one that must be exact, and it lives in an actor.
  ctx.background(
    ctx.cache.put(key, String(current + 1), { expirationTtl: limit.windowSeconds + 10 }),
  )
}

/** Builds the request context, authenticating by API key or dashboard session. */
export async function contextFromRequest(
  request: Request,
  opts: { allowSession?: boolean } = {},
): Promise<Ctx> {
  const env = getEnv()
  const token = bearerToken(request)

  if (token) {
    const tenancy = (await import('../context.ts')).tenancyFor(env)
    const actor = await actorFromApiKey(token, tenancy.db(''), env.CACHE)
    return buildContext(env, actor, background)
  }

  if (opts.allowSession !== false) {
    const tenancy = (await import('../context.ts')).tenancyFor(env)
    const actor = await actorFromSession(request, tenancy.db(''))
    if (actor) return buildContext(env, actor, background)

    // A browser is asking. `missing_api_key` is the correct answer for a
    // program and the wrong one for a person: the remedy is "sign in", not
    // "check your key", and telling them the wrong one is how a signed-out
    // dashboard turns into a support ticket.
    if (request.headers.has('cookie') || request.headers.get('sec-fetch-mode') === 'cors') {
      throw apiError('not_signed_in')
    }
  }

  throw apiError('missing_api_key')
}

/** Middleware: authenticate, build context, rate limit, serialize errors. */
export function withContext(bucket: keyof typeof RATE_LIMITS = 'default') {
  return async (
    c: { req: { raw: Request }; set: (k: 'ctx', v: Ctx) => void },
    next: () => Promise<void>,
  ) => {
    const ctx = await contextFromRequest(c.req.raw)
    await enforceRateLimit(ctx, bucket)
    c.set('ctx', ctx)
    await next()
  }
}

/** Cursor pagination over prefixed ULIDs — the ids sort by time, so the id is the cursor. */
export interface Page<T> {
  object: 'list'
  data: T[]
  has_more: boolean
  next_cursor: string | null
}

export function page<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  return {
    object: 'list',
    data,
    has_more: hasMore,
    next_cursor: hasMore ? (data.at(-1)?.id ?? null) : null,
  }
}

export const parseLimit = (raw: string | undefined, fallback = 25, max = 100): number => {
  const n = Number(raw ?? fallback)
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), max) : fallback
}

/** `{ data: … }` for collections; bare objects for single resources — Resend's shape. */
export const json = <T>(body: T, status = 200): Response => Response.json(body as never, { status })
