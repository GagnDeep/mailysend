import {
  apiKeyPreview,
  DEFAULT_WORKSPACE,
  generateApiKey,
  hashApiKey,
  newId,
} from '@mailysend/core'
import { migrate } from '@mailysend/db'
import type { Sql } from '@mailysend/platform'
import { actorNamespace } from '@mailysend/platform/cloudflare'
import type { Env } from './env.ts'

/**
 * Making a deployment usable without being configured first.
 *
 * The one-click deploy hands us a Worker with bindings and nothing else: no
 * shell to run migrations in, no operator to paste a secret, and no chance to
 * ask a question before the first request arrives. Anything this file cannot
 * derive on its own becomes a form field somebody has to fill in before they
 * are allowed to see the product, which is the wrong order.
 *
 * So: migrations run on first touch, the workspace and its first API key are
 * created if absent, and the two values that genuinely cannot be defaulted —
 * the signing secret and the public URL — are generated and then *persisted*,
 * because a secret that regenerates per isolate invalidates every tracking
 * link and every session it ever signed.
 *
 * Setting `MS_SECRET` and `MS_PUBLIC_URL` explicitly is still the better
 * operational posture, and both win when present. This is what happens when
 * they are not.
 */

/** Instance-wide settings live under the empty workspace id. */
const INSTANCE = ''
const SECRET_KEY = 'instance_secret'
/** SHA-256 of the first-boot claim code. The code itself exists only in the log. */
export const CLAIM_CODE_KEY = 'instance_claim_code'
export const PUBLIC_URL_KEY = 'instance_public_url'

/**
 * Per-isolate memo, keyed by the database it was read from.
 *
 * These are deployment constants rather than request state, so caching them for
 * the life of the isolate is right. Keying on the `Sql` instance rather than a
 * bare module variable keeps two instances in one process — which is what the
 * tests are, and what a future multi-tenant router would be — from reading each
 * other's secret.
 */
const memos = new WeakMap<Sql, Map<string, string>>()
const readies = new WeakMap<Sql, Promise<void>>()

const memoFor = (sql: Sql): Map<string, string> => {
  const held = memos.get(sql)
  if (held) return held
  const made = new Map<string, string>()
  memos.set(sql, made)
  return made
}

const hex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

/**
 * Read-or-create, safe against two isolates racing on a cold deployment.
 *
 * `ON CONFLICT DO NOTHING` followed by a re-read means the loser of the race
 * adopts the winner's value instead of overwriting it — which matters here
 * more than anywhere else in the codebase, since the value being written is
 * what every existing signature was made with.
 */
async function instanceValue(sql: Sql, key: string, make: () => string): Promise<string> {
  const memo = memoFor(sql)
  const held = memo.get(key)
  if (held) return held

  const read = () =>
    sql
      .prepare('SELECT value FROM settings WHERE workspace_id = ? AND key = ?')
      .bind(INSTANCE, key)
      .first<{ value: string | null }>()

  const existing = await read()
  if (existing?.value) {
    memo.set(key, existing.value)
    return existing.value
  }

  await sql
    .prepare(
      `INSERT INTO settings (workspace_id, key, value, updated_at) VALUES (?,?,?,?)
       ON CONFLICT (workspace_id, key) DO NOTHING`,
    )
    .bind(INSTANCE, key, make(), new Date().toISOString())
    .run()

  const stored = await read()
  const value = stored?.value ?? make()
  memo.set(key, value)
  return value
}

/**
 * Migrations plus the first workspace and API key.
 *
 * On Node this runs at boot; on Workers it runs on the first request of the
 * first isolate. Both are idempotent — `migrate` skips what `_migrations`
 * already lists, and the workspace insert is guarded by a read — so running it
 * on every cold start costs one indexed lookup.
 */
export async function ensureInstance(env: Env): Promise<void> {
  let ready = readies.get(env.DB)
  if (!ready) {
    ready = (async () => {
      await migrate(env.DB)
      await ensureWorkspace(env)
      await adoptExistingOwner(env)
    })()
    readies.set(env.DB, ready)
  }
  await ready
}

