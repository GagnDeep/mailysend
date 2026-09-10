import { apiError, CreateDomainRequest, UpdateDomainRequest } from '@mailysend/contracts'
import { doName, kvKey, newId } from '@mailysend/core'
import type { DnsRequirement, Provider } from '@mailysend/providers'
import { z } from 'zod'
import { requireRole, requireScope } from '../auth.ts'
import type { Ctx } from '../context.ts'
import { buildProviderFor, buildRouter, decryptCredentials } from '../services/providers.ts'
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
 * place when it is not bound to one transport — and discovering that at failover
 * time is discovering it too late. A domain that names a `provider` gets that
 * transport's records and nothing else, because a union of two transports each
 * wanting an apex `v=spf1` is two apex SPF records, which is a permanent error.
 */

const domains: App = createRouter()

domains.use('*', withContext())

/** The four transports, as the column stores them. */
const ProviderName = z.enum(['cloudflare', 'ses', 'resend', 'smtp'])

/** The PATCH surface the dashboard actually exposes; the contract omits the return path. */
const UpdateDomain = UpdateDomainRequest.extend({
  custom_return_path: z
    .string()
    .max(63)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i, 'must be a single DNS label, e.g. cf-bounce')
    .optional(),
  /** Binds the domain to one transport. `null` returns it to the workspace default. */
  provider: ProviderName.nullable().optional(),
})

/** The create surface takes the same binding, so records are right the first time. */
const CreateDomain = CreateDomainRequest.extend({
  provider: ProviderName.optional(),
})

