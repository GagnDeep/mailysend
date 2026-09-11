import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUEUES, queueRole } from '@mailysend/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scopeResourceNames } from '../../../scripts/instance-names.mjs'
import { runCron } from '../src/server/cron.ts'
import { type Harness, harness } from './harness.ts'

/**
 * A second MailySend on one Cloudflare account.
 *
 * Deploying one used to upload cleanly and then fail its trigger update, once
 * per queue — `Queue 'ms-send' already has a consumer [code: 11004]` — because
 * queue names are account-global and a queue has exactly one consumer. Where it
 * did not fail it was worse: the new Worker bound `DB` and `BUCKET` to the
 * first instance's database and bucket. And the cron schedules ran out before
 * the third instance existed at all: three each, five per account on the free
 * plan.
 *
 * Everything here is a consequence of that, tested where it can be: the build
 * scoping, the runtime dispatch that has to keep working once names are
 * scoped, and the daily task that now has to claim its turn instead of owning
 * a schedule.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('the names a build deploys', () => {
  const config = () => ({
    name: 'mailysend16',
    queues: {
      producers: [{ queue: 'ms-send' }, { queue: 'ms-inbound' }],
      consumers: [
        { queue: 'ms-send-bulk', dead_letter_queue: 'ms-dlq' },
        { queue: 'ms-events-cf', dead_letter_queue: 'ms-dlq' },
      ],
    },
    d1_databases: [{ database_name: 'mailysend' }],
    r2_buckets: [{ bucket_name: 'mailysend' }],
  })

  it('scopes every account-global name to the Worker', () => {
    const cfg = config()
    scopeResourceNames(cfg)

    expect(cfg.queues.producers.map((p) => p.queue)).toEqual([
      'mailysend16-send',
      'mailysend16-inbound',
    ])
    expect(cfg.queues.consumers.map((c) => c.queue)).toEqual([
      'mailysend16-send-bulk',
      'mailysend16-events-cf',
    ])
    // One dead-letter queue per instance too, or two deployments pile their
    // failures into one bucket nobody owns.
    expect(new Set(cfg.queues.consumers.map((c) => c.dead_letter_queue))).toEqual(
      new Set(['mailysend16-dlq']),
    )
    expect(cfg.d1_databases[0]?.database_name).toBe('mailysend16')
    expect(cfg.r2_buckets[0]?.bucket_name).toBe('mailysend16')
  })

  /**
   * The name the dashboard chose, which is not the name in the file.
   *
   * Workers Builds and the Deploy to Cloudflare button pass the operator's
   * chosen Worker name to wrangler as `WRANGLER_CI_OVERRIDE_NAME` instead of
   * editing the config — the repo behind `mailysend16` still reads
   * `"name": "mailysend"`. Keying off the config alone scoped nothing for
   * precisely the deployments that need it: every one-click instance.
   */
  it('scopes to the CI name override, not just the config', () => {
    const previous = process.env.WRANGLER_CI_OVERRIDE_NAME
    process.env.WRANGLER_CI_OVERRIDE_NAME = 'mailysend16'
    try {
      const cfg = { ...config(), name: 'mailysend' }
      scopeResourceNames(cfg)
      expect(cfg.queues.producers[0]?.queue).toBe('mailysend16-send')
      expect(cfg.d1_databases[0]?.database_name).toBe('mailysend16')
    } finally {
      if (previous === undefined) delete process.env.WRANGLER_CI_OVERRIDE_NAME
      else process.env.WRANGLER_CI_OVERRIDE_NAME = previous
    }
  })

  /**
   * The load-bearing half. Renaming the default deployment's resources would
   * point a running instance at an empty database — a data loss, not a rename.
   */
  it('leaves the default deployment alone, entirely', () => {
    const cfg = { ...config(), name: 'mailysend' }
    expect(scopeResourceNames(cfg)).toEqual([])
    expect(cfg.queues.producers[0]?.queue).toBe('ms-send')
    expect(cfg.d1_databases[0]?.database_name).toBe('mailysend')
  })

  it('keeps a database name the operator chose themselves', () => {
    const cfg = { ...config(), d1_databases: [{ database_name: 'shared-mail' }] }
    scopeResourceNames(cfg)
    expect(cfg.d1_databases[0]?.database_name).toBe('shared-mail')
  })

  /** Cloudflare's limit, and a Worker name may be long. */
  it('keeps a scoped queue name inside 63 characters', () => {
    const cfg = { ...config(), name: 'a'.repeat(60) }
    scopeResourceNames(cfg)
    for (const producer of cfg.queues.producers) {
      expect(producer.queue.length).toBeLessThanOrEqual(63)
    }
  })
})

