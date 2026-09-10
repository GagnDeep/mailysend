import { apiError } from '@mailysend/contracts'
import {
  DEFAULT_WORKSPACE,
  hashApiKey,
  newId,
  normalizeRecoveryCode,
  timingSafeEqual,
} from '@mailysend/core'
import type { Sql } from '@mailysend/platform'
import { z } from 'zod'
import { buildContext, tenancyFor } from '../context.ts'
import { background, getEnv } from '../env.ts'
import { acceptEmail } from '../send/accept.ts'
import {
  clientIp,
  issueSession,
  normalizeEmail,
  SESSION_TTL_MS,
  sessionCookie,
  sessionResponse,
} from '../session.ts'
import { createRouter } from './base.ts'
import { device } from './device.ts'
import { passkeys } from './passkeys.ts'

/**
 * Dashboard sign-in.
 *
 * Deliberately not a password store. A self-hosted email platform that invents
 * its own password database is adding the one credential most likely to be
 * reused and leaked, to protect a dashboard that already sits behind whatever
 * the operator put in front of it. The ways in, in the order a person meets
 * them:
 *
 *   - **A passkey**, in `passkeys.ts`. The default, and the only credential a
 *     brand-new deployment can create for itself: no email, no DNS, no identity
 *     provider. This is what `/setup` claims the instance with.
 *   - **A recovery code**, also in `passkeys.ts`. Ten, issued once at claim
 *     time, for the day the device with the passkey is gone.
 *   - **Cloudflare Access.** The identity is already proven at the edge; we
 *     verify the assertion and mint a session. Offered only when the deployment
 *     actually has `MS_ACCESS_TEAM` and `MS_ACCESS_AUD` — `/v1/instance` says
 *     so, and the sign-in page renders the button from that answer rather than
 *     from hope.
 *   - **A one-time code, emailed through the deployment's own send path.**
 *     Dogfooding, and only possible once a sending domain is verified — which
 *     is why it is no longer the bootstrap path it was originally written as.
 *   - **A device code**, in `device.ts`, for the CLI.
 *
 * Every response here is deliberately uniform about whether an address exists.
 * A sign-in form that answers "no such user" is a membership oracle for anyone
 * who wants to know who runs this instance.
 */
export const auth = createRouter()

auth.route('/passkey', passkeys)
auth.route('/device', device)

/** Six digits. Long enough with five attempts and a ten-minute window. */
const CODE_TTL_MS = 10 * 60_000
const MAX_ATTEMPTS = 5
/** Per address, per hour. Generous for a human, useless for spraying an inbox. */
const MAX_CODES_PER_HOUR = 10
/** Per source address, per hour. The address bucket alone does not bound a script. */
const MAX_CODES_PER_IP_PER_HOUR = 30

const StartBody = z.object({ email: z.string().trim().email().max(320) })
const VerifyBody = z.object({
  email: z.string().trim().email().max(320),
  code: z.string().regex(/^\d{6}$/, 'must be six digits'),
})

/** Crypto-random, uniform over 000000-999999 — not `Math.random()`. */
function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1))
  return String(bytes[0]! % 1_000_000).padStart(6, '0')
}

/**
 * Which workspace an address belongs to.
 *
 * Read-only, unlike `resolveUser`: the code request must not create an account
 * as a side effect, or requesting a code for an address becomes a way to make
 * one exist.
 */
async function workspaceForEmail(sql: Sql, email: string): Promise<string | null> {
  const row = await sql
    .prepare(
      `SELECT m.workspace_id FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE u.email = ? ORDER BY m.created_at LIMIT 1`,
    )
    .bind(email)
    .first<{ workspace_id: string }>()
  return row?.workspace_id ?? null
}

/**
 * The domain auth mail is sent from.
 *
 * `ORDER BY created_at LIMIT 1` — which this used to be — means the oldest
 * domain ever added silently becomes the identity of every sign-in email, and
 * stays that way after it is retired. So an explicit choice wins, and the
 * oldest verified domain is only the fallback for an instance that never made
 * one.
 */
