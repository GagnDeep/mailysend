import { Actor, type BucketState, takeTokens } from './base.ts'

/**
 * The broadcast coordinator.
 *
 * The design constraint that shapes this entire class: a Durable Object handles
 * roughly a thousand requests a second, and a 500,000-contact broadcast at
 * 50,000/hour cannot route every send through one object. The usual answer —
 * shard the coordinator — trades a simple problem for a hard one (who owns
 * which contact, what happens when a shard dies mid-page).
 *
 * Instead the coordinator holds **32 cursors and nothing else**. Preparation
 * splits the recipient id space into 32 contiguous ranges; each tick, the
 * coordinator mints tokens and hands out page jobs naming a range and a cursor.
 * Page workers do the actual keyset query, the sends and the `broadcast_sends`
 * writes, then make one RPC back to advance their cursor.
 *
 * The result is ~6 actor writes per second whether the audience is a thousand
 * contacts or half a million. Nothing here grows with the audience.
 */

export const RANGE_COUNT = 32
/** Tokens are minted every 5s, so a per-minute throttle divides into 12 ticks. */
const TICK_MS = 5_000
const TICKS_PER_MINUTE = 12

export interface RangeCursor {
  /** Inclusive lower bound of this range in contact-id space. */
  start: string
  /** Exclusive upper bound. */
  end: string
  /** Last contact id dispatched. Resuming means `WHERE id > cursor`. */
  cursor: string
  done: boolean
  dispatched: number
}

export interface BroadcastState {
  broadcastId: string
  workspaceId: string
  status: 'idle' | 'preparing' | 'sending' | 'paused' | 'complete' | 'canceled'
  throttlePerMinute: number
  totalRecipients: number
  startedAt: number | null
  completedAt: number | null
}

export interface PageJob {
  broadcastId: string
  workspaceId: string
  rangeIndex: number
  after: string
  until: string
  limit: number
}

export class BroadcastActor extends Actor {
  /**
   * Splits the id space into 32 ranges and arms the alarm.
   *
   * Ranges are boundaries in ULID space, not row counts, so preparation does no
   * counting pass over the audience — a count would be O(audience) work in the
   * one place we have promised it will not be.
   */
  async prepare(input: {
    broadcastId: string
    workspaceId: string
    throttlePerMinute: number
    totalRecipients: number
    /** Lowest and highest contact id in the audience, from one indexed query. */
    minId: string
    maxId: string
  }): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const ranges = splitIdSpace(input.minId, input.maxId, RANGE_COUNT)
      const state: BroadcastState = {
        broadcastId: input.broadcastId,
        workspaceId: input.workspaceId,
        status: 'sending',
        throttlePerMinute: input.throttlePerMinute,
        totalRecipients: input.totalRecipients,
        startedAt: Date.now(),
        completedAt: null,
      }
      await this.storage.put({
        state,
        bucket: { tokens: 0, updatedAt: Date.now() } satisfies BucketState,
        ...Object.fromEntries(ranges.map((r, i) => [`range:${String(i).padStart(2, '0')}`, r])),
      })
      await this.storage.setAlarm(Date.now() + 100)
    })
  }

  async pause(): Promise<void> {
    const state = await this.read<BroadcastState | null>('state', null)
    if (!state) return
    state.status = 'paused'
    await this.storage.put('state', state)
    // The alarm is left armed: it will see `paused` and re-arm cheaply, which
    // keeps resume instant instead of requiring the caller to re-arm correctly.
  }

  async resume(): Promise<void> {
    const state = await this.read<BroadcastState | null>('state', null)
    if (state?.status !== 'paused') return
    state.status = 'sending'
    await this.storage.put('state', state)
    await this.storage.setAlarm(Date.now() + 100)
  }

  async cancel(): Promise<void> {
    const state = await this.read<BroadcastState | null>('state', null)
    if (!state) return
    state.status = 'canceled'
    state.completedAt = Date.now()
    await this.storage.put('state', state)
    await this.storage.deleteAlarm()
  }

  /** Called by a page worker when it finishes a page. One write per page. */
  async advance(
    rangeIndex: number,
    lastId: string,
    dispatched: number,
    exhausted: boolean,
  ): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const key = `range:${String(rangeIndex).padStart(2, '0')}`
      const range = await this.storage.get<RangeCursor>(key)
      if (!range) return
      // Monotonic, for the same reason the event ladder is: a retried page
      // report must never move the cursor backwards and re-send a block.
      if (lastId > range.cursor) range.cursor = lastId
      range.dispatched += dispatched
      if (exhausted) range.done = true
      await this.storage.put(key, range)
    })
  }

  async status(): Promise<{
    state: BroadcastState | null
    ranges: RangeCursor[]
    dispatched: number
  }> {
    const state = await this.read<BroadcastState | null>('state', null)
    const ranges = [...(await this.storage.list<RangeCursor>({ prefix: 'range:' })).values()]
    return { state, ranges, dispatched: ranges.reduce((sum, r) => sum + r.dispatched, 0) }
  }

  /**
   * The tick.
   *
   * Mints one tick's worth of tokens, then hands out at most one page job per
   * unfinished range. Everything expensive happens in the page workers; this
   * handler does a bounded amount of work regardless of audience size.
   */
  async alarm(): Promise<void> {
    const state = await this.read<BroadcastState | null>('state', null)
    if (!state) return

    if (state.status === 'paused') {
      // Re-arm slowly. A paused broadcast should cost almost nothing.
      await this.storage.setAlarm(Date.now() + 30_000)
      return
    }
    if (state.status !== 'sending') return

    const ranges = [...(await this.storage.list<RangeCursor>({ prefix: 'range:' })).entries()]
    const pending = ranges.filter(([, r]) => !r.done)

    if (pending.length === 0) {
      state.status = 'complete'
      state.completedAt = Date.now()
      await this.storage.put('state', state)
      await this.env.ON_BROADCAST_COMPLETE?.(state.broadcastId, state.workspaceId)
      return
    }

    const perSecond = state.throttlePerMinute / 60
    const bucket = await this.read<BucketState>('bucket', { tokens: 0, updatedAt: Date.now() })
    const { granted, state: nextBucket } = takeTokens(
      bucket,
      {
        capacity: Math.max(1, Math.ceil(state.throttlePerMinute / TICKS_PER_MINUTE) * 2),
        refillPerSecond: perSecond,
      },
      Math.ceil(state.throttlePerMinute / TICKS_PER_MINUTE),
    )
    await this.storage.put('bucket', nextBucket)

    if (granted > 0) {
      // Spread the tick's budget across the ranges that still have work, so a
      // single slow range cannot starve the others.
      const perRange = Math.max(1, Math.floor(granted / pending.length))
      const jobs: PageJob[] = pending.slice(0, granted).map(([key, range]) => ({
        broadcastId: state.broadcastId,
        workspaceId: state.workspaceId,
        rangeIndex: Number(key.slice('range:'.length)),
        after: range.cursor || range.start,
        until: range.end,
        limit: perRange,
      }))
      await this.env.DISPATCH_PAGES?.(jobs)
    }

    await this.storage.setAlarm(Date.now() + TICK_MS)
  }
}

