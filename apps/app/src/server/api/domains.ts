import { apiError, CreateDomainRequest, UpdateDomainRequest } from '@mailysend/contracts'
import { doName, kvKey, newId } from '@mailysend/core'
import type { DnsRequirement, Provider } from '@mailysend/providers'
import { z } from 'zod'
import { requireRole, requireScope } from '../auth.ts'
import type { Ctx } from '../context.ts'
import { buildRouter } from '../services/providers.ts'
import { type App, createRouter, json, page, parseLimit, withContext } from './base.ts'

/**
 * `/v1/domains` — the setup screen behind every first send.
 *
 * Two decisions shape this file. First, the DKIM keypair is minted here and the
 * private key never leaves the row: a customer who can re-read their signing key
 * has a key that can be leaked, and there is no operation that needs it outside
 * the send path. Second, the DNS record set is the *union* of what every
 * configured provider requires, tagged per provider — a workspace that fails
 * over from Cloudflare to SES mid-incident must already have SES's records in
 * place, and discovering that at failover time is discovering it too late.
 */

const domains: App = createRouter()

domains.use('*', withContext())

/** The PATCH surface the dashboard actually exposes; the contract omits the return path. */
const UpdateDomain = UpdateDomainRequest.extend({
  custom_return_path: z
    .string()
    .max(63)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i, 'must be a single DNS label, e.g. cf-bounce')
    .optional(),
})