export async function defaultSendingDomain(
  sql: Sql,
  workspaceId: string,
): Promise<{ id: string; name: string } | null> {
  const chosen = await sql
    .prepare(`SELECT value FROM settings WHERE workspace_id = ? AND key = 'default_sending_domain'`)
    .bind(workspaceId)
    .first<{ value: string | null }>()
  // Written raw by `PUT /v1/workspace/sending-domain`, but the generic settings
  // patch JSON-encodes what it stores — so tolerate both rather than silently
  // failing to find a domain whose id arrived wrapped in quotes.
  const chosenId = chosen?.value?.replace(/^"|"$/g, '')
  if (chosenId) {
    const row = await sql
      .prepare(
        `SELECT id, name FROM domains WHERE workspace_id = ? AND id = ? AND status = 'verified'`,
      )
      .bind(workspaceId, chosenId)
      .first<{ id: string; name: string }>()
    if (row) return row
  }
  const oldest = await sql
    .prepare(
      `SELECT id, name FROM domains
        WHERE workspace_id = ? AND status = 'verified'
        ORDER BY created_at LIMIT 1`,
    )
    .bind(workspaceId)
    .first<{ id: string; name: string }>()
  return oldest ?? null
}

/**
 * Sends the code, or says it could not.
 *
 * The return value is a *global* fact — this deployment has, or has not, a
 * verified sending domain — never a per-address one. `/otp` passes it straight
 * to the caller, which is safe precisely because it does not depend on who
 * asked, and is the difference between "check your inbox" and an inbox that
 * will never receive anything.
 */
async function deliverCode(
  workspaceId: string,
  email: string,
  code: string,
): Promise<'sent' | 'logged' | 'unavailable'> {
  const env = getEnv()
  const tenancy = tenancyFor(env)
  const sql = tenancy.db(workspaceId)
  const domain = await defaultSendingDomain(sql, workspaceId)

  const isOwner = env.MS_OWNER_EMAIL && normalizeEmail(env.MS_OWNER_EMAIL) === email
  if (!domain) {
    if (isOwner) {
      // Narrow on purpose: only `MS_OWNER_EMAIL`, and only while nothing can be
      // sent. On a self-hosted box the process log is a place only the operator
      // can read. It is no longer the *only* way in — `/setup` and
      // `mailysend claim` both exist now — so this is a convenience, not the
      // bootstrap it once had to be.
      console.log(
        `\n  Sign-in code for ${email}: ${code}\n` +
          '  (shown here because no sending domain is verified yet)\n',
      )
      return 'logged'
    }
    return 'unavailable'
  }

  const ctx = await buildContext(
    env,
    { workspaceId, environment: 'live', scopes: ['*'] },
    background,
  )
  await acceptEmail(ctx, {
    from: `MailySend <security@${domain.name}>`,
    to: [email],
    subject: `${code} is your MailySend sign-in code`,
    text:
      `Your sign-in code is ${code}.\n\n` +
      'It expires in ten minutes and can be used once. ' +
      'If you did not ask for it, someone has your email address and nothing else — ' +
      'no action is needed.\n',
    // A sign-in code that lands in an engagement report is a privacy leak and a
    // deliverability problem; neither tracking pixel belongs on it.
    tags: [{ name: 'kind', value: 'login_code' }],
  })
  return 'sent'
}

/**
 * `POST /v1/auth/otp` — ask for a code.
 *
 * Always 202, and the body never varies with the address: whether the account
 * exists, whether it is suppressed, whether the code was logged rather than
 * sent — none of it is observable. What *is* reported is whether this
 * deployment can send mail at all, which is a property of the deployment and
 * already visible on `/v1/instance`.
 */