domains.post('/', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'domains:write')
  requireRole(ctx.actor, 'developer')
  const body = CreateDomain.parse(await c.req.json())
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
                            dkim_public_key, custom_return_path, provider, created_at, updated_at)
       VALUES (?, ?, ?, 'not_started', ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      body.provider ?? null,
      now,
      now,
    )
    .run()

  const records = await requiredRecords(ctx, name, {
    selector,
    returnPath,
    dkimPublicKey: dkim.publicKey,
    provider: body.provider ?? null,
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
      provider: body.provider ?? null,
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
              click_tracking, tls, dmarc_policy, learned_daily_quota, last_verified_at, provider,
              created_at
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
      `SELECT record, name, value, priority, provider, purpose, origin, match_mode, status, found,
              last_checked_at
         FROM domain_dns_records WHERE workspace_id = ? AND domain_id = ?
        ORDER BY record, name`,
    )
    .bind(ctx.workspace.id, row.id)
    .all<DnsRow>()

  return json({
    ...toDomain(row),
    records: records.results.map(fromDnsRow),
    ...readiness(records.results),
  })
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
  if (patch.provider !== undefined) columns.provider = patch.provider ?? null

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

  // The return path is baked into the CNAME the customer publishes and the
  // transport decides the whole record set, so either change invalidates the
  // records the customer was previously told to create.
  const returnPathChanged =
    patch.custom_return_path !== undefined && patch.custom_return_path !== row.custom_return_path
  const providerChanged = patch.provider !== undefined && (patch.provider ?? null) !== row.provider
  if (returnPathChanged || providerChanged) {
    const dkimPublicKey = await ctx.sql
      .prepare('SELECT dkim_public_key FROM domains WHERE id = ? AND workspace_id = ?')
      .bind(row.id, ctx.workspace.id)
      .first<{ dkim_public_key: string | null }>()
    const records = await requiredRecords(ctx, row.name, {
      selector: row.dkim_selector,
      returnPath: patch.custom_return_path ?? row.custom_return_path,
      ...(dkimPublicKey?.dkim_public_key ? { dkimPublicKey: dkimPublicKey.dkim_public_key } : {}),
      provider: (patch.provider !== undefined ? (patch.provider ?? null) : row.provider) as
        | Provider['name']
        | null,
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
      `SELECT id, record, name, value, priority, provider, purpose, origin, match_mode, status,
              found, last_checked_at
         FROM domain_dns_records WHERE workspace_id = ? AND domain_id = ?`,
    )
    .bind(ctx.workspace.id, row.id)
    .all<DnsRow & { id: string }>()

  const checkedAt = new Date().toISOString()
  const checked = await Promise.all(
    stored.results.map(async (record) => ({ record, ...(await checkRecord(record)) })),
  )

  await ctx.sql.batch(
    checked.map(({ record, status, found }) =>
      ctx.sql
        .prepare(
          'UPDATE domain_dns_records SET status = ?, found = ?, last_checked_at = ? WHERE id = ?',
        )
        .bind(status, found, checkedAt, record.id),
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
    records: checked.map(({ record, status: s, found }) =>
      fromDnsRow({ ...record, status: s, found, last_checked_at: checkedAt }),
    ),
    ...readiness(checked.map(({ record, status: s, found }) => ({ ...record, status: s, found }))),
  })
})

/**
 * The three signals the dashboard has always rendered and the server has never
 * sent.
 *
 * A domain is not one binary. DKIM published but SPF missing is a domain that
 * will deliver and fail alignment; SPF published but DMARC absent is a domain
 * nobody is watching. Reporting one roll-up status hid all of that.
 */
function readiness(
  records: {
    record: string
    name: string
    value: string
    status: string
    found?: string | null
  }[],
) {
  const verified = (predicate: (r: (typeof records)[number]) => boolean) =>
    records.some((r) => predicate(r) && r.status === 'verified')
  const dmarc = records.find((r) => r.name.startsWith('_dmarc.'))
  return {
    dkim_ready: verified((r) => r.name.includes('._domainkey.')),
    spf_ready: verified((r) => r.value.startsWith('v=spf1') && !r.name.startsWith('_dmarc.')),
    // `missing` is the answer that a record was looked for and was not there,
    // which is a different statement from null — nobody has looked yet.
    dmarc_policy: !dmarc
      ? null
      : dmarc.status === 'verified'
        ? (/p=(none|quarantine|reject)/.exec(dmarc.found ?? dmarc.value)?.[1] ?? 'none')
        : dmarc.status === 'not_started'
          ? null
          : 'missing',
  }
}

/**
 * `POST /:id/identity` — ask the transport to create the sending identity.
 *
 * The wizard used to compute a record set from first principles and present it
 * as fact. For two of the four transports that was wrong: Cloudflare writes its
 * own records and mints its own DKIM key, and Resend issues a key under a
 * selector we cannot guess. Where a transport can do this itself, it is asked,
 * and *its* answer replaces ours.
 */
domains.post('/:id/identity', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'domains:write')
  requireRole(ctx.actor, 'developer')
  const row = await loadDomain(ctx, c.req.param('id'))

  const keys = await ctx.sql
    .prepare(
      'SELECT dkim_public_key, dkim_private_key FROM domains WHERE id = ? AND workspace_id = ?',
    )
    .bind(row.id, ctx.workspace.id)
    .first<{ dkim_public_key: string | null; dkim_private_key: string | null }>()

  const provider = row.provider
    ? await buildProviderFor(ctx.sql, ctx.workspace.id, row.provider as Provider['name'], ctx.env)
    : (await buildRouter(ctx.sql, ctx.workspace.id, ctx.env)).providers[0]

  if (!provider) {
    throw apiError('validation_error', {
      message:
        'No transport is configured, so there is nobody to create the identity with. Configure one in Settings → Transports first.',
    })
  }
  if (!provider.identity) {
    // Not a failure. SMTP genuinely has no identity API — the records we
    // compute are the whole of the setup, and they are already published.
    return json({
      object: 'domain_identity',
      provider: provider.name,
      status: 'unknown',
      detail:
        'This transport has no identity API. The records below are the whole of the setup, and they are ours to compute.',
      external: null,
    })
  }

  const state = await provider.identity.ensure(row.name, {
    selector: row.dkim_selector,
    returnPath: row.custom_return_path,
    ...(keys?.dkim_public_key ? { dkimPublicKey: keys.dkim_public_key } : {}),
    ...(keys?.dkim_private_key ? { dkimPrivateKey: keys.dkim_private_key } : {}),
  })

  // The provider's records win where it gave any. Where it gave none — the
  // Cloudflare case — ours stand, marked `observe`, purely so verification has
  // something to resolve.
  if (state.records.length > 0) {
    await writeRecords(
      ctx,
      row.id,
      state.records.map((record) => ({ ...record, provider: provider.name as ProviderTag })),
    )
  }

  return json({
    object: 'domain_identity',
    provider: provider.name,
    status: state.status,
    detail: state.detail ?? null,
    external: state.external ?? null,
    records: state.records.map((record) =>
      toDnsRecord({ ...record, provider: provider.name as ProviderTag }, 'not_started', null),
    ),
  })
})

