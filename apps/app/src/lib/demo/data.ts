import { demoId } from './ids.ts'

/**
 * The tour's dataset.
 *
 * One fictional workspace — Acme, sending from `acme.dev`, which is the domain
 * every code sample on the site already uses — populated densely enough that
 * the screens show what they are for. An empty dashboard demonstrates the empty
 * state and nothing else, and a dashboard with three rows in it demonstrates a
 * table; the numbers below are the ones a small product actually has after a
 * month, because a demo that shows 40 million sends is selling a different
 * product than the one being deployed.
 *
 * Everything is derived, not typed out: the log is generated from a subject
 * list and a status distribution, the chart from a seeded walk. That keeps the
 * file readable and keeps the totals consistent with the rows they total.
 */

// ---------------------------------------------------------------------------
// Time and randomness
// ---------------------------------------------------------------------------

/**
 * Frozen at module load. The tour is meant to look like it was captured a
 * moment ago — timestamps recomputed per render would make a row's "3m ago"
 * disagree with the same row on the next screen.
 */
const NOW = Date.now()

const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString()

/** A seeded generator, so a reload shows the same dashboard it showed before. */
const rng = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 4_294_967_296
  }
}

const pick = <T>(items: readonly T[], random: () => number): T =>
  items[Math.floor(random() * items.length)] as T

// ---------------------------------------------------------------------------
// Who the visitor is
// ---------------------------------------------------------------------------

/**
 * The tour signs the visitor in as themselves.
 *
 * Their own address in the top-right is the difference between reading a
 * screenshot and being inside the product — and it is the address they just
 * typed, so it is the one thing here that is not fiction.
 */
export const demoUser = (email: string) => {
  const handle = email.split('@')[0] ?? 'you'
  const name = handle
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
  return {
    id: demoId('usr', 'visitor'),
    email,
    name: name || 'You',
    avatar_url: null,
    workspaces: [
      {
        id: WORKSPACE_ID,
        name: 'Acme',
        slug: 'acme',
        created_at: ago(60 * 24 * 96),
        role: 'owner' as const,
      },
    ],
  }
}

export const WORKSPACE_ID = demoId('ws', 'acme')

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

const DOMAIN_IDS = {
  acme: demoId('dom', 'acme.dev', -60 * 24 * 90),
  mail: demoId('dom', 'mail.acme.dev', -60 * 24 * 40),
  notify: demoId('dom', 'notify.acme.dev', -60 * 24 * 3),
}

/**
 * Every id the fixtures use, minted in one place and above everything that
 * reads one. The log generator tags its marketing rows with a broadcast id, so
 * these cannot sit beside the records they belong to — a `const` read during
 * module evaluation before its own declaration is a temporal-dead-zone throw,
 * and the screen it takes down is the first one.
 */
const TEMPLATE_IDS = {
  login: demoId('tpl', 'login-code', -60 * 24 * 80),
  receipt: demoId('tpl', 'receipt', -60 * 24 * 70),
  welcome: demoId('tpl', 'welcome', -60 * 24 * 60),
  digest: demoId('tpl', 'digest', -60 * 24 * 20),
  trial: demoId('tpl', 'trial-ending', -60 * 24 * 9),
}
const AUDIENCE_IDS = {
  product: demoId('aud', 'product-updates', -60 * 24 * 85),
  customers: demoId('aud', 'customers', -60 * 24 * 88),
}
const SEGMENT_IDS = {
  engaged: demoId('seg', 'engaged', -60 * 24 * 30),
  dormant: demoId('seg', 'dormant', -60 * 24 * 18),
  paying: demoId('seg', 'paying', -60 * 24 * 12),
}
const BROADCAST_IDS = {
  digest: demoId('bc', 'digest-aug', -60 * 24 * 2),
  launch: demoId('bc', 'launch', -60 * 24 * 16),
  survey: demoId('bc', 'survey', -60 * 24 * 45),
  draft: demoId('bc', 'september', -60),
}
const AUTOMATION_IDS = {
  onboarding: demoId('aut', 'onboarding', -60 * 24 * 55),
  winback: demoId('aut', 'winback', -60 * 24 * 25),
  trial: demoId('aut', 'trial', -60 * 24 * 10),
}
const WEBHOOK_IDS = {
  primary: demoId('wh', 'api-acme', -60 * 24 * 70),
  billing: demoId('wh', 'billing', -60 * 24 * 21),
}

const dns = (
  record: 'TXT' | 'MX' | 'CNAME',
  name: string,
  value: string,
  status: 'verified' | 'pending' | 'failed',
  purpose: string,
  extra: Record<string, unknown> = {},
) => ({
  record,
  name,
  value,
  type: record,
  ttl: 'Auto',
  status,
  provider: 'all' as const,
  purpose,
  origin: 'copy' as const,
  match: 'exact' as const,
  found: status === 'verified' ? value : null,
  error: null,
  expected: value,
  last_checked_at: ago(14),
  ...extra,
})

