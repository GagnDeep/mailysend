/**
 * Demo data for the public instance at mailysend.com.
 *
 * A dashboard screenshot of an empty deployment shows nothing about the
 * product; every screen here is designed around its numbers, so the demo needs
 * numbers. This writes a month of plausible traffic straight into the SQLite
 * file — rollups, messages, events, tags, links, placement results and a sent
 * broadcast — which is the same shape the event consumer would have produced.
 *
 * It is deliberately dependency-free (node:sqlite and nothing else) so it can
 * be copied to a server and run with the Node that is already there.
 *
 *   node scripts/seed-demo.mjs /srv/mailysend/.data/mailysend.db
 *
 * Nothing here is reachable from the app: it is a script, not an endpoint, and
 * a deployment that never runs it is unaffected.
 */
import { DatabaseSync } from 'node:sqlite'

const path = process.argv[2] ?? '.data/mailysend.db'
const db = new DatabaseSync(path)
db.exec('PRAGMA busy_timeout = 10000')

// ---------------------------------------------------------------- ids

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const encodeTime = (ms) => {
  let out = ''
  for (let i = 9; i >= 0; i--) {
    out = CROCKFORD[ms % 32] + out
    ms = Math.floor(ms / 32)
  }
  return out
}
/** Deterministic randomness: the same seed must produce the same demo twice. */
let state = 0x2f6e2b1
const rand = () => {
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return ((state >>> 0) % 1_000_000) / 1_000_000
}
const pick = (list) => list[Math.floor(rand() * list.length) % list.length]
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
const encodeRandom = () => {
  let out = ''
  for (let i = 0; i < 16; i++) out += CROCKFORD[Math.floor(rand() * 32) % 32]
  return out
}
const newId = (prefix, at) => `${prefix}_${encodeTime(at)}${encodeRandom()}`

const iso = (ms) => new Date(ms).toISOString()
const dayKey = (ms) => iso(ms).slice(0, 10)
const hourKey = (ms) => `${iso(ms).slice(0, 13)}:00`

// ---------------------------------------------------------------- context

const workspace = db.prepare('SELECT id FROM workspaces LIMIT 1').get()
if (!workspace) {
  console.error('No workspace yet — boot the server once before seeding.')
  process.exit(2)
}
const ws = workspace.id
const domain = db.prepare('SELECT id, name FROM domains WHERE workspace_id = ? LIMIT 1').get(ws)
if (!domain) {
  console.error('No sending domain yet — add one before seeding.')
  process.exit(2)
}
const audience = db.prepare('SELECT id FROM audiences WHERE workspace_id = ? LIMIT 1').get(ws)
const contacts = audience
  ? db.prepare('SELECT id, email FROM contacts WHERE audience_id = ?').all(audience.id)
  : []

const FROM = `Acme <hello@${domain.name}>`
const NOW = Date.now()
const DAY = 86_400_000
const HOUR = 3_600_000

// ---------------------------------------------------------------- rollups

/**
 * A month of traffic with a shape: weekdays busier than weekends, a broadcast
 * spike, and rates that stay in the range a real sender lives in — 99.2%
 * delivered, half a percent bounced, and an open rate that is mostly Apple.
 */
const PROVIDERS = ['cloudflare', 'ses']
const rollupDaily = db.prepare(
  `INSERT INTO rollups_daily (workspace_id, day, domain_id, provider, sent, delivered, bounced,
     complained, opened, unique_opened, clicked, unique_clicked, unsubscribed, failed, delayed,
     mpp_opened, bot_opened)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT (workspace_id, day, domain_id, provider) DO UPDATE SET
     sent=excluded.sent, delivered=excluded.delivered, bounced=excluded.bounced,
     complained=excluded.complained, opened=excluded.opened, unique_opened=excluded.unique_opened,
     clicked=excluded.clicked, unique_clicked=excluded.unique_clicked,
     unsubscribed=excluded.unsubscribed, failed=excluded.failed, delayed=excluded.delayed,
     mpp_opened=excluded.mpp_opened, bot_opened=excluded.bot_opened`,
)
const rollupHourly = db.prepare(
  `INSERT INTO rollups_hourly (workspace_id, hour, domain_id, sent, delivered, bounced, opened,
     clicked, complained, failed)
   VALUES (?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT (workspace_id, hour, domain_id) DO UPDATE SET
     sent=excluded.sent, delivered=excluded.delivered, bounced=excluded.bounced,
     opened=excluded.opened, clicked=excluded.clicked, complained=excluded.complained,
     failed=excluded.failed`,
)