/**
 * `POST /:id/dns` — write the records for the customer, where they let us.
 *
 * Strictly an accelerator. Every path through this wizard completes without it,
 * and it only runs for a Cloudflare token the operator supplied with
 * `Zone:DNS:Edit`. What it writes is recorded — `zone_id` and `managed_at` per
 * row — because automation that cannot say what it did is not reversible, and a
 * record this product created is a different thing from one the operator
 * published by hand.
 */
domains.post('/:id/dns', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'domains:write')
  requireRole(ctx.actor, 'developer')
  const row = await loadDomain(ctx, c.req.param('id'))

  const credentials = await cloudflareToken(ctx)
  if (!credentials) {
    throw apiError('validation_error', {
      message:
        'No Cloudflare API token is configured, so there is nothing to automate with. Publish the records yourself, or add a token with Zone:DNS:Edit under Settings → Transports.',
    })
  }

  const api = 'https://api.cloudflare.com/client/v4'
  const auth = { Authorization: `Bearer ${credentials}`, 'content-type': 'application/json' }

  const zoneResponse = await fetch(`${api}/zones?name=${encodeURIComponent(row.name)}`, {
    headers: auth,
  })
  const zones = (await zoneResponse.json().catch(() => ({}))) as { result?: { id: string }[] }
  const zoneId = zones.result?.[0]?.id
  if (!zoneId) {
    throw apiError('validation_error', {
      message: `${row.name} is not a zone on the Cloudflare account this token belongs to, so its DNS cannot be written from here.`,
    })
  }

  const records = await ctx.sql
    .prepare(
      `SELECT id, record, name, value, priority, origin
         FROM domain_dns_records
        WHERE workspace_id = ? AND domain_id = ? AND origin = 'copy'`,
    )
    .bind(ctx.workspace.id, row.id)
    .all<{ id: string; record: string; name: string; value: string; priority: number | null }>()

  const now = new Date().toISOString()
  const written: string[] = []
  const refused: { name: string; detail: string }[] = []

  for (const record of records.results) {
    const response = await fetch(`${api}/zones/${zoneId}/dns_records`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        type: record.record,
        name: record.name,
        content: record.value,
        ttl: 300,
        ...(record.priority !== null ? { priority: record.priority } : {}),
        comment: 'Created by MailySend',
      }),
    })
    if (response.ok) {
      written.push(record.name)
      await ctx.sql
        .prepare('UPDATE domain_dns_records SET zone_id = ?, managed_at = ? WHERE id = ?')
        .bind(zoneId, now, record.id)
        .run()
      continue
    }
    // An 81057 is "this record already exists", which is success by another
    // name — the customer got there first.
    const body = (await response.json().catch(() => ({}))) as {
      errors?: { code?: number; message?: string }[]
    }
    const error = body.errors?.[0]
    if (error?.code === 81057 || error?.code === 81058) {
      written.push(record.name)
      continue
    }
    refused.push({ name: record.name, detail: error?.message ?? `HTTP ${response.status}` })
  }

  return json({
    object: 'domain_dns_automation',
    domain_id: row.id,
    zone_id: zoneId,
    written,
    refused,
    detail:
      refused.length === 0
        ? 'Every record was written. DNS still has to propagate before verification passes.'
        : 'Some records were refused; those are still yours to publish by hand.',
  })
})