describe('which consumer a batch reaches', () => {
  it('matches the role under any prefix, including one with dashes', () => {
    expect(queueRole('ms-send')).toBe('send')
    expect(queueRole('mailysend16-send')).toBe('send')
    expect(queueRole('my-mail-16-send')).toBe('send')
  })

  /** `send-bulk` must never be answered by `send`, which is why roles sort long first. */
  it('does not let a shorter role swallow a longer one', () => {
    expect(queueRole('mailysend16-send-bulk')).toBe('send-bulk')
    expect(queueRole('ms-events-norm')).toBe('events-norm')
    expect(queueRole('ms-automation-triggers')).toBe('automation-triggers')
  })

  it('has a role for every queue the deployment declares', () => {
    for (const queue of Object.values(QUEUES)) {
      expect(queueRole(queue)).toBe(queue.slice('ms-'.length))
    }
  })

  it('answers nothing for a queue that is not ours', () => {
    expect(queueRole('some-other-teams-queue')).toBeNull()
  })
})

describe('the cron triggers a deployment declares', () => {
  /**
   * Five per account on the free plan. Three per instance meant the second
   * deployment lost triggers and the third could not deploy at all, so the
   * count is asserted rather than left to whoever edits the config next.
   */
  it('declares exactly one schedule', () => {
    const jsonc = readFileSync(join(root, 'apps/app/wrangler.jsonc'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n')
    const config = JSON.parse(jsonc)
    expect(config.triggers.crons).toEqual(['* * * * *'])
  })
})

describe('the daily task, once it has no schedule of its own', () => {
  let h: Harness

  beforeEach(async () => {
    h = await harness()
  })

  const ranOn = async () =>
    (
      await h.sql
        .prepare("SELECT value FROM settings WHERE workspace_id = ? AND key = 'cron_daily_ran_on'")
        .bind('ws_default')
        .first<{ value: string }>()
    )?.value ?? null

  // `Date` only: the sqlite driver is synchronous and faking timers as well
  // would deadlock it. The hour is what this branch reads, so the hour is what
  // has to stop depending on when the suite happens to run.
  const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(iso))
  }
  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * The minute tick has to notice the daily task is due, and exactly one tick
   * may run it — otherwise a deployment that ticks every minute runs a full
   * retention sweep 1,440 times a day.
   */
  it('claims its turn once, however many ticks arrive', async () => {
    at('2026-09-11T05:00:00.000Z')
    await runCron('* * * * *', h.env)
    expect(await ranOn()).toBe('2026-09-11')

    await runCron('* * * * *', h.env)
    await runCron('* * * * *', h.env)
    expect(await ranOn()).toBe('2026-09-11')
  })

  /** And the next day is a different claim, not a permanent one. */
  it('claims again tomorrow', async () => {
    at('2026-09-11T05:00:00.000Z')
    await runCron('* * * * *', h.env)
    at('2026-09-12T03:00:00.000Z')
    await runCron('* * * * *', h.env)
    expect(await ranOn()).toBe('2026-09-12')
  })

  /**
   * 03:00 UTC was the old schedule and stays the earliest this may run: the
   * deletes are heavy and were put at a quiet hour on purpose.
   */
  it('waits for the quiet hour rather than running at midnight', async () => {
    at('2026-09-11T01:30:00.000Z')
    await runCron('* * * * *', h.env)
    expect(await ranOn()).toBeNull()
  })

  /** A stale hourly trigger, still attached until the instance redeploys. */
  it('does nothing at all on the schedule that had nothing to do', async () => {
    await runCron('0 * * * *', h.env)
    expect(await ranOn()).toBeNull()
  })
})