let monthSent = 0
for (let back = 29; back >= 0; back--) {
  const at = NOW - back * DAY
  const weekday = new Date(at).getUTCDay()
  const weekend = weekday === 0 || weekday === 6
  // A gentle ramp across the month, plus the broadcast on day 22.
  const base = Math.round((520 + (29 - back) * 14) * (weekend ? 0.42 : 1))
  const total = base + (back === 7 ? 4_100 : 0) + between(-40, 40)

  for (const provider of PROVIDERS) {
    const share = provider === 'cloudflare' ? 0.86 : 0.14
    const sent = Math.round(total * share)
    if (sent <= 0) continue
    const failed = Math.round(sent * 0.0012)
    const bounced = Math.round(sent * (provider === 'ses' ? 0.004 : 0.0051))
    const delivered = sent - bounced - failed
    const complained = Math.round(delivered * 0.0002)
    const uniqueOpened = Math.round(delivered * (weekend ? 0.39 : 0.446))
    const mpp = Math.round(uniqueOpened * 0.34)
    const bot = Math.round(uniqueOpened * 0.042)
    const opened = Math.round(uniqueOpened * 1.63)
    const uniqueClicked = Math.round(delivered * 0.108)
    const clicked = Math.round(uniqueClicked * 1.28)
    monthSent += sent
    rollupDaily.run(
      ws,
      dayKey(at),
      domain.id,
      provider,
      sent,
      delivered,
      bounced,
      complained,
      opened,
      uniqueOpened,
      clicked,
      uniqueClicked,
      Math.round(delivered * 0.0016),
      failed,
      Math.round(sent * 0.003),
      mpp,
      bot,
    )
  }

  // The last two days also get an hourly series, which is what the Analytics
  // screen switches to when the range is short enough to want one.
  if (back <= 1) {
    for (let hour = 0; hour < 24; hour++) {
      const at2 = at - (23 - hour) * 3_600_000
      if (at2 > NOW) continue
      // Sending follows office hours; nothing looks faker than a flat line.
      const curve = [
        2, 1, 1, 1, 1, 2, 5, 9, 14, 18, 20, 19, 16, 18, 20, 19, 15, 11, 8, 6, 5, 4, 3, 2,
      ]
      const sent = Math.round((total / 260) * curve[new Date(at2).getUTCHours()])
      const bounced = Math.round(sent * 0.005)
      rollupHourly.run(
        ws,
        hourKey(at2),
        domain.id,
        sent,
        sent - bounced,
        bounced,
        Math.round(sent * 0.72),
        Math.round(sent * 0.14),
        0,
        0,
      )
    }
  }
}

// ---------------------------------------------------------------- messages

const TEMPLATES = [
  ['Welcome to Acme', 'welcome', 'onboarding'],
  ['Your receipt from Acme', 'receipt', 'transactional'],
  ['Reset your password', 'password-reset', 'transactional'],
  ['Your weekly digest', 'digest', 'lifecycle'],
  ['Invitation to Acme workspace', 'invite', 'onboarding'],
  ['Your invoice is ready', 'invoice', 'transactional'],
  ['We noticed a new sign-in', 'security-alert', 'transactional'],
]
const RECIPIENT_DOMAINS = [
  'gmail.com',
  'gmail.com',
  'gmail.com',
  'outlook.com',
  'outlook.com',
  'yahoo.com',
  'icloud.com',
  'proton.me',
  'fastmail.com',
  'hey.com',
]
const NAMES = [
  'ada',
  'grace',
  'alan',
  'katherine',
  'linus',
  'barbara',
  'dennis',
  'margaret',
  'edsger',
  'radia',
  'james',
  'sophie',
  'noor',
  'rafael',
  'yuki',
  'omar',
]
const BOUNCES = [
  ['hard', '550', '550 5.1.1 The email account that you tried to reach does not exist'],
  ['soft', '452', '452 4.2.2 The recipient’s mailbox is over its storage limit'],
]