domains.post('/', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'domains:write')
  requireRole(ctx.actor, 'developer')
  const body = CreateDomainRequest.parse(await c.req.json())
  const name = body.name.toLowerCase()

  const existing = await ctx.sql
    .prepare('SELECT id FROM domains WHERE workspace_id = ? AND name = ?')
    .bind(ctx.workspace.id, name)
    .first<{ id: string }>()
  if (existing) throw apiError('domain_already_exists', { param: 'name' })

  const id = newId('domain')
  const now = new Date().toISOString()
  const selector = 'ms1'
  const returnPath = body.custom_return_path ?? 'cf-bounce'
  const dkim = await generateDkimKeypair()

  await ctx.sql
    .prepare(
      `INSERT INTO domains (id, workspace_id, name, status, region, dkim_selector, dkim_private_key,
                            dkim_public_key, custom_return_path, created_at, updated_at)
       VALUES (?, ?, ?, 'not_started', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      ctx.workspace.id,
      name,
      body.region ?? 'global',
      selector,
      dkim.privateKey,
      dkim.publicKey,
      returnPath,
      now,
      now,
    )
    .run()

  const records = await requiredRecords(ctx, name, {
    selector,
    returnPath,
    dkimPublicKey: dkim.publicKey,
  })
  await writeRecords(ctx, id, records)
  ctx.background(ctx.cache.delete(kvKey.domain(ctx.workspace.id, name)))

  return json(
    {
      object: 'domain',
      id,
      name,
      status: 'not_started',
      region: body.region ?? 'global',
      created_at: now,
      custom_return_path: returnPath,
      open_tracking: true,
      click_tracking: true,
      records: records.map((r) => toDnsRecord(r, 'not_started', null)),
    },
    201,
  )
})

domains.get('/', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const cursor = c.req.query('cursor')

  const rows = await ctx.sql
    .prepare(
      `SELECT id, name, status, region, dkim_selector, custom_return_path, open_tracking,
              click_tracking, tls, dmarc_policy, learned_daily_quota, last_verified_at, created_at
         FROM domains
        WHERE workspace_id = ? ${cursor ? 'AND id < ?' : ''}
        ORDER BY id DESC LIMIT ?`,
    )
    .bind(ctx.workspace.id, ...(cursor ? [cursor] : []), limit + 1)
    .all<DomainRow>()

  return json(page(rows.results.map(toDomain), limit))
})

domains.get('/:id', async (c) => {
  const ctx = c.get('ctx')
  const row = await loadDomain(ctx, c.req.param('id'))
  const records = await ctx.sql
    .prepare(
      `SELECT record, name, value, priority, provider, purpose, status, last_checked_at
         FROM domain_dns_records WHERE workspace_id = ? AND domain_id = ?
        ORDER BY record, name`,
    )
    .bind(ctx.workspace.id, row.id)
    .all<DnsRow>()

  return json({ ...toDomain(row), records: records.results.map(fromDnsRow) })
})

domains.patch('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'domains:write')
  requireRole(ctx.actor, 'developer')
  const patch = UpdateDomain.parse(await c.req.json())
  const row = await loadDomain(ctx, c.req.param('id'))

  const columns: Record<string, unknown> = {}
  if (patch.open_tracking !== undefined) columns.open_tracking = patch.open_tracking ? 1 : 0
  if (patch.click_tracking !== undefined) columns.click_tracking = patch.click_tracking ? 1 : 0
  if (patch.tls !== undefined) columns.tls = patch.tls
  if (patch.custom_return_path !== undefined) columns.custom_return_path = patch.custom_return_path

  const keys = Object.keys(columns)
  if (keys.length === 0)
    throw apiError('validation_error', { message: 'No updatable fields supplied.' })

  await ctx.sql
    .prepare(
      `UPDATE domains SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ?
        WHERE id = ? AND workspace_id = ?`,
    )
    .bind(...keys.map((k) => columns[k]), new Date().toISOString(), row.id, ctx.workspace.id)
    .run()

  // The return path is baked into the CNAME the customer publishes, so changing
  // it invalidates the record set they were told to create.
  if (
    patch.custom_return_path !== undefined &&
    patch.custom_return_path !== row.custom_return_path
  ) {
    const dkimPublicKey = await ctx.sql
      .prepare('SELECT dkim_public_key FROM domains WHERE id = ? AND workspace_id = ?')
      .bind(row.id, ctx.workspace.id)
      .first<{ dkim_public_key: string | null }>()
    const records = await requiredRecords(ctx, row.name, {
      selector: row.dkim_selector,
      returnPath: patch.custom_return_path,
      ...(dkimPublicKey?.dkim_public_key ? { dkimPublicKey: dkimPublicKey.dkim_public_key } : {}),
    })
    await writeRecords(ctx, row.id, records)
  }

  ctx.background(ctx.cache.delete(kvKey.domain(ctx.workspace.id, row.name)))
  const updated = await loadDomain(ctx, row.id)
  return json(toDomain(updated))
})

domains.delete('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'domains:write')
  requireRole(ctx.actor, 'developer')
  const row = await loadDomain(ctx, c.req.param('id'))

  await ctx.sql.batch([
    ctx.sql
      .prepare('DELETE FROM domain_dns_records WHERE workspace_id = ? AND domain_id = ?')
      .bind(ctx.workspace.id, row.id),
    ctx.sql
      .prepare('DELETE FROM domains WHERE workspace_id = ? AND id = ?')
      .bind(ctx.workspace.id, row.id),
  ])
  ctx.background(ctx.cache.delete(kvKey.domain(ctx.workspace.id, row.name)))

  return json({ object: 'domain', id: row.id, deleted: true })
})

/**
 * Re-checks every published record over DNS-over-HTTPS.
 *
 * Resolving from the Worker rather than trusting the customer's word is the
 * whole point: "I added it" and "it resolves" differ by a typo, a trailing dot
 * or a registrar that silently appends the zone name to an already-FQDN.
 */
domains.post('/:id/verify', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'domains:write')
  const row = await loadDomain(ctx, c.req.param('id'))

  const stored = await ctx.sql
    .prepare(
      `SELECT id, record, name, value, priority, provider, purpose, status, last_checked_at
         FROM domain_dns_records WHERE workspace_id = ? AND domain_id = ?`,
    )
    .bind(ctx.workspace.id, row.id)
    .all<DnsRow & { id: string }>()

  const checkedAt = new Date().toISOString()
  const checked = await Promise.all(
    stored.results.map(async (record) => ({ record, status: await checkRecord(record) })),
  )

  await ctx.sql.batch(
    checked.map(({ record, status }) =>
      ctx.sql
        .prepare('UPDATE domain_dns_records SET status = ?, last_checked_at = ? WHERE id = ?')
        .bind(status, checkedAt, record.id),
    ),
  )

  const status = rollUpStatus(checked.map((r) => r.status))
  await ctx.sql
    .prepare(
      `UPDATE domains SET status = ?, updated_at = ?${status === 'verified' ? ', last_verified_at = ?' : ''}
        WHERE id = ? AND workspace_id = ?`,
    )
    .bind(
      status,
      checkedAt,
      ...(status === 'verified' ? [checkedAt] : []),
      row.id,
      ctx.workspace.id,
    )
    .run()

  // The send path reads the domain from KV; a domain that just became verified
  // must be sendable now, not in five minutes.
  ctx.background(ctx.cache.delete(kvKey.domain(ctx.workspace.id, row.name)))
  ctx.background(
    ctx.env.SENDING_DOMAIN.get(doName('SendingDomain', ctx.workspace.id, row.name)).setVerification(
      {
        status,
        checkedAt,
        records: checked.map(({ record, status: s }) => ({
          name: record.name,
          record: record.record,
          status: s,
        })),
      },
    ),
  )

  // The whole domain, not just the three fields that changed. A verify is the
  // one call a client makes expecting the object to be usable afterwards, and a
  // partial body here means every consumer needs a second GET to parse it.
  return json({
    ...toDomain({
      ...row,
      status,
      last_verified_at: status === 'verified' ? checkedAt : row.last_verified_at,
    }),
    records: checked.map(({ record, status: s }) =>
      fromDnsRow({ ...record, status: s, last_checked_at: checkedAt }),
    ),
  })
})

/**
 * The learned daily ceiling, straight from the actor that owns it.
 *
 * Providers ramp a new domain's quota without publishing the number, so we
 * observe it. Surfacing what we observed turns "the broadcast slowed down" from
 * a mystery into a number the customer can plan around.
 */
domains.get('/:id/quota', async (c) => {
  const ctx = c.get('ctx')
  const row = await loadDomain(ctx, c.req.param('id'))
  const snapshot = await ctx.env.SENDING_DOMAIN.get(
    doName('SendingDomain', ctx.workspace.id, row.name),
  ).snapshot()

  return json({
    object: 'domain_quota',
    domain_id: row.id,
    domain: row.name,
    day: snapshot.day,
    sent_today: snapshot.dailySent,
    daily_ceiling: snapshot.dailyCeiling,
    remaining:
      snapshot.dailyCeiling === null
        ? null
        : Math.max(0, snapshot.dailyCeiling - snapshot.dailySent),
    /** Non-null only once the domain has been throttled and the ceiling learned. */
    learned: snapshot.dailyCeiling !== null,
    available_tokens: snapshot.tokens,
    breakers: snapshot.breakers,
  })
})

// ---------------------------------------------------------------------------
// DKIM
// ---------------------------------------------------------------------------

const toBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin)
}

/**
 * RSA-2048 rather than Ed25519: Ed25519 DKIM (RFC 8463) is still rejected or
 * ignored by enough receivers that signing with it alone would cost alignment
 * at exactly the mailbox providers that matter most.
 */
async function generateDkimKeypair(): Promise<{ privateKey: string; publicKey: string }> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair

  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.exportKey('pkcs8', pair.privateKey),
    crypto.subtle.exportKey('spki', pair.publicKey),
  ])
  return { privateKey: toBase64(privateKey), publicKey: toBase64(publicKey) }
}

// ---------------------------------------------------------------------------
// DNS requirements
// ---------------------------------------------------------------------------

type ProviderTag = 'cloudflare' | 'ses' | 'resend' | 'smtp' | 'all'

interface RequiredRecord extends DnsRequirement {
  provider: ProviderTag
}

/** The union across configured providers, deduped by (type, name, value). */
async function requiredRecords(
  ctx: Ctx,
  domain: string,
  opts: { selector: string; returnPath: string; dkimPublicKey?: string },
): Promise<RequiredRecord[]> {
  const router = await buildRouter(ctx.sql, ctx.workspace.id, ctx.env)
  const union = new Map<string, { requirement: DnsRequirement; providers: Set<Provider['name']> }>()

  for (const provider of router.providers) {
    for (const requirement of provider.dnsRecords(domain, opts)) {
      const key = `${requirement.record}:${requirement.name.toLowerCase()}:${requirement.value}`
      const held = union.get(key)
      if (held) held.providers.add(provider.name)
      else union.set(key, { requirement, providers: new Set([provider.name]) })
    }
  }

  return [...union.values()].map(({ requirement, providers }) => ({
    ...requirement,
    // A record two transports both need is not "Cloudflare's record" — labelling
    // it with one of them invites a customer to delete it when they drop that
    // provider, which would break the other.
    provider: providers.size === 1 ? ([...providers][0] as ProviderTag) : 'all',
  }))
}

/**
 * DNS rows are addressed by what they *are* rather than by a fresh ULID, so a
 * rewritten record set keeps the ids the dashboard is already rendering.
 */
const dnsRecordId = (domainId: string, r: RequiredRecord): string =>
  `${domainId}:${r.record}:${r.name.toLowerCase()}`

async function writeRecords(ctx: Ctx, domainId: string, records: RequiredRecord[]): Promise<void> {
  const statements = [
    ctx.sql
      .prepare('DELETE FROM domain_dns_records WHERE workspace_id = ? AND domain_id = ?')
      .bind(ctx.workspace.id, domainId),
    ...records.map((r) =>
      ctx.sql
        .prepare(
          `INSERT INTO domain_dns_records
             (id, workspace_id, domain_id, record, name, value, priority, provider, purpose, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started')`,
        )
        .bind(
          dnsRecordId(domainId, r),
          ctx.workspace.id,
          domainId,
          r.record,
          r.name,
          r.value,
          r.priority ?? null,
          r.provider,
          r.purpose,
        ),
    ),
  ]
  await ctx.sql.batch(statements)
}