export const domains = [
  {
    object: 'domain' as const,
    id: DOMAIN_IDS.acme,
    name: 'acme.dev',
    status: 'verified' as const,
    created_at: ago(60 * 24 * 90),
    region: 'global',
    dkim_ready: true,
    spf_ready: true,
    dmarc_policy: 'quarantine' as const,
    daily_quota: 50_000,
    open_tracking: true,
    click_tracking: true,
    custom_return_path: 'cf-bounce',
    dkim_selector: 'ms1',
    tls: 'enforced' as const,
    last_verified_at: ago(60 * 6),
    provider: 'cloudflare' as const,
    sending_ready: true,
    records: [
      dns(
        'TXT',
        'acme.dev',
        'v=spf1 include:_spf.mx.cloudflare.net ~all',
        'verified',
        'Authorises Cloudflare Email to send as this domain.',
      ),
      dns(
        'TXT',
        'ms1._domainkey.acme.dev',
        'v=DKIM1; k=rsa; p=MIIBIjANBgkq…',
        'verified',
        'Signs every message so receivers can prove it was you.',
      ),
      dns(
        'TXT',
        '_dmarc.acme.dev',
        'v=DMARC1; p=quarantine; rua=mailto:dmarc@acme.dev',
        'verified',
        'Tells receivers what to do with mail that fails both checks.',
      ),
      dns(
        'CNAME',
        'cf-bounce.acme.dev',
        'bounce.mailysend.workers.dev',
        'verified',
        'Bounces come back to you rather than to a shared address.',
      ),
    ],
    checked: { total: 4, resolved: 4, errored: 0, first_error: null },
  },
  {
    object: 'domain' as const,
    id: DOMAIN_IDS.mail,
    name: 'mail.acme.dev',
    status: 'verified' as const,
    created_at: ago(60 * 24 * 40),
    region: 'global',
    dkim_ready: true,
    spf_ready: true,
    dmarc_policy: 'none' as const,
    daily_quota: null,
    open_tracking: false,
    click_tracking: false,
    custom_return_path: 'cf-bounce',
    dkim_selector: 'ms1',
    tls: 'opportunistic' as const,
    last_verified_at: ago(60 * 30),
    provider: 'ses' as const,
    sending_ready: true,
    records: [
      dns(
        'TXT',
        'mail.acme.dev',
        'v=spf1 include:amazonses.com ~all',
        'verified',
        'Authorises SES to send as this domain.',
      ),
      dns(
        'TXT',
        'ms1._domainkey.mail.acme.dev',
        'v=DKIM1; k=rsa; p=MIIBIjANBgkq…',
        'verified',
        'DKIM signing key.',
      ),
      dns(
        'MX',
        'mail.acme.dev',
        'route1.mx.cloudflare.net',
        'verified',
        'Receives replies into the shared inbox.',
        { priority: 10 },
      ),
    ],
    receiving: {
      mx_status: 'verified' as const,
      mx_found: 'route1.mx.cloudflare.net',
      expected: 'route1.mx.cloudflare.net',
      checked_at: ago(180),
      mailboxes: { count: 2, catch_all: 'support@mail.acme.dev' },
      catch_all: {
        observable: false as const,
        detail:
          'Cloudflare does not expose the catch-all rule over its API, so this cannot be confirmed from here. The last inbound message is the proof that it works.',
      },
      last_inbound_at: ago(26),
    },
    checked: { total: 3, resolved: 3, errored: 0, first_error: null },
  },
  {
    object: 'domain' as const,
    id: DOMAIN_IDS.notify,
    name: 'notify.acme.dev',
    status: 'pending' as const,
    created_at: ago(60 * 24 * 3),
    region: 'global',
    dkim_ready: false,
    spf_ready: true,
    dmarc_policy: 'missing' as const,
    daily_quota: null,
    open_tracking: false,
    click_tracking: false,
    custom_return_path: 'cf-bounce',
    dkim_selector: 'ms1',
    tls: 'opportunistic' as const,
    last_verified_at: null,
    provider: 'cloudflare' as const,
    sending_ready: false,
    records: [
      dns(
        'TXT',
        'notify.acme.dev',
        'v=spf1 include:_spf.mx.cloudflare.net ~all',
        'verified',
        'Authorises Cloudflare Email to send as this domain.',
      ),
      dns(
        'TXT',
        'ms1._domainkey.notify.acme.dev',
        'v=DKIM1; k=rsa; p=MIIBIjANBgkq…',
        'pending',
        'Not published yet — add this record at your DNS host.',
      ),
      dns(
        'TXT',
        '_dmarc.notify.acme.dev',
        'v=DMARC1; p=none; rua=mailto:dmarc@acme.dev',
        'pending',
        'Start at p=none and tighten once the reports are clean.',
      ),
    ],
    checked: { total: 3, resolved: 3, errored: 0, first_error: null },
  },
]

// ---------------------------------------------------------------------------
// The message log
// ---------------------------------------------------------------------------

const PEOPLE = [
  'rina.okafor',
  'jules.mercier',
  'sam.whitfield',
  'priya.raman',
  'tom.ashby',
  'noor.haddad',
  'evie.lindqvist',
  'marcus.oyelaran',
  'hana.sato',
  'leo.brandt',
  'ada.nwosu',
  'kit.fairbanks',
  'yuki.tanabe',
  'omar.el-sayed',
  'greta.olsen',
] as const

const RECIPIENT_DOMAINS = [
  'gmail.com',
  'outlook.com',
  'fastmail.com',
  'proton.me',
  'hey.com',
  'yahoo.com',
] as const

const SUBJECTS = [
  { subject: 'Your Acme sign-in code', tag: 'transactional', template: 'login-code' },
  { subject: 'Receipt for invoice #4471', tag: 'transactional', template: 'receipt' },
  { subject: 'Welcome to Acme', tag: 'lifecycle', template: 'welcome' },
  { subject: 'Your weekly digest', tag: 'marketing', template: 'digest' },
  { subject: 'Password changed', tag: 'transactional', template: 'security' },
  { subject: 'Your trial ends in 3 days', tag: 'lifecycle', template: 'trial-ending' },
  { subject: 'Someone mentioned you', tag: 'notification', template: 'mention' },
  { subject: 'Invoice #4472 is ready', tag: 'transactional', template: 'receipt' },
] as const

/**
 * The status mix.
 *
 * Weighted to look like a healthy sender with a real bounce rate rather than a
 * screenshot where everything is green — the bounced and complained rows are
 * the ones the log page exists for, and a demo that hides them is showing the
 * wrong screen.
 */
const STATUS_MIX = [
  ...Array(58).fill('delivered'),
  ...Array(9).fill('opened'),
  ...Array(5).fill('clicked'),
  ...Array(4).fill('sent'),
  ...Array(3).fill('bounced'),
  ...Array(2).fill('queued'),
  'complained',
  // The contract's spelling, not the shorthand: `EmailStatus` in
  // `packages/contracts` says `delivery_delayed`, and `/v1/emails` parses
  // against it.
  'delivery_delayed',
  'failed',
  'scheduled',
] as const

const BOUNCE = {
  code: '550',
  response:
    '550 5.1.1 <recipient>: Recipient address rejected: User unknown in virtual mailbox table',
  class: 'hard_bounce',
}

const buildLog = () => {
  const random = rng(20_260_812)
  const rows = []
  for (let i = 0; i < 120; i++) {
    const person = pick(PEOPLE, random)
    const to = `${person}@${pick(RECIPIENT_DOMAINS, random)}`
    const template = pick(SUBJECTS, random)
    const status = pick(STATUS_MIX, random)
    const minutes = Math.round(i * 11 + random() * 7)
    const domain = random() < 0.7 ? domains[0] : domains[1]
    const failed = status === 'bounced' || status === 'failed'
    rows.push({
      object: 'log' as const,
      // Descending age, so the generated id sorts the way the log reads.
      id: demoId('em', `log-${i}`, -minutes),
      from: `Acme <hello@${domain?.name}>`,
      to: [to],
      subject: template.subject,
      status,
      provider: domain?.provider ?? 'cloudflare',
      provider_message_id: `<${demoId('msg', `pm-${i}`)}@${domain?.name}>`,
      domain_id: domain?.id ?? null,
      broadcast_id: template.tag === 'marketing' ? BROADCAST_IDS.digest : null,
      automation_id: null,
      contact_id: null,
      opens: status === 'opened' || status === 'clicked' ? 1 + Math.floor(random() * 4) : 0,
      clicks: status === 'clicked' ? 1 + Math.floor(random() * 2) : 0,
      bounce_class: status === 'bounced' ? BOUNCE.class : null,
      smtp_code: failed ? BOUNCE.code : '250',
      smtp_response: failed ? BOUNCE.response.replace('<recipient>', to) : '250 2.0.0 OK',
      error: status === 'failed' ? 'Connection timed out after 30s' : null,
      size_bytes: 12_000 + Math.floor(random() * 40_000),
      attempts: failed ? 2 : 1,
      scheduled_at: status === 'scheduled' ? ago(-90) : null,
      sent_at: status === 'queued' || status === 'scheduled' ? null : ago(minutes),
      delivered_at:
        failed || status === 'queued' || status === 'scheduled' ? null : ago(minutes - 1),
      created_at: ago(minutes),
      _tag: template.tag,
      _template: template.template,
    })
  }
  return rows
}

