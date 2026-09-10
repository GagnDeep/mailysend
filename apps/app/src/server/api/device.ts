import { apiError } from '@mailysend/contracts'
import { apiKeyPreview, generateApiKey, hashApiKey, newId } from '@mailysend/core'
import { z } from 'zod'
import { tenancyFor } from '../context.ts'
import { getEnv } from '../env.ts'
import { createRouter, withContext } from './base.ts'

/**
 * The CLI device flow — `/v1/auth/device*`.
 *
 * `mailysend login` has called these endpoints since the day it was written;
 * they did not exist, so it answered 404 and told people to go and make a key
 * by hand. A device code rather than a localhost callback because people run
 * the CLI over SSH, in containers, and on machines whose `localhost` a browser
 * cannot reach.
 *
 * The device code is stored hashed, exactly like an API key: the row is a
 * record of a pending approval, not a credential. The user code is not — it is
 * eight characters a person reads off one screen and types into another, and it
 * is useless without the device code held by the waiting CLI.
 */
export const device = createRouter()

const DEVICE_TTL_MS = 15 * 60_000
const POLL_INTERVAL_SECONDS = 5

/** Crockford base32 minus the ambiguous letters, in two groups of four. */
const USER_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const newUserCode = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const chars = Array.from(bytes, (b) => USER_CODE_ALPHABET[b % 32]!)
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}