// ---------------------------------------------------------------------------
// DNS-over-HTTPS verification
// ---------------------------------------------------------------------------

const DNS_TYPES = { TXT: 16, CNAME: 5, MX: 15 } as const

interface DohAnswer {
  name: string
  type: number
  data: string
}

/** A TXT answer arrives as quoted, 255-byte-chunked strings; DKIM keys span several. */
const unquoteTxt = (data: string): string =>
  data.split('" "').join('').replace(/^"|"$/g, '').replace(/\\"/g, '"')

const canonical = (value: string): string =>
  value.replace(/\s+/g, '').replace(/\.$/, '').toLowerCase()

async function resolve(name: string, type: keyof typeof DNS_TYPES): Promise<DohAnswer[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`
  const response = await fetch(url, { headers: { accept: 'application/dns-json' } })
  if (!response.ok) return []
  const body = (await response.json()) as { Answer?: DohAnswer[] }
  return (body.Answer ?? []).filter((a) => a.type === DNS_TYPES[type])
}

async function checkRecord(record: DnsRow): Promise<'verified' | 'pending' | 'failed'> {
  let answers: DohAnswer[]
  try {
    answers = await resolve(record.name, record.record as keyof typeof DNS_TYPES)
  } catch {
    // A resolver hiccup is not evidence the customer did anything wrong, so it
    // must not flip a verified record to failed.
    return record.status === 'verified' ? 'verified' : 'pending'
  }

  // Nothing published yet, or still propagating. `failed` is reserved for a
  // record that exists and disagrees, which is the actionable case.
  if (answers.length === 0) return 'pending'

  const wanted = canonical(record.value)
  const found = answers.map((a) => canonical(record.record === 'TXT' ? unquoteTxt(a.data) : a.data))

  if (record.record === 'MX') {
    // An MX answer is `<priority> <exchange>`; only the exchange is ours to check.
    return found.some((f) => f.split(' ').pop()?.endsWith(wanted) || f.endsWith(wanted))
      ? 'verified'
      : 'failed'
  }
  if (record.record === 'TXT' && record.value.startsWith('v=spf1')) {
    // SPF is one record per domain, so a customer merging our include into their
    // existing record is doing the right thing — match on the include, not equality.
    const include = wanted.match(/include:[^\s~+-]+/)?.[0]
    return include && found.some((f) => f.includes(include)) ? 'verified' : 'failed'
  }
  return found.some((f) => f === wanted) ? 'verified' : 'failed'
}

const rollUpStatus = (statuses: string[]): 'verified' | 'pending' | 'failed' | 'not_started' => {
  if (statuses.length === 0) return 'not_started'
  if (statuses.every((s) => s === 'verified')) return 'verified'
  if (statuses.includes('failed')) return 'failed'
  return 'pending'
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface DomainRow {
  id: string
  name: string
  status: string
  region: string
  dkim_selector: string
  custom_return_path: string
  open_tracking: number
  click_tracking: number
  tls?: string
  dmarc_policy: string | null
  learned_daily_quota: number | null
  last_verified_at: string | null
  created_at: string
}

interface DnsRow {
  record: string
  name: string
  value: string
  priority: number | null
  provider: string
  purpose: string | null
  status: string
  last_checked_at: string | null
}

async function loadDomain(ctx: Ctx, id: string): Promise<DomainRow> {
  const row = await ctx.sql
    .prepare(
      `SELECT id, name, status, region, dkim_selector, custom_return_path, open_tracking,
              click_tracking, tls, dmarc_policy, learned_daily_quota, last_verified_at, created_at
         FROM domains WHERE id = ? AND workspace_id = ?`,
    )
    .bind(id, ctx.workspace.id)
    .first<DomainRow>()
  if (!row) throw apiError('not_found')
  return row
}

/** `dkim_private_key` is deliberately absent from every SELECT above. */
const toDomain = (row: DomainRow) => ({
  object: 'domain' as const,
  id: row.id,
  name: row.name,
  status: row.status,
  region: row.region,
  created_at: row.created_at,
  dkim_selector: row.dkim_selector,
  custom_return_path: row.custom_return_path,
  open_tracking: row.open_tracking === 1,
  click_tracking: row.click_tracking === 1,
  tls: row.tls ?? 'opportunistic',
  dmarc_policy: row.dmarc_policy,
  daily_quota: row.learned_daily_quota,
  last_verified_at: row.last_verified_at,
})

const toDnsRecord = (r: RequiredRecord, status: string, lastCheckedAt: string | null) => ({
  record: r.record,
  name: r.name,
  value: r.value,
  type: r.record,
  ttl: 'Auto',
  ...(r.priority !== undefined ? { priority: r.priority } : {}),
  provider: r.provider,
  purpose: r.purpose,
  status,
  last_checked_at: lastCheckedAt,
})

const fromDnsRow = (row: DnsRow) =>
  toDnsRecord(
    {
      record: row.record as DnsRequirement['record'],
      name: row.name,
      value: row.value,
      ...(row.priority !== null ? { priority: row.priority } : {}),
      purpose: row.purpose ?? '',
      provider: row.provider as ProviderTag,
    },
    row.status,
    row.last_checked_at,
  )

export { domains }
