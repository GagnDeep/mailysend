import { Actor } from './base.ts'

/**
 * Scheduled-send shards.
 *
 * `scheduled_at` messages could be found with a cron sweep of the messages
 * table, and at low volume that is fine. It stops being fine when the table is
 * large: the sweep is an index scan every minute whether or not anything is due.
 *
 * These shards hold only the *due times*, keyed so that `list()` with an upper
 * bound returns exactly what is ready. Sharding spreads the alarm load, and a
 * message is assigned to a shard by hash of its id so the same message always
 * lands in the same one.
 */

export const SCHEDULE_SHARDS = 8

export interface ScheduledItem {
  emailId: string
  workspaceId: string
  dueAt: number
}

export class ScheduleShardActor extends Actor {
  async schedule(item: ScheduledItem): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      // Key is `due:<zero-padded ms>:<id>` so lexicographic order is time order
      // and `list({ end })` is a range query rather than a filter.
      await this.storage.put(`due:${String(item.dueAt).padStart(15, '0')}:${item.emailId}`, item)
      const existing = await this.storage.getAlarm()
      if (existing === null || item.dueAt < existing) await this.storage.setAlarm(item.dueAt)
    })
  }

  async cancel(emailId: string, dueAt: number): Promise<boolean> {
    return this.storage.delete(`due:${String(dueAt).padStart(15, '0')}:${emailId}`)
  }

  async reschedule(
    emailId: string,
    oldDueAt: number,
    newDueAt: number,
    workspaceId: string,
  ): Promise<void> {
    await this.cancel(emailId, oldDueAt)
    await this.schedule({ emailId, workspaceId, dueAt: newDueAt })
  }

  async alarm(): Promise<void> {
    const now = Date.now()
    const due = await this.storage.list<ScheduledItem>({
      prefix: 'due:',
      end: `due:${String(now).padStart(15, '0')}~`,
      limit: 500,
    })

    if (due.size > 0) {
      await this.env.RELEASE_SCHEDULED?.([...due.values()])
      await this.storage.delete([...due.keys()])
    }

    // Re-arm on the next item rather than on a fixed interval: an empty shard
    // should cost nothing at all.
    const next = await this.storage.list<ScheduledItem>({ prefix: 'due:', limit: 1 })
    const first = [...next.values()][0]
    if (first) await this.storage.setAlarm(Math.max(first.dueAt, now + 1000))
    // 500 items is the page size, so a full page means more work is ready now.
    else if (due.size === 500) await this.storage.setAlarm(now + 1000)
  }

  async pending(): Promise<number> {
    return (await this.storage.list({ prefix: 'due:' })).size
  }
}