async function ensureWorkspace(env: Env): Promise<void> {
  const existing = await env.DB.prepare('SELECT id FROM workspaces WHERE id = ?')
    .bind(DEFAULT_WORKSPACE)
    .first<{ id: string }>()
  if (existing) return

  const now = new Date().toISOString()
  await env.DB.prepare(
    'INSERT INTO workspaces (id, name, slug, plan, created_at) VALUES (?,?,?,?,?)',
  )
    .bind(DEFAULT_WORKSPACE, 'MailySend', 'default', 'self_hosted', now)
    .run()

  const token = generateApiKey('live')
  await env.DB.prepare(
    `INSERT INTO api_keys (id, workspace_id, name, token_hash, token_preview, environment, permission, created_at)
     VALUES (?,?,?,?,?,'live','full_access',?)`,
  )
    .bind(
      newId('apiKey'),
      DEFAULT_WORKSPACE,
      'Bootstrap key',
      await hashApiKey(token),
      apiKeyPreview(token),
      now,
    )
    .run()

  // The claim code is opt-in, and off by default.
  //
  // It closes a real window — between a deployment answering its first request
  // and its operator reaching `/setup`, whoever has the URL can claim it — and
  // for a deployment on a URL that is public before its operator gets there,
  // `MS_REQUIRE_CLAIM_CODE=1` is the right answer. But it is not the common
  // case, and as a default it cost every operator the same thing: a code that
  // exists only in a log line, needed at the one moment they are least likely
  // to be reading logs, on a Worker whose log retention may already have
  // dropped it. Two locks on one door, and the one people lost was the one
  // nobody chose.
  //
  // So the default is an open claim, closed by the first person to reach
  // `/setup` — which on a fresh deploy is the operator, seconds later. The two
  // narrower guarantees stay available and are documented together in
  // `docs/AUTH.md`: `MS_OWNER_EMAIL` reserves the claim for one address, and
  // `MS_REQUIRE_CLAIM_CODE` mints the code below.
  const wantsCode = requireClaimCode(env.MS_REQUIRE_CLAIM_CODE) && !env.MS_OWNER_EMAIL
  const claimCode = wantsCode ? claimCodeString() : null
  if (claimCode) {
    await env.DB.prepare(
      'INSERT INTO settings (workspace_id, key, value, updated_at) VALUES (?,?,?,?)',
    )
      .bind(INSTANCE, CLAIM_CODE_KEY, await hashApiKey(claimCode), now)
      .run()
  }

  // The only time these strings exist anywhere but in the operator's hands:
  // the table stores their SHA-256 and nothing else. On Workers they land in
  // `wrangler tail` and the dashboard's live logs.
  console.log('\n  MailySend is set up. Your first API key — this is the only time it is shown:\n')
  console.log(`      ${token}\n`)
  if (claimCode) {
    console.log('  Your claim code — /setup asks for this before it will let anyone in:\n')
    console.log(`      ${claimCode}\n`)
    console.log(
      '  Open /setup, enter the code above and create a passkey. You asked for this\n' +
        '  with MS_REQUIRE_CLAIM_CODE, and it is what makes claiming safe even if the\n' +
        '  URL is public before you get there.\n' +
        '  Lost it? `npx mailysend claim` writes a fresh nonce straight into this\n' +
        '  database and is the break-glass path back in.\n',
    )
  } else {
    console.log(
      '  Open /setup and create a passkey. This deployment is unclaimed, and the\n' +
        '  first person to reach /setup takes it — so claim it now rather than later.\n' +
        (env.MS_OWNER_EMAIL
          ? `  Only ${env.MS_OWNER_EMAIL} may claim it (MS_OWNER_EMAIL is set).\n`
          : '  To hold the claim for a URL that is public before you get to it, set\n' +
            '  MS_OWNER_EMAIL to reserve it for one address, or MS_REQUIRE_CLAIM_CODE=1\n' +
            '  to mint a code here that /setup will ask for.\n') +
        '  Locked out later? `npx mailysend claim` writes a fresh nonce straight into\n' +
        '  this database and is the break-glass path back in.\n',
    )
  }
}

/**
 * Is the first-boot claim code switched on?
 *
 * Written out rather than a truthiness check because the values that reach it
 * are strings from a deploy form, and `MS_REQUIRE_CLAIM_CODE=0` or `=false`
 * meaning "on" is the kind of surprise that only shows up in an incident.
 */
export const requireClaimCode = (value?: string): boolean =>
  value !== undefined && ['1', 'true', 'yes', 'on', 'required'].includes(value.trim().toLowerCase())

/**
 * A code a human reads off a log and types into a form.
 *
 * Crockford's alphabet minus the letters that a terminal font and a tired
 * operator disagree about, in three groups of four — 60 bits, which is far more
 * than a code that lives until the first claim needs, and still shorter than
 * anything anyone would paste rather than read.
 */
