import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUEUES, queueRole } from '@mailysend/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chooseKvNamespace,
  kvNamespaceTitle,
  scopeDataNames,
  scopeQueueNames,
} from '../../../scripts/instance-names.mjs'
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
    scopeQueueNames(cfg)

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
      scopeQueueNames(cfg)
      expect(cfg.queues.producers[0]?.queue).toBe('mailysend16-send')
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
    expect(scopeQueueNames(cfg)).toEqual([])
    expect(cfg.queues.producers[0]?.queue).toBe('ms-send')
    expect(cfg.d1_databases[0]?.database_name).toBe('mailysend')
  })

  /** Cloudflare's limit, and a Worker name may be long. */
  it('keeps a scoped queue name inside 63 characters', () => {
    const cfg = { ...config(), name: 'a'.repeat(60) }
    scopeQueueNames(cfg)
    for (const producer of cfg.queues.producers) {
      expect(producer.queue.length).toBeLessThanOrEqual(63)
    }
  })
})

/**
 * Whether an instance gets its own database, which is the half that bites.
 *
 * Deciding this from the Worker's name alone took a live `mailysend14` off its
 * data for eight minutes: it pointed at a `mailysend14` database that did not
 * exist, the app created it, ran every migration, and came up as a fresh
 * unclaimed instance while the real one — users, domains, mail — sat in
 * `mailysend`. Nothing was lost and nothing in the build log said a word.
 */
describe('whether an instance gets its own database', () => {
  const config = () => ({
    name: 'mailysend',
    d1_databases: [{ binding: 'DB', database_name: 'mailysend' }],
    r2_buckets: [{ binding: 'BUCKET', bucket_name: 'mailysend' }],
  })

  const scoped = (over, account) => {
    const previous = process.env.WRANGLER_CI_OVERRIDE_NAME
    // Assigning `undefined` to process.env stores the *string* "undefined", so
    // "no override" has to be a delete.
    if (over === undefined) delete process.env.WRANGLER_CI_OVERRIDE_NAME
    else process.env.WRANGLER_CI_OVERRIDE_NAME = over
    try {
      const cfg = config()
      const changes = scopeDataNames(cfg, account)
      return { cfg, changes }
    } finally {
      if (previous === undefined) delete process.env.WRANGLER_CI_OVERRIDE_NAME
      else process.env.WRANGLER_CI_OVERRIDE_NAME = previous
    }
  }

  it('gives a Worker that has never been deployed its own', () => {
    const { cfg, changes } = scoped('mailysend17', { deployed: false, hasOwnDatabase: false })
    expect(changes).toHaveLength(2)
    expect(cfg.d1_databases[0]?.database_name).toBe('mailysend17')
    expect(cfg.r2_buckets[0]?.bucket_name).toBe('mailysend17')
  })

  /** The regression, asserted directly: a running instance keeps its data. */
  it('leaves a Worker that is already deployed on what it is running on', () => {
    const { cfg, changes } = scoped('mailysend14', { deployed: true, hasOwnDatabase: false })
    expect(changes).toEqual([])
    expect(cfg.d1_databases[0]?.database_name).toBe('mailysend')
    expect(cfg.r2_buckets[0]?.bucket_name).toBe('mailysend')
  })

  it('keeps an instance that already has its own database on it', () => {
    const { cfg } = scoped('mailysend16', { deployed: true, hasOwnDatabase: true })
    expect(cfg.d1_databases[0]?.database_name).toBe('mailysend16')
  })

  it('never renames the default deployment, deployed or not', () => {
    const { cfg, changes } = scoped(undefined, { deployed: false, hasOwnDatabase: false })
    expect(changes).toEqual([])
    expect(cfg.d1_databases[0]?.database_name).toBe('mailysend')
  })

  it('keeps a database name the operator chose themselves', () => {
    const previous = process.env.WRANGLER_CI_OVERRIDE_NAME
    process.env.WRANGLER_CI_OVERRIDE_NAME = 'mailysend17'
    try {
      const cfg = { ...config(), d1_databases: [{ binding: 'DB', database_name: 'shared-mail' }] }
      scopeDataNames(cfg, { deployed: false, hasOwnDatabase: false })
      expect(cfg.d1_databases[0]?.database_name).toBe('shared-mail')
    } finally {
      if (previous === undefined) delete process.env.WRANGLER_CI_OVERRIDE_NAME
      else process.env.WRANGLER_CI_OVERRIDE_NAME = previous
    }
  })

  /** A stale id would out-rank the new name and bind the old database anyway. */
  it('drops the database id along with the name', () => {
    const previous = process.env.WRANGLER_CI_OVERRIDE_NAME
    process.env.WRANGLER_CI_OVERRIDE_NAME = 'mailysend17'
    try {
      const cfg = {
        ...config(),
        d1_databases: [{ binding: 'DB', database_name: 'mailysend', database_id: 'f22203bf' }],
      }
      scopeDataNames(cfg, { deployed: false, hasOwnDatabase: false })
      expect(cfg.d1_databases[0]).not.toHaveProperty('database_id')
    } finally {
      if (previous === undefined) delete process.env.WRANGLER_CI_OVERRIDE_NAME
      else process.env.WRANGLER_CI_OVERRIDE_NAME = previous
    }
  })
})

