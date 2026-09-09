import type { ActorContext } from '@mailysend/platform'

/**
 * The base every actor extends.
 *
 * Actors are written against `ActorContext` rather than `DurableObjectState` so
 * the same class runs on Workers (as a real Durable Object) and on Node (as an
 * in-process instance). `packages/durable/src/cloudflare.ts` supplies the
 * twenty-line adapter that makes the Workers case work; nothing in this
 * directory imports `cloudflare:workers`.
 */
export abstract class Actor {
  protected ctx: ActorContext
  protected env: any

  constructor(ctx: ActorContext, env: unknown) {
    this.ctx = ctx
    this.env = env
  }

  protected get storage() {
    return this.ctx.storage
  }

  /** Convenience: read with a default, so call sites are not full of `?? x`. */
  protected async read<T>(key: string, fallback: T): Promise<T> {
    return (await this.storage.get<T>(key)) ?? fallback
  }
}

/**
 * A leaky-bucket rate limiter, persisted lazily.
 *
 * Tokens are computed from elapsed time rather than replenished on a timer,
 * which means an idle actor costs nothing and a restart cannot lose or
 * duplicate capacity — the state is two numbers and the clock.
 */
export interface BucketState {
  tokens: number
  updatedAt: number
}

export const takeTokens = (
  state: BucketState,
  { capacity, refillPerSecond }: { capacity: number; refillPerSecond: number },
  want: number,
  now = Date.now(),
): { granted: number; state: BucketState; retryAfterMs: number } => {
  const elapsed = Math.max(0, now - state.updatedAt) / 1000
  const tokens = Math.min(capacity, state.tokens + elapsed * refillPerSecond)
  const granted = Math.min(want, Math.floor(tokens))
  const remaining = tokens - granted
  return {
    granted,
    state: { tokens: remaining, updatedAt: now },
    // How long until at least one more token exists. Callers use this to set an
    // alarm instead of spinning.
    retryAfterMs: granted >= want ? 0 : Math.ceil(((1 - remaining) / refillPerSecond) * 1000),
  }
}
