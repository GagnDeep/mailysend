import { apiError, CreateDomainRequest, UpdateDomainRequest } from '@mailysend/contracts'
import { doName, kvKey, newId } from '@mailysend/core'
import type { DnsRequirement, Provider } from '@mailysend/providers'
import { z } from 'zod'
import { requireRole, requireScope } from '../auth.ts'
import type { Ctx } from '../context.ts'
import {
  buildProviderFor,
  buildRouter,
  decryptCredentials,
  recordsOnlyProvider,
  resolveDefaultProvider,
} from '../services/providers.ts'
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

  const provider = body.provider ?? (await defaultBinding(ctx))

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
      provider,
      now,
      now,
    )
    .run()

  const records = await requiredRecords(ctx, name, {
    selector,
    returnPath,
    dkimPublicKey: dkim.publicKey,
    provider,
  })
  await writeRecords(ctx, id, name, records)

  return json(
    {
      object: 'domain',
      id,
      name,
      status: 'not_started',
      region: body.region ?? 'global',
      created_at: now,
      custom_return_path: returnPath,
      provider,
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
              error, last_checked_at
         FROM domain_dns_records WHERE workspace_id = ? AND domain_id = ?
        ORDER BY record, name`,
    )
    .bind(ctx.workspace.id, row.id)
    .all<DnsRow>()

  const ready = readiness(records.results)

  return json({
    ...toDomain(row),
    records: records.results.map(fromDnsRow),
    ...ready,
    /**
     * Can this domain send, in one boolean.
     *
     * Not just `status`: `rollUpStatus` can read `verified` for a record set
     * that predates a transport rebind, and a domain whose DKIM does not
     * actually resolve is not a domain anybody should be told to send from.
     */
    sending_ready: row.status === 'verified' && ready.dkim_ready && ready.spf_ready,
    ...checkedSummary(records.results),
    receiving: await receivingState(ctx, row),
    last_send_error: await lastSendError(ctx, row.id),
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
    await writeRecords(ctx, row.id, row.name, records)
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
              found, error, last_checked_at
         FROM domain_dns_records WHERE workspace_id = ? AND domain_id = ?`,
    )
    .bind(ctx.workspace.id, row.id)
    .all<DnsRow & { id: string }>()

  const checkedAt = new Date().toISOString()
  const checked = await Promise.all(
    stored.results.map(async (record) => ({ record, ...(await checkRecord(record)) })),
  )

  /**
   * What the transport itself thinks, asked fresh.
   *
   * `ProviderIdentity.status()` has existed since identity was written and had
   * no caller anywhere, so a Cloudflare domain — which publishes its own records
   * and reports its own onboarding state — could only ever be judged by resolver
   * lookups against records Cloudflare had not written yet. Best-effort: a
   * transport that will not answer must not fail a verify.
   */
  let identity: { status: string; detail: string | null; external: unknown } | null = null
  try {
    const provider = row.provider
      ? await buildProviderFor(ctx.sql, ctx.workspace.id, row.provider as Provider['name'], ctx.env)
      : (await buildRouter(ctx.sql, ctx.workspace.id, ctx.env)).providers[0]
    if (provider?.identity) {
      const state = await provider.identity.status(row.name)
      identity = {
        status: state.status,
        detail: state.detail ?? null,
        external: state.external ?? null,
      }
    }
  } catch (err) {
    console.warn('[domains] the transport would not report its identity state', err)
  }

  await ctx.sql.batch(
    checked.map(({ record, status, found, error }) =>
      ctx.sql
        .prepare(
          `UPDATE domain_dns_records
              SET status = ?, found = ?, error = ?, last_checked_at = ? WHERE id = ?`,
        )
        .bind(status, found, error ?? null, checkedAt, record.id),
    ),
  )

  const status = rollUpStatus(checked.map((r) => r.status))
  const errored = checked.filter((r) => r.status === 'error')
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
  // The check has already been resolved and written by this point, so telling
  // the actor about it is a courtesy and not part of the answer. It used to be
  // able to fail the whole request — `.get()` throws synchronously, so it threw
  // before `background()` was ever called — and a verify that had succeeded
  // came back as "Something went wrong on our side."
  try {
    ctx.background(
      ctx.env.SENDING_DOMAIN.get(
        doName('SendingDomain', ctx.workspace.id, row.name),
      ).setVerification({
        status,
        checkedAt,
        records: checked.map(({ record, status: s }) => ({
          name: record.name,
          record: record.record,
          status: s,
        })),
      }),
    )
  } catch (err) {
    console.warn('[domains] could not hand the verification to the actor', err)
  }

  // The whole domain, not just the three fields that changed. A verify is the
  // one call a client makes expecting the object to be usable afterwards, and a
  // partial body here means every consumer needs a second GET to parse it.
  return json({
    ...toDomain({
      ...row,
      status,
      last_verified_at: status === 'verified' ? checkedAt : row.last_verified_at,
    }),
    records: checked.map(({ record, status: s, found, error }) =>
      fromDnsRow({ ...record, status: s, found, error: error ?? null, last_checked_at: checkedAt }),
    ),
    ...readiness(checked.map(({ record, status: s, found }) => ({ ...record, status: s, found }))),
    /**
     * How much of this answer is actually an answer. A verify that could look up
     * two of six records used to be indistinguishable from one that looked up
     * all six — the screen said `pending` either way and the reader had no
     * reason to suspect the resolver rather than their own zone.
     */
    ...(identity ? { identity } : {}),
    checked: {
      total: checked.length,
      resolved: checked.length - errored.length,
      errored: errored.length,
      ...(errored.length > 0 ? { first_error: errored[0]?.error ?? null } : {}),
    },
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
  // `every` over the matching rows, not `some`: a domain with two DKIM records
  // where one passes and one fails is not a domain with working DKIM, and
  // reporting it ready is how a half-published key reaches production.
  const verified = (predicate: (r: (typeof records)[number]) => boolean) => {
    const matching = records.filter(predicate)
    return matching.length > 0 && matching.every((r) => r.status === 'verified')
  }
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
 * The most recent send this domain could not complete.
 *
 * A permanent failure is otherwise invisible until somebody reads a log — which
 * includes the new "bound to a transport you have not configured" error, whose
 * whole point is that a person has to go and fix a setting. The domain page is
 * where that setting lives, so the failure belongs on it.
 */
async function lastSendError(ctx: Ctx, domainId: string) {
  const row = await ctx.sql
    .prepare(
      `SELECT id, provider, error_message, created_at
         FROM messages
        WHERE workspace_id = ? AND domain_id = ? AND environment = ?
          AND status = 'failed' AND error_message IS NOT NULL
        ORDER BY id DESC LIMIT 1`,
    )
    .bind(ctx.workspace.id, domainId, ctx.actor.environment)
    .first<{ id: string; provider: string | null; error_message: string; created_at: string }>()
  return row
    ? {
        email_id: row.id,
        provider: row.provider,
        error: row.error_message,
        at: row.created_at,
      }
    : null
}

/**
 * How much of the stored answer is actually an answer.
 *
 * The verify response has always carried this; a GET never did, so a page load
 * could not say "4 of 6 records resolve" and had to present a `pending` domain
 * as though nobody had ever looked. Derived from `domain_dns_records`, which
 * already stores `status`, `error` and `last_checked_at` per row, rather than
 * denormalised onto `domains` — a copy there would be a second truth that
 * `writeRecords` has to remember to clear, and forgetting is what produced the
 * stale `verified` this file has already been bitten by once.
 */
function checkedSummary(
  rows: { status: string; error?: string | null; last_checked_at: string | null }[],
) {
  // A row nobody has looked at is not a row that resolved.
  const looked = rows.filter((r) => r.last_checked_at !== null)
  const errored = looked.filter((r) => r.status === 'error')
  return {
    checked: {
      total: rows.length,
      resolved: looked.length - errored.length,
      errored: errored.length,
      ...(errored.length > 0 ? { first_error: errored[0]?.error ?? null } : {}),
    },
  }
}

/**
 * Everything the server honestly knows about receiving, as separate named facts.
 *
 * Deliberately not a boolean. Cloudflare's Email Routing catch-all rule is not
 * readable over its API, so the server can prove an MX points at Email Routing
 * and that mailboxes exist, and cannot prove that mail arrives. A
 * `receiving_ready` field would be a claim nothing here supports, so the gap is
 * named — `catch_all.observable: false` — and the operator confirms that one
 * step with their own eyes.
 *
 * No network I/O: the MX columns are whatever the last receiving check wrote.
 * Mailboxes are counted live, because a mailbox added a minute ago should not
 * have to wait on a DNS check to appear.
 */
async function receivingState(ctx: Ctx, row: DomainRow) {
  return {
    /** Null means nobody has looked yet, which is not the same as `pending`. */
    mx_status: row.receiving_mx_status,
    mx_found: row.receiving_mx_found,
    expected: '*.mx.cloudflare.net',
    checked_at: row.receiving_checked_at,
    mailboxes: await mailboxSummary(ctx, row.name),
    catch_all: {
      observable: false as const,
      detail:
        "Cloudflare's Email Routing catch-all rule is not readable over its API, so whether it is bound to this Worker can only be confirmed on the Email Routing page.",
    },
    /** The only end-to-end proof there is; everything else is configuration. */
    last_inbound_at: await lastInboundAt(ctx, row.name),
  }
}

/** When mail last actually landed for this domain, or null if it never has. */
async function lastInboundAt(ctx: Ctx, domain: string): Promise<string | null> {
  const hit = await ctx.sql
    .prepare(
      `SELECT at FROM mail_messages
        WHERE workspace_id = ? AND direction = 'in' AND environment = 'live'
          AND mailbox_id IN (SELECT id FROM inbound_mailboxes
                              WHERE workspace_id = ? AND (domain = ? OR address LIKE ?))
        ORDER BY at DESC LIMIT 1`,
    )
    .bind(ctx.workspace.id, ctx.workspace.id, domain, `%@${domain}`)
    .first<{ at: string }>()
  return hit?.at ?? null
}

/**
 * `POST /v1/domains/:id/receiving-check` — is this domain's MX pointed at us?
 *
 * Receiving has always been the half of a domain the product could not check.
 * `docs/RECEIVING.md` told the operator to resolve the MX by hand and compare
 * it to `*.mx.cloudflare.net`; nothing in the app did it, so "I bound the
 * catch-all and nothing arrived" had no first step. This is that step, and it
 * is pure observation — no API token, the same DoH resolver the sending checks
 * use, and the same four-word vocabulary.
 *
 * `error` is a real answer here, exactly as it is for sending records: a
 * resolver that would not answer is not a domain that failed.
 */
domains.post('/:id/receiving-check', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'domains:read')
  const row = await loadDomain(ctx, c.req.param('id'))

  const checkedAt = new Date().toISOString()

  let answers: DohAnswer[]
  try {
    answers = await resolve(row.name, 'MX')
  } catch (err) {
    // An `error` overwrites a previous `verified` on purpose: a resolver that
    // would not answer means we no longer know, and "we no longer know" is the
    // honest state to render.
    await rememberMx(ctx, row.id, 'error', null, checkedAt)
    return json({
      object: 'receiving_check',
      domain: row.name,
      status: 'error' as const,
      found: null,
      expected: '*.mx.cloudflare.net',
      checked_at: checkedAt,
      detail: `The MX lookup did not complete: ${err instanceof Error ? err.message : String(err)}. That is not evidence the domain is wrong — try again.`,
      mailboxes: await mailboxSummary(ctx, row.name),
    })
  }

  const exchanges = answers.map((a) => canonical(a.data.trim().split(/\s+/).pop() ?? a.data))
  const found = answers.map((a) => a.data.trim()).join(' | ') || null
  const cloudflare = exchanges.filter((e) => e.endsWith('mx.cloudflare.net'))

  const status =
    exchanges.length === 0 ? 'pending' : cloudflare.length > 0 ? 'verified' : ('failed' as const)

  const detail =
    status === 'verified'
      ? 'Cloudflare Email Routing is receiving for this domain. The remaining question is whether its catch-all rule is bound to this Worker — that part is zone-side and cannot be observed from here.'
      : status === 'pending'
        ? 'This domain publishes no MX at all, so nothing can deliver mail to it. Enable Email Routing on the zone and Cloudflare publishes the records itself.'
        : `This domain's mail is delivered somewhere else (${found}). Receiving through MailySend needs the MX pointed at Cloudflare Email Routing; changing it moves *all* mail for this domain.`

  await rememberMx(ctx, row.id, status, found, checkedAt)

  return json({
    object: 'receiving_check',
    domain: row.name,
    status,
    found,
    expected: '*.mx.cloudflare.net',
    checked_at: checkedAt,
    detail,
    mailboxes: await mailboxSummary(ctx, row.name),
  })
})

/**
 * Memoises the MX observation so the next page load starts from a fact.
 *
 * No cache bust: `resolveDomain` on the send path does not read these columns,
 * and busting for a receiving observation would throw away a hot sending row
 * for nothing.
 */
async function rememberMx(
  ctx: Ctx,
  domainId: string,
  status: 'pending' | 'verified' | 'failed' | 'error',
  found: string | null,
  checkedAt: string,
): Promise<void> {
  await ctx.sql
    .prepare(
      `UPDATE domains SET receiving_mx_status = ?, receiving_mx_found = ?,
              receiving_checked_at = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ?`,
    )
    .bind(status, found, checkedAt, checkedAt, domainId, ctx.workspace.id)
    .run()
}

/**
 * The other half of "why did nothing arrive": routing can be perfect and the
 * address still have nowhere to land. Reported together so the answer is one
 * screen rather than two.
 */
async function mailboxSummary(
  ctx: Ctx,
  domain: string,
): Promise<{ count: number; catch_all: string | null }> {
  const rows = await ctx.sql
    .prepare(
      `SELECT address, is_catch_all FROM inbound_mailboxes
        WHERE workspace_id = ? AND (domain = ? OR address LIKE ?)`,
    )
    .bind(ctx.workspace.id, domain, `%@${domain}`)
    .all<{ address: string; is_catch_all: number }>()
  const catchAll = rows.results.find((r) => r.is_catch_all)
  return { count: rows.results.length, catch_all: catchAll?.address ?? null }
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
      row.name,
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

  if (records.results.length === 0) {
    // Every Cloudflare record is `observe` — the transport publishes its own —
    // so this endpoint wrote nothing and still answered "Every record was
    // written", which the screen toasted as a success. There was no work here
    // and saying so is the honest answer.
    return json({
      object: 'domain_dns_automation',
      domain_id: row.id,
      zone_id: zoneId,
      written: [],
      refused: [],
      nothing_to_write: true,
      detail:
        'There are no records for us to write: this transport publishes its own, and we only check them. Finish the setup with the transport itself.',
    })
  }

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
    nothing_to_write: false,
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
 * The transport a domain created right now should be bound to.
 *
 * A new domain used to be created unbound, which made `requiredRecords()` union
 * every transport the router could yield — so the customer published records
 * authorising transports their mail would never leave through, and an apex SPF
 * that had to be merged to stay legal. Binding at create time to the transport
 * the workspace would *actually* send through makes the published records a true
 * statement about this domain's mail.
 *
 * The router comes first because it is the thing that will pick: a workspace
 * with SES configured sends through SES, and binding such a domain to Cloudflare
 * would publish Cloudflare's records and then pin the send to a transport the
 * router does not carry.
 *
 * A static `MS_DEFAULT_PROVIDER ?? 'cloudflare'` would be wrong for a concrete
 * reason worth writing down: with `MS_DEFAULT_PROVIDER=ses` and no SES keys it
 * binds `ses`, `requiredRecords()` filters the router to a name it does not
 * have, and the domain gets *zero* records — strictly worse than the union. The
 * `'cloudflare'` tail is safe only because `recordsOnlyProvider('cloudflare')`
 * is the one transport that yields records with no credentials.
 */
async function defaultBinding(ctx: Ctx): Promise<Provider['name']> {
  const router = await buildRouter(ctx.sql, ctx.workspace.id, ctx.env)
  const first = router.providers[0]?.name as Provider['name'] | undefined
  return first ?? (await resolveDefaultProvider(ctx.env)) ?? 'cloudflare'
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
  let active = chosen.length > 0 ? chosen : router.providers

  // Cloudflare is the default transport, so its records belong in the zone
  // whether or not this deployment can currently stand it up — see
  // `recordsOnlyProvider`. Without this, adding a domain before adding the
  // binding produced a record list that silently omitted the transport the mail
  // was actually going to leave through.
  if (!opts.provider || opts.provider === 'cloudflare') {
    if (!active.some((p) => p.name === 'cloudflare')) {
      const cloudflare = recordsOnlyProvider('cloudflare')
      if (cloudflare) active = [...active, cloudflare]
    }
  }

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

/**
 * Rewrites the record set, and invalidates the cached row that just became a lie.
 *
 * The bust lives here rather than at each call site because one call site
 * forgot it: `POST /:id/identity` reset `status` to `not_started` while
 * `accept.ts` went on reading a cached `verified` row from KV, so live sends
 * kept being accepted for up to 300 seconds against a domain whose records had
 * been thrown away. The domain name is a parameter for exactly that reason —
 * the cache key needs it, so the caller cannot omit the bust without also
 * failing to compile.
 */
async function writeRecords(
  ctx: Ctx,
  domainId: string,
  domainName: string,
  records: RequiredRecord[],
): Promise<void> {
  const statements = [
    // Every row is about to be re-inserted as `not_started`, so the domain's own
    // `verified` is now a claim about records that no longer exist. Leaving it
    // set is exactly the "it still says verified but the table below says
    // otherwise" the reader was looking at.
    ctx.sql
      .prepare(
        `UPDATE domains SET status = 'not_started', last_verified_at = NULL, updated_at = ?
          WHERE id = ? AND workspace_id = ?`,
      )
      .bind(new Date().toISOString(), domainId, ctx.workspace.id),
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
  ctx.background(ctx.cache.delete(kvKey.domain(ctx.workspace.id, domainName)))
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

/** The DoH `Status` values that mean the lookup itself did not succeed. */
const DOH_STATUS: Record<number, string> = {
  1: 'the resolver rejected the query (FORMERR)',
  2: "the domain's nameservers failed to answer (SERVFAIL)",
  4: 'the resolver does not implement this query type',
  5: 'the query was refused',
}

async function resolve(name: string, type: keyof typeof DNS_TYPES): Promise<DohAnswer[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`
  const response = await fetch(url, { headers: { accept: 'application/dns-json' } })
  // A non-200 used to become `[]`, which is the same value as "nothing is
  // published" — so an outage at the resolver read as a customer who had not
  // added the record yet. It throws now, and `checkRecord` reports `error`.
  if (!response.ok) {
    throw new Error(`the DNS resolver answered ${response.status}`)
  }
  const body = (await response.json()) as { Answer?: DohAnswer[]; Status?: number }
  // Likewise NXDOMAIN (3) is a real answer — the name does not exist — while
  // SERVFAIL and friends mean we learned nothing at all.
  const failure = body.Status !== undefined ? DOH_STATUS[body.Status] : undefined
  if (failure) throw new Error(failure)
  return (body.Answer ?? []).filter((a) => a.type === DNS_TYPES[type])
}

interface CheckResult {
  status: 'verified' | 'pending' | 'failed' | 'error'
  /**
   * What actually resolved, verbatim.
   *
   * `dns-records.tsx` has rendered a `found` against `expected` diff since the
   * component was written and the server has never sent one, so every failure
   * read as "wrong" with no way to see *how*. It is a trailing dot more often
   * than not.
   */
  found: string | null
  /** Why the lookup could not be made, when `status` is `error`. */
  error?: string | null
}

async function checkRecord(record: DnsRow): Promise<CheckResult> {
  let answers: DohAnswer[]
  try {
    answers = await resolve(record.name, record.record as keyof typeof DNS_TYPES)
  } catch (err) {
    // A resolver hiccup is still not evidence the customer did anything wrong —
    // but returning the record's *previous* `verified` laundered an error into a
    // pass, and a domain whose every row errored rolled up to `verified`. The
    // honest answer is that we do not know, and `error` is how that is said.
    return {
      status: 'error',
      found: null,
      error: err instanceof Error ? err.message : String(err),
    }
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

  const mode = record.match_mode ?? 'exact'

  if (record.record === 'MX') {
    // An MX answer is `<priority> <exchange>`. `canonical()` strips whitespace,
    // so splitting the canonical form on a space could never work — the raw
    // answer is where the exchange still is. A provider's `prefix` MX (a route
    // that lands on `<anything>.mx.cloudflare.net`) was dead for the same
    // reason: this branch ran before `match_mode` was read at all.
    const exchanges = raw.map((value) => canonical(value.trim().split(/\s+/).pop() ?? value))
    const ok =
      mode === 'prefix'
        ? exchanges.some((exchange) => exchange.endsWith(wanted) || wanted.endsWith(exchange))
        : exchanges.some((exchange) => exchange === wanted || exchange.endsWith(`.${wanted}`))
    return { status: ok ? 'verified' : 'failed', found: seen }
  }

  if (mode === 'include') {
    // SPF is one record per name, so a customer merging our include into their
    // existing record is doing the right thing — match on the include, not
    // equality. Every include we asked for has to be there.
    // Splitting on whitespace rather than a character class: the class excluded
    // `-`, so `include:smtp-relay.example.com` was truncated to `include:smtp`
    // and then substring-matched against the published record — a hyphenated
    // include always passed, whatever was actually there. `canonical()` has
    // already removed the whitespace, so the split is on the original value.
    const includes = record.value
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.startsWith('include:'))
      .map((token) => token.replace(/\.$/, ''))
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
  // A row we could not check is not a row that passed. `verified` requires that
  // every record was actually looked up and actually agreed — anything less is
  // still `pending`, which is the state that keeps the reader checking.
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
  /** Null means nobody has run a receiving check yet — not that one failed. */
  receiving_mx_status: string | null
  receiving_mx_found: string | null
  receiving_checked_at: string | null
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
  /** Why the last lookup could not be made, when `status` is `error`. */
  error?: string | null
  last_checked_at: string | null
}

async function loadDomain(ctx: Ctx, id: string): Promise<DomainRow> {
  const row = await ctx.sql
    .prepare(
      `SELECT id, name, status, region, dkim_selector, custom_return_path, open_tracking,
              click_tracking, tls, dmarc_policy, receiving_mx_status, receiving_mx_found,
              receiving_checked_at, learned_daily_quota, last_verified_at, provider,
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
  error: string | null = null,
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
  /** `dns-records.tsx` has read both of these since it was written. */
  expected: r.value,
  error,
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
    row.error ?? null,
  )

export { domains }
