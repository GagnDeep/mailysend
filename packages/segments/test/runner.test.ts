import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NodeSql } from '@mailysend/platform/node'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SegmentSpec } from '../src/runner.ts'
import {
  boundarySweep,
  countSegment,
  previewSegment,
  recomputeDelta,
  recomputeFull,
} from '../src/runner.ts'

/**
 * The runner is exercised against a real SQLite database rather than a mock.
 * D1 and `node:sqlite` are the same engine, so a query that behaves here
 * behaves in production — and a mock would have quietly accepted the
 * `json_extract` path binding and the LIKE escaping that these tests exist to
 * check.
 */

const MIGRATION = fileURLToPath(new URL('../../db/migrations/0000_init.sql', import.meta.url))

const WS = 'ws_test'
const OTHER_WS = 'ws_other'
const AUD = 'aud_test'
const NOW = new Date('2026-09-09T12:00:00.000Z')
const DAY = 86_400_000

interface Seed {
  id: string
  email?: string
  firstName?: string | null
  unsubscribed?: boolean
  data?: Record<string, unknown> | null
  lastOpenAt?: string | null
  lastClickAt?: string | null
  openCount?: number
  clickCount?: number
  bounceCount?: number
  workspaceId?: string
  audienceId?: string
}

let sql: NodeSql

const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString()