/**
 * Which KV namespace an instance binds.
 *
 * `wrangler kv namespace create CACHE` titles the namespace exactly `CACHE` and
 * adds no prefix of its own, so the first build created bare `CACHE` and
 * `SUPPRESSIONS` and every later instance found them and took them. Two live
 * deployments were bound to one pair. SUPPRESSIONS is a do-not-send list rather
 * than a cache, and every instance addresses it under the same default
 * workspace id, so those keys collided exactly.
 */
describe('which KV namespace an instance binds', () => {
  const account = [
    { id: 'n1', title: 'CACHE' },
    { id: 'n2', title: 'SUPPRESSIONS' },
    { id: 'n3', title: 'mailysend16-CACHE' },
    { id: 'n4', title: '__somebody-else-workers_sites_assets' },
  ]

  it('names a scoped instance its own namespace, and the default one the bare title', () => {
    expect(kvNamespaceTitle('mailysend17', 'CACHE')).toBe('mailysend17-CACHE')
    expect(kvNamespaceTitle('mailysend', 'CACHE')).toBe('CACHE')
    expect(kvNamespaceTitle(undefined, 'CACHE')).toBe('CACHE')
  })

  /** The bug, asserted: an instance with its own storage may not adopt a stray. */
  it('does not let an instance that owns its data adopt somebody elses', () => {
    expect(chooseKvNamespace(account, 'CACHE', 'mailysend17', true)).toBeUndefined()
    expect(chooseKvNamespace(account, 'SUPPRESSIONS', 'mailysend17', true)).toBeUndefined()
  })

  it('binds the namespace named after the instance when there is one', () => {
    expect(chooseKvNamespace(account, 'CACHE', 'mailysend16', true)?.id).toBe('n3')
  })

  /**
   * And the other half of the same rule as the database: an instance already
   * running on a shared namespace keeps it, because moving it would leave the
   * suppression list it has accumulated behind.
   */
  it('leaves an already-running instance on what it is running on', () => {
    expect(chooseKvNamespace(account, 'SUPPRESSIONS', 'mailysend14', false)?.id).toBe('n2')
  })

  it('gives the default deployment its bare namespace', () => {
    expect(chooseKvNamespace(account, 'CACHE', 'mailysend', false)?.id).toBe('n1')
  })

  it('creates rather than guess when the candidates are ambiguous', () => {
    const ambiguous = [...account, { id: 'n5', title: 'mailysend12-CACHE' }]
    expect(chooseKvNamespace(ambiguous, 'CACHE', 'mailysend14', false)).toBeUndefined()
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