const CLAIM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'

const claimCodeString = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  const chars = Array.from(bytes, (b) => CLAIM_CODE_ALPHABET[b % CLAIM_CODE_ALPHABET.length])
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)]
    .map((group) => group.join(''))
    .join('-')
}

/**
 * Does `/setup` need a claim code?
 *
 * Four answers now, and only one of them asks. A deployment that did not opt in
 * with `MS_REQUIRE_CLAIM_CODE` is never asked — including one that booted while
 * the code was the default and still carries the row, which is the case that
 * makes this a live switch rather than a first-boot decision: turning it off
 * has to actually let the operator in. A deployment with `MS_OWNER_EMAIL` set
 * is already narrowed to one address, and asking for both would be two locks on
 * the same door. A deployment that predates the code has no row. Everything
 * else asks.
 */
export const claimCodeRequired = async (
  sql: Sql,
  ownerEmail?: string,
  requireCode?: string,
): Promise<boolean> => {
  if (ownerEmail) return false
  if (!requireClaimCode(requireCode)) return false
  return (await readInstanceSetting(sql, CLAIM_CODE_KEY)) !== null
}

/** Constant-time-ish comparison against the stored hash. Returns false if unset. */
export const claimCodeMatches = async (sql: Sql, code: string): Promise<boolean> => {
  const stored = await readInstanceSetting(sql, CLAIM_CODE_KEY)
  if (!stored) return true
  const given = await hashApiKey(code.trim().toUpperCase().replace(/\s/g, ''))
  if (given.length !== stored.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i += 1) diff |= given.charCodeAt(i) ^ stored.charCodeAt(i)
  return diff === 0
}

/**
 * An instance that already had an owner before the claim flow existed is
 * claimed, and must not be offered to whoever finds the URL next.
 *
 * The alternative — treating "no claim row" as "unclaimed" — would turn an
 * upgrade into a takeover window on every deployment that predates this
 * migration. A deployment with no member at all stays unclaimed, which is
 * exactly the case `/setup` exists for: the many instances nobody ever managed
 * to sign into.
 */
async function adoptExistingOwner(env: Env): Promise<void> {
  if (await isClaimed(env.DB)) return
  const member = await env.DB.prepare('SELECT user_id FROM memberships LIMIT 1').first<{
    user_id: string
  }>()
  if (!member) return
  await claimInstance(env.DB)
}

/**
 * Fill in what was not configured.
 *
 * `request` is present on the fetch path and absent on the queue, email and
 * cron paths — which is why the resolved public URL is written to `settings`:
 * a broadcast rendered by a queue consumer has to mint the same tracking links
 * a request would have, and it has no request to learn the origin from.
 *
 * The env object is updated in place as well as returned. On Workers that is a
 * per-isolate object holding deployment constants, so the write is idempotent;
 * on Node it is the single shared binding object the queue consumers were
 * registered with, and updating it is the only way a consumer learns the origin
 * that the first real request revealed.
 */