const insertMessage = db.prepare(
  `INSERT OR REPLACE INTO messages (id, workspace_id, domain_id, from_address, to_addresses,
     subject, status, state_rank, provider, provider_message_id, environment, template_id,
     sent_at, delivered_at, open_count, click_count, bounce_class, smtp_code, smtp_response,
     size_bytes, attempts, created_at, contact_id)
   VALUES (?,?,?,?,?,?,?,?,?,?,'live',?,?,?,?,?,?,?,?,?,?,?,?)`,
)
const insertTag = db.prepare(
  'INSERT INTO message_tags (workspace_id, message_id, name, value) VALUES (?,?,?,?)',
)
const insertEvent = db.prepare(
  `INSERT OR IGNORE INTO message_events (event_id, workspace_id, message_id, type, recipient,
     occurred_at, provider, audience_class, link_url, bounce_class, smtp_code, smtp_response,
     ip, user_agent, geo_country, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
)
const insertLink = db.prepare(
  `INSERT OR REPLACE INTO message_links (id, workspace_id, message_id, broadcast_id, url,
     click_count, unique_click_count) VALUES (?,?,?,?,?,?,?)`,
)

db.exec('BEGIN IMMEDIATE')
db.prepare("DELETE FROM messages WHERE workspace_id = ? AND provider_message_id LIKE 'demo-%'").run(
  ws,
)

/**
 * A domain stuck on `not_started` makes every deliverability panel read as
 * broken, so the demo domain is marked as it would be a minute after the DNS
 * resolves: verified, with each record checked.
 */
db.prepare(
  `UPDATE domains SET status = 'verified', last_verified_at = ?, dmarc_policy = 'none',
     learned_daily_quota = 50000, updated_at = ? WHERE id = ?`,
).run(iso(NOW - 26 * DAY), iso(NOW - 26 * DAY), domain.id)
db.prepare(
  "UPDATE domain_dns_records SET status = 'verified', last_checked_at = ? WHERE domain_id = ?",
).run(iso(NOW - 40 * 60_000), domain.id)

/**
 * `messages.status` is the state ladder's name for where the message got to —
 * an open is a counter on a delivered message, not a status of its own, which
 * is why the mix below is weighted towards `delivered` and the engagement
 * lives in `open_count` / `click_count`.
 */
const STATUSES = [
  ...Array(274).fill('delivered'),
  ...Array(6).fill('bounced'),
  ...Array(4).fill('queued'),
  ...Array(3).fill('sending'),
  ...Array(2).fill('complained'),
  ...Array(2).fill('failed'),
  ...Array(2).fill('delivery_delayed'),
]
const RANK = {
  queued: 10,
  scheduled: 15,
  sending: 20,
  sent: 30,
  delivery_delayed: 35,
  delivered: 40,
  canceled: 80,
  complained: 90,
  bounced: 95,
  failed: 96,
}

/**
 * The unusual statuses are dealt onto the *newest* timestamps on purpose. A log
 * sorted newest-first with 94% delivered rows would open on a screen of
 * identical green ticks, which is the one thing a message log is not for.
 */
const times = STATUSES.map(() => NOW - Math.floor(rand() * 4 * DAY) - between(0, 3_600_000)).sort(
  (a, b) => b - a,
)
const dealt = STATUSES.filter((s) => s === 'delivered')
// Spread, not sorted: a run of six bounces at the top of the list looks like an
// incident rather than a demo. The gaps widen so the first screen shows a mix
// and the rest of the log settles into its real proportions.
const GAPS = [1, 3, 6, 9, 13, 17, 21, 26, 31, 37, 44, 52, 61, 71, 82, 94, 107, 121, 136]
STATUSES.filter((s) => s !== 'delivered').forEach((status, i) => {
  dealt.splice(GAPS[i] ?? 150 + i * 7, 0, status)
})

let written = 0
for (let i = 0; i < dealt.length; i++) {
  const at = times[i]
  const status = dealt[i]
  const [subject, template, category] = pick(TEMPLATES)
  const to = `${pick(NAMES)}.${pick(NAMES)}@${pick(RECIPIENT_DOMAINS)}`
  const id = newId('em', at)
  const provider = rand() > 0.14 ? 'cloudflare' : 'ses'
  const settled = !['queued', 'sending', 'scheduled'].includes(status)
  const delivered = ['delivered', 'complained'].includes(status)
  // Roughly the rates the rollups above describe, applied per message.
  const opens = delivered && rand() > 0.55 ? between(1, 4) : 0
  const clicks = opens > 0 && rand() > 0.6 ? between(1, 3) : 0
  const bounce = status === 'bounced' ? pick(BOUNCES) : null

  insertMessage.run(
    id,
    ws,
    domain.id,
    FROM,
    JSON.stringify([to]),
    subject,
    status,
    RANK[status] ?? 10,
    settled ? provider : null,
    settled ? `demo-${id}` : null,
    `tpl_${template}`,
    settled ? iso(at) : null,
    delivered ? iso(at + between(400, 9_000)) : null,
    opens,
    clicks,
    bounce?.[0] ?? null,
    bounce?.[1] ?? null,
    bounce?.[2] ?? null,
    between(12_000, 86_000),
    settled ? 1 : 0,
    iso(at),
    contacts.length ? pick(contacts).id : null,
  )
  insertTag.run(ws, id, 'category', category)
  insertTag.run(ws, id, 'template', template)

  const event = (type, offset, extra = {}) =>
    insertEvent.run(
      `${id}:${type}`,
      ws,
      id,
      type,
      to,
      iso(at + offset),
      provider,
      extra.audience_class ?? null,
      extra.link_url ?? null,
      extra.bounce_class ?? null,
      extra.smtp_code ?? null,
      extra.smtp_response ?? null,
      extra.ip ?? null,
      extra.user_agent ?? null,
      extra.geo_country ?? null,
      iso(at + offset),
    )

  if (settled) event('sent', 0)
  if (delivered)
    event('delivered', between(400, 9_000), {
      smtp_code: '250',
      smtp_response: '250 2.0.0 OK  gsmtp',
    })
  if (opens > 0)
    event('opened', between(20_000, 400_000), {
      audience_class: rand() > 0.62 ? 'mpp' : 'human',
      ip: `66.249.${between(64, 95)}.${between(1, 254)}`,
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      geo_country: pick(['US', 'GB', 'DE', 'IN', 'CA', 'AU']),
    })
  if (clicks > 0) {
    const url = pick([
      'https://acme.dev/dashboard',
      'https://acme.dev/docs/quickstart',
      'https://acme.dev/pricing',
      'https://acme.dev/changelog',
    ])
    event('clicked', between(60_000, 600_000), { audience_class: 'human', link_url: url })
    insertLink.run(newId('lnk', at), ws, id, null, url, clicks, 1)
  }
  if (bounce)
    event('bounced', between(1_000, 40_000), {
      bounce_class: bounce[0],
      smtp_code: bounce[1],
      smtp_response: bounce[2],
    })
  if (status === 'complained') event('complained', between(100_000, 900_000))
  if (status === 'failed')
    event('failed', 2_000, { smtp_code: '421', smtp_response: '421 4.7.0 Try again later' })
  if (status === 'delivery_delayed')
    event('delivery_delayed', 30_000, {
      smtp_code: '451',
      smtp_response: '451 4.3.0 Mail server temporarily rejected message',
    })
  written++
}

// ---------------------------------------------------------------- placement

db.prepare("DELETE FROM placement_results WHERE workspace_id = ? AND test_id LIKE 'pt_demo%'").run(
  ws,
)
const testId = 'pt_demo_seed'
db.prepare(
  `INSERT OR REPLACE INTO placement_tests (id, workspace_id, domain_id, name, status, seed_count,
     created_at, completed_at) VALUES (?,?,?,?,'complete',?,?,?)`,
).run(
  testId,
  ws,
  domain.id,
  'Weekly seed panel',
  84,
  iso(NOW - 2 * DAY),
  iso(NOW - 2 * DAY + 900_000),
)

for (const [recipient, inbox, spam, missing, size] of [
  ['gmail', 97.6, 1.2, 1.2, 24],
  ['outlook', 94.1, 4.7, 1.2, 17],
  ['yahoo', 96.4, 3.6, 0, 14],
  ['apple', 98.9, 1.1, 0, 18],
  ['proton', 100, 0, 0, 11],
]) {
  db.prepare(
    `INSERT INTO placement_results (id, workspace_id, test_id, domain_id, recipient_provider,
       inbox_percent, spam_percent, missing_percent, source, confidence, sample_size, measured_at)
     VALUES (?,?,?,?,?,?,?,?,'seed','high',?,?)`,
  ).run(
    newId('plr', NOW - 2 * DAY),
    ws,
    testId,
    domain.id,
    recipient,
    inbox,
    spam,
    missing,
    size,
    iso(NOW - 2 * DAY),
  )
}

// ---------------------------------------------------------------- broadcast

// A prefixed ULID, not a readable slug: the contracts validate the shape, so a
// `bc_demo_september` parses as an invalid id and the detail page only ever
// renders its error state.
const bcId = 'bc_01M22JBRDACSTDEMSEEDXYZ234'
db.prepare(
  `INSERT OR REPLACE INTO broadcasts (id, workspace_id, name, audience_id, from_address, subject,
     preview_text, status, throttle_per_minute, holdout_percent, total_recipients, started_at,
     sent_at, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,'sent',600,10,?,?,?,?,?)`,
).run(
  bcId,
  ws,
  'August product update',
  audience?.id ?? null,
  FROM,
  'What shipped in August',
  'Inbound threading, placement tests and a faster log view.',
  4_182,
  iso(NOW - 7 * DAY),
  iso(NOW - 7 * DAY + 1_020_000),
  iso(NOW - 8 * DAY),
  iso(NOW - 7 * DAY + 1_020_000),
)

/**
 * Broadcast progress is read from the 16 counter shards, not from the row, so a
 * broadcast with no shard state reports "0 of 4,182 sent" however finished it
 * is. The totals below are split across the shards the same way the send path
 * would have spread them.
 */
const BC_TOTALS = {
  sent: 4_182,
  delivered: 4_151,
  opened: 2_106,
  clicked: 498,
  bounced: 27,
  complained: 2,
  unsubscribed: 9,
}
// Created by the actor registry on boot; declared here too so a seed against a
// database that has never run an actor still writes somewhere.
db.exec(
  `CREATE TABLE IF NOT EXISTS actor_storage (
     actor TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (actor, k))`,
)
const putCounts = db.prepare(
  `INSERT INTO actor_storage (actor, k, v) VALUES (?, 'counts', ?)
     ON CONFLICT(actor, k) DO UPDATE SET v = excluded.v`,
)
for (let shard = 0; shard < 16; shard += 1) {
  const counts = {}
  for (const [metric, total] of Object.entries(BC_TOTALS)) {
    // The last shard carries the remainder, so the shards sum to the total exactly.
    const base = Math.floor(total / 16)
    counts[metric] = shard === 15 ? total - base * 15 : base
  }
  // The node actor registry keys storage as `${kind}:${doName(...)}`, and
  // doName already starts with the kind — hence the repeated prefix.
  putCounts.run(`BroadcastCounter:BroadcastCounter:${ws}:${bcId}:${shard}`, JSON.stringify(counts))
}

// ---------------------------------------------------------------- contacts

/**
 * Engagement columns are what the segment `last_open_at > 30d` reads, so a
 * contact list with none of them is a list where every segment is empty.
 */
const touch = db.prepare(
  `UPDATE contacts SET last_send_at = ?, last_open_at = ?, last_click_at = ?, send_count = ?,
     open_count = ?, click_count = ? WHERE id = ?`,
)
for (const contact of contacts) {
  // Always at least an hour back, so the derived open/click stamps never land in the future.
  const lastSend = NOW - between(1, 6) * DAY - between(1, 20) * HOUR
  const opened = rand() > 0.18
  const clicked = opened && rand() > 0.45
  touch.run(
    iso(lastSend),
    opened ? iso(lastSend + 600_000) : null,
    clicked ? iso(lastSend + 900_000) : null,
    between(9, 41),
    opened ? between(3, 24) : 0,
    clicked ? between(1, 9) : 0,
    contact.id,
  )
}

db.exec('COMMIT')

console.log(
  `seeded: 30 days of rollups (${monthSent.toLocaleString()} sent), ${written} messages with ` +
    `events, 5 placement results, 1 sent broadcast, ${contacts.length} contacts touched`,
)