/** `POST /v1/auth/device` — start. Unauthenticated: nobody is signed in yet. */
device.post('/', async (c) => {
  const env = getEnv()
  const sql = tenancyFor(env).db('')
  const body = z
    .object({ client: z.string().max(120).optional() })
    .catch({})
    .parse(await c.req.json().catch(() => ({})))

  const deviceCode = `msd_${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')
  const userCode = newUserCode()
  const now = Date.now()

  await sql
    .prepare(
      `INSERT INTO device_codes (id, device_code_hash, user_code, client, expires_at, created_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .bind(
      newId('deviceCode'),
      await hashApiKey(deviceCode),
      userCode,
      body.client ?? null,
      new Date(now + DEVICE_TTL_MS).toISOString(),
      new Date(now).toISOString(),
    )
    .run()

  return Response.json({
    object: 'device_code',
    device_code: deviceCode,
    user_code: userCode,
    verification_url: `${env.MS_PUBLIC_URL.replace(/\/$/, '')}/app/settings?section=security`,
    interval: POLL_INTERVAL_SECONDS,
    expires_in: DEVICE_TTL_MS / 1000,
  })
})

/**
 * `POST /v1/auth/device/token` — poll.
 *
 * 428 while it is still pending, which is what the CLI already treats as "keep
 * waiting". The minted key is handed over exactly once and cleared from the
 * row in the same statement that marks it redeemed, so a leaked device code
 * cannot be replayed for a second copy.
 */
device.post('/token', async (c) => {
  const env = getEnv()
  const sql = tenancyFor(env).db('')
  const body = z.object({ device_code: z.string().min(10).max(200) }).parse(await c.req.json())

  const row = await sql
    .prepare(
      `SELECT id, approved_at, denied_at, issued_token, redeemed_at, expires_at, workspace_id
         FROM device_codes WHERE device_code_hash = ?`,
    )
    .bind(await hashApiKey(body.device_code))
    .first<{
      id: string
      approved_at: string | null
      denied_at: string | null
      issued_token: string | null
      redeemed_at: string | null
      expires_at: string
      workspace_id: string | null
    }>()

  if (!row || Date.parse(row.expires_at) < Date.now()) {
    throw apiError('invalid_login_code', { message: 'That login code has expired.' })
  }
  if (row.denied_at) throw apiError('invalid_login_code', { message: 'That login was declined.' })
  // Redeemed first: the exchange NULLs `issued_token`, so asking about the
  // token before asking about the redemption reports a spent code as still
  // pending and leaves the CLI polling an approval it already collected.
  if (row.redeemed_at) {
    throw apiError('invalid_login_code', { message: 'That login code has already been used.' })
  }
  if (!row.approved_at || !row.issued_token) {
    return Response.json({ object: 'device_code', status: 'pending' }, { status: 428 })
  }

  const token = row.issued_token
  await sql
    .prepare(
      'UPDATE device_codes SET redeemed_at = ?, issued_token = NULL WHERE id = ? AND redeemed_at IS NULL',
    )
    .bind(new Date().toISOString(), row.id)
    .run()

  return Response.json({
    object: 'device_code',
    token,
    workspace: row.workspace_id,
  })
})

/** `GET /v1/auth/device/pending` — what the dashboard shows on the approval screen. */
device.get('/pending', withContext(), async (c) => {
  const ctx = c.get('ctx')
  if (!ctx.actor.userId) throw apiError('not_signed_in')
  const { results } = await ctx.sql
    .prepare(
      `SELECT id, user_code, client, created_at FROM device_codes
        WHERE approved_at IS NULL AND denied_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC LIMIT 10`,
    )
    .bind(new Date().toISOString())
    .all<{ id: string; user_code: string; client: string | null; created_at: string }>()
  return Response.json({
    object: 'list',
    data: results.map((row) => ({
      object: 'device_code',
      id: row.id,
      user_code: row.user_code,
      client: row.client,
      created_at: row.created_at,
    })),
  })
})

const DecideBody = z.object({ user_code: z.string().min(4).max(20) })

/**
 * `POST /v1/auth/device/approve` — a signed-in person says yes.
 *
 * The key is minted here rather than at start, so an unapproved device code
 * never corresponds to a credential that exists. It is a full-access key named
 * after the client, because a CLI that cannot manage domains is a CLI people
 * stop using — and it is revocable from the same screen as any other key.
 */
device.post('/approve', withContext(), async (c) => {
  const ctx = c.get('ctx')
  if (!ctx.actor.userId) throw apiError('not_signed_in')
  const body = DecideBody.parse(await c.req.json())
  const userCode = body.user_code.trim().toUpperCase()

  const row = await ctx.sql
    .prepare(
      `SELECT id, client FROM device_codes
        WHERE user_code = ? AND approved_at IS NULL AND denied_at IS NULL AND expires_at > ?`,
    )
    .bind(userCode, new Date().toISOString())
    .first<{ id: string; client: string | null }>()
  if (!row)
    throw apiError('invalid_login_code', { message: 'That code is not waiting for approval.' })

  const token = generateApiKey('live')
  const now = new Date().toISOString()
  await ctx.sql.batch([
    ctx.sql
      .prepare(
        `INSERT INTO api_keys (id, workspace_id, name, token_hash, token_preview, environment, permission, created_by, created_at)
         VALUES (?,?,?,?,?,'live','full_access',?,?)`,
      )
      .bind(
        newId('apiKey'),
        ctx.workspace.id,
        row.client ? `CLI · ${row.client}` : 'CLI',
        await hashApiKey(token),
        apiKeyPreview(token),
        ctx.actor.userId,
        now,
      ),
    ctx.sql
      .prepare(
        `UPDATE device_codes SET approved_at = ?, user_id = ?, workspace_id = ?, issued_token = ?
          WHERE id = ? AND approved_at IS NULL`,
      )
      .bind(now, ctx.actor.userId, ctx.workspace.id, token, row.id),
  ])

  return Response.json({ object: 'device_code', approved: true })
})

/** `POST /v1/auth/device/deny` — and no. */
device.post('/deny', withContext(), async (c) => {
  const ctx = c.get('ctx')
  if (!ctx.actor.userId) throw apiError('not_signed_in')
  const body = DecideBody.parse(await c.req.json())
  await ctx.sql
    .prepare('UPDATE device_codes SET denied_at = ? WHERE user_code = ? AND approved_at IS NULL')
    .bind(new Date().toISOString(), body.user_code.trim().toUpperCase())
    .run()
  return Response.json({ object: 'device_code', denied: true })
})