auth.post('/otp', async (c) => {
  const env = getEnv()
  const body = StartBody.parse(await c.req.json())
  const email = normalizeEmail(body.email)
  const sql = tenancyFor(env).db('')
  const now = Date.now()
  const hourAgo = new Date(now - 60 * 60_000).toISOString()

  const workspaceId = (await workspaceForEmail(sql, email)) ?? DEFAULT_WORKSPACE

  // Both caps are checked *before* anything is invalidated. The original order
  // consumed the live code first and then declined to issue a replacement,
  // which turned a rate limit into a way to lock somebody out of their own
  // sign-in for an hour while reporting success.
  const [perAddress, perIp] = await Promise.all([
    sql
      .prepare('SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?')
      .bind(email, hourAgo)
      .first<{ n: number }>(),
    sql
      .prepare('SELECT COUNT(*) AS n FROM login_codes WHERE ip = ? AND created_at > ?')
      .bind(clientIp(c.req.raw), hourAgo)
      .first<{ n: number }>(),
  ])

  if ((perAddress?.n ?? 0) >= MAX_CODES_PER_HOUR || (perIp?.n ?? 0) >= MAX_CODES_PER_IP_PER_HOUR) {
    // Still 202, still the same shape: a caller that can tell "rate limited"
    // from "sent" can tell which addresses are real by watching which ones a
    // burst locks out.
    return Response.json({ object: 'login_code', status: 'sent' }, { status: 202 })
  }

  // One live code per address. Requesting a second invalidates the first, so a
  // stolen older code cannot be used after the real user asks for a new one.
  await sql
    .prepare('UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL')
    .bind(new Date(now).toISOString(), email)
    .run()

  const code = newCode()
  await sql
    .prepare(
      `INSERT INTO login_codes (id, email, code_hash, expires_at, ip, created_at) VALUES (?,?,?,?,?,?)`,
    )
    .bind(
      newId('loginCode'),
      email,
      await hashApiKey(`${email}:${code}`),
      new Date(now + CODE_TTL_MS).toISOString(),
      clientIp(c.req.raw),
      new Date(now).toISOString(),
    )
    .run()

  let status: 'sent' | 'logged' | 'unavailable'
  try {
    status = await deliverCode(workspaceId, email, code)
  } catch (err) {
    // Unguarded, this was a membership oracle: a suppressed requester made
    // `acceptEmail` throw `recipient_suppressed`, so the uniform 202 became a
    // 403 for exactly the addresses that had previously received mail. Sending
    // failures belong in the log and on `/v1/instance`, not in this response.
    console.error('[auth] could not deliver login code', err)
    status = 'sent'
  }

  return Response.json(
    { object: 'login_code', status: status === 'unavailable' ? 'unavailable' : 'sent' },
    { status: 202 },
  )
})

