import { Actor } from './base.ts'

/**
 * The webhook retry tail.
 *
 * Queues handle the first few minutes of retries well. What they handle badly
 * is the long tail — an endpoint that is down for six hours should not occupy a
 * queue slot with a six-hour visibility delay, and the retry schedule needs to
 * be inspectable from the dashboard.
 *
 * So: the queue owns 10s → 1h, and anything still failing after that is handed
 * to this actor, which walks 3h → 6h → 12h → 24h on alarms and then gives up.
 * An endpoint failing 20 times consecutively is disabled outright, because a
 * permanently broken endpoint is a retry amplifier that costs everyone.
 */

const TAIL_SCHEDULE_MS = [3 * 3600_000, 6 * 3600_000, 12 * 3600_000, 24 * 3600_000]
const DISABLE_AFTER_CONSECUTIVE_FAILURES = 20

export interface PendingDelivery {
  deliveryId: string
  eventId: string
  eventType: string
  body: string
  attempt: number
  nextAt: number
}

export class WebhookEndpointActor extends Actor {
  async enqueueTail(delivery: Omit<PendingDelivery, 'nextAt'>): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const stage = Math.max(0, delivery.attempt - 1)
      if (stage >= TAIL_SCHEDULE_MS.length) {
        await this.#recordAbandoned(delivery)
        return
      }
      const nextAt = Date.now() + TAIL_SCHEDULE_MS[stage]!
      await this.storage.put(`pending:${delivery.deliveryId}`, { ...delivery, nextAt })
      const existing = await this.storage.getAlarm()
      if (existing === null || nextAt < existing) await this.storage.setAlarm(nextAt)
    })
  }

  async recordResult(ok: boolean): Promise<{ consecutiveFailures: number; disabled: boolean }> {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (ok) {
        await this.storage.put('consecutiveFailures', 0)
        return { consecutiveFailures: 0, disabled: false }
      }
      const failures = (await this.read<number>('consecutiveFailures', 0)) + 1
      await this.storage.put('consecutiveFailures', failures)
      const disabled = failures >= DISABLE_AFTER_CONSECUTIVE_FAILURES
      if (disabled) await this.storage.put('disabledAt', Date.now())
      return { consecutiveFailures: failures, disabled }
    })
  }

  async health(): Promise<{
    consecutiveFailures: number
    disabledAt: number | null
    pending: number
  }> {
    const pending = await this.storage.list({ prefix: 'pending:' })
    return {
      consecutiveFailures: await this.read('consecutiveFailures', 0),
      disabledAt: await this.read<number | null>('disabledAt', null),
      pending: pending.size,
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now()
    const pending = await this.storage.list<PendingDelivery>({ prefix: 'pending:' })
    let nextAlarm: number | null = null

    for (const [key, delivery] of pending) {
      if (delivery.nextAt > now) {
        nextAlarm = nextAlarm === null ? delivery.nextAt : Math.min(nextAlarm, delivery.nextAt)
        continue
      }
      await this.storage.delete(key)
      // Re-enqueue onto the normal queue rather than sending from inside the
      // alarm: the queue already owns signing, timeouts and attempt recording,
      // and duplicating that here would be a second implementation to keep
      // correct.
      await this.env.RETRY_WEBHOOK?.({ ...delivery, attempt: delivery.attempt + 1 })
    }

    if (nextAlarm !== null) await this.storage.setAlarm(nextAlarm)
  }

  async #recordAbandoned(delivery: Omit<PendingDelivery, 'nextAt'>) {
    // Kept for the dashboard: "we gave up after 24 hours" is a materially
    // different answer from "it is still retrying", and support needs both.
    await this.storage.put(`abandoned:${delivery.deliveryId}`, {
      ...delivery,
      abandonedAt: Date.now(),
    })
  }
}
