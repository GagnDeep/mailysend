import { Actor } from './base.ts'

/**
 * Segment recomputation.
 *
 * "Continuously recomputed segments" sounds like it needs a background job that
 * re-evaluates everything. It does not, and cannot: re-evaluating every segment
 * over every contact on a schedule is O(segments × contacts) work that grows
 * with both.
 *
 * Three mechanisms cover it instead:
 *
 *   1. A full compute when the expression is edited. Rare, and bounded.
 *   2. A write-driven delta: contact writes mark a row dirty, and only the
 *      segments that read the changed field are re-evaluated for that contact.
 *   3. The hourly boundary sweep, which is this actor's job.
 *
 * The third exists because of predicates like `last_open_at > now - 30d`. Those
 * flip with *no write at all* — the clock crosses a boundary and yesterday's
 * member silently stops qualifying. The sweep re-evaluates only the contacts
 * whose relevant timestamp fell into the hour that just expired, which is a
 * bounded index range rather than a scan.
 */

export interface SegmentRegistration {
  segmentId: string
  workspaceId: string
  audienceId: string
  /** Which time-relative fields the expression reads, and over what window. */
  timeWindows: { field: string; days: number }[]
}

export class SegmentActor extends Actor {
  async register(registration: SegmentRegistration): Promise<void> {
    await this.storage.put(`seg:${registration.segmentId}`, registration)
    // Only segments with a time-relative predicate need the sweep at all;
    // arming the alarm for the others would be pure waste.
    if (registration.timeWindows.length > 0) {
      const existing = await this.storage.getAlarm()
      if (existing === null) await this.storage.setAlarm(nextHourBoundary())
    }
  }

  async unregister(segmentId: string): Promise<void> {
    await this.storage.delete(`seg:${segmentId}`)
  }

  async list(): Promise<SegmentRegistration[]> {
    return [...(await this.storage.list<SegmentRegistration>({ prefix: 'seg:' })).values()]
  }

  async alarm(): Promise<void> {
    const registrations = await this.list()
    if (registrations.length === 0) return

    const now = Date.now()
    // The hour that just ended. Anything whose qualifying timestamp sits inside
    // it is exactly the set whose membership can have changed since the last
    // sweep — nothing outside it needs to be looked at.
    const expiredHourEnd = new Date(Math.floor(now / 3600_000) * 3600_000)
    const expiredHourStart = new Date(expiredHourEnd.getTime() - 3600_000)

    for (const registration of registrations) {
      for (const window of registration.timeWindows) {
        // A `last_open_at > now - 30d` predicate stops matching for contacts
        // whose last open was in the hour 30 days ago. That is the range.
        const boundaryEnd = new Date(expiredHourEnd.getTime() - window.days * 86_400_000)
        const boundaryStart = new Date(expiredHourStart.getTime() - window.days * 86_400_000)
        await this.env.SWEEP_SEGMENT?.({
          segmentId: registration.segmentId,
          workspaceId: registration.workspaceId,
          field: window.field,
          from: boundaryStart.toISOString(),
          to: boundaryEnd.toISOString(),
        })
      }
    }

    await this.storage.setAlarm(nextHourBoundary())
  }
}

/** A minute past the hour, so the sweep never races the boundary it is chasing. */
const nextHourBoundary = (): number => Math.ceil(Date.now() / 3600_000) * 3600_000 + 60_000
