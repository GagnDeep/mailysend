import { apiError, StatsQuery } from '@mailysend/contracts'
import { dayKey, hourKey, idLowerBound, idUpperBound, newId } from '@mailysend/core'
import { z } from 'zod'
import { requireRole } from '../auth.ts'
import type { Ctx } from '../context.ts'
import { type App, createRouter, json, page, parseLimit, withContext } from './base.ts'

/**
 * `/v1/analytics`.
 *
 * There are two counting systems in this product and they are not
 * interchangeable. Analytics Engine (the `ms_email_events` dataset) is the
 * hot chart layer: fast, approximate, sampled under load, three months of
 * retention. `rollups_daily` is the count of record: written once per event by
 * the consumer, never sampled, kept for as long as the deployment keeps its
 * database.
 *
 * Every endpoint here reads the count of record. A dashboard number that
 * disagrees with the invoice — or with what the customer told their own
 * board — is worse than a slower query.
 */

const analytics: App = createRouter()

analytics.use('*', withContext())

interface DailyRow {
  day: string
  domain_id: string
  provider: string
  sent: number
  delivered: number
  bounced: number
  complained: number
  opened: number
  unique_opened: number
  clicked: number
  unique_clicked: number
  unsubscribed: number
  failed: number
  delayed: number
  mpp_opened: number
  bot_opened: number
}

const DAILY_SUMS = `SUM(sent) AS sent, SUM(delivered) AS delivered, SUM(bounced) AS bounced,
                    SUM(complained) AS complained, SUM(opened) AS opened,
                    SUM(unique_opened) AS unique_opened, SUM(clicked) AS clicked,
                    SUM(unique_clicked) AS unique_clicked, SUM(unsubscribed) AS unsubscribed,
                    SUM(failed) AS failed, SUM(delayed) AS delayed,
                    SUM(mpp_opened) AS mpp_opened, SUM(bot_opened) AS bot_opened`

interface Range {
  from: Date
  to: Date
  fromDay: string
  toDay: string
}

/** Defaults to the last 30 days, which is what the dashboard opens on. */
function parseRange(q: URLSearchParams): Range {
  const to = q.get('to') ? new Date(q.get('to')!) : new Date()
  // An hourly series over the 30-day default would be 720 buckets nobody can
  // read; asking for hours means asking about today.
  const span = q.get('granularity') === 'hour' ? 86_400_000 : 29 * 86_400_000
  const from = q.get('from') ? new Date(q.get('from')!) : new Date(to.getTime() - span)
  if (Number.isNaN(from.getTime())) throw apiError('validation_error', { param: 'from' })
  if (Number.isNaN(to.getTime())) throw apiError('validation_error', { param: 'to' })
  if (from > to)
    throw apiError('validation_error', { message: '`from` must be before `to`.', param: 'from' })
  return { from, to, fromDay: dayKey(from), toDay: dayKey(to) }
}

