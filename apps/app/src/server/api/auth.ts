import { apiError } from '@mailysend/contracts'
import { DEFAULT_WORKSPACE, hashApiKey, newId } from '@mailysend/core'
import type { Sql } from '@mailysend/platform'
import { z } from 'zod'
import { buildContext, tenancyFor } from '../context.ts'
import { background, getEnv } from '../env.ts'
import { acceptEmail } from '../send/accept.ts'
import { createRouter } from './base.ts'

/**
 * Dashboard sign-in.
 *
 * Deliberately separate from API-key auth, and deliberately not a password
 * store. A self-hosted email platform that invents its own password database is
 * adding the one credential most likely to be reused and leaked, to protect a
 * dashboard that already sits behind whatever the operator put in front of it.
 * So there are exactly two ways in:
 *
 *   - **Cloudflare Access.** The identity is already proven at the edge; we
 *     verify the assertion and mint a session. This is the intended path.
 *   - **A one-time code, emailed through the deployment's own send path.**
 *     Dogfooding, and the only bootstrap that works before Access is set up.
 *
 * Every response here is deliberately uniform about whether an address exists.
 * A sign-in form that answers "no such user" is a membership oracle for anyone
 * who wants to know who runs this instance.
 */
export const auth = createRouter()

/** Six digits. Long enough with five attempts and a ten-minute window. */
const CODE_TTL_MS = 10 * 60_000
const MAX_ATTEMPTS = 5
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000

const StartBody = z.object({ email: z.string().email().max(320) })
const VerifyBody = z.object({
  email: z.string().email().max(320),
  code: z.string().regex(/^\d{6}$/, 'must be six digits'),
})

const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** Crypto-random, uniform over 000000-999999 — not `Math.random()`. */
function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1))
  return String(bytes[0]! % 1_000_000).padStart(6, '0')
}

/**
 * The cookie.
 *
 * `HttpOnly` so a script cannot read it, `SameSite=Lax` so it survives the
 * top-level navigation back from an email link but is not sent on a
 * cross-origin POST, and `Secure` unless the instance is being run over plain
 * HTTP on localhost — where marking it Secure would silently drop it and make
 * local development look broken.
 */
