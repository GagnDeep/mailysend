import { apiError } from '@mailysend/contracts'
import {
  DEFAULT_WORKSPACE,
  hashApiKey,
  newId,
  newRecoveryCode,
  registrationOptions,
  verifyRegistration,
} from '@mailysend/core'
import type { Sql } from '@mailysend/platform'
import { z } from 'zod'
import { CLAIMED_KEY, claimInstance, isClaimed } from '../bootstrap.ts'
import { tenancyFor } from '../context.ts'
import { getEnv } from '../env.ts'
import { clientIp, issueSession, normalizeEmail, sessionResponse } from '../session.ts'
import {
  consumeChallenge,
  insertCredential,
  insertRecoveryCode,
  relyingParty,
  storeChallenge,
} from '../webauthn.ts'
import { createRouter, withContext } from './base.ts'

/**
 * First run — `/v1/setup/*`.
 *
 * A deployment that nobody can sign in to is not a deployment. Before this
 * existed, a fresh instance was locked four ways at once: Cloudflare Access
 * answered 501 unless configured, the emailed code needed a verified sending
 * domain you could only add once signed in, the owner's code went to a log
 * nobody was told to read, and `mailysend login` called an endpoint that did
 * not exist. Every one of those wants something the operator does not yet have.
 *
 * A passkey wants nothing. It is created by the browser already open on the
 * page, needs no email, no DNS and no identity provider, and is the strongest
 * credential of the five. So claiming is: prove you have a browser pointed at
 * this instance before anyone else does, and write down ten recovery codes.
 *
 * The obvious objection — "then the first stranger to find the URL owns it" —
 * is real, and is why `MS_OWNER_EMAIL` restricts who may claim when it is set,
 * why the claim is recorded in the audit log with its source address, and why
 * `POST /claim/cli` exists: proving you can write this deployment's own
 * database is a strictly stronger claim than proving you read an inbox.
 */
export const setup = createRouter()

const CLAIM_SCOPE = { register: 'register' } as const
const RECOVERY_CODE_COUNT = 10

const ClaimOptionsBody = z.object({
  email: z.string().trim().email().max(320),
})

const ClaimVerifyBody = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().max(120).optional(),
  workspace_name: z.string().min(1).max(120).optional(),
  challenge: z.string().min(1),
  response: z.unknown(),
})

/** Refuses everything below once the instance has an owner. */
async function requireUnclaimed(sql: Sql): Promise<void> {
  if (await isClaimed(sql)) throw apiError('instance_claimed')
}

/**
 * `MS_OWNER_EMAIL` is a restriction, not a nomination.
 *
 * Setting it does not create an owner and does not send anything; it only says
 * that no other address may claim this instance. Documented that way because
 * the old copy implied the opposite, and an operator who believes the variable
 * *is* the setup will wait forever for something to happen.
 */
function assertAllowedClaimant(email: string): void {
  const expected = getEnv().MS_OWNER_EMAIL
  if (expected && normalizeEmail(expected) !== email) {
    throw apiError('not_signed_in', {
      message: 'This instance is reserved for a different address (MS_OWNER_EMAIL).',
    })
  }
}

/** `POST /v1/setup/claim/options` — a registration challenge for the first owner. */
setup.post('/claim/options', async (c) => {
  const env = getEnv()
  const sql = tenancyFor(env).db('')
  await requireUnclaimed(sql)

  const body = ClaimOptionsBody.parse(await c.req.json())
  const email = normalizeEmail(body.email)
  assertAllowedClaimant(email)

  const rp = relyingParty(env)
  // The user id is minted now and carried on the challenge, so the credential
  // the browser creates is bound to the row `claim/verify` will write. Letting
  // the client choose it would let it bind a passkey to somebody else.
  const userId = newId('user')
  const options = await registrationOptions({
    rp,
    userId,
    userName: email,
    userDisplayName: email,
  })
  await storeChallenge(sql, options.challenge, CLAIM_SCOPE.register, rp.id, userId)

  return Response.json({ object: 'claim_options', rp_id: rp.id, user_id: userId, options })
})

