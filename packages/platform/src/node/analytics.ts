import type { DatabaseSync } from 'node:sqlite'
import type { Analytics } from '../types.ts'

/**
 * Analytics Engine on Node.
 *
 * AE is Cloudflare-only, and its query surface is SQL over HTTP. Rather than
 * stub it out — which would leave the Node deployment with no per-event
 * analytics at all — datapoints land in a local table with the same shape
 * (one index, blobs, doubles). The dashboard's analytics queries run against
 * whichever of the two is present.
 *
 * The three-month retention that constrains AE does not apply here, but the
 * R2/parquet export still runs: keeping one archive format across both runtimes
 * is worth more than the disk it saves.
 */
export class NodeAnalytics implements Analytics {
  #db: DatabaseSync
  #dataset: string

  constructor(db: DatabaseSync, dataset: string) {
    this.#db = db
    this.#dataset = dataset
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dataset TEXT NOT NULL,
        ts INTEGER NOT NULL,
        idx TEXT,
        blobs TEXT NOT NULL,
        doubles TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS analytics_events_q ON analytics_events(dataset, idx, ts);
    `)
  }

  writeDataPoint(point: {
    indexes?: string[]
    blobs?: (string | null)[]
    doubles?: number[]
  }): void {
    // Synchronous and fire-and-forget, matching AE: an analytics write must
    // never be able to fail a send.
    try {
      this.#db
        .prepare(
          'INSERT INTO analytics_events (dataset, ts, idx, blobs, doubles) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          this.#dataset,
          Date.now(),
          point.indexes?.[0] ?? null,
          JSON.stringify(point.blobs ?? []),
          JSON.stringify(point.doubles ?? []),
        )
    } catch (err) {
      console.error('[analytics] write failed', err)
    }
  }

  /** Retention sweep, run from the scheduler. Mirrors AE's 3-month window by default. */
  prune(olderThanDays = 92): number {
    const res = this.#db
      .prepare('DELETE FROM analytics_events WHERE dataset = ? AND ts < ?')
      .run(this.#dataset, Date.now() - olderThanDays * 86_400_000)
    return Number(res.changes ?? 0)
  }
}