const scope = (q: URLSearchParams): { clause: string; args: unknown[] } => {
  const clauses: string[] = []
  const args: unknown[] = []
  const domainId = q.get('domain_id')
  if (domainId) {
    clauses.push('domain_id = ?')
    args.push(domainId)
  }
  const provider = q.get('provider')
  if (provider) {
    clauses.push('provider = ?')
    args.push(provider)
  }
  return { clause: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', args }
}

const rate = (numerator: number, denominator: number): number =>
  denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0

const num = (value: number | null | undefined): number => value ?? 0

analytics.get('/overview', async (c) => {
  const ctx = c.get('ctx')
  const q = new URL(c.req.url).searchParams
  const range = parseRange(q)
  const filter = scope(q)

  const row = await ctx.sql
    .prepare(
      `SELECT ${DAILY_SUMS} FROM rollups_daily
        WHERE workspace_id = ? AND day >= ? AND day <= ?${filter.clause}`,
    )
    .bind(ctx.workspace.id, range.fromDay, range.toDay, ...filter.args)
    .first<DailyRow>()

  const sent = num(row?.sent)
  const delivered = num(row?.delivered)
  const opened = num(row?.opened)
  const uniqueOpened = num(row?.unique_opened)
  const mppOpened = num(row?.mpp_opened)
  const botOpened = num(row?.bot_opened)
  const clicked = num(row?.clicked)

  return json({
    object: 'analytics_overview',
    from: range.fromDay,
    to: range.toDay,
    sent,
    delivered,
    opened,
    unique_opened: uniqueOpened,
    clicked,
    unique_clicked: num(row?.unique_clicked),
    bounced: num(row?.bounced),
    complained: num(row?.complained),
    unsubscribed: num(row?.unsubscribed),
    failed: num(row?.failed),
    delayed: num(row?.delayed),
    rates: {
      delivery: rate(delivered, sent),
      bounce: rate(num(row?.bounced), sent),
      complaint: rate(num(row?.complained), delivered),
      open: rate(uniqueOpened, delivered),
      click: rate(num(row?.unique_clicked), delivered),
      click_to_open: rate(num(row?.unique_clicked), uniqueOpened),
    },
    /** Machine-opened pixels, excluded from `human_opened` and from the adjusted rate. */
    opened_by_class: {
      human: Math.max(opened - mppOpened - botOpened, 0),
      mpp: mppOpened,
      bot: botOpened,
    },
    privacy_adjusted_open_rate: privacyAdjustedOpenRate(delivered, opened, mppOpened),
    source: 'rollups_daily',
    counting: 'exact',
  })
})

/**
 * Apple's Mail Privacy Protection opens every image in every message it fetches,
 * so an unadjusted open rate is mostly a measure of how many recipients use
 * Apple Mail. Excluding MPP from *both* sides — the opens and the population
 * that produced them — is the only version of the number that means anything.
 */
const privacyAdjustedOpenRate = (delivered: number, opened: number, mppOpened: number): number =>
  rate(Math.max(opened - mppOpened, 0), Math.max(delivered - mppOpened, 0))

/**
 * `GET /v1/analytics/dashboard`.
 *
 * The Overview and Analytics screens draw six things from one range: a series,
 * two breakdowns, an engagement split, placement, and the totals band. Asking
 * for them separately means six round trips that can disagree with each other
 * — a chart drawn from one range and a total from another is a support ticket
 * nobody can reproduce. This endpoint answers all six from one parsed range.
 *
 * It is deliberately shaped for the dashboard rather than for the public API:
 * the per-resource endpoints above stay as they are documented, and this one is
 * free to change with the screens that consume it.
 */
analytics.get('/dashboard', async (c) => {
  const ctx = c.get('ctx')
  const q = new URL(c.req.url).searchParams
  const range = parseRange(q)
  const filter = scope(q)
  const granularity = (q.get('granularity') ?? 'day') as 'hour' | 'day' | 'week' | 'month'
  const tag = q.get('tag')

  const daily = await ctx.sql
    .prepare(
      `SELECT day, ${DAILY_SUMS} FROM rollups_daily
        WHERE workspace_id = ? AND day >= ? AND day <= ?${filter.clause}
        GROUP BY day ORDER BY day ASC LIMIT 1000`,
    )
    .bind(ctx.workspace.id, range.fromDay, range.toDay, ...filter.args)
    .all<DailyRow>()

  /**
   * `granularity=hour` used to return daily buckets under an hourly label,
   * because both fell through to the same branch. The Overview's chart is
   * captioned "sent per hour", so it was drawing a month of days and calling
   * them hours. Hourly rows live in their own table and are read from it.
   */
  const buckets =
    granularity === 'hour'
      ? (
          await ctx.sql
            .prepare(
              `SELECT hour AS day,
                      SUM(sent) AS sent, SUM(delivered) AS delivered, SUM(bounced) AS bounced,
                      SUM(complained) AS complained, SUM(opened) AS opened,
                      SUM(clicked) AS clicked
                 FROM rollups_hourly
                WHERE workspace_id = ? AND hour >= ? AND hour <= ?${
                  q.get('domain_id') ? ' AND domain_id = ?' : ''
                }
                GROUP BY hour ORDER BY hour ASC LIMIT 720`,
            )
            .bind(
              ctx.workspace.id,
              hourKey(range.from),
              hourKey(range.to),
              ...(q.get('domain_id') ? [q.get('domain_id')] : []),
            )
            .all<DailyRow>()
        ).results
      : granularity === 'day'
        ? daily.results
        : rollUp(daily.results, granularity)

  const byDomain = await ctx.sql
    .prepare(
      `SELECT r.domain_id, d.name AS domain, ${DAILY_SUMS}
         FROM rollups_daily r
         LEFT JOIN domains d ON d.id = r.domain_id AND d.workspace_id = r.workspace_id
        WHERE r.workspace_id = ? AND r.day >= ? AND r.day <= ?
        GROUP BY r.domain_id ORDER BY SUM(r.sent) DESC LIMIT 20`,
    )
    .bind(ctx.workspace.id, range.fromDay, range.toDay)
    .all<DailyRow & { domain: string | null }>()

  const byTag = await ctx.sql
    .prepare(
      `SELECT t.name, t.value,
              COUNT(*) AS sent,
              SUM(CASE WHEN m.delivered_at IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN m.status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
              SUM(CASE WHEN m.open_count > 0 THEN 1 ELSE 0 END) AS opened,
              SUM(CASE WHEN m.click_count > 0 THEN 1 ELSE 0 END) AS clicked
         FROM message_tags t
         JOIN messages m ON m.id = t.message_id AND m.workspace_id = t.workspace_id
        WHERE t.workspace_id = ? AND m.id >= ? AND m.id <= ? AND m.environment = ?
          ${tag ? 'AND t.name = ?' : ''}
        GROUP BY t.name, t.value
        ORDER BY sent DESC LIMIT 20`,
    )
    .bind(
      ctx.workspace.id,
      idLowerBound('email', range.from),
      idUpperBound('email', range.to),
      ctx.actor.environment,
      ...(tag ? [tag] : []),
    )
    .all<{
      name: string
      value: string
      sent: number
      delivered: number
      bounced: number
      opened: number
      clicked: number
    }>()

  const sum = (field: (typeof SUMMABLE)[number]): number =>
    daily.results.reduce((total, row) => total + num(row[field]), 0)

  const delivered = sum('delivered')
  const opened = sum('opened')
  const mppOpened = sum('mpp_opened')
  const botOpened = sum('bot_opened')
  const clicked = sum('clicked')
  const humanOpens = Math.max(opened - mppOpened - botOpened, 0)

  return json({
    object: 'analytics_dashboard',
    from: range.fromDay,
    to: range.toDay,
    granularity,
    timeseries: buckets.map((row) => ({
      bucket: row.day,
      sent: num(row.sent),
      delivered: num(row.delivered),
      bounced: num(row.bounced),
      complained: num(row.complained),
      opened: num(row.opened),
      clicked: num(row.clicked),
    })),
    by_domain: byDomain.results.map((row) => ({
      // The receiving domain is the label a person reads; the id is only useful
      // to a filter, and an unattributed rollup still has to appear somewhere.
      key: row.domain ?? row.domain_id ?? 'unattributed',
      sent: num(row.sent),
      delivered: num(row.delivered),
      bounced: num(row.bounced),
      opened: num(row.opened),
      clicked: num(row.clicked),
    })),
    by_tag: byTag.results.map((row) => ({
      key: row.value ? `${row.name}:${row.value}` : row.name,
      sent: num(row.sent),
      delivered: num(row.delivered),
      bounced: num(row.bounced),
      opened: num(row.opened),
      clicked: num(row.clicked),
    })),
    // Three classes, always present, so a chart never redraws with a different
    // number of series as data arrives.
    engagement: [
      { audience_class: 'human', opens: humanOpens, clicks: clicked },
      { audience_class: 'mpp', opens: mppOpened, clicks: 0 },
      { audience_class: 'bot', opens: botOpened, clicks: 0 },
    ],
    placement: await placementFigures(ctx, range, q.get('domain_id')),
    totals: {
      sent: sum('sent'),
      delivered,
      bounced: sum('bounced'),
      complained: sum('complained'),
      opened,
      clicked,
      unsubscribed: sum('unsubscribed'),
      // Both sides of the privacy-adjusted ratio, so the screen does the
      // division rather than inventing its own population.
      human_opens: Math.max(opened - mppOpened, 0),
      human_delivered: Math.max(delivered - mppOpened, 0),
    },
    source: 'rollups_daily',
  })
})

analytics.get('/timeseries', async (c) => {
  const ctx = c.get('ctx')
  const q = new URL(c.req.url).searchParams
  const range = parseRange(q)
  const params = StatsQuery.parse({
    granularity: q.get('granularity') ?? undefined,
    domain_id: q.get('domain_id') ?? undefined,
    provider: q.get('provider') ?? undefined,
    audience_class: q.get('audience_class') ?? undefined,
  })

  if (params.granularity === 'hour') {
    const domainId = q.get('domain_id')
    const rows = await ctx.sql
      .prepare(
        `SELECT hour,
                SUM(sent) AS sent, SUM(delivered) AS delivered, SUM(bounced) AS bounced,
                SUM(opened) AS opened, SUM(clicked) AS clicked, SUM(complained) AS complained,
                SUM(failed) AS failed
           FROM rollups_hourly
          WHERE workspace_id = ? AND hour >= ? AND hour <= ?${domainId ? ' AND domain_id = ?' : ''}
          GROUP BY hour ORDER BY hour ASC LIMIT 2000`,
      )
      .bind(
        ctx.workspace.id,
        hourKey(range.from),
        hourKey(range.to),
        ...(domainId ? [domainId] : []),
      )
      .all<{ hour: string }>()
    return json({
      object: 'analytics_timeseries',
      granularity: 'hour',
      // Hourly rollups carry no MPP split, so an hourly open rate cannot be
      // privacy adjusted; the daily series is the one to read for that.
      data: rows.results.map((row) => ({ bucket: row.hour, ...row })),
      source: 'rollups_hourly',
    })
  }

  const filter = scope(q)
  const rows = await ctx.sql
    .prepare(
      `SELECT day, ${DAILY_SUMS} FROM rollups_daily
        WHERE workspace_id = ? AND day >= ? AND day <= ?${filter.clause}
        GROUP BY day ORDER BY day ASC LIMIT 1000`,
    )
    .bind(ctx.workspace.id, range.fromDay, range.toDay, ...filter.args)
    .all<DailyRow>()

  const buckets =
    params.granularity === 'day' ? rows.results : rollUp(rows.results, params.granularity)

  return json({
    object: 'analytics_timeseries',
    granularity: params.granularity,
    audience_class: params.audience_class,
    data: buckets.map((row) => ({
      bucket: row.day,
      sent: num(row.sent),
      delivered: num(row.delivered),
      bounced: num(row.bounced),
      complained: num(row.complained),
      opened:
        params.audience_class === 'all'
          ? num(row.opened)
          : Math.max(num(row.opened) - num(row.mpp_opened) - num(row.bot_opened), 0),
      unique_opened: num(row.unique_opened),
      clicked: num(row.clicked),
      unique_clicked: num(row.unique_clicked),
      unsubscribed: num(row.unsubscribed),
      failed: num(row.failed),
      mpp_opened: num(row.mpp_opened),
      bot_opened: num(row.bot_opened),
      privacy_adjusted_open_rate: privacyAdjustedOpenRate(
        num(row.delivered),
        num(row.opened),
        num(row.mpp_opened),
      ),
    })),
    source: 'rollups_daily',
  })
})

/** Week and month buckets are folded here; SQL has no date maths worth relying on. */
function rollUp(rows: DailyRow[], granularity: 'week' | 'month' | 'hour' | 'day'): DailyRow[] {
  const keyed = new Map<string, DailyRow>()
  for (const row of rows) {
    const at = new Date(`${row.day}T00:00:00Z`)
    const key =
      granularity === 'month'
        ? row.day.slice(0, 7)
        : dayKey(new Date(at.getTime() - at.getUTCDay() * 86_400_000))
    const held = keyed.get(key)
    if (!held) {
      keyed.set(key, { ...row, day: key })
      continue
    }
    for (const field of SUMMABLE) held[field] += num(row[field])
  }
  return [...keyed.values()]
}

const SUMMABLE = [
  'sent',
  'delivered',
  'bounced',
  'complained',
  'opened',
  'unique_opened',
  'clicked',
  'unique_clicked',
  'unsubscribed',
  'failed',
  'delayed',
  'mpp_opened',
  'bot_opened',
] as const satisfies readonly (keyof DailyRow)[]

analytics.get('/by-domain', async (c) => {
  const ctx = c.get('ctx')
  const q = new URL(c.req.url).searchParams
  const range = parseRange(q)

  const rows = await ctx.sql
    .prepare(
      `SELECT r.domain_id, d.name AS domain, ${DAILY_SUMS}
         FROM rollups_daily r
         LEFT JOIN domains d ON d.id = r.domain_id AND d.workspace_id = r.workspace_id
        WHERE r.workspace_id = ? AND r.day >= ? AND r.day <= ?
        GROUP BY r.domain_id ORDER BY SUM(r.sent) DESC LIMIT 100`,
    )
    .bind(ctx.workspace.id, range.fromDay, range.toDay)
    .all<DailyRow & { domain: string | null }>()

  return json({
    object: 'list',
    data: rows.results.map((row) => ({
      domain_id: row.domain_id || null,
      domain: row.domain,
      sent: num(row.sent),
      delivered: num(row.delivered),
      bounced: num(row.bounced),
      complained: num(row.complained),
      opened: num(row.opened),
      clicked: num(row.clicked),
      delivery_rate: rate(num(row.delivered), num(row.sent)),
      bounce_rate: rate(num(row.bounced), num(row.sent)),
      complaint_rate: rate(num(row.complained), num(row.delivered)),
      privacy_adjusted_open_rate: privacyAdjustedOpenRate(
        num(row.delivered),
        num(row.opened),
        num(row.mpp_opened),
      ),
    })),
    from: range.fromDay,
    to: range.toDay,
    source: 'rollups_daily',
  })
})

/**
 * By tag.
 *
 * Rollups are not tagged — tagging them would multiply every row by the tag
 * cardinality a customer chooses, which is unbounded. Tag breakdowns therefore
 * come from `messages` joined to `message_tags` over an id range, and the
 * response says so, because that source is bounded by message retention while
 * the rollups are not.
 */
analytics.get('/by-tag', async (c) => {
  const ctx = c.get('ctx')
  const q = new URL(c.req.url).searchParams
  const range = parseRange(q)
  const limit = parseLimit(q.get('limit') ?? undefined, 50, 200)
  const name = q.get('tag_name') ?? q.get('name')

  const rows = await ctx.sql
    .prepare(
      `SELECT t.name, t.value,
              COUNT(*) AS sent,
              SUM(CASE WHEN m.delivered_at IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN m.status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
              SUM(CASE WHEN m.status = 'complained' THEN 1 ELSE 0 END) AS complained,
              SUM(CASE WHEN m.open_count > 0 THEN 1 ELSE 0 END) AS opened,
              SUM(CASE WHEN m.click_count > 0 THEN 1 ELSE 0 END) AS clicked
         FROM message_tags t
         JOIN messages m ON m.id = t.message_id AND m.workspace_id = t.workspace_id
        WHERE t.workspace_id = ? AND m.id >= ? AND m.id <= ? AND m.environment = ?
          ${name ? 'AND t.name = ?' : ''}
        GROUP BY t.name, t.value
        ORDER BY sent DESC LIMIT ?`,
    )
    .bind(
      ctx.workspace.id,
      idLowerBound('email', range.from),
      idUpperBound('email', range.to),
      ctx.actor.environment,
      ...(name ? [name] : []),
      limit,
    )
    .all<{
      name: string
      value: string
      sent: number
      delivered: number
      bounced: number
      complained: number
      opened: number
      clicked: number
    }>()

  return json({
    object: 'list',
    data: rows.results.map((row) => ({
      ...row,
      delivery_rate: rate(row.delivered, row.sent),
      open_rate: rate(row.opened, row.delivered),
      click_rate: rate(row.clicked, row.delivered),
    })),
    from: range.fromDay,
    to: range.toDay,
    source: 'messages',
    counting: 'exact_within_message_retention',
  })
})

/**
 * Engagement by audience class.
 *
 * Nothing is discarded at the edge: a bot open is stored as a bot open. This
 * endpoint is where that pays off — the default view is `human`, and the
 * response carries the privacy-adjusted rate alongside the raw one so the two
 * can never be confused for each other.
 */
analytics.get('/engagement', async (c) => {
  const ctx = c.get('ctx')
  const q = new URL(c.req.url).searchParams
  const range = parseRange(q)
  const audienceClass = (q.get('audience_class') ?? 'human') as z.infer<
    typeof StatsQuery
  >['audience_class']

  const totals = await ctx.sql
    .prepare(
      `SELECT ${DAILY_SUMS} FROM rollups_daily
        WHERE workspace_id = ? AND day >= ? AND day <= ?`,
    )
    .bind(ctx.workspace.id, range.fromDay, range.toDay)
    .first<DailyRow>()

  const delivered = num(totals?.delivered)
  const opened = num(totals?.opened)
  const mppOpened = num(totals?.mpp_opened)
  const botOpened = num(totals?.bot_opened)

  // The rollups split opens three ways. The finer classes (scanner,
  // proxy_prefetch) exist only on the event rows, so they are read from there
  // when detail is on and reported as absent when it is not.
  const byClass = ctx.features.eventDetail
    ? await ctx.sql
        .prepare(
          `SELECT audience_class, type, COUNT(*) AS count
             FROM message_events
            WHERE workspace_id = ? AND occurred_at >= ? AND occurred_at <= ?
              AND type IN ('opened', 'clicked')
            GROUP BY audience_class, type`,
        )
        .bind(ctx.workspace.id, range.from.toISOString(), range.to.toISOString())
        .all<{ audience_class: string | null; type: string; count: number }>()
    : { results: [] as { audience_class: string | null; type: string; count: number }[] }

  const classes: Record<string, { opened: number; clicked: number }> = {}
  for (const row of byClass.results) {
    const key = row.audience_class ?? 'human'
    const held = classes[key] ?? { opened: 0, clicked: 0 }
    if (row.type === 'opened') held.opened += row.count
    else held.clicked += row.count
    classes[key] = held
  }
  if (!ctx.features.eventDetail) {
    classes.human = {
      opened: Math.max(opened - mppOpened - botOpened, 0),
      clicked: num(totals?.clicked),
    }
    classes.mpp = { opened: mppOpened, clicked: 0 }
    classes.bot = { opened: botOpened, clicked: 0 }
  }

  const selected =
    audienceClass === 'all'
      ? { opened, clicked: num(totals?.clicked) }
      : (classes[audienceClass] ?? { opened: 0, clicked: 0 })

  return json({
    object: 'analytics_engagement',
    from: range.fromDay,
    to: range.toDay,
    audience_class: audienceClass,
    delivered,
    opened: selected.opened,
    clicked: selected.clicked,
    open_rate: rate(selected.opened, delivered),
    click_rate: rate(selected.clicked, delivered),
    /**
     * Excludes MPP opens from the numerator *and* the delivered population that
     * produced them. Reported unconditionally so the honest number is never the
     * one a caller has to opt into.
     */
    privacy_adjusted_open_rate: privacyAdjustedOpenRate(delivered, opened, mppOpened),
    by_class: classes,
    class_detail_available: ctx.features.eventDetail,
    source: ctx.features.eventDetail ? 'message_events' : 'rollups_daily',
  })
})

// ---------------------------------------------------------------------------
// Inbox placement
// ---------------------------------------------------------------------------

interface PlacementRow {
  recipient_provider: string
  inbox_percent: number
  spam_percent: number
  missing_percent: number
  source: string
  confidence: string
  sample_size: number | null
  measured_at: string
}

const toFigure = (row: PlacementRow) => ({
  provider: row.recipient_provider,
  inbox_percent: row.inbox_percent,
  spam_percent: row.spam_percent,
  missing_percent: row.missing_percent,
  source: row.source,
  confidence: row.confidence,
  sample_size: row.sample_size,
  measured_at: row.measured_at,
})

/** Which mailbox provider an address belongs to, for grouping delivery events. */
const providerOf = (recipient: string): string => {
  const domain = recipient.split('@')[1]?.toLowerCase() ?? ''
  if (/(^|\.)(gmail|googlemail)\.com$/.test(domain) || domain.endsWith('google.com'))
    return 'google'
  if (/(^|\.)(outlook|hotmail|live|msn)\./.test(`${domain}.`) || domain.endsWith('microsoft.com'))
    return 'microsoft'
  if (/(^|\.)(yahoo|aol|ymail)\./.test(`${domain}.`)) return 'yahoo'
  if (domain.endsWith('icloud.com') || domain.endsWith('me.com') || domain.endsWith('mac.com'))
    return 'apple'
  return 'other'
}

/**
 * `GET /v1/analytics/placement`.
 *
 * A `250 OK` from a receiving MTA means *accepted*, not *inboxed*. Nothing in
 * the delivery pipeline can see a spam folder, so a placement number derived
 * from delivery events is an estimate and is labelled one — every figure
 * carries `source` and `confidence`, and where seed results exist they are
 * returned in preference to anything computed here. The alternative, printing a
 * confident 96.1% assembled from acceptances, is the single most dishonest
 * thing a deliverability product can do.
 */
/**
 * Seed results if any exist in the range, estimates otherwise — the one
 * resolution order, shared by `/placement` and the dashboard payload, so the
 * two screens can never disagree about which number is measured.
 */
async function placementFigures(ctx: Ctx, range: Range, domainId: string | null) {
  const seeded = await seedResults(ctx, range, domainId)
  return seeded.length > 0 ? seeded : await estimatePlacement(ctx, range, domainId)
}

async function seedResults(ctx: Ctx, range: Range, domainId: string | null) {
  const seeded = await ctx.sql
    .prepare(
      `SELECT recipient_provider, inbox_percent, spam_percent, missing_percent, source,
              confidence, sample_size, measured_at
         FROM placement_results
        WHERE workspace_id = ? AND measured_at >= ? AND measured_at <= ?
          ${domainId ? 'AND domain_id = ?' : ''}
        ORDER BY measured_at DESC LIMIT 100`,
    )
    .bind(
      ctx.workspace.id,
      range.from.toISOString(),
      range.to.toISOString(),
      ...(domainId ? [domainId] : []),
    )
    .all<PlacementRow>()
  return seeded.results.map(toFigure)
}

analytics.get('/placement', async (c) => {
  const ctx = c.get('ctx')
  const q = new URL(c.req.url).searchParams
  const range = parseRange(q)
  const domainId = q.get('domain_id')

  const seeded = await seedResults(ctx, range, domainId)

  if (seeded.length > 0) {
    return json({
      object: 'placement_report',
      from: range.fromDay,
      to: range.toDay,
      figures: seeded,
      has_seed_data: true,
      note: 'Measured against seed mailboxes. Seed panels are a sample of real inboxes, not the whole audience.',
    })
  }

  return json({
    object: 'placement_report',
    from: range.fromDay,
    to: range.toDay,
    figures: await estimatePlacement(ctx, range, domainId),
    has_seed_data: false,
    note:
      'No seed-list results in this range, so these figures are estimates derived from acceptance, ' +
      'bounce and complaint events. SMTP 250 means accepted, not inboxed: a message can be accepted ' +
      'and filed in spam, and nothing in the delivery path can see that. Start a seed test ' +
      '(POST /v1/analytics/placement-tests) for measured placement.',
    seed_testing_available: ctx.features.seedTesting,
  })
})

/**
 * The estimate.
 *
 * Acceptance sets the ceiling: mail that bounced certainly did not reach an
 * inbox. Within what was accepted, complaints are the only spam-adjacent signal
 * available without a seed panel, so the spam figure is derived from them and
 * the remainder is reported as *unknown* rather than as inbox. Confidence is
 * `low` by construction, and never anything else.
 */
async function estimatePlacement(ctx: Ctx, range: Range, domainId: string | null) {
  const measuredAt = new Date().toISOString()

  if (!ctx.features.eventDetail) {
    const totals = await ctx.sql
      .prepare(
        `SELECT ${DAILY_SUMS} FROM rollups_daily
          WHERE workspace_id = ? AND day >= ? AND day <= ?${domainId ? ' AND domain_id = ?' : ''}`,
      )
      .bind(ctx.workspace.id, range.fromDay, range.toDay, ...(domainId ? [domainId] : []))
      .first<DailyRow>()
    return [
      estimateFigure(
        'all',
        num(totals?.sent),
        num(totals?.delivered),
        num(totals?.complained),
        measuredAt,
      ),
    ]
  }

  const rows = await ctx.sql
    .prepare(
      `SELECT recipient, type, COUNT(*) AS count
         FROM message_events
        WHERE workspace_id = ? AND occurred_at >= ? AND occurred_at <= ?
          AND type IN ('sent', 'delivered', 'bounced', 'complained')
        GROUP BY recipient, type LIMIT 100000`,
    )
    .bind(ctx.workspace.id, range.from.toISOString(), range.to.toISOString())
    .all<{ recipient: string; type: string; count: number }>()

  const grouped = new Map<string, { sent: number; delivered: number; complained: number }>()
  for (const row of rows.results) {
    const key = providerOf(row.recipient)
    const held = grouped.get(key) ?? { sent: 0, delivered: 0, complained: 0 }
    if (row.type === 'sent' || row.type === 'bounced') held.sent += row.count
    if (row.type === 'delivered') {
      held.sent += row.count
      held.delivered += row.count
    }
    if (row.type === 'complained') held.complained += row.count
    grouped.set(key, held)
  }

  if (grouped.size === 0) return []
  return [...grouped.entries()].map(([provider, totals]) =>
    estimateFigure(provider, totals.sent, totals.delivered, totals.complained, measuredAt),
  )
}

const estimateFigure = (
  provider: string,
  sent: number,
  delivered: number,
  complained: number,
  measuredAt: string,
) => {
  const accepted = rate(delivered, sent)
  const spam = rate(complained, delivered)
  return {
    provider,
    /** Upper bound: everything accepted and not complained about *might* be inboxed. */
    inbox_percent: Math.max(Math.round((accepted - spam) * 100) / 100, 0),
    spam_percent: spam,
    missing_percent: Math.max(Math.round((100 - accepted) * 100) / 100, 0),
    source: 'estimate' as const,
    confidence: 'low' as const,
    sample_size: sent || null,
    measured_at: measuredAt,
    basis: 'delivery_events',
    caveat: 'Derived from acceptance and complaints. Accepted mail can still be filed as spam.',
  }
}

interface SeedTestRow {
  id: string
  domain_id: string | null
  name: string | null
  status: string
  seed_count: number
  created_at: string
  completed_at: string | null
}

/**
 * One shape for a seed test, everywhere.
 *
 * The stored `status` is the pipeline's word (`running`); the API's word is
 * `collecting`, because that is what is actually happening from the caller's
 * side — mail is out and replies are trickling in. Mapping it in one function
 * keeps the list, the create response and the detail response identical, which
 * is the only reason a client can parse all three with one schema.
 */
const SEED_STATUS: Record<string, 'queued' | 'sending' | 'collecting' | 'complete' | 'failed'> = {
  queued: 'queued',
  sending: 'sending',
  running: 'collecting',
  collecting: 'collecting',
  complete: 'complete',
  completed: 'complete',
  failed: 'failed',
}

const toSeedTest = (row: SeedTestRow, results: PlacementRow[]) => ({
  id: row.id,
  // A test with no name is still a row someone has to pick out of a list.
  name: row.name ?? `Seed test · ${row.created_at.slice(0, 16).replace('T', ' ')}`,
  status: SEED_STATUS[row.status] ?? 'collecting',
  created_at: row.created_at,
  seed_count: row.seed_count,
  // What came back, not what was sent — the gap between the two is the finding.
  received_count: results.reduce((sum, r) => sum + (r.sample_size ?? 0), 0),
  results: results.map(toFigure),
})

/** `GET /v1/analytics/placement-tests` — the list behind the seed-testing screen. */
analytics.get('/placement-tests', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const { results: rows } = await ctx.sql
    .prepare(
      `SELECT id, domain_id, name, status, seed_count, created_at, completed_at
         FROM placement_tests
        WHERE workspace_id = ? AND (? IS NULL OR id < ?)
        ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(ctx.workspace.id, c.req.query('after') ?? null, c.req.query('after') ?? null, limit + 1)
    .all<SeedTestRow>()

  // One query for every test's figures rather than one per test: a seed panel
  // is small, and N+1 over a list screen is how a page gets slow quietly.
  const ids = rows.slice(0, limit).map((r) => r.id)
  const figures = ids.length
    ? (
        await ctx.sql
          .prepare(
            `SELECT test_id, recipient_provider, inbox_percent, spam_percent, missing_percent,
                    source, confidence, sample_size, measured_at
               FROM placement_results
              WHERE workspace_id = ? AND test_id IN (${ids.map(() => '?').join(',')})`,
          )
          .bind(ctx.workspace.id, ...ids)
          .all<PlacementRow & { test_id: string }>()
      ).results
    : []

  const byTest = new Map<string, PlacementRow[]>()
  for (const row of figures) {
    const bucket = byTest.get(row.test_id)
    if (bucket) bucket.push(row)
    else byTest.set(row.test_id, [row])
  }

  return json(
    page(
      rows.map((row) => ({ ...toSeedTest(row, byTest.get(row.id) ?? []), id: row.id })),
      limit,
    ),
  )
})

analytics.post('/placement-tests', async (c) => {
  const ctx = c.get('ctx')
  requireRole(ctx.actor, 'marketer')
  const body = z
    .object({
      name: z.string().max(200).optional(),
      domain_id: z.string().max(64).optional(),
      seed_addresses: z.array(z.string().min(3).max(320)).max(200).optional(),
    })
    .parse(await c.req.json().catch(() => ({})))

  const seeds = body.seed_addresses ?? []
  if (seeds.length === 0 && !ctx.features.seedTesting) {
    throw apiError('not_implemented', {
      message:
        'This deployment has no seed panel. Supply `seed_addresses` (mailboxes you control at the ' +
        'providers you care about) to run a test against your own seeds.',
      param: 'seed_addresses',
    })
  }

  const id = newId('placementTest')
  const now = new Date().toISOString()
  await ctx.sql
    .prepare(
      `INSERT INTO placement_tests (id, workspace_id, domain_id, name, status, seed_count, created_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?)`,
    )
    .bind(id, ctx.workspace.id, body.domain_id ?? null, body.name ?? null, seeds.length, now)
    .run()

  ctx.background(
    ctx.env.EXPORT_QUEUE.send({
      type: 'placement.test',
      test_id: id,
      workspace_id: ctx.workspace.id,
      domain_id: body.domain_id ?? null,
      seed_addresses: seeds,
      created_at: now,
    }),
  )

  return json(
    {
      ...toSeedTest(
        {
          id,
          domain_id: body.domain_id ?? null,
          name: body.name ?? null,
          status: 'running',
          seed_count: seeds.length,
          created_at: now,
          completed_at: null,
        },
        [],
      ),
      note: 'Results appear as each seed mailbox reports back; until then this test has no figures.',
    },
    202,
  )
})

analytics.get('/placement-tests/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const test = await ctx.sql
    .prepare(
      `SELECT id, domain_id, name, status, seed_count, created_at, completed_at
         FROM placement_tests WHERE id = ? AND workspace_id = ?`,
    )
    .bind(id, ctx.workspace.id)
    .first<SeedTestRow>()
  if (!test) throw apiError('not_found')

  const results = await ctx.sql
    .prepare(
      `SELECT recipient_provider, inbox_percent, spam_percent, missing_percent, source,
              confidence, sample_size, measured_at
         FROM placement_results WHERE workspace_id = ? AND test_id = ?
        ORDER BY recipient_provider ASC`,
    )
    .bind(ctx.workspace.id, id)
    .all<PlacementRow>()

  return json({
    ...toSeedTest(test, results.results),
    domain_id: test.domain_id,
    completed_at: test.completed_at,
    has_seed_data: results.results.length > 0,
  })
})

export { analytics }