/** `POST /v1/auth/session` — exchange a code for a session cookie. */
auth.post('/session', async (c) => {
  const env = getEnv()
  const body = VerifyBody.parse(await c.req.json())
  const email = normalizeEmail(body.email)
  const sql = tenancyFor(env).db('')
  const now = new Date()

  const row = await sql
    .prepare(
      `SELECT id, code_hash, attempts FROM login_codes
        WHERE email = ? AND consumed_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(email, now.toISOString())
    .first<{ id: string; code_hash: string; attempts: number }>()
  if (!row || row.attempts >= MAX_ATTEMPTS) throw apiError('invalid_login_code')

  // Constant-time. `!==` on a hash leaks its prefix through timing, and a
  // six-digit code has little enough entropy that narrowing it matters.
  if (!timingSafeEqual(row.code_hash, await hashApiKey(`${email}:${body.code}`))) {
    // Counted on the row, not in memory: five wrong guesses burn this code
    // whether they arrive on one connection or fifty.
    await sql
      .prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?')
      .bind(row.id)
      .run()
    throw apiError('invalid_login_code')
  }

  await sql
    .prepare(`UPDATE login_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`)
    .bind(now.toISOString(), row.id)
    .run()

  const user = await resolveUser(sql, email, env.MS_MODE)
  if (!user) throw apiError('invalid_login_code')

  const token = await issueSession(sql, user.id, user.workspaceId, c.req.raw)
  return sessionResponse(token, user.workspaceId, env.MS_PUBLIC_URL)
})

/**
 * `POST /v1/auth/recovery` — spend a recovery code for a session.
 *
 * The answer to "the laptop with the passkey is gone", and the reason removing
 * your last passkey is allowed at all. Single-use, enforced in the UPDATE, and
 * rate-limited by source address for the same reason the code form is: twenty
 * characters is a lot of entropy, but not if you are allowed unlimited guesses.
 */
auth.post('/recovery', async (c) => {
  const env = getEnv()
  const sql = tenancyFor(env).db('')
  const body = z.object({ code: z.string().min(8).max(64) }).parse(await c.req.json())

  const { spendRecoveryCode } = await import('../webauthn.ts')
  const spent = await spendRecoveryCode(sql, normalizeRecoveryCode(body.code))
  if (!spent) throw apiError('invalid_login_code', { message: 'That recovery code is not valid.' })

  const token = await issueSession(sql, spent.userId, spent.workspaceId, c.req.raw)
  return sessionResponse(token, spent.workspaceId, env.MS_PUBLIC_URL)
})

/**
 * Finds or creates the user, and makes sure they belong somewhere.
 *
 * On an unclaimed self-hosted instance the first person through the door is the
 * owner; there is nobody to invite them. Once `/setup` has run, `instance_claimed_at`
 * exists and this stops creating accounts — a claimed instance invites people,
 * it does not enrol whoever asks for a code. On a hosted one, `memberships` is
 * written by the invite flow and this only ever finds what is already there.
 */
export async function resolveUser(
  sql: Sql,
  email: string,
  mode: 'single' | 'saas',
  opts: { create?: boolean } = {},
): Promise<{ id: string; workspaceId: string } | null> {
  const now = new Date().toISOString()
  const existing = await sql
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()

  const { isClaimed } = await import('../bootstrap.ts')
  const create = opts.create ?? (mode === 'single' && !(await isClaimed(sql)))

  let userId = existing?.id
  if (!userId) {
    if (!create) return null
    userId = newId('user')
    await sql
      .prepare(
        'INSERT INTO users (id, email, name, email_verified_at, created_at) VALUES (?,?,?,?,?)',
      )
      .bind(userId, email, null, now, now)
      .run()
  }

  const membership = await sql
    .prepare('SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1')
    .bind(userId)
    .first<{ workspace_id: string }>()
  if (membership) return { id: userId, workspaceId: membership.workspace_id }

  if (!create) return null
  await sql
    .prepare(
      `INSERT INTO memberships (workspace_id, user_id, role, created_at)
       VALUES (?,?,'owner',?)
       ON CONFLICT DO NOTHING`,
    )
    .bind(DEFAULT_WORKSPACE, userId, now)
    .run()
  return { id: userId, workspaceId: DEFAULT_WORKSPACE }
}

/**
 * `POST /v1/auth/access` — trade a Cloudflare Access assertion for a session.
 *
 * The JWT is verified properly — signature against the team's published keys,
 * `iss` against the team domain, `aud` against this application's tag,
 * `exp`/`iat` against the clock. Reading the email out of an unverified token
 * would let anyone with a text editor sign in as anyone.
 */
auth.post('/access', async (c) => {
  const env = getEnv()
  if (!env.MS_ACCESS_TEAM || !env.MS_ACCESS_AUD) {
    throw apiError('not_implemented', {
      message:
        'Cloudflare Access is not configured on this instance. Set MS_ACCESS_TEAM and MS_ACCESS_AUD, or sign in with a passkey.',
    })
  }

  const assertion =
    c.req.raw.headers.get('cf-access-jwt-assertion') ??
    /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(c.req.raw.headers.get('cookie') ?? '')?.[1]
  if (!assertion) throw apiError('not_signed_in')

  const claims = await verifyAccessJwt(assertion, env.MS_ACCESS_TEAM, env.MS_ACCESS_AUD)
  if (!claims?.email) throw apiError('not_signed_in')

  const sql = tenancyFor(env).db('')
  // An Access policy *is* the operator's decision about who may in. On an
  // unclaimed single-tenant instance, passing it is enough to become the owner;
  // afterwards it finds an existing membership like every other path.
  const user = await resolveUser(sql, normalizeEmail(claims.email), env.MS_MODE)
  if (!user) throw apiError('not_signed_in')

  const token = await issueSession(sql, user.id, user.workspaceId, c.req.raw)
  return sessionResponse(token, user.workspaceId, env.MS_PUBLIC_URL)
})

/** `DELETE /v1/auth/session` — sign out. Deletes the row, not just the cookie. */
auth.delete('/session', async (c) => {
  const env = getEnv()
  const match = /(?:^|;\s*)ms_session=([^;]+)/.exec(c.req.raw.headers.get('cookie') ?? '')
  if (match?.[1]) {
    await tenancyFor(env)
      .db('')
      .prepare('DELETE FROM sessions WHERE id = ?')
      .bind(await hashApiKey(decodeURIComponent(match[1])))
      .run()
  }
  return Response.json(
    { object: 'session', deleted: true },
    { headers: { 'set-cookie': sessionCookie('', env.MS_PUBLIC_URL, 0) } },
  )
})

export { SESSION_TTL_MS }

// ---------------------------------------------------------------------------
// Cloudflare Access JWT verification
// ---------------------------------------------------------------------------

interface AccessClaims {
  email?: string
  aud?: string | string[]
  exp?: number
  iat?: number
  iss?: string
}

/** Keys change rarely; refetching them on every sign-in is a needless round trip. */
let certCache: { team: string; at: number; keys: JsonWebKey[] } | null = null
const CERT_TTL_MS = 60 * 60_000

const accessHost = (team: string): string =>
  team.includes('.') ? team : `${team}.cloudflareaccess.com`

async function accessKeys(team: string): Promise<JsonWebKey[]> {
  if (certCache?.team === team && Date.now() - certCache.at < CERT_TTL_MS) return certCache.keys
  const response = await fetch(`https://${accessHost(team)}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw apiError('not_signed_in')
  const body = (await response.json()) as { keys?: JsonWebKey[] }
  const keys = body.keys ?? []
  certCache = { team, at: Date.now(), keys }
  return keys
}

const b64urlToBytes = (value: string): ArrayBuffer => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

async function verifyAccessJwt(
  jwt: string,
  team: string,
  aud: string,
): Promise<AccessClaims | null> {
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  const [header, payload, signature] = parts as [string, string, string]

  const signed = new TextEncoder().encode(`${header}.${payload}`)
  const sig = b64urlToBytes(signature)

  let verified = false
  for (const jwk of await accessKeys(team)) {
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      )
      if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed)) {
        verified = true
        break
      }
    } catch {
      // A key we cannot import is a key that cannot have signed this. Trying
      // the rest is the whole point of the set being a set.
    }
  }
  if (!verified) return null

  const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as AccessClaims
  const now = Math.floor(Date.now() / 1000)
  if (typeof claims.exp === 'number' && claims.exp < now) return null
  // 60s of slack for clock skew, which is real and small.
  if (typeof claims.iat === 'number' && claims.iat > now + 60) return null
  const audience = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : []
  if (!audience.includes(aud)) return null
  // The issuer was declared on the claims type and never checked. Cloudflare
  // signs every team's tokens with keys served from that team's own hostname,
  // so a mismatch here means the token was minted for a different Access
  // organisation than the one this deployment trusts.
  if (claims.iss && claims.iss !== `https://${accessHost(team)}`) return null
  return claims
}