/**
 * `POST /v1/setup/claim/verify` — become the owner.
 *
 * The claim row is written *first*, on its own, with `INSERT … WHERE NOT
 * EXISTS`. That is what makes two simultaneous claimants produce exactly one
 * owner: the loser writes zero rows and is refused before any credential of
 * theirs reaches the database. Doing it the other way round — owner rows in the
 * batch, claim last — would leave the loser holding a working passkey, which is
 * a sign-in, not a failed setup.
 *
 * If the owner rows then fail, the claim is released again, because a claimed
 * instance with no owner is the one state nothing else here can recover from.
 */
setup.post('/claim/verify', async (c) => {
  const env = getEnv()
  const sql = tenancyFor(env).db('')
  await requireUnclaimed(sql)

  const body = ClaimVerifyBody.parse(await c.req.json())
  const email = normalizeEmail(body.email)
  assertAllowedClaimant(email)

  const rp = relyingParty(env)
  const pending = await consumeChallenge(sql, body.challenge, CLAIM_SCOPE.register)
  if (!pending?.userId)
    throw apiError('not_signed_in', { message: 'That passkey was not accepted.' })

  const credential = await verifyRegistration({
    rp,
    challenge: body.challenge,
    response: body.response,
  })
  if (!credential) throw apiError('not_signed_in', { message: 'That passkey was not accepted.' })

  if (!(await claimInstance(sql))) throw apiError('instance_claimed')

  const userId = pending.userId
  const now = new Date().toISOString()
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode)

  try {
    await sql.batch([
      sql
        .prepare(
          'INSERT INTO users (id, email, name, email_verified_at, created_at) VALUES (?,?,?,?,?)',
        )
        .bind(userId, email, body.name ?? null, null, now),
      sql
        .prepare(
          `INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?,?,'owner',?)`,
        )
        .bind(DEFAULT_WORKSPACE, userId, now),
      insertCredential(sql, {
        workspaceId: DEFAULT_WORKSPACE,
        userId,
        credential,
        rpId: rp.id,
        name: 'Setup passkey',
      }),
      ...(await Promise.all(
        codes.map(async (code) =>
          insertRecoveryCode(sql, {
            workspaceId: DEFAULT_WORKSPACE,
            userId,
            hash: await hashApiKey(code.replace(/-/g, '')),
          }),
        ),
      )),
      sql
        .prepare(
          `INSERT INTO audit_log (id, workspace_id, actor_type, actor_id, action, resource_type, resource_id, metadata, ip, created_at)
           VALUES (?,?,'user',?,'instance.claimed','instance',?,?,?,?)`,
        )
        .bind(
          newId('event'),
          DEFAULT_WORKSPACE,
          userId,
          rp.id,
          JSON.stringify({ email, user_agent: c.req.raw.headers.get('user-agent') }),
          clientIp(c.req.raw),
          now,
        ),
      ...(body.workspace_name
        ? [
            sql
              .prepare('UPDATE workspaces SET name = ? WHERE id = ?')
              .bind(body.workspace_name, DEFAULT_WORKSPACE),
          ]
        : []),
    ])
  } catch (err) {
    await sql
      .prepare('DELETE FROM settings WHERE workspace_id = ? AND key = ?')
      .bind('', CLAIMED_KEY)
      .run()
    throw err
  }

  const token = await issueSession(sql, userId, DEFAULT_WORKSPACE, c.req.raw)
  const response = sessionResponse(token, DEFAULT_WORKSPACE, env.MS_PUBLIC_URL)
  // The one and only time these strings exist outside the operator's hands.
  return new Response(
    JSON.stringify({
      object: 'claim',
      user_id: userId,
      workspace_id: DEFAULT_WORKSPACE,
      recovery_codes: codes,
    }),
    { status: 201, headers: response.headers },
  )
})

