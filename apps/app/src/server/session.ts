import { hashApiKey } from '@mailysend/core'
import type { Sql } from '@mailysend/platform'

/**
 * Dashboard sessions.
 *
 * Split out of the auth router because five different entry paths mint one —
 * a passkey, a recovery code, an emailed code, a Cloudflare Access assertion
 * and the first-run claim — and every one of them must produce a byte-identical
 * cookie. A second copy of this logic is a second place for the `Secure` flag
 * to be wrong.
 */

export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()

/**
 * The cookie.
 *
 * `HttpOnly` so a script cannot read it, `SameSite=Lax` so it survives the
 * top-level navigation back from an email link but is not sent on a
 * cross-origin POST, and `Secure` unless the instance is being run over plain
 * HTTP on localhost — where marking it Secure would silently drop it and make
 * local development look broken.
 */
export function sessionCookie(token: string, publicUrl: string, maxAgeSeconds: number): string {
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

export async function issueSession(
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

/** The whole response a successful sign-in produces, wherever it came from. */
export const sessionResponse = (token: string, workspaceId: string, publicUrl: string): Response =>
  Response.json(
    { object: 'session', workspace_id: workspaceId },
    { headers: { 'set-cookie': sessionCookie(token, publicUrl, SESSION_TTL_MS / 1000) } },
  )

export const clientIp = (request: Request): string =>
  request.headers.get('cf-connecting-ip') ??
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
  'unknown'