/**
 * Splits ULID space into contiguous ranges.
 *
 * ULIDs are Crockford base32 and sort lexicographically, so the split works on
 * the first few characters treated as a big integer. Ranges will not be equal
 * in row count — contacts are not uniformly distributed in time — but they do
 * not need to be: the coordinator hands work to whichever ranges still have
 * any, so an uneven split costs nothing but a slightly longer tail.
 */
export function splitIdSpace(minId: string, maxId: string, parts: number): RangeCursor[] {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const prefix = minId.includes('_') ? `${minId.slice(0, minId.indexOf('_') + 1)}` : ''
  const strip = (id: string) => (id.includes('_') ? id.slice(id.indexOf('_') + 1) : id)

  // Six characters of ULID is ~1 billion buckets: far more resolution than 32
  // ranges need, and cheap to work with in a plain number.
  const WIDTH = 6
  const toInt = (id: string) => {
    const body = strip(id).padEnd(WIDTH, '0').slice(0, WIDTH)
    let n = 0
    for (const c of body) n = n * 32 + Math.max(0, ALPHABET.indexOf(c))
    return n
  }
  const toId = (n: number) => {
    let out = ''
    let v = n
    for (let i = 0; i < WIDTH; i++) {
      out = ALPHABET[v % 32] + out
      v = Math.floor(v / 32)
    }
    return prefix + out
  }

  const lo = toInt(minId)
  const hi = toInt(maxId) + 1
  const span = Math.max(parts, hi - lo)
  const step = Math.ceil(span / parts)

  const ranges: RangeCursor[] = []
  for (let i = 0; i < parts; i++) {
    const start = toId(lo + i * step)
    // The last range's upper bound is deliberately open-ended, so a contact
    // created after preparation still falls inside the space.
    const end = i === parts - 1 ? `${prefix}ZZZZZZZZZZZZZZZZZZZZZZZZZZ` : toId(lo + (i + 1) * step)
    ranges.push({ start, end, cursor: '', done: false, dispatched: 0 })
  }
  return ranges
}

/**
 * Broadcast counters, sharded sixteen ways.
 *
 * Delivery and open events for a large broadcast arrive far faster than one
 * object can absorb, so counts are spread across sixteen shards and summed on
 * read. The coordinator never sees them — it has one job, and counting is not
 * it.
 */
export const COUNTER_SHARDS = 16

export class BroadcastCounterActor extends Actor {
  async increment(counts: Record<string, number>): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.read<Record<string, number>>('counts', {})
      for (const [k, v] of Object.entries(counts)) current[k] = (current[k] ?? 0) + v
      await this.storage.put('counts', current)
    })
  }

  async read_(): Promise<Record<string, number>> {
    return this.read('counts', {})
  }
}