/** The token for the DNS write path, workspace first and the deployment second. */
async function cloudflareToken(ctx: Ctx): Promise<string | null> {
  const row = await ctx.sql
    .prepare(
      "SELECT credentials FROM provider_configs WHERE workspace_id = ? AND provider = 'cloudflare'",
    )
    .bind(ctx.workspace.id)
    .first<{ credentials: string | null }>()
  if (row?.credentials) {
    const decrypted = await decryptCredentials(row.credentials, ctx.env)
    if (decrypted.api_token) return decrypted.api_token
  }
  return ctx.env.CLOUDFLARE_API_TOKEN ?? null
}

/**
 * `GET /:id/zone-file` — the whole record set as BIND.
 *
 * Copying six records one at a time through a registrar's web form is where
 * typos come from. Anybody running their own DNS can paste this instead, and
 * anybody who is not can still read it as a single unambiguous statement of
 * what is wanted.
 */
domains.get('/:id/zone-file', async (c) => {
  const ctx = c.get('ctx')
  const row = await loadDomain(ctx, c.req.param('id'))
  const records = await ctx.sql
    .prepare(
      `SELECT record, name, value, priority, provider, purpose, origin, match_mode, status, found,
              last_checked_at
         FROM domain_dns_records WHERE workspace_id = ? AND domain_id = ?
        ORDER BY record, name`,
    )
    .bind(ctx.workspace.id, row.id)
    .all<DnsRow>()

  const lines = [
    `; ${row.name} — DNS for sending through MailySend`,
    `; Generated ${new Date().toISOString()}`,
    ';',
  ]
  for (const record of records.results) {
    if (record.origin === 'observe') {
      lines.push(
        `; ${record.name} ${record.record} is published by ${record.provider} itself — do not add it by hand.`,
      )
      continue
    }
    if (record.purpose) lines.push(`; ${record.purpose}`)
    // TXT values are quoted and chunked at 255 bytes, because a DKIM key is
    // longer than that and an unchunked one is a zone file that will not load.
    const value =
      record.record === 'TXT'
        ? (record.value.match(/.{1,255}/g) ?? []).map((part) => `"${part}"`).join(' ')
        : `${record.priority !== null ? `${record.priority} ` : ''}${record.value}.`
    lines.push(`${record.name}. 300 IN ${record.record} ${value}`)
    lines.push(';')
  }

  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${row.name}.zone"`,
    },
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

/**
 * What this domain actually has to publish.
 *
 * When the domain names a transport, that transport alone decides — which is
 * the point of the column. Without it this was the union across every provider
 * the router could yield, and a union of two transports that each want an apex
 * `v=spf1` record is *two* apex SPF records, which is a permanent error at
 * every receiver that checks. Where a union is genuinely unavoidable, the SPF
 * includes are merged into one legal record instead.
 */
async function requiredRecords(
  ctx: Ctx,
  domain: string,
  opts: {
    selector: string
    returnPath: string
    dkimPublicKey?: string
    /** The domain's bound transport, when it has one. */
    provider?: Provider['name'] | null
  },
): Promise<RequiredRecord[]> {
  const router = await buildRouter(ctx.sql, ctx.workspace.id, ctx.env)
  const chosen = opts.provider
    ? router.providers.filter((p) => p.name === opts.provider)
    : router.providers
  // A domain bound to a transport the workspace has since turned off would
  // otherwise silently produce no records at all.
  const active = chosen.length > 0 ? chosen : router.providers

  const union = new Map<string, { requirement: DnsRequirement; providers: Set<Provider['name']> }>()

  for (const provider of active) {
    for (const requirement of provider.dnsRecords(domain, opts)) {
      const key = `${requirement.record}:${requirement.name.toLowerCase()}:${requirement.value}`
      const held = union.get(key)
      if (held) held.providers.add(provider.name)
      else union.set(key, { requirement, providers: new Set([provider.name]) })
    }
  }

  const records = [...union.values()].map(({ requirement, providers }) => ({
    ...requirement,
    // A record two transports both need is not "Cloudflare's record" — labelling
    // it with one of them invites a customer to delete it when they drop that
    // provider, which would break the other.
    provider: providers.size === 1 ? ([...providers][0] as ProviderTag) : 'all',
  }))

  return mergeSpf(records)
}

/**
 * Collapses several apex `v=spf1` records into one.
 *
 * RFC 7208 §3.2: more than one SPF record at a name is a `permerror`, so two
 * transports each publishing their own is not "belt and braces", it is a
 * failure. The includes are concatenated in order and the first record's
 * qualifier (`~all` / `-all`) is kept.
 */
function mergeSpf(records: RequiredRecord[]): RequiredRecord[] {
  const byName = new Map<string, RequiredRecord[]>()
  for (const record of records) {
    if (record.record !== 'TXT' || !record.value.startsWith('v=spf1')) continue
    const key = record.name.toLowerCase()
    byName.set(key, [...(byName.get(key) ?? []), record])
  }

  const merged: RequiredRecord[] = []
  const dropped = new Set<RequiredRecord>()
  for (const [, group] of byName) {
    if (group.length < 2) continue
    const mechanisms: string[] = []
    let all = '~all'
    for (const record of group) {
      dropped.add(record)
      for (const token of record.value.split(/\s+/).slice(1)) {
        if (/^[-~+?]?all$/.test(token)) {
          all = token
          continue
        }
        if (!mechanisms.includes(token)) mechanisms.push(token)
      }
    }
    const first = group[0] as RequiredRecord
    merged.push({
      ...first,
      value: ['v=spf1', ...mechanisms, all].join(' '),
      provider: 'all',
      purpose:
        'Authorises every transport this workspace sends through. One record: a second v=spf1 at the same name is a permanent error, not a fallback.',
    })
  }

  return [...records.filter((r) => !dropped.has(r)), ...merged]
}

/**
 * DNS rows are addressed by what they *are* rather than by a fresh ULID, so a
 * rewritten record set keeps the ids the dashboard is already rendering.
 */
/**
 * A stable id per record.
 *
 * The value is part of it. Keying on `(domain, type, name)` alone meant two
 * transports asking for different TXT values at the same name — Resend's DKIM
 * placeholder against our real key, say — collided on the primary key and the
 * whole domain creation failed with a 500. A name legitimately carries more
 * than one TXT record, so the id has to admit that.
 */
const dnsRecordId = (domainId: string, r: RequiredRecord): string => {
  let hash = 0x811c9dc5
  for (const char of `${r.record}:${r.name.toLowerCase()}:${r.value}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  }
  return `${domainId}:${r.record}:${r.name.toLowerCase()}:${hash.toString(36)}`
}

async function writeRecords(ctx: Ctx, domainId: string, records: RequiredRecord[]): Promise<void> {
  const statements = [
    ctx.sql
      .prepare('DELETE FROM domain_dns_records WHERE workspace_id = ? AND domain_id = ?')
      .bind(ctx.workspace.id, domainId),
    ...records.map((r) =>
      ctx.sql
        .prepare(
          `INSERT INTO domain_dns_records
             (id, workspace_id, domain_id, record, name, value, priority, provider, purpose,
              origin, match_mode, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started')`,
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
          r.origin ?? 'copy',
          r.match ?? 'exact',
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

interface CheckResult {
  status: 'verified' | 'pending' | 'failed'
  /**
   * What actually resolved, verbatim.
   *
   * `dns-records.tsx` has rendered a `found` against `expected` diff since the
   * component was written and the server has never sent one, so every failure
   * read as "wrong" with no way to see *how*. It is a trailing dot more often
   * than not.
   */
  found: string | null
}

async function checkRecord(record: DnsRow): Promise<CheckResult> {
  let answers: DohAnswer[]
  try {
    answers = await resolve(record.name, record.record as keyof typeof DNS_TYPES)
  } catch {
    // A resolver hiccup is not evidence the customer did anything wrong, so it
    // must not flip a verified record to failed.
    return { status: record.status === 'verified' ? 'verified' : 'pending', found: null }
  }

  // Nothing published yet, or still propagating. `failed` is reserved for a
  // record that exists and disagrees, which is the actionable case.
  if (answers.length === 0) return { status: 'pending', found: null }

  const wanted = canonical(record.value)
  const raw = answers.map((a) => (record.record === 'TXT' ? unquoteTxt(a.data) : a.data))
  const found = raw.map(canonical)
  // Only the answers that could plausibly be this record: a name carrying six
  // TXT records should not show all six as "found" for the SPF row.
  const relevant =
    record.record === 'TXT' && record.value.startsWith('v=spf1')
      ? raw.filter((value) => value.toLowerCase().startsWith('v=spf1'))
      : raw
  const seen = (relevant.length > 0 ? relevant : raw).join(' | ')

  if (record.record === 'MX') {
    // An MX answer is `<priority> <exchange>`; only the exchange is ours to check.
    const ok = found.some((f) => f.split(' ').pop()?.endsWith(wanted) || f.endsWith(wanted))
    return { status: ok ? 'verified' : 'failed', found: seen }
  }

  const mode = record.match_mode ?? 'exact'
  if (mode === 'include') {
    // SPF is one record per name, so a customer merging our include into their
    // existing record is doing the right thing — match on the include, not
    // equality. Every include we asked for has to be there.
    const includes = [...wanted.matchAll(/include:[^\s~+?-]+/g)].map((m) => m[0])
    const ok =
      includes.length > 0 && includes.every((include) => found.some((f) => f.includes(include)))
    return { status: ok ? 'verified' : 'failed', found: seen }
  }
  if (mode === 'prefix') {
    // A value only the provider knows — a DKIM key it mints, a DMARC policy the
    // customer is free to tighten. All that can be checked is the shape.
    const prefix = canonical(record.value.split(';')[0] ?? record.value)
    return { status: found.some((f) => f.startsWith(prefix)) ? 'verified' : 'failed', found: seen }
  }
  return { status: found.some((f) => f === wanted) ? 'verified' : 'failed', found: seen }
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
  provider: string | null
  created_at: string
}

interface DnsRow {
  record: string
  name: string
  value: string
  priority: number | null
  provider: string
  purpose: string | null
  origin: 'copy' | 'observe'
  match_mode: 'exact' | 'include' | 'prefix'
  status: string
  /** What last resolved at this name, so a failure can show the difference. */
  found: string | null
  last_checked_at: string | null
}

async function loadDomain(ctx: Ctx, id: string): Promise<DomainRow> {
  const row = await ctx.sql
    .prepare(
      `SELECT id, name, status, region, dkim_selector, custom_return_path, open_tracking,
              click_tracking, tls, dmarc_policy, learned_daily_quota, last_verified_at, provider,
              created_at
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
  // null means "whatever the workspace routes through today"; a named transport
  // is what the published records are derived from.
  provider: (row.provider ?? null) as Provider['name'] | null,
})

const toDnsRecord = (
  r: RequiredRecord,
  status: string,
  lastCheckedAt: string | null,
  found: string | null = null,
) => ({
  record: r.record,
  name: r.name,
  value: r.value,
  type: r.record,
  ttl: 'Auto',
  ...(r.priority !== undefined ? { priority: r.priority } : {}),
  provider: r.provider,
  purpose: r.purpose,
  /** `observe` means the transport publishes it; there is nothing to copy. */
  origin: r.origin ?? 'copy',
  match: r.match ?? 'exact',
  status,
  /** What resolved, so the screen can show found against expected. */
  found,
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
      origin: row.origin ?? 'copy',
      match: row.match_mode ?? 'exact',
    },
    row.status,
    row.last_checked_at,
    row.found,
  )

export { domains }