function sessionCookie(token: string, publicUrl: string, maxAgeSeconds: number): string {
  const secure = !publicUrl.startsWith('http://')
  return [
    `ms_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join('; ')
}

async function issueSession(
  sql: Sql,
  userId: string,
  workspaceId: string,
  request: Request,
): Promise<string> {
  // The token never reaches the database. Its SHA-256 is the row's primary key,
  // so a dump of `sessions` cannot be replayed as a cookie.
  const token = `mss_${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')
  const now = Date.now()
  await sql
    .prepare(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, ip, user_agent, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(
      await hashApiKey(token),
      userId,
      workspaceId,
      new Date(now + SESSION_TTL_MS).toISOString(),
      request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for'),
      request.headers.get('user-agent'),
      new Date(now).toISOString(),
    )
    .run()
  return token
}

/**
 * Finds or creates the user, and makes sure they belong somewhere.
 *
 * On a self-hosted instance the first person to sign in is the owner; there is
 * nobody to invite them. On a hosted one, `memberships` is written by the
 * invite flow and this only ever finds what is already there.
 */
async function resolveUser(
  sql: Sql,
  email: string,
  mode: 'single' | 'saas',
): Promise<{ id: string; workspaceId: string } | null> {
  const now = new Date().toISOString()
  const existing = await sql
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()

  let userId = existing?.id
  if (!userId) {
    // In SaaS mode an unknown address is not an account. Self-host creates one,
    // because the alternative is a deployment nobody can ever sign in to.
    if (mode === 'saas') return null
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

  if (mode === 'saas') return null
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
 * Sends the code, or logs it.
 *
 * A brand-new deployment has no verified sending domain, so it cannot email
 * anybody — including the person trying to get in and verify a domain. Rather
 * than leave that as a deadlock, the owner's code goes to the process log,
 * which on a self-hosted box is a place only the operator can read. It is
 * narrowly scoped: only `MS_OWNER_EMAIL`, and only while sending is impossible.
 */
async function deliverCode(email: string, code: string): Promise<void> {
  const env = getEnv()
  const tenancy = tenancyFor(env)
  const sql = tenancy.db('')
  const domain = await sql
    .prepare(`SELECT name FROM domains WHERE status = 'verified' ORDER BY created_at LIMIT 1`)
    .bind()
    .first<{ name: string }>()

  const isOwner = env.MS_OWNER_EMAIL && normalizeEmail(env.MS_OWNER_EMAIL) === email
  if (!domain) {
    if (isOwner) {
      console.log(
        `\n  Sign-in code for ${email}: ${code}\n` +
          '  (shown here because no sending domain is verified yet)\n',
      )
      return
    }
    // Not the owner and nothing can be sent: say nothing to the caller, because
    // the alternative leaks whether an address is the owner's.
    console.warn(`[auth] cannot deliver login code to ${email}: no verified sending domain`)
    return
  }

  const ctx = await buildContext(
    env,
    { workspaceId: DEFAULT_WORKSPACE, environment: 'live', scopes: ['*'] },
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
}

/**
 * `POST /v1/auth/otp` — ask for a code.
 *
 * Always 202. Whether the address exists, whether mail could be sent, whether
 * the code was logged — none of it is observable from the response.
 */
auth.post('/otp', async (c) => {
  const env = getEnv()
  const body = StartBody.parse(await c.req.json())
  const email = normalizeEmail(body.email)
  const sql = tenancyFor(env).db('')
  const now = Date.now()

  // One live code per address. Requesting a second invalidates the first, so a
  // stolen older code cannot be used after the real user asks for a new one.
  await sql
    .prepare(`UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL`)
    .bind(new Date(now).toISOString(), email)
    .run()

  const recent = await sql
    .prepare(`SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?`)
    .bind(email, new Date(now - 60 * 60_000).toISOString())
    .first<{ n: number }>()

  // Ten an hour is generous for a human and useless as a way to spray codes at
  // somebody's inbox.
  if ((recent?.n ?? 0) < 10) {
    const code = newCode()
    await sql
      .prepare(
        `INSERT INTO login_codes (id, email, code_hash, expires_at, created_at) VALUES (?,?,?,?,?)`,
      )
      .bind(
        newId('user'),
        email,
        await hashApiKey(`${email}:${code}`),
        new Date(now + CODE_TTL_MS).toISOString(),
        new Date(now).toISOString(),
      )
      .run()
    await deliverCode(email, code)
  }

  return Response.json({ object: 'login_code', status: 'sent' }, { status: 202 })
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

  if (row.code_hash !== (await hashApiKey(`${email}:${body.code}`))) {
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
  return Response.json(
    { object: 'session', workspace_id: user.workspaceId },
    {
      headers: {
        'set-cookie': sessionCookie(token, env.MS_PUBLIC_URL, SESSION_TTL_MS / 1000),
      },
    },
  )
})

/**
 * `POST /v1/auth/access` — trade a Cloudflare Access assertion for a session.
 *
 * The JWT is verified properly — signature against the team's published keys,
 * `aud` against this application's tag, `exp`/`iat` against the clock. Reading
 * the email out of an unverified token would let anyone with a text editor sign
 * in as anyone.
 */
auth.post('/access', async (c) => {
  const env = getEnv()
  if (!env.MS_ACCESS_TEAM || !env.MS_ACCESS_AUD) throw apiError('not_implemented')

  const assertion =
    c.req.raw.headers.get('cf-access-jwt-assertion') ??
    /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(c.req.raw.headers.get('cookie') ?? '')?.[1]
  if (!assertion) throw apiError('not_signed_in')

  const claims = await verifyAccessJwt(assertion, env.MS_ACCESS_TEAM, env.MS_ACCESS_AUD)
  if (!claims?.email) throw apiError('not_signed_in')

  const sql = tenancyFor(env).db('')
  const user = await resolveUser(sql, normalizeEmail(claims.email), env.MS_MODE)
  if (!user) throw apiError('not_signed_in')

  const token = await issueSession(sql, user.id, user.workspaceId, c.req.raw)
  return Response.json(
    { object: 'session', workspace_id: user.workspaceId },
    { headers: { 'set-cookie': sessionCookie(token, env.MS_PUBLIC_URL, SESSION_TTL_MS / 1000) } },
  )
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

async function accessKeys(team: string): Promise<JsonWebKey[]> {
  if (certCache?.team === team && Date.now() - certCache.at < CERT_TTL_MS) return certCache.keys
  const host = team.includes('.') ? team : `${team}.cloudflareaccess.com`
  const response = await fetch(`https://${host}/cdn-cgi/access/certs`, {
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
  return claims
}
