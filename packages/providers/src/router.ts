import { stableHash } from '@mailysend/core'
import type { OutboundMessage, Provider, ProviderName, SendResult } from './types.ts'
import { SendError } from './types.ts'

/**
 * Provider selection and failover.
 *
 * Two rules, and both exist to prevent duplicate delivery rather than to
 * balance load:
 *
 *   1. Selection is `hash(email_id) % weight_space`, not random. A retry of the
 *      same message therefore always reaches the same provider. Random
 *      selection would mean a timed-out send could be retried through a
 *      *different* transport and delivered twice.
 *
 *   2. Failover happens only for `transient` and `throttled` errors — cases
 *      where we know the provider did not accept the message. An `unknown`
 *      outcome never fails over, because the message may already be on the wire.
 */

export interface ProviderEntry {
  provider: Provider
  /** Lower runs first. Failover walks priority order. */
  priority: number
  /** Share of traffic among providers at the same priority. */
  weight: number
  enabled: boolean
}

export interface RouteOptions {
  /** Pins one transport, bypassing routing. Used by `provider` on the send API. */
  pin?: ProviderName
  /** Providers already tried in this attempt chain. */
  exclude?: ProviderName[]
}

export interface SendAttempt {
  provider: ProviderName
  ok: boolean
  error?: SendError
  durationMs: number
}

export interface RoutedSendResult extends SendResult {
  attempts: SendAttempt[]
}

export class ProviderRouter {
  #entries: ProviderEntry[]
  #breaker: CircuitBreaker

  constructor(entries: ProviderEntry[], breaker = new CircuitBreaker()) {
    this.#entries = entries.filter((e) => e.enabled).sort((a, b) => a.priority - b.priority)
    this.#breaker = breaker
  }

  get providers(): Provider[] {
    return this.#entries.map((e) => e.provider)
  }

  /** Deterministic choice among the healthy providers at the lowest priority. */
  select(emailId: string, options: RouteOptions = {}): Provider | null {
    if (options.pin) {
      return this.#entries.find((e) => e.provider.name === options.pin)?.provider ?? null
    }

    const excluded = new Set(options.exclude ?? [])
    const candidates = this.#entries.filter(
      (e) => !excluded.has(e.provider.name) && !this.#breaker.isOpen(e.provider.name),
    )
    if (candidates.length === 0) {
      // Everything is either excluded or circuit-broken. Falling back to the
      // full list is better than dropping the message: a broken circuit is a
      // guess, and a guess should not become a delivery failure.
      const fallback = this.#entries.filter((e) => !excluded.has(e.provider.name))
      return fallback[0]?.provider ?? null
    }

    const topPriority = candidates[0]!.priority
    const tier = candidates.filter((e) => e.priority === topPriority)
    if (tier.length === 1) return tier[0]!.provider

    const totalWeight = tier.reduce((sum, e) => sum + e.weight, 0)
    let point = stableHash(emailId) % totalWeight
    for (const entry of tier) {
      point -= entry.weight
      if (point < 0) return entry.provider
    }
    return tier.at(-1)!.provider
  }

  /**
   * Sends, failing over where — and only where — that is provably safe.
   * `maxAttempts` is 2 by default: a third transport rarely helps, and each
   * additional attempt widens the window in which a duplicate could occur.
   */
  async send(
    message: OutboundMessage,
    options: RouteOptions & { maxAttempts?: number } = {},
  ): Promise<RoutedSendResult> {
    const maxAttempts = options.maxAttempts ?? 2
    const attempts: SendAttempt[] = []
    const tried: ProviderName[] = [...(options.exclude ?? [])]
    let lastError: SendError | undefined

    for (let i = 0; i < maxAttempts; i++) {
      const provider = this.select(message.emailId, { ...options, exclude: tried })
      if (!provider) break

      const startedAt = Date.now()
      try {
        const result = await provider.send(message)
        attempts.push({ provider: provider.name, ok: true, durationMs: Date.now() - startedAt })
        this.#breaker.recordSuccess(provider.name)
        return { ...result, attempts }
      } catch (err) {
        const error =
          err instanceof SendError ? err : new SendError('transient', provider.name, String(err))
        attempts.push({
          provider: provider.name,
          ok: false,
          error,
          durationMs: Date.now() - startedAt,
        })
        lastError = error
        tried.push(provider.name)

        if (error.kind === 'transient' || error.kind === 'auth')
          this.#breaker.recordFailure(provider.name)

        // The whole point of the `unknown` kind. Do not try another transport.
        if (!error.canFailover) break
        // A pinned provider was an explicit instruction; silently using another
        // would violate it.
        if (options.pin) break
      }
    }

    throw lastError ?? new SendError('permanent', 'cloudflare', 'no sending provider is configured')
  }
}

/**
 * A per-provider circuit breaker.
 *
 * Opens after five consecutive failures and half-opens after thirty seconds.
 * Its job is not to protect the provider — it is to stop us spending the whole
 * queue's retry budget on a transport that is currently down, while the healthy
 * one sits idle.
 */
export class CircuitBreaker {
  #state = new Map<ProviderName, { failures: number; openedAt: number }>()
  #threshold: number
  #cooldownMs: number

  constructor(threshold = 5, cooldownMs = 30_000) {
    this.#threshold = threshold
    this.#cooldownMs = cooldownMs
  }

  isOpen(provider: ProviderName): boolean {
    const s = this.#state.get(provider)
    if (!s || s.failures < this.#threshold) return false
    if (Date.now() - s.openedAt > this.#cooldownMs) {
      // Half-open: let one request through to find out whether it recovered.
      s.failures = this.#threshold - 1
      return false
    }
    return true
  }

  recordFailure(provider: ProviderName) {
    const s = this.#state.get(provider) ?? { failures: 0, openedAt: 0 }
    s.failures++
    if (s.failures >= this.#threshold) s.openedAt = Date.now()
    this.#state.set(provider, s)
  }

  recordSuccess(provider: ProviderName) {
    this.#state.delete(provider)
  }

  snapshot(): Record<string, { failures: number; open: boolean }> {
    return Object.fromEntries(
      [...this.#state.entries()].map(([k, v]) => [
        k,
        { failures: v.failures, open: this.isOpen(k) },
      ]),
    )
  }
}
