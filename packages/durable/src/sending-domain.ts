import type { ActorContext } from '@mailysend/platform'
import { Actor, type BucketState, takeTokens } from './base.ts'

/**
 * One actor per (workspace, sending domain).
 *
 * It owns three things that must be serialised somewhere, and a domain is the
 * natural boundary for all three:
 *
 *   - the send-rate governor, so a broadcast cannot outrun the provider,
 *   - the *learned* daily ceiling, and
 *   - the per-provider circuit breaker.
 *
 * The learned ceiling is the interesting one. Cloudflare Email Service ramps a
 * domain's daily quota with its reputation and does not publish the number. The
 * only honest way to know it is to observe where sends start failing — so we
 * halve on a quota rejection and creep back up on a clean day. A broadcast
 * consults this before releasing tokens, which turns "first big send generates
 * ten thousand errors and a reputation hit" into "first big send throttles
 * itself into the ramp".
 */

export interface DomainGovernorConfig {
  /** Steady-state send rate. */
  perSecond: number
  /** How much burst is allowed above the steady rate. */
  burst: number
}

export interface DomainSnapshot {
  dailySent: number
  dailyCeiling: number | null
  day: string
  breakers: Record<string, { failures: number; openedUntil: number }>
  tokens: number
}

const DEFAULT_GOVERNOR: DomainGovernorConfig = { perSecond: 14, burst: 60 }

/** Where a domain with no history starts. Low enough not to trip a new ramp. */
const INITIAL_CEILING = 5_000

export class SendingDomainActor extends Actor {
  #config: DomainGovernorConfig

  constructor(ctx: ActorContext, env: unknown) {
    super(ctx, env)
    this.#config = DEFAULT_GOVERNOR
  }

  async configure(config: Partial<DomainGovernorConfig>): Promise<void> {
    this.#config = { ...this.#config, ...config }
    await this.storage.put('config', this.#config)
  }

  /**
   * Reserves capacity to send `count` messages.
   *
   * Returns how many were granted — callers must respect a partial grant rather
   * than treating it as failure, because that is what makes a broadcast slow
   * down smoothly instead of stopping.
   */
  async reserve(
    count: number,
    provider = 'cloudflare',
  ): Promise<{
    granted: number
    retryAfterMs: number
    reason?: 'daily_ceiling' | 'rate' | 'circuit_open'
  }> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now()
      const today = new Date(now).toISOString().slice(0, 10)

      const breaker = await this.read<Record<string, { failures: number; openedUntil: number }>>(
        'breakers',
        {},
      )
      if (breaker[provider] && breaker[provider]!.openedUntil > now) {
        return {
          granted: 0,
          retryAfterMs: breaker[provider]!.openedUntil - now,
          reason: 'circuit_open' as const,
        }
      }

      const state = await this.read<{ day: string; sent: number }>('daily', { day: today, sent: 0 })
      if (state.day !== today) {
        // A new day. If yesterday finished without hitting the ceiling, the
        // domain has earned a little more headroom — but at most double, since
        // providers ramp gradually and a sudden jump looks like an attack.
        const ceiling = await this.read<number | null>('ceiling', null)
        if (ceiling !== null && state.sent < ceiling * 0.9) {
          await this.storage.put('ceiling', Math.min(ceiling * 2, 5_000_000))
        }
        state.day = today
        state.sent = 0
      }

      const ceiling = (await this.read<number | null>('ceiling', null)) ?? INITIAL_CEILING
      const remainingToday = ceiling - state.sent
      if (remainingToday <= 0) {
        const midnight = new Date(now)
        midnight.setUTCHours(24, 0, 0, 0)
        return {
          granted: 0,
          retryAfterMs: midnight.getTime() - now,
          reason: 'daily_ceiling' as const,
        }
      }

      const config = (await this.read<DomainGovernorConfig>('config', this.#config)) ?? this.#config
      const bucket = await this.read<BucketState>('bucket', {
        tokens: config.burst,
        updatedAt: now,
      })
      const want = Math.min(count, remainingToday)
      const {
        granted,
        state: nextBucket,
        retryAfterMs,
      } = takeTokens(
        bucket,
        { capacity: config.burst, refillPerSecond: config.perSecond },
        want,
        now,
      )

      state.sent += granted
      await this.storage.put({ bucket: nextBucket, daily: state })

      return {
        granted,
        retryAfterMs: granted === 0 ? Math.max(retryAfterMs, 100) : 0,
        ...(granted < count ? { reason: 'rate' as const } : {}),
      }
    })
  }

  /**
   * Called when a provider rejects a send for exceeding its daily quota.
   * Halving is deliberately aggressive: overshooting a ramp costs reputation,
   * and reputation is far more expensive to recover than throughput.
   */
  async recordQuotaExceeded(provider: string): Promise<number> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const sent = (await this.read<{ day: string; sent: number }>('daily', { day: '', sent: 0 }))
        .sent
      const learned = Math.max(100, Math.floor(sent * 0.5))
      await this.storage.put('ceiling', learned)
      await this.#trip(provider, 5 * 60_000)
      return learned
    })
  }

  async recordFailure(provider: string): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const breakers = await this.read<Record<string, { failures: number; openedUntil: number }>>(
        'breakers',
        {},
      )
      const held = breakers[provider] ?? { failures: 0, openedUntil: 0 }
      held.failures++
      if (held.failures >= 5) held.openedUntil = Date.now() + 30_000
      breakers[provider] = held
      await this.storage.put('breakers', breakers)
    })
  }

  async recordSuccess(provider: string): Promise<void> {
    const breakers = await this.read<Record<string, { failures: number; openedUntil: number }>>(
      'breakers',
      {},
    )
    if (breakers[provider]) {
      delete breakers[provider]
      await this.storage.put('breakers', breakers)
    }
  }

  async #trip(provider: string, forMs: number) {
    const breakers = await this.read<Record<string, { failures: number; openedUntil: number }>>(
      'breakers',
      {},
    )
    breakers[provider] = { failures: 99, openedUntil: Date.now() + forMs }
    await this.storage.put('breakers', breakers)
  }

  async snapshot(): Promise<DomainSnapshot> {
    const today = new Date().toISOString().slice(0, 10)
    const daily = await this.read<{ day: string; sent: number }>('daily', { day: today, sent: 0 })
    const bucket = await this.read<BucketState>('bucket', { tokens: 0, updatedAt: Date.now() })
    return {
      dailySent: daily.day === today ? daily.sent : 0,
      dailyCeiling: await this.read<number | null>('ceiling', null),
      day: today,
      breakers: await this.read('breakers', {}),
      tokens: Math.floor(bucket.tokens),
    }
  }

  /** Verification state, polled by the domain setup screen. */
  async setVerification(state: {
    status: string
    checkedAt: string
    records: unknown
  }): Promise<void> {
    await this.storage.put('verification', state)
  }

  async getVerification(): Promise<
    { status: string; checkedAt: string; records: unknown } | undefined
  > {
    return this.storage.get('verification')
  }
}