const insertContact = (seed: Seed) => {
  sql.db
    .prepare(
      `INSERT INTO contacts (id, workspace_id, audience_id, email, first_name, last_name,
         unsubscribed, unsubscribed_at, data, last_open_at, last_click_at, last_send_at,
         open_count, click_count, send_count, bounce_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, NULL, ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      seed.id,
      seed.workspaceId ?? WS,
      seed.audienceId ?? AUD,
      seed.email ?? `${seed.id}@example.com`,
      seed.firstName ?? null,
      seed.unsubscribed ? 1 : 0,
      seed.data === undefined ? null : seed.data === null ? null : JSON.stringify(seed.data),
      seed.lastOpenAt ?? null,
      seed.lastClickAt ?? null,
      seed.openCount ?? 0,
      seed.clickCount ?? 0,
      seed.bounceCount ?? 0,
      NOW.toISOString(),
      NOW.toISOString(),
    )
}

const members = (segmentId: string): string[] =>
  (
    sql.db
      .prepare(
        'SELECT contact_id FROM segment_members WHERE workspace_id = ? AND segment_id = ? ORDER BY contact_id',
      )
      .all(WS, segmentId) as { contact_id: string }[]
  ).map((r) => r.contact_id)

const segment = (id: string, expression: string): SegmentSpec => ({
  id,
  audienceId: AUD,
  expression,
})

beforeEach(() => {
  sql = new NodeSql(':memory:')
  for (const statement of readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed) sql.db.exec(trimmed)
  }
})

describe('countSegment', () => {
  beforeEach(() => {
    insertContact({ id: 'con_01', lastOpenAt: ago(2 * DAY), openCount: 4 })
    insertContact({ id: 'con_02', lastOpenAt: ago(60 * DAY), openCount: 1 })
    insertContact({ id: 'con_03' })
    insertContact({ id: 'con_04', lastOpenAt: ago(DAY), workspaceId: OTHER_WS })
    insertContact({ id: 'con_05', lastOpenAt: ago(DAY), audienceId: 'aud_other' })
  })

  it('counts matches inside the workspace and audience only', async () => {
    expect(await countSegment(sql, WS, segment('seg_1', 'opened_last_30d'), { now: NOW })).toBe(1)
  })

  it('treats a never-opened contact as not-recently-opened under negation', async () => {
    // con_02 opened long ago, con_03 never opened; both must be counted.
    expect(await countSegment(sql, WS, segment('seg_1', 'not opened_last_30d'), { now: NOW })).toBe(
      2,
    )
  })

  it('evaluates custom fields through the bound json path', async () => {
    insertContact({ id: 'con_06', data: { plan: 'pro', seats: 12 } })
    insertContact({ id: 'con_07', data: { plan: 'free', seats: 1 } })
    expect(await countSegment(sql, WS, segment('s', "data.plan = 'pro'"), { now: NOW })).toBe(1)
    expect(await countSegment(sql, WS, segment('s', 'data.seats > 5'), { now: NOW })).toBe(1)
    expect(await countSegment(sql, WS, segment('s', 'data.plan is null'), { now: NOW })).toBe(3)
  })

  it('escapes LIKE wildcards so they match literally', async () => {
    insertContact({ id: 'con_08', email: '100%@example.com' })
    insertContact({ id: 'con_09', email: 'abc@example.com' })
    expect(await countSegment(sql, WS, segment('s', "email contains '100%'"), { now: NOW })).toBe(1)
    // A bare `%` must not act as a wildcard matching everyone.
    expect(await countSegment(sql, WS, segment('s', "email contains '%'"), { now: NOW })).toBe(1)
  })
})

describe('recomputeFull', () => {
  const many = 25

  beforeEach(() => {
    for (let i = 0; i < many; i++) {
      insertContact({
        id: `con_${String(i).padStart(3, '0')}`,
        lastOpenAt: i % 2 === 0 ? ago(DAY) : ago(90 * DAY),
        openCount: i % 2 === 0 ? 3 : 0,
      })
    }
  })

  it('materialises membership', async () => {
    const result = await recomputeFull(sql, WS, segment('seg_a', 'opened_last_30d'), { now: NOW })
    expect(result.scanned).toBe(many)
    expect(result.matched).toBe(13)
    expect(result.added).toBe(13)
    expect(members('seg_a')).toHaveLength(13)
  })

  it('produces the same membership regardless of page size', async () => {
    await recomputeFull(sql, WS, segment('seg_a', 'opened_last_30d'), { now: NOW, pageSize: 500 })
    const oneShot = members('seg_a')
    sql.db.exec('DELETE FROM segment_members')
    // A page size of 2 forces 13 keyset pages; the result must not change.
    await recomputeFull(sql, WS, segment('seg_a', 'opened_last_30d'), { now: NOW, pageSize: 2 })
    expect(members('seg_a')).toEqual(oneShot)
  })

  it('is idempotent and preserves the entry timestamp', async () => {
    await recomputeFull(sql, WS, segment('seg_a', 'opened_last_30d'), { now: NOW })
    const before = sql.db
      .prepare('SELECT created_at FROM segment_members WHERE contact_id = ?')
      .get('con_000') as { created_at: string }

    const again = await recomputeFull(sql, WS, segment('seg_a', 'opened_last_30d'), {
      now: new Date(NOW.getTime() + DAY),
    })
    expect(again).toMatchObject({ added: 0, removed: 0, matched: 13 })
    // Automations trigger on segment entry, so a reconfirmation must not look
    // like a fresh join.
    expect(
      (
        sql.db
          .prepare('SELECT created_at FROM segment_members WHERE contact_id = ?')
          .get('con_000') as {
          created_at: string
        }
      ).created_at,
    ).toBe(before.created_at)
  })

  it('removes members that no longer match', async () => {
    await recomputeFull(sql, WS, segment('seg_a', 'opened_last_30d'), { now: NOW })
    sql.db.prepare('UPDATE contacts SET last_open_at = NULL WHERE id = ?').run('con_000')
    const result = await recomputeFull(sql, WS, segment('seg_a', 'opened_last_30d'), { now: NOW })
    expect(result.removed).toBe(1)
    expect(members('seg_a')).not.toContain('con_000')
  })

  it('sweeps members whose contact was deleted', async () => {
    await recomputeFull(sql, WS, segment('seg_a', 'opened_last_30d'), { now: NOW })
    sql.db.prepare('DELETE FROM contacts WHERE id = ?').run('con_000')
    const result = await recomputeFull(sql, WS, segment('seg_a', 'opened_last_30d'), { now: NOW })
    expect(result.removed).toBe(1)
    expect(members('seg_a')).not.toContain('con_000')
  })

  it('leaves other segments alone', async () => {
    await recomputeFull(sql, WS, segment('seg_a', 'opened_last_30d'), { now: NOW })
    await recomputeFull(sql, WS, segment('seg_b', 'never_opened'), { now: NOW })
    expect(members('seg_a')).toHaveLength(13)
    expect(members('seg_b')).toHaveLength(12)
  })
})

describe('recomputeDelta', () => {
  beforeEach(async () => {
    insertContact({ id: 'con_01', openCount: 5, lastOpenAt: ago(DAY) })
    insertContact({ id: 'con_02', openCount: 0 })
    insertContact({ id: 'con_03', openCount: 0 })
    await recomputeFull(sql, WS, segment('seg_a', 'never_opened'), { now: NOW })
  })

  it('adds a contact that now matches', async () => {
    sql.db.prepare('UPDATE contacts SET open_count = 0 WHERE id = ?').run('con_01')
    const result = await recomputeDelta(sql, WS, segment('seg_a', 'never_opened'), ['con_01'], {
      now: NOW,
    })
    expect(result).toMatchObject({ added: 1, removed: 0, scanned: 1 })
    expect(members('seg_a')).toEqual(['con_01', 'con_02', 'con_03'])
  })

  it('removes a contact that no longer matches', async () => {
    sql.db.prepare('UPDATE contacts SET open_count = 2 WHERE id = ?').run('con_02')
    const result = await recomputeDelta(sql, WS, segment('seg_a', 'never_opened'), ['con_02'], {
      now: NOW,
    })
    expect(result).toMatchObject({ added: 0, removed: 1 })
    expect(members('seg_a')).toEqual(['con_03'])
  })

  it('removes a contact that has been deleted outright', async () => {
    sql.db.prepare('DELETE FROM contacts WHERE id = ?').run('con_02')
    const result = await recomputeDelta(sql, WS, segment('seg_a', 'never_opened'), ['con_02'], {
      now: NOW,
    })
    expect(result.removed).toBe(1)
    expect(members('seg_a')).toEqual(['con_03'])
  })

  it('touches nothing outside the named contacts', async () => {
    sql.db.prepare('UPDATE contacts SET open_count = 9').run()
    const result = await recomputeDelta(sql, WS, segment('seg_a', 'never_opened'), ['con_02'], {
      now: NOW,
    })
    expect(result).toMatchObject({ removed: 1, scanned: 1 })
    // con_03 stops matching too, but nobody said so — that is the delta contract.
    expect(members('seg_a')).toEqual(['con_03'])
  })

  it('is a no-op for an empty list and deduplicates repeats', async () => {
    expect(
      await recomputeDelta(sql, WS, segment('seg_a', 'never_opened'), [], { now: NOW }),
    ).toEqual({
      added: 0,
      removed: 0,
      scanned: 0,
      matched: 0,
    })
    const repeated = await recomputeDelta(
      sql,
      WS,
      segment('seg_a', 'never_opened'),
      ['con_02', 'con_02', 'con_02'],
      { now: NOW },
    )
    expect(repeated.scanned).toBe(1)
  })

  it('chunks id lists past the bound-parameter budget', async () => {
    const ids: string[] = []
    for (let i = 10; i < 210; i++) {
      const id = `con_${i}`
      insertContact({ id, openCount: 0 })
      ids.push(id)
    }
    const result = await recomputeDelta(sql, WS, segment('seg_a', 'never_opened'), ids, {
      now: NOW,
    })
    expect(result).toMatchObject({ scanned: 200, added: 200 })
    expect(members('seg_a')).toHaveLength(202)
  })
})

describe('boundarySweep', () => {
  const seg = segment('seg_a', 'opened_last_30d')

  beforeEach(async () => {
    // Flips out during the hour after NOW: the 30-day threshold crosses it.
    insertContact({ id: 'con_flip', lastOpenAt: ago(30 * DAY - 30 * 60_000) })
    // Comfortably inside the window; unaffected by one hour passing.
    insertContact({ id: 'con_stay', lastOpenAt: ago(10 * DAY) })
    // Already outside, and not a member.
    insertContact({ id: 'con_gone', lastOpenAt: ago(60 * DAY) })
    // No engagement at all: a NULL timestamp can never flip.
    insertContact({ id: 'con_null' })
    await recomputeFull(sql, WS, seg, { now: NOW })
    expect(members('seg_a')).toEqual(['con_flip', 'con_stay'])
  })

  it('re-checks only the contacts whose timestamp entered the expiring hour', async () => {
    const result = await boundarySweep(sql, WS, seg, NOW, new Date(NOW.getTime() + 3_600_000))
    expect(result.applicable).toBe(true)
    // One candidate out of four contacts — the sweep is a range scan, not a table scan.
    expect(result.candidates).toBe(1)
    expect(result.removed).toBe(1)
    expect(members('seg_a')).toEqual(['con_stay'])
  })

  it('does nothing when no timestamp falls in the hour', async () => {
    const start = new Date(NOW.getTime() + 4 * 3_600_000)
    const result = await boundarySweep(sql, WS, seg, start, new Date(start.getTime() + 3_600_000))
    expect(result).toMatchObject({ applicable: true, candidates: 0, removed: 0 })
    expect(members('seg_a')).toEqual(['con_flip', 'con_stay'])
  })

  it('reports that a segment without a relative window cannot drift', async () => {
    const result = await boundarySweep(
      sql,
      WS,
      segment('seg_b', 'never_opened and unsubscribed'),
      NOW,
      new Date(NOW.getTime() + 3_600_000),
    )
    expect(result).toMatchObject({ applicable: false, candidates: 0 })
  })

  it('sweeps each relative window in a compound expression', async () => {
    insertContact({
      id: 'con_click',
      lastOpenAt: ago(DAY),
      lastClickAt: ago(7 * DAY - 30 * 60_000),
    })
    const compound = segment('seg_c', 'opened_last_30d and clicked_last_7d')
    await recomputeFull(sql, WS, compound, { now: NOW })
    expect(members('seg_c')).toEqual(['con_click'])

    const result = await boundarySweep(sql, WS, compound, NOW, new Date(NOW.getTime() + 3_600_000))
    // Both the 30-day and the 7-day threshold sweep an hour; two candidates.
    expect(result.candidates).toBe(2)
    expect(members('seg_c')).toEqual([])
  })

  it('can also add a contact back when a window widens the other way', async () => {
    // `created_at < 30d ago` — "older than a month" — gains members over time.
    insertContact({ id: 'con_new' })
    sql.db
      .prepare('UPDATE contacts SET created_at = ? WHERE id = ?')
      .run(ago(30 * DAY - 30 * 60_000), 'con_new')
    const aging = segment('seg_d', 'not created_at > 30d')
    await recomputeFull(sql, WS, aging, { now: NOW })
    expect(members('seg_d')).not.toContain('con_new')

    const result = await boundarySweep(sql, WS, aging, NOW, new Date(NOW.getTime() + 3_600_000))
    expect(result.added).toBe(1)
    expect(members('seg_d')).toContain('con_new')
  })
})

describe('previewSegment', () => {
  beforeEach(() => {
    for (let i = 0; i < 30; i++) {
      insertContact({ id: `con_${String(i).padStart(3, '0')}`, openCount: 1, lastOpenAt: ago(DAY) })
    }
  })

  it('returns a page plus the full total', async () => {
    const preview = await previewSegment(sql, WS, 'opened_last_30d', AUD, 5, { now: NOW })
    expect(preview.contacts).toHaveLength(5)
    expect(preview.contacts[0]).toMatchObject({ id: 'con_000', email: 'con_000@example.com' })
    expect(preview.total).toBe(30)
    expect(preview.dependsOn).toEqual(['last_open_at'])
  })

  it('clamps the page size', async () => {
    expect(
      (await previewSegment(sql, WS, 'opened_last_30d', AUD, 1000, { now: NOW })).contacts,
    ).toHaveLength(30)
    expect(
      (await previewSegment(sql, WS, 'opened_last_30d', AUD, 0, { now: NOW })).contacts,
    ).toHaveLength(1)
  })

  it('surfaces a parse error to the caller rather than returning nothing', async () => {
    await expect(previewSegment(sql, WS, 'emial = 1', AUD)).rejects.toThrow(/unknown field/)
  })
})

describe('injection, end to end', () => {
  const PAYLOAD = "'); DROP TABLE contacts; --"

  beforeEach(() => {
    insertContact({ id: 'con_01', email: PAYLOAD, data: { [PAYLOAD]: 'yes' } })
    insertContact({ id: 'con_02', email: 'safe@example.com', data: { plan: 'pro' } })
  })

  it('matches a hostile value as data, leaving the schema intact', async () => {
    const count = await countSegment(sql, WS, segment('s', `email = ${JSON.stringify(PAYLOAD)}`), {
      now: NOW,
    })
    expect(count).toBe(1)
    expect(sql.db.prepare('SELECT COUNT(*) AS n FROM contacts').get()).toMatchObject({ n: 2 })
  })

  it('reads a hostile custom field name through the bound json path', async () => {
    const count = await countSegment(
      sql,
      WS,
      segment('s', `data[${JSON.stringify(PAYLOAD)}] = 'yes'`),
      {
        now: NOW,
      },
    )
    expect(count).toBe(1)
    expect(sql.db.prepare('SELECT COUNT(*) AS n FROM contacts').get()).toMatchObject({ n: 2 })
  })

  it('cannot reach a table the registry does not name', async () => {
    await expect(previewSegment(sql, WS, "secret = 'x'", AUD)).rejects.toThrow(/unknown field/)
    await expect(previewSegment(sql, WS, 'workspace_id is not null', AUD)).rejects.toThrow(
      /unknown field/,
    )
  })
})