export async function configure(env: Env, request?: Request): Promise<Env> {
  await ensureInstance(env)

  const secret = env.MS_SECRET || (await instanceValue(env.DB, SECRET_KEY, () => hex(32)))
  const origin = request ? new URL(request.url).origin : ''

  // Order of preference: what the operator pinned, what a previous request
  // stored, the origin of this request, and only then a localhost guess.
  let publicUrl =
    pinnedPublicUrl(env) || memoFor(env.DB).get(PUBLIC_URL_KEY) || (await storedPublicUrl(env))

  // A deployment first reached on workers.dev and later on a custom domain
  // would otherwise keep minting workers.dev links forever. Local origins are
  // never stored, so a development request cannot poison a real deployment.
  if (
    !pinnedPublicUrl(env) &&
    origin &&
    !isLocal(origin) &&
    origin !== publicUrl &&
    // Both guards below only cost a read when the origin actually differs from
    // what is stored, which happens on a host change and then never again.
    !isVanityRegression(origin, publicUrl) &&
    !(await isUrlPinned(env.DB))
  ) {
    const now = new Date().toISOString()
    const statements = [
      env.DB.prepare(
        `INSERT INTO settings (workspace_id, key, value, updated_at) VALUES (?,?,?,?)
         ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(INSTANCE, PUBLIC_URL_KEY, origin, now),
    ]
    // Remember where we moved from. A passkey is bound to the hostname it was
    // created on, so a host change does not degrade sign-in — it breaks it, and
    // silently. Recording the old origin is what lets the dashboard say *which*
    // host the existing passkeys belong to instead of showing a login that just
    // never succeeds.
    if (publicUrl) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO settings (workspace_id, key, value, updated_at) VALUES (?,?,?,?)
           ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).bind(INSTANCE, PREVIOUS_URL_KEY, publicUrl, now),
      )
    }
    await env.DB.batch(statements)
    memoFor(env.DB).set(PUBLIC_URL_KEY, origin)
    publicUrl = origin
  }

  if (!publicUrl) publicUrl = origin || 'http://localhost:8917'

  // Defaulted here rather than pinned in `wrangler.jsonc`, because a var in that
  // file overwrites the value the operator typed into the deploy form on every
  // subsequent build — the form stores its answers as secrets, and vars win.
  const mode = env.MS_MODE ?? 'single'

  // What `/` serves. A self-hosted instance is a dashboard, not a shop window,
  // so the marketing site is not what its operator wants at the root — but
  // mailysend.com runs the same build in the same mode, which is why this is a
  // switch with a mode-derived default rather than a hardcoded rule.
  const landing = env.MS_LANDING ?? (mode === 'single' ? 'app' : 'marketing')

  const actors = adaptActors(env)

  try {
    env.MS_SECRET = secret
    env.MS_PUBLIC_URL = publicUrl
    env.MS_MODE = mode
    env.MS_LANDING = landing
    Object.assign(env, actors)
    return env
  } catch {
    // A frozen env is not something any runtime does today, but a copy is a
    // correct answer and a thrown TypeError is not.
    return {
      ...env,
      MS_SECRET: secret,
      MS_PUBLIC_URL: publicUrl,
      MS_MODE: mode,
      MS_LANDING: landing,
      ...actors,
    }
  }
}

/** Every binding the application addresses by name rather than by id. */
const ACTOR_BINDINGS = [
  'SENDING_DOMAIN',
  'BROADCAST',
  'BROADCAST_COUNTER',
  'WEBHOOK_ENDPOINT',
  'SCHEDULE_SHARD',
  'MAILBOX',
  'SEGMENT',
  'AUTOMATION_COHORT',
  'AUTOMATION_RUN',
  'WORKSPACE_HUB',
] as const satisfies readonly (keyof Env)[]

/**
 * Names into Durable Object ids, on the one runtime that needs it.
 *
 * Every actor in MailySend is a singleton for some key — a domain, a mailbox, a
 * workspace — so the whole codebase addresses them by a name from `doName()`.
 * The Node registry takes those names directly, which is why the entire test
 * suite passes; a real `DurableObjectNamespace` does not, and answers
 * `env.WORKSPACE_HUB.get('WorkspaceHub:ws_…')` with
 * "parameter 1 is not of type 'DurableObjectId'". `actorNamespace()` was
 * written for exactly this and had no caller anywhere, so on Workers every
 * actor call site threw — a failed send whose reason was a type error about a
 * parameter, reported through the honest failure surface as `unknown`.
 *
 * The check is the presence of `idFromName`: a raw namespace has it, an already
 * wrapped one does not, and the Node registry does not either — so this is safe
 * to run on every request, which is what `configure()` does.
 */
function adaptActors(env: Env): Partial<Env> {
  const patch: Record<string, unknown> = {}
  for (const binding of ACTOR_BINDINGS) {
    const held = env[binding] as { idFromName?: unknown } | undefined
    if (held && typeof held.idFromName === 'function') {
      patch[binding] = actorNamespace(held as never)
    }
  }
  return patch as Partial<Env>
}

/**
 * What the operator set, as opposed to what a previous request derived.
 *
 * `configure` writes the resolved URL back into `env`, so the raw value has to
 * be captured before that ever happens — otherwise the second call would read
 * its own answer and treat a derived origin as a pinned one.
 */
const pinnedPublicUrl = (env: Env): string => {
  if (!pinned.has(env)) pinned.set(env, env.MS_PUBLIC_URL ?? '')
  return pinned.get(env) ?? ''
}
const pinned = new WeakMap<Env, string>()

const isLocal = (origin: string): boolean =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(origin)

/**
 * Moving *back* to the deploy-time hostname is not a move.
 *
 * `*.workers.dev` keeps answering after a custom domain is attached, so a
 * health check or an old bookmark hitting it would otherwise drag the whole
 * instance back — re-minting every tracking link on a hostname the operator
 * has stopped using, and invalidating passkeys a second time. A custom domain
 * is only ever left deliberately, which is what `PUT /v1/workspace/instance-domain`
 * is for.
 */
const isVanity = (origin: string): boolean => /\.workers\.dev$/.test(new URL(origin).hostname)

const isVanityRegression = (origin: string, current: string): boolean =>
  Boolean(current) && isVanity(origin) && !isVanity(current)

/** Set by an explicit instance-domain change; stops the learning entirely. */
export const PUBLIC_URL_PINNED_KEY = 'instance_public_url_pinned'

const isUrlPinned = async (sql: Sql): Promise<boolean> => {
  const row = await sql
    .prepare('SELECT value FROM settings WHERE workspace_id = ? AND key = ?')
    .bind(INSTANCE, PUBLIC_URL_PINNED_KEY)
    .first<{ value: string | null }>()
  return row?.value === '1'
}

const storedPublicUrl = async (env: Env): Promise<string> => {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE workspace_id = ? AND key = ?')
    .bind(INSTANCE, PUBLIC_URL_KEY)
    .first<{ value: string | null }>()
  if (row?.value) memoFor(env.DB).set(PUBLIC_URL_KEY, row.value)
  return row?.value ?? ''
}

// ---------------------------------------------------------------------------
// Instance-wide settings
// ---------------------------------------------------------------------------

/** The settings key that says this deployment has an owner. */
export const CLAIMED_KEY = 'instance_claimed_at'
/** Set when the learned public URL moves, so the UI can explain broken passkeys. */
export const PREVIOUS_URL_KEY = 'instance_previous_public_url'
/** The last error the send path produced, surfaced on `/v1/instance`. */
export const LAST_SEND_ERROR_KEY = 'instance_last_send_error'

export async function readInstanceSetting(sql: Sql, key: string): Promise<string | null> {
  const row = await sql
    .prepare('SELECT value FROM settings WHERE workspace_id = ? AND key = ?')
    .bind(INSTANCE, key)
    .first<{ value: string | null }>()
  return row?.value ?? null
}

export async function writeInstanceSetting(sql: Sql, key: string, value: string): Promise<void> {
  await sql
    .prepare(
      `INSERT INTO settings (workspace_id, key, value, updated_at) VALUES (?,?,?,?)
       ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(INSTANCE, key, value, new Date().toISOString())
    .run()
  memoFor(sql).delete(key)
}

/**
 * Claims the instance, exactly once.
 *
 * The whole first-run design rests on this being atomic. Two people opening
 * `/setup` on a fresh deployment at the same moment must not both become the
 * owner, and a `SELECT` followed by an `INSERT` cannot promise that on D1 —
 * there is no transaction spanning the two. `INSERT … WHERE NOT EXISTS` is one
 * statement, so the loser writes zero rows and is told the instance is already
 * claimed.
 */
export async function claimInstance(sql: Sql, at = new Date().toISOString()): Promise<boolean> {
  const result = await sql
    .prepare(
      `INSERT INTO settings (workspace_id, key, value, updated_at)
       SELECT ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM settings WHERE workspace_id = ? AND key = ?)`,
    )
    .bind(INSTANCE, CLAIMED_KEY, at, at, INSTANCE, CLAIMED_KEY)
    .run()
  const changes = (result as { meta?: { changes?: number } }).meta?.changes
  // A driver that does not report `changes` is not a licence to guess: read
  // back and compare, which is correct either way and costs one indexed lookup
  // on a path that runs once in the life of a deployment.
  if (typeof changes === 'number') return changes > 0
  return (await readInstanceSetting(sql, CLAIMED_KEY)) === at
}

/**
 * Has this deployment got an owner?
 *
 * Read on every `/` and `/app` request, so the `true` answer is memoised for
 * the life of the isolate — a claim is a one-way door in every path but the
 * rollback inside `/v1/setup/claim/verify`, and that one runs before any of
 * this could have cached it. `false` is never cached, because the whole point
 * is that it is about to change.
 */
const claimed = new WeakSet<Sql>()

export const isClaimed = async (sql: Sql): Promise<boolean> => {
  if (claimed.has(sql)) return true
  const value = await readInstanceSetting(sql, CLAIMED_KEY)
  if (value) claimed.add(sql)
  return value !== null
}