export const logs = buildLog()

/**
 * The same messages as `/v1/emails` sees them.
 *
 * `/v1/logs` and `/v1/emails` are two views of one table with two different
 * contracts — the log is the operator's row, `Email` is the Resend-compatible
 * resource — so the tour owes both, derived from the one dataset rather than
 * typed out twice.
 */
export const emails = logs.map((row) => ({
  object: 'email' as const,
  id: row.id,
  to: row.to,
  from: row.from,
  created_at: row.created_at,
  subject: row.subject,
  bcc: null,
  cc: null,
  reply_to: ['support@mail.acme.dev'],
  last_event: row.status,
  scheduled_at: row.scheduled_at,
  tags: [
    { name: 'category', value: row._tag },
    { name: 'template', value: row._template },
  ],
  provider: row.provider,
  provider_message_id: row.provider_message_id,
  error: row.error,
  opens: row.opens,
  clicks: row.clicks,
}))

/** The drawer's payload: the row, plus everything that happened to it. */
export const logDetail = (id: string) => {
  const row = logs.find((entry) => entry.id === id) ?? logs[0]
  if (!row) return null
  const failed = row.status === 'bounced' || row.status === 'failed'
  const at = (offset: number) => new Date(Date.parse(row.created_at) + offset * 1000).toISOString()

  const events = [
    {
      event_id: demoId('msg', `${id}-queued`),
      type: 'email.queued',
      occurred_at: at(0),
      recipient: row.to[0] ?? null,
      provider: row.provider,
    },
    {
      event_id: demoId('msg', `${id}-sent`),
      type: 'email.sent',
      occurred_at: at(2),
      recipient: row.to[0] ?? null,
      provider: row.provider,
      smtp_code: row.smtp_code,
      smtp_response: row.smtp_response,
    },
  ]
  if (!failed && row.status !== 'queued' && row.status !== 'scheduled') {
    events.push({
      event_id: demoId('msg', `${id}-delivered`),
      type: 'email.delivered',
      occurred_at: at(4),
      recipient: row.to[0] ?? null,
      provider: row.provider,
      smtp_code: '250',
      smtp_response: '250 2.0.0 OK',
    })
  }
  if (row.status === 'opened' || row.status === 'clicked') {
    events.push({
      event_id: demoId('msg', `${id}-opened`),
      type: 'email.opened',
      occurred_at: at(700),
      recipient: row.to[0] ?? null,
      provider: row.provider,
      audience_class: 'human',
      geo_country: 'GB',
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    } as never)
  }
  if (row.status === 'clicked') {
    events.push({
      event_id: demoId('msg', `${id}-clicked`),
      type: 'email.clicked',
      occurred_at: at(760),
      recipient: row.to[0] ?? null,
      provider: row.provider,
      link_url: 'https://acme.dev/verify',
      audience_class: 'human',
      geo_country: 'GB',
    } as never)
  }
  if (row.status === 'bounced') {
    events.push({
      event_id: demoId('msg', `${id}-bounced`),
      type: 'email.bounced',
      occurred_at: at(6),
      recipient: row.to[0] ?? null,
      provider: row.provider,
      smtp_code: BOUNCE.code,
      smtp_response: row.smtp_response,
      bounce_class: BOUNCE.class,
      diagnostic: 'Permanent failure — the address was added to your suppression list.',
    } as never)
  }

  return {
    ...row,
    tags: [
      { name: 'category', value: row._tag },
      { name: 'template', value: row._template },
    ],
    events,
    smtp: [
      {
        at: at(2),
        code: row.smtp_code,
        response: row.smtp_response,
        source: row.provider ?? 'cloudflare',
      },
    ],
    links:
      row.status === 'clicked'
        ? [
            {
              id: demoId('msg', `${id}-link`),
              url: 'https://acme.dev/verify',
              click_count: row.clicks ?? 1,
              unique_click_count: 1,
            },
          ]
        : [],
    webhook_deliveries: failed
      ? [
          {
            id: demoId('wh', `${id}-d1`),
            webhook_id: WEBHOOK_IDS.primary,
            event: 'email.bounced',
            url: 'https://api.acme.dev/hooks/mailysend',
            status_code: 200,
            duration_ms: 88,
            attempt: 1,
            succeeded: true,
            created_at: at(8),
          },
        ]
      : [],
    raw_available: true,
    event_detail: true,
  }
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * One generator, two granularities.
 *
 * The Overview asks for `granularity=hour` and captions its chart "sent per
 * hour"; Analytics asks for days. Serving the daily series to both gave the
 * Overview thirty identical bucket labels — and, because the chart keys its
 * bars on `bucket`, a duplicate-key warning as well. The bucket format matches
 * what the API actually returns: `dayKey` for days, `hourKey`'s
 * `YYYY-MM-DD/HH` for hours (`packages/core/src/time.ts`).
 */
const buildSeries = (granularity: 'hour' | 'day') => {
  const hourly = granularity === 'hour'
  const step = hourly ? 3_600_000 : 86_400_000
  const count = hourly ? 24 : 30
  const random = rng(hourly ? 5_119 : 7_741)
  const points = []
  for (let back = count - 1; back >= 0; back--) {
    const at = new Date(NOW - back * step)
    // Weekends are quiet, and so is the small hours of the morning. Both are
    // the shape a reader recognises as real sending rather than a sine wave.
    const quiet = hourly ? at.getUTCHours() < 7 : [0, 6].includes(at.getUTCDay())
    const base = hourly ? (quiet ? 22 : 96) : quiet ? 900 : 2_400
    const sent = Math.round(base * (0.85 + random() * 0.3))
    const bounced = Math.round(sent * (0.004 + random() * 0.004))
    const complained = hourly ? 0 : Math.round(sent * 0.0004)
    const delivered = sent - bounced
    points.push({
      bucket: hourly
        ? at.toISOString().slice(0, 13).replace('T', '/')
        : at.toISOString().slice(0, 10),
      sent,
      delivered,
      bounced,
      complained,
      opened: Math.round(delivered * (0.38 + random() * 0.12)),
      clicked: Math.round(delivered * (0.07 + random() * 0.04)),
    })
  }
  return points
}

const timeseries = buildSeries('day')

type SeriesPoint = ReturnType<typeof buildSeries>[number]
type Metric = 'sent' | 'delivered' | 'bounced' | 'complained' | 'opened' | 'clicked'

export const placementFigures = [
  {
    provider: 'Gmail',
    inbox_percent: 97.4,
    spam_percent: 1.1,
    missing_percent: 1.5,
    source: 'seed' as const,
    confidence: 'high' as const,
    sample_size: 240,
    measured_at: ago(190),
  },
  {
    provider: 'Outlook',
    inbox_percent: 91.2,
    spam_percent: 6.4,
    missing_percent: 2.4,
    source: 'seed' as const,
    confidence: 'medium' as const,
    sample_size: 180,
    measured_at: ago(190),
  },
  {
    provider: 'Yahoo',
    inbox_percent: 95.8,
    spam_percent: 2.9,
    missing_percent: 1.3,
    source: 'seed' as const,
    confidence: 'high' as const,
    sample_size: 160,
    measured_at: ago(190),
  },
  {
    provider: 'Apple Mail',
    inbox_percent: 98.1,
    spam_percent: 0.6,
    missing_percent: 1.3,
    source: 'estimate' as const,
    confidence: 'low' as const,
    sample_size: null,
    measured_at: ago(190),
  },
]

/**
 * The dashboard payload, derived from whichever series was asked for, so the
 * Overview's totals describe the same 24 hours its chart draws.
 */
const view = (points: SeriesPoint[]) => {
  const sum = (key: Metric) => points.reduce((total, point) => total + point[key], 0)
  return {
    timeseries: points,
    by_domain: [
      {
        key: 'acme.dev',
        sent: Math.round(sum('sent') * 0.71),
        delivered: Math.round(sum('delivered') * 0.71),
        bounced: Math.round(sum('bounced') * 0.6),
        opened: Math.round(sum('opened') * 0.74),
        clicked: Math.round(sum('clicked') * 0.77),
      },
      {
        key: 'mail.acme.dev',
        sent: Math.round(sum('sent') * 0.29),
        delivered: Math.round(sum('delivered') * 0.29),
        bounced: Math.round(sum('bounced') * 0.4),
        opened: Math.round(sum('opened') * 0.26),
        clicked: Math.round(sum('clicked') * 0.23),
      },
    ],
    by_tag: [
      {
        key: 'transactional',
        sent: Math.round(sum('sent') * 0.54),
        delivered: Math.round(sum('delivered') * 0.55),
        bounced: Math.round(sum('bounced') * 0.3),
        opened: Math.round(sum('opened') * 0.6),
        clicked: Math.round(sum('clicked') * 0.5),
      },
      {
        key: 'lifecycle',
        sent: Math.round(sum('sent') * 0.21),
        delivered: Math.round(sum('delivered') * 0.21),
        bounced: Math.round(sum('bounced') * 0.2),
        opened: Math.round(sum('opened') * 0.22),
        clicked: Math.round(sum('clicked') * 0.24),
      },
      {
        key: 'marketing',
        sent: Math.round(sum('sent') * 0.18),
        delivered: Math.round(sum('delivered') * 0.17),
        bounced: Math.round(sum('bounced') * 0.44),
        opened: Math.round(sum('opened') * 0.13),
        clicked: Math.round(sum('clicked') * 0.2),
      },
      {
        key: 'notification',
        sent: Math.round(sum('sent') * 0.07),
        delivered: Math.round(sum('delivered') * 0.07),
        bounced: Math.round(sum('bounced') * 0.06),
        opened: Math.round(sum('opened') * 0.05),
        clicked: Math.round(sum('clicked') * 0.06),
      },
    ],
    engagement: [
      {
        audience_class: 'human',
        opens: Math.round(sum('opened') * 0.62),
        clicks: Math.round(sum('clicked') * 0.94),
      },
      { audience_class: 'mpp', opens: Math.round(sum('opened') * 0.31), clicks: 0 },
      {
        audience_class: 'bot',
        opens: Math.round(sum('opened') * 0.05),
        clicks: Math.round(sum('clicked') * 0.04),
      },
      {
        audience_class: 'scanner',
        opens: Math.round(sum('opened') * 0.02),
        clicks: Math.round(sum('clicked') * 0.02),
      },
    ],
    placement: placementFigures,
    totals: {
      sent: sum('sent'),
      delivered: sum('delivered'),
      bounced: sum('bounced'),
      complained: sum('complained'),
      opened: sum('opened'),
      clicked: sum('clicked'),
      unsubscribed: 37,
      human_opens: Math.round(sum('opened') * 0.62),
      human_delivered: Math.round(sum('delivered') * 0.78),
    },
  }
}

export const analytics = view(timeseries)

/** Overview asks for hours, Analytics for days. */
export const analyticsFor = (granularity?: string) =>
  granularity === 'hour' ? view(buildSeries('hour')) : analytics

export const placementReport = {
  figures: placementFigures,
  has_seed_data: true,
  seed_testing_available: true,
  note: 'Three of these were measured against seed mailboxes; Apple Mail is estimated from delivery events and is labelled as such.',
}

// ---------------------------------------------------------------------------
// Templates, broadcasts, audiences, segments, automations
// ---------------------------------------------------------------------------

export const templates = [
  {
    object: 'template' as const,
    id: TEMPLATE_IDS.login,
    name: 'Login code',
    slug: 'login-code',
    engine: 'jsx-ast' as const,
    subject: 'Your Acme sign-in code',
    version: 7,
    created_at: ago(60 * 24 * 80),
    updated_at: ago(60 * 30),
    variables: ['code', 'expires_in'],
  },
  {
    object: 'template' as const,
    id: TEMPLATE_IDS.receipt,
    name: 'Receipt',
    slug: 'receipt',
    engine: 'mjml' as const,
    subject: 'Receipt for invoice {{invoice.number}}',
    version: 4,
    created_at: ago(60 * 24 * 70),
    updated_at: ago(60 * 24 * 5),
    variables: ['invoice.number', 'invoice.total', 'contact.first_name'],
  },
  {
    object: 'template' as const,
    id: TEMPLATE_IDS.welcome,
    name: 'Welcome',
    slug: 'welcome',
    engine: 'handlebars' as const,
    subject: 'Welcome to Acme',
    version: 12,
    created_at: ago(60 * 24 * 60),
    updated_at: ago(60 * 24 * 2),
    variables: ['contact.first_name', 'workspace'],
  },
  {
    object: 'template' as const,
    id: TEMPLATE_IDS.digest,
    name: 'Weekly digest',
    slug: 'digest',
    engine: 'jsx-ast' as const,
    subject: 'Your weekly digest',
    version: 3,
    created_at: ago(60 * 24 * 20),
    updated_at: ago(60 * 24),
    variables: ['contact.first_name', 'items'],
  },
  {
    object: 'template' as const,
    id: TEMPLATE_IDS.trial,
    name: 'Trial ending',
    slug: 'trial-ending',
    engine: 'handlebars' as const,
    subject: 'Your trial ends in {{days}} days',
    version: 2,
    created_at: ago(60 * 24 * 9),
    updated_at: ago(60 * 24 * 9),
    variables: ['days', 'contact.first_name'],
  },
]

export const templateVersions = (id: string) => {
  const template = templates.find((t) => t.id === id) ?? templates[0]
  if (!template) return []
  return Array.from({ length: Math.min(template.version, 5) }, (_, index) => {
    const version = template.version - index
    return {
      version,
      template_id: template.id,
      created_at: ago(60 * 24 * (index * 6 + 1)),
      subject: template.subject,
      variables: template.variables,
      published: index === 0,
      created_by: index % 2 === 0 ? 'rina@acme.dev' : 'mailysend templates push',
      note: index === 0 ? 'Current' : null,
      html: `<!doctype html><html><body><h1>${template.name}</h1><p>Version ${version}.</p></body></html>`,
      text: `${template.name} — version ${version}.`,
    }
  })
}

export const audiences = [
  {
    object: 'audience' as const,
    id: AUDIENCE_IDS.customers,
    name: 'Customers',
    created_at: ago(60 * 24 * 88),
    contact_count: 4_812,
  },
  {
    object: 'audience' as const,
    id: AUDIENCE_IDS.product,
    name: 'Product updates',
    created_at: ago(60 * 24 * 85),
    contact_count: 2_164,
  },
]

export const contacts = (audienceId: string) => {
  const random = rng(audienceId.length * 977 + 13)
  return Array.from({ length: 24 }, (_, index) => {
    const person = PEOPLE[index % PEOPLE.length] as string
    const engaged = random() > 0.35
    return {
      object: 'contact' as const,
      id: demoId('con', `${audienceId}-${index}`, -index * 120),
      email: `${person}@${pick(RECIPIENT_DOMAINS, random)}`,
      first_name: (person.split('.')[0] ?? '').replace(/^./, (c) => c.toUpperCase()),
      last_name: (person.split('.')[1] ?? '').replace(/^./, (c) => c.toUpperCase()),
      created_at: ago(60 * 24 * (index + 2)),
      unsubscribed: random() > 0.93,
      audience_id: audienceId,
      data: {
        plan: pick(['free', 'team', 'business'] as const, random),
        signup_source: pick(['website', 'invite', 'api'] as const, random),
      },
      last_open_at: engaged ? ago(60 * (index + 3)) : null,
      last_click_at: engaged && random() > 0.5 ? ago(60 * (index + 9)) : null,
      open_count: engaged ? Math.floor(random() * 40) : 0,
      click_count: engaged ? Math.floor(random() * 9) : 0,
    }
  })
}

export const segments = [
  {
    object: 'segment' as const,
    id: SEGMENT_IDS.engaged,
    name: 'Engaged last 30 days',
    audience_id: AUDIENCE_IDS.customers,
    expression: 'opened_last_30d or clicked_last_30d',
    created_at: ago(60 * 24 * 30),
    updated_at: ago(60 * 24 * 4),
    member_count: 2_918,
    computed_at: ago(22),
  },
  {
    object: 'segment' as const,
    id: SEGMENT_IDS.dormant,
    name: 'Dormant',
    audience_id: AUDIENCE_IDS.customers,
    expression: 'not opened_last_90d and not unsubscribed',
    created_at: ago(60 * 24 * 18),
    updated_at: ago(60 * 24 * 18),
    member_count: 611,
    computed_at: ago(22),
  },
  {
    object: 'segment' as const,
    id: SEGMENT_IDS.paying,
    name: 'Paying plans',
    audience_id: AUDIENCE_IDS.product,
    expression: 'data.plan in ["team", "business"]',
    created_at: ago(60 * 24 * 12),
    updated_at: ago(60 * 24 * 3),
    member_count: 1_204,
    computed_at: ago(22),
  },
]

const broadcastStats = (total: number, opened: number, clicked: number) => ({
  total,
  sent: total,
  delivered: Math.round(total * 0.988),
  opened,
  clicked,
  bounced: Math.round(total * 0.012),
  complained: Math.round(total * 0.0004),
  unsubscribed: Math.round(total * 0.003),
})

export const broadcasts = [
  {
    object: 'broadcast' as const,
    id: BROADCAST_IDS.digest,
    name: 'Weekly digest — 12 Sep',
    audience_id: AUDIENCE_IDS.product,
    segment_id: SEGMENT_IDS.engaged,
    from: 'Acme <hello@acme.dev>',
    subject: 'Your weekly digest',
    reply_to: ['support@mail.acme.dev'],
    preview_text: 'Six things shipped this week.',
    status: 'sent' as const,
    created_at: ago(60 * 24 * 2),
    scheduled_at: null,
    sent_at: ago(60 * 46),
    throttle_per_minute: 2_000,
    total_recipients: 2_918,
    stats: broadcastStats(2_918, 1_284, 306),
  },
  {
    object: 'broadcast' as const,
    id: BROADCAST_IDS.launch,
    name: 'Inbound mailboxes are live',
    audience_id: AUDIENCE_IDS.customers,
    segment_id: null,
    from: 'Rina at Acme <rina@acme.dev>',
    subject: 'Replies now land in Acme',
    reply_to: ['support@mail.acme.dev'],
    preview_text: 'One inbox for everything you send.',
    status: 'sent' as const,
    created_at: ago(60 * 24 * 16),
    scheduled_at: null,
    sent_at: ago(60 * 24 * 16),
    throttle_per_minute: 1_200,
    total_recipients: 4_712,
    winner_metric: 'opens' as const,
    winner_variant: 'b',
    variants: [
      { key: 'a', subject: 'Replies now land in Acme', weight: 50 },
      { key: 'b', subject: 'Your customers can reply now', weight: 50 },
    ],
    holdout_percent: 20,
    stats: broadcastStats(4_712, 2_401, 588),
  },
  {
    object: 'broadcast' as const,
    id: BROADCAST_IDS.draft,
    name: 'September changelog',
    audience_id: AUDIENCE_IDS.product,
    segment_id: null,
    from: 'Acme <hello@acme.dev>',
    subject: 'What shipped in September',
    reply_to: null,
    preview_text: null,
    status: 'draft' as const,
    created_at: ago(60),
    scheduled_at: null,
    sent_at: null,
    throttle_per_minute: null,
    total_recipients: null,
  },
  {
    object: 'broadcast' as const,
    id: BROADCAST_IDS.survey,
    name: 'Quarterly survey',
    audience_id: AUDIENCE_IDS.customers,
    segment_id: SEGMENT_IDS.dormant,
    from: 'Acme <hello@acme.dev>',
    subject: 'Two questions, ninety seconds',
    reply_to: ['support@mail.acme.dev'],
    preview_text: null,
    status: 'scheduled' as const,
    created_at: ago(60 * 24 * 45),
    scheduled_at: ago(-60 * 20),
    sent_at: null,
    throttle_per_minute: 600,
    total_recipients: 611,
  },
]

export const automations = [
  {
    object: 'automation' as const,
    id: AUTOMATION_IDS.onboarding,
    name: 'Onboarding',
    status: 'active' as const,
    mode: 'cohort' as const,
    trigger: { type: 'contact_created' as const, audience_id: AUDIENCE_IDS.customers },
    steps: [
      { type: 'send' as const, template_id: TEMPLATE_IDS.welcome, from: 'hello@acme.dev' },
      { type: 'wait' as const, duration: '2d' },
      // A branch arm in a stored automation step, named by the contract this
      // is parsed against — not a thenable.
      // biome-ignore lint/suspicious/noThenProperty: see above
      { type: 'branch' as const, condition: 'opened_last_30d', then: [], otherwise: [] },
      { type: 'send' as const, template_id: TEMPLATE_IDS.digest },
    ],
    version: 4,
    created_at: ago(60 * 24 * 55),
    enrolled_count: 1_842,
  },
  {
    object: 'automation' as const,
    id: AUTOMATION_IDS.trial,
    name: 'Trial ending',
    status: 'active' as const,
    mode: 'cohort' as const,
    trigger: { type: 'event' as const, name: 'trial.expiring' },
    steps: [
      { type: 'send' as const, template_id: TEMPLATE_IDS.trial },
      { type: 'wait_until' as const, event: 'subscription.created', timeout: '3d' },
      { type: 'exit' as const },
    ],
    version: 2,
    created_at: ago(60 * 24 * 10),
    enrolled_count: 96,
  },
  {
    object: 'automation' as const,
    id: AUTOMATION_IDS.winback,
    name: 'Win-back',
    status: 'paused' as const,
    mode: 'cohort' as const,
    trigger: { type: 'segment_entered' as const, segment_id: SEGMENT_IDS.dormant },
    steps: [
      { type: 'wait' as const, duration: '7d' },
      {
        type: 'send' as const,
        subject: 'Still there?',
        html: '<p>We kept your workspace warm.</p>',
      },
      { type: 'tag' as const, add: ['winback'] },
    ],
    version: 1,
    created_at: ago(60 * 24 * 25),
    enrolled_count: 214,
  },
]

// ---------------------------------------------------------------------------
// Webhooks, suppressions, keys, transports
// ---------------------------------------------------------------------------

export const webhooks = [
  {
    object: 'webhook' as const,
    id: WEBHOOK_IDS.primary,
    url: 'https://api.acme.dev/hooks/mailysend',
    events: [
      'email.delivered',
      'email.bounced',
      'email.complained',
      'email.opened',
      'email.clicked',
    ] as const,
    status: 'enabled' as const,
    created_at: ago(60 * 24 * 70),
    consecutive_failures: 0,
  },
  {
    object: 'webhook' as const,
    id: WEBHOOK_IDS.billing,
    url: 'https://billing.acme.dev/mail-events',
    events: ['email.bounced', 'contact.unsubscribed'] as const,
    status: 'enabled' as const,
    created_at: ago(60 * 24 * 21),
    consecutive_failures: 2,
  },
]

export const webhookAttempts = (id: string) => {
  const random = rng(id.length * 31)
  return Array.from({ length: 12 }, (_, index) => {
    const failed = index === 3 || index === 4
    return {
      id: demoId('wh', `${id}-attempt-${index}`, -index * 30),
      webhook_id: id,
      event: pick(['email.delivered', 'email.bounced', 'email.opened'] as const, random),
      url: webhooks.find((w) => w.id === id)?.url ?? webhooks[0]?.url ?? '',
      status_code: failed ? 502 : 200,
      duration_ms: failed ? 30_000 : 40 + Math.floor(random() * 160),
      attempt: failed ? 2 : 1,
      succeeded: !failed,
      error: failed ? 'Bad gateway' : null,
      created_at: ago(index * 30 + 4),
    }
  })
}

export const suppressions = Array.from({ length: 18 }, (_, index) => {
  const random = rng(index * 4_099)
  const reason = pick(['hard_bounce', 'complaint', 'unsubscribe', 'manual'] as const, random)
  return {
    object: 'suppression' as const,
    // Address, not id, is a suppression's identity — the API has no `id` here
    // and the table keys its rows on the address. Walking both pools in step
    // rather than picking at random is what keeps 18 of them distinct.
    email: `${PEOPLE[index % PEOPLE.length]}@${
      RECIPIENT_DOMAINS[Math.floor(index / PEOPLE.length) % RECIPIENT_DOMAINS.length]
    }`,
    reason,
    created_at: ago(index * 220 + 30),
    source:
      reason === 'hard_bounce'
        ? '550 5.1.1 user unknown'
        : reason === 'complaint'
          ? 'Feedback loop'
          : null,
    expires_at: null,
  }
})

export const apiKeys = [
  {
    object: 'api_key' as const,
    id: demoId('key', 'prod', -60 * 24 * 88),
    name: 'Production',
    created_at: ago(60 * 24 * 88),
    permission: 'full_access' as const,
    token_preview: 'ms_live_9f2c',
    last_used_at: ago(3),
    expires_at: null,
  },
  {
    object: 'api_key' as const,
    id: demoId('key', 'checkout', -60 * 24 * 40),
    name: 'Checkout service',
    created_at: ago(60 * 24 * 40),
    permission: 'sending_access' as const,
    token_preview: 'ms_live_41ab',
    last_used_at: ago(18),
    expires_at: null,
  },
  {
    object: 'api_key' as const,
    id: demoId('key', 'ci', -60 * 24 * 6),
    name: 'CI (test mode)',
    created_at: ago(60 * 24 * 6),
    permission: 'sending_access' as const,
    token_preview: 'ms_test_0d77',
    last_used_at: ago(60 * 9),
    expires_at: ago(-60 * 24 * 24),
  },
]

export const providers = [
  {
    object: 'provider' as const,
    id: demoId('key', 'prov-cf'),
    provider: 'cloudflare' as const,
    enabled: true,
    priority: 1,
    weight: 80,
    credentials_set: ['api_token'],
    config: { region: 'auto' },
    updated_at: ago(60 * 24 * 3),
  },
  {
    object: 'provider' as const,
    id: demoId('key', 'prov-ses'),
    provider: 'ses' as const,
    enabled: true,
    priority: 2,
    weight: 20,
    credentials_set: ['access_key_id', 'secret_access_key'],
    config: { region: 'eu-west-1' },
    updated_at: ago(60 * 24 * 12),
  },
]

// ---------------------------------------------------------------------------
// Workspace, team, settings
// ---------------------------------------------------------------------------

export const settings = {
  name: 'Acme',
  default_sending_domain: 'acme.dev',
  default_from: 'Acme <hello@acme.dev>',
  default_reply_to: 'support@mail.acme.dev',
  open_tracking: true,
  click_tracking: true,
  provider: 'cloudflare' as const,
  failover_provider: 'ses' as const,
  log_retention_days: 90,
  raw_message_retention_days: 30,
  suppression_sync: true,
}

export const members = (email: string) => [
  {
    id: demoId('usr', 'visitor'),
    email,
    name: 'You',
    role: 'owner' as const,
    created_at: ago(60 * 24 * 96),
    last_seen_at: ago(0),
  },
  {
    id: demoId('usr', 'rina'),
    email: 'rina@acme.dev',
    name: 'Rina Okafor',
    role: 'developer' as const,
    created_at: ago(60 * 24 * 74),
    last_seen_at: ago(52),
  },
  {
    id: demoId('usr', 'jules'),
    email: 'jules@acme.dev',
    name: 'Jules Mercier',
    role: 'marketer' as const,
    created_at: ago(60 * 24 * 41),
    last_seen_at: ago(60 * 20),
  },
  {
    id: demoId('usr', 'sam'),
    email: 'sam@acme.dev',
    name: 'Sam Whitfield',
    role: 'read_only' as const,
    created_at: ago(60 * 24 * 12),
    last_seen_at: null,
  },
]

export const invites = [
  {
    id: demoId('usr', 'invite-1'),
    email: 'priya@acme.dev',
    role: 'developer' as const,
    created_at: ago(60 * 30),
    expires_at: ago(-60 * 24 * 6),
  },
]

export const mailboxes = [
  {
    object: 'inbound_mailbox' as const,
    id: demoId('thr', 'mb-support'),
    address: 'support@mail.acme.dev',
    name: 'Support',
    forward_webhook_id: null,
    agent_enabled: true,
    is_catch_all: true,
    domain: 'mail.acme.dev',
    created_at: ago(60 * 24 * 38),
  },
  {
    object: 'inbound_mailbox' as const,
    id: demoId('thr', 'mb-billing'),
    address: 'billing@mail.acme.dev',
    name: 'Billing',
    forward_webhook_id: WEBHOOK_IDS.billing,
    agent_enabled: false,
    is_catch_all: false,
    domain: 'mail.acme.dev',
    created_at: ago(60 * 24 * 20),
  },
]

export const preferenceCentre = {
  headline: 'Choose what Acme sends you',
  body: 'Change your mind any time. Transactional mail — receipts, sign-in codes — is always sent.',
  show_unsubscribe_all: true,
  topics: [
    {
      id: 'product',
      name: 'Product updates',
      description: 'What shipped, roughly monthly.',
      default_opted_in: true,
      subscriber_count: 2_164,
    },
    {
      id: 'digest',
      name: 'Weekly digest',
      description: 'A summary of your workspace activity.',
      default_opted_in: false,
      subscriber_count: 2_918,
    },
    {
      id: 'research',
      name: 'Research invitations',
      description: 'Occasional interviews. We pay for your time.',
      default_opted_in: false,
      subscriber_count: 412,
    },
  ],
}

export const seedTests = [
  {
    id: demoId('msg', 'seed-1', -190),
    name: 'September send — acme.dev',
    status: 'complete' as const,
    created_at: ago(190),
    seed_count: 240,
    received_count: 236,
    results: placementFigures,
  },
  {
    id: demoId('msg', 'seed-2', -60 * 24 * 8),
    name: 'Launch broadcast',
    status: 'complete' as const,
    created_at: ago(60 * 24 * 8),
    seed_count: 220,
    received_count: 214,
    results: placementFigures,
  },
]

export const confirmations = [
  {
    object: 'mcp_confirmation' as const,
    token: demoId('msg', 'conf-1', -12),
    tool: 'send_email',
    summary: {
      from: 'hello@acme.dev',
      to: 'rina.okafor@gmail.com',
      subject: 'Your weekly digest',
      body_digest: 'sha256:4f21…',
      reason: 'Requested by the agent while drafting a reply.',
    },
    status: 'pending',
    decided_by: null,
    consumed_at: null,
    created_at: ago(12),
    expires_at: ago(-48),
    expired: false,
  },
  {
    object: 'mcp_confirmation' as const,
    token: demoId('msg', 'conf-2', -60 * 5),
    tool: 'create_broadcast',
    summary: { name: 'September changelog', audience: 'Product updates', recipients: 2_164 },
    status: 'approved',
    decided_by: 'rina@acme.dev',
    consumed_at: ago(60 * 5 - 4),
    created_at: ago(60 * 5),
    expires_at: ago(60 * 4),
    expired: false,
  },
]

// ---------------------------------------------------------------------------
// Mail — the shared inbox
// ---------------------------------------------------------------------------

const THREAD_SEEDS = [
  {
    subject: 'Re: Invoice #4471',
    from: 'jules.mercier@fastmail.com',
    name: 'Jules Mercier',
    snippet: 'Thanks — could you resend it as a PDF?',
    folder: 'inbox',
    unread: true,
    attachments: false,
  },
  {
    subject: 'DKIM failing on notify.acme.dev',
    from: 'ops@northbridge.io',
    name: 'Northbridge Ops',
    snippet: 'We are seeing the selector return NXDOMAIN since Tuesday.',
    folder: 'inbox',
    unread: true,
    attachments: false,
  },
  {
    subject: 'Re: Welcome to Acme',
    from: 'priya.raman@proton.me',
    name: 'Priya Raman',
    snippet: 'Got it, thank you! One question about the API keys…',
    folder: 'inbox',
    unread: false,
    attachments: false,
  },
  {
    subject: 'Contract — signed copy',
    from: 'legal@vellum.co',
    name: 'Vellum Legal',
    snippet: 'Attached, countersigned.',
    folder: 'inbox',
    unread: false,
    attachments: true,
  },
  {
    subject: 'Re: Your weekly digest',
    from: 'tom.ashby@hey.com',
    name: 'Tom Ashby',
    snippet: 'Unsubscribing — too many of these. No hard feelings.',
    folder: 'inbox',
    unread: false,
    attachments: false,
  },
  {
    subject: 'Onboarding call Thursday?',
    from: 'hana.sato@outlook.com',
    name: 'Hana Sato',
    snippet: 'Thursday 14:00 UTC works for us.',
    folder: 'archive',
    unread: false,
    attachments: false,
  },
  {
    subject: 'Receipt for invoice #4470',
    from: 'hello@acme.dev',
    name: 'Acme',
    snippet: 'Your receipt is attached.',
    folder: 'sent',
    unread: false,
    attachments: true,
  },
] as const

export const mailThreads = THREAD_SEEDS.map((seed, index) => ({
  object: 'mail_thread' as const,
  id: demoId('thr', `thread-${index}`, -index * 95 - 8),
  mailbox_id: mailboxes[0]?.id ?? null,
  environment: 'live',
  subject: seed.subject,
  participants: [seed.from, 'support@mail.acme.dev'],
  message_count: index % 3 === 0 ? 3 : 2,
  unread_count: seed.unread ? 1 : 0,
  unread: seed.unread,
  has_attachments: seed.attachments,
  starred: index === 1,
  folder: seed.folder,
  labels: index === 1 ? ['deliverability'] : [],
  snoozed_until: null,
  last_message_at: ago(index * 95 + 8),
  last_direction: seed.folder === 'sent' ? ('out' as const) : ('in' as const),
  snippet: seed.snippet,
  created_at: ago(index * 95 + 400),
}))

const mailMessagesFor = (threadId: string) => {
  const index = mailThreads.findIndex((thread) => thread.id === threadId)
  const thread = mailThreads[index] ?? mailThreads[0]
  if (!thread) return []
  const seed = THREAD_SEEDS[index === -1 ? 0 : index] ?? THREAD_SEEDS[0]
  const inbound = {
    object: 'mail_message' as const,
    id: demoId('msg', `${threadId}-in`, -8),
    thread_id: thread.id,
    direction: 'in' as const,
    mailbox_id: thread.mailbox_id,
    source_id: null,
    message_id: `<${demoId('msg', `${threadId}-mid`)}@${seed.from.split('@')[1]}>`,
    in_reply_to: null,
    references: [],
    from: seed.from,
    from_name: seed.name,
    to: ['support@mail.acme.dev'],
    cc: [],
    bcc: [],
    reply_to: null,
    subject: thread.subject,
    snippet: seed.snippet,
    has_attachments: seed.attachments,
    unread: thread.unread,
    size_bytes: 8_400,
    spf: 'pass',
    dkim: 'pass',
    dmarc: 'pass',
    spam_score: 0.3,
    parse_status: 'parsed' as const,
    matched_by: 'reply_token',
    status: null,
    at: thread.last_message_at,
    email_id: null,
    html: `<p>${seed.snippet}</p><p>— ${seed.name}</p>`,
    text: `${seed.snippet}\n\n— ${seed.name}`,
    body_available: true,
    has_raw: true,
    attachments: seed.attachments
      ? [
          {
            object: 'mail_attachment' as const,
            id: demoId('msg', `${threadId}-att`),
            filename: 'contract-signed.pdf',
            content_type: 'application/pdf',
            size: 184_320,
            content_id: null,
            inline: false,
            url: `/v1/mail/attachments/${demoId('msg', `${threadId}-att`)}`,
          },
        ]
      : [],
  }

  const outbound = {
    ...inbound,
    id: demoId('msg', `${threadId}-out`, -400),
    direction: 'out' as const,
    from: 'support@mail.acme.dev',
    from_name: 'Acme Support',
    to: [seed.from],
    subject: thread.subject.replace(/^Re: /, ''),
    snippet: 'Thanks for writing in — here is what we found.',
    unread: false,
    spf: null,
    dkim: null,
    dmarc: null,
    spam_score: null,
    matched_by: null,
    status: 'delivered',
    at: ago(400),
    email_id: logs[0]?.id ?? null,
    html: '<p>Thanks for writing in — here is what we found.</p>',
    text: 'Thanks for writing in — here is what we found.',
    has_attachments: false,
    attachments: [],
  }

  return [outbound, inbound]
}

export const mailThreadDetail = (id: string) => {
  const thread = mailThreads.find((t) => t.id === id) ?? mailThreads[0]
  if (!thread) return null
  return { ...thread, messages: mailMessagesFor(thread.id) }
}

export const mailMessages = mailMessagesFor

export const mailCounts = {
  object: 'mail_counts' as const,
  environment: 'live',
  folders: {
    inbox: { threads: 5, unread: 2 },
    sent: { threads: 1, unread: 0 },
    archive: { threads: 1, unread: 0 },
    spam: { threads: 0, unread: 0 },
    trash: { threads: 0, unread: 0 },
  },
}

export const mailIdentities = {
  object: 'list' as const,
  data: [
    {
      object: 'mail_identity' as const,
      address: 'support@mail.acme.dev',
      name: 'Acme Support',
      domain: 'mail.acme.dev',
      domain_id: DOMAIN_IDS.mail,
      domain_status: 'verified',
      source: 'mailbox' as const,
      can_receive_replies: true,
    },
    {
      object: 'mail_identity' as const,
      address: 'billing@mail.acme.dev',
      name: 'Acme Billing',
      domain: 'mail.acme.dev',
      domain_id: DOMAIN_IDS.mail,
      domain_status: 'verified',
      source: 'mailbox' as const,
      can_receive_replies: true,
    },
    {
      object: 'mail_identity' as const,
      address: 'hello@acme.dev',
      name: 'Acme',
      domain: 'acme.dev',
      domain_id: DOMAIN_IDS.acme,
      domain_status: 'verified',
      source: 'domain' as const,
      can_receive_replies: false,
    },
  ],
  sendable_domains: [
    { id: DOMAIN_IDS.acme, name: 'acme.dev' },
    { id: DOMAIN_IDS.mail, name: 'mail.acme.dev' },
  ],
}

export const mailLabels = [
  {
    object: 'mail_label' as const,
    id: demoId('thr', 'label-deliv'),
    name: 'deliverability',
    colour: '#d97706',
    created_at: ago(60 * 24 * 30),
  },
  {
    object: 'mail_label' as const,
    id: demoId('thr', 'label-billing'),
    name: 'billing',
    colour: '#2563eb',
    created_at: ago(60 * 24 * 30),
  },
]

export const mailHeaders = [
  {
    name: 'Received',
    value: 'from mx.fastmail.com by route1.mx.cloudflare.net; Fri, 12 Sep 2026 09:14:02 +0000',
  },
  { name: 'Authentication-Results', value: 'mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass' },
  { name: 'Content-Type', value: 'multipart/alternative; boundary="000000000000a1b2"' },
]

export {
  AUDIENCE_IDS,
  AUTOMATION_IDS,
  BROADCAST_IDS,
  DOMAIN_IDS,
  SEGMENT_IDS,
  TEMPLATE_IDS,
  WEBHOOK_IDS,
}