/**
 * `POST /v1/setup/claim/cli` — break glass.
 *
 * The caller proves control of the *deployment* by writing a nonce into its own
 * database — through `wrangler d1 execute`, the D1 HTTP API, or the SQLite file
 * on a Node box — and then presenting it here. Nobody who cannot already read
 * and write the instance's data can produce that value, so this is safe to
 * leave enabled after claiming, which is exactly what makes it the answer to
 * "every passkey is gone and the recovery codes were on the same laptop".
 *
 * The nonce is deleted as it is spent, and the delete is the check.
 */
setup.post('/claim/cli', async (c) => {
  const env = getEnv()
  const sql = tenancyFor(env).db('')
  const body = z
    .object({
      nonce: z.string().min(16).max(200),
      email: z.string().trim().email().max(320).optional(),
    })
    .parse(await c.req.json())

  const row = await sql
    .prepare('SELECT nonce, created_at FROM claim_nonces WHERE nonce = ?')
    .bind(body.nonce)
    .first<{ nonce: string; created_at: string }>()
  if (!row) throw apiError('not_signed_in', { message: 'That claim nonce is not valid.' })

  await sql.prepare('DELETE FROM claim_nonces WHERE nonce = ?').bind(body.nonce).run()
  // Ten minutes. A nonce that sits in the table forever is a permanent
  // authentication bypass for anyone who later reads a database backup.
  if (Date.now() - Date.parse(row.created_at) > 10 * 60_000) {
    throw apiError('not_signed_in', { message: 'That claim nonce has expired.' })
  }

  const email = normalizeEmail(body.email ?? env.MS_OWNER_EMAIL ?? 'owner@localhost')
  const now = new Date().toISOString()

  const existing = await sql
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()
  const userId = existing?.id ?? newId('user')

  const statements = [
    ...(existing
      ? []
      : [
          sql
            .prepare(
              'INSERT INTO users (id, email, name, email_verified_at, created_at) VALUES (?,?,?,?,?)',
            )
            .bind(userId, email, null, null, now),
        ]),
    sql
      .prepare(
        `INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?,?,'owner',?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(DEFAULT_WORKSPACE, userId, now),
    sql
      .prepare(
        `INSERT INTO audit_log (id, workspace_id, actor_type, actor_id, action, resource_type, resource_id, metadata, ip, created_at)
         VALUES (?,?,'user',?,'instance.claimed_cli','instance',?,?,?,?)`,
      )
      .bind(
        newId('event'),
        DEFAULT_WORKSPACE,
        userId,
        relyingParty(env).id,
        JSON.stringify({ email }),
        clientIp(c.req.raw),
        now,
      ),
  ]
  await sql.batch(statements)
  await claimInstance(sql)

  const token = await issueSession(sql, userId, DEFAULT_WORKSPACE, c.req.raw)
  const response = sessionResponse(token, DEFAULT_WORKSPACE, env.MS_PUBLIC_URL)
  return new Response(
    JSON.stringify({ object: 'claim', user_id: userId, workspace_id: DEFAULT_WORKSPACE, email }),
    { status: 200, headers: response.headers },
  )
})

/**
 * `POST /v1/setup/recovery-codes` — regenerate, for a signed-in user.
 *
 * Replaces every code the user has, spent or not, because a set you are unsure
 * about is a set you do not have. Returned once and never again.
 */
setup.post('/recovery-codes', withContext(), async (c) => {
  const ctx = c.get('ctx')
  if (!ctx.actor.userId) throw apiError('not_signed_in')
  const userId = ctx.actor.userId

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode)
  await ctx.sql.batch([
    ctx.sql.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(userId),
    ...(await Promise.all(
      codes.map(async (code) =>
        insertRecoveryCode(ctx.sql, {
          workspaceId: ctx.workspace.id,
          userId,
          hash: await hashApiKey(code.replace(/-/g, '')),
        }),
      ),
    )),
  ])

  return Response.json({ object: 'recovery_codes', recovery_codes: codes }, { status: 201 })
})
