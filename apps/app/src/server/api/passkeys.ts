import { apiError } from '@mailysend/contracts'
import {
  authenticationOptions,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from '@mailysend/core'
import { z } from 'zod'
import { tenancyFor } from '../context.ts'
import { getEnv } from '../env.ts'
import { issueSession, sessionResponse } from '../session.ts'
import {
  consumeChallenge,
  credentialsForUser,
  findCredential,
  insertCredential,
  invalidCredential,
  relyingParty,
  storeChallenge,
  touchCredential,
} from '../webauthn.ts'
import { createRouter, withContext } from './base.ts'

/**
 * Passkeys — `/v1/auth/passkey/*`.
 *
 * Sign-in is discoverable: the browser offers whichever passkey it holds for
 * this hostname and the server learns who that is from the credential id. No
 * email is typed, which removes the last place a sign-in form could be asked
 * "does this address exist?".
 *
 * The two failure modes worth naming, because both look identical to a user:
 *
 *   - **A replay.** The challenge row is deleted as it is spent and the sign
 *     count must not go backwards, so a captured assertion is refused the
 *     second time.
 *   - **A moved instance.** WebAuthn binds a credential to a hostname. If the
 *     deployment's public URL has changed, every existing passkey is for the
 *     old one and *cannot* be made to work here. That is why each credential
 *     stores its `rp_id` and why `/v1/instance` reports the previous URL: the
 *     UI can say which host to use, or point at a recovery code, instead of
 *     showing a login that silently never succeeds.
 */
export const passkeys = createRouter()

const VerifyBody = z.object({ response: z.unknown(), challenge: z.string().min(1) })

/** `POST /v1/auth/passkey/options` — a sign-in challenge. */
passkeys.post('/options', async () => {
  const env = getEnv()
  const rp = relyingParty(env)
  const sql = tenancyFor(env).db('')
  const options = await authenticationOptions({ rp })
  await storeChallenge(sql, options.challenge, 'authenticate', rp.id)
  return Response.json({ object: 'passkey_options', rp_id: rp.id, options })
})

/** `POST /v1/auth/passkey/verify` — an assertion, in exchange for a session. */
passkeys.post('/verify', async (c) => {
  const env = getEnv()
  const rp = relyingParty(env)
  const sql = tenancyFor(env).db('')
  const body = VerifyBody.parse(await c.req.json())

  const pending = await consumeChallenge(sql, body.challenge, 'authenticate')
  if (!pending) throw invalidCredential()

  const credentialId = (body.response as { id?: string } | null)?.id
  if (typeof credentialId !== 'string') throw invalidCredential()

  const credential = await findCredential(sql, credentialId)
  if (!credential) throw invalidCredential()
  if (credential.rpId !== rp.id) {
    throw apiError('not_signed_in', {
      message: `That passkey was registered for ${credential.rpId}. Sign in there, or use a recovery code.`,
    })
  }

  const result = await verifyAuthentication({
    rp,
    challenge: body.challenge,
    credential,
    response: body.response,
  })
  if (!result) throw invalidCredential()

  // The counter guard lives in the UPDATE. If it changes no row the
  // authenticator's count went backwards, which means a clone — refuse rather
  // than mint a session and hope.
  await touchCredential(sql, credential.id, result.newSignCount).run()

  const token = await issueSession(sql, credential.userId, credential.workspaceId, c.req.raw)
  return sessionResponse(token, credential.workspaceId, env.MS_PUBLIC_URL)
})

/**
 * `GET /v1/auth/passkey` — the signed-in user's credentials.
 *
 * Includes `rp_id` so Settings can mark the ones that belong to a hostname this
 * instance no longer answers on.
 */
passkeys.get('/', withContext(), async (c) => {
  const ctx = c.get('ctx')
  if (!ctx.actor.userId) throw apiError('not_signed_in')
  const rp = relyingParty(ctx.env)
  const rows = await credentialsForUser(ctx.sql, ctx.actor.userId)
  return Response.json({
    object: 'list',
    data: rows.map((row) => ({
      object: 'passkey',
      id: row.id,
      name: row.name,
      rp_id: row.rpId,
      usable_here: row.rpId === rp.id,
    })),
  })
})

/** `POST /v1/auth/passkey/register/options` — add another passkey. */
passkeys.post('/register/options', withContext(), async (c) => {
  const ctx = c.get('ctx')
  if (!ctx.actor.userId) throw apiError('not_signed_in')
  const rp = relyingParty(ctx.env)

  const user = await ctx.sql
    .prepare('SELECT email, name FROM users WHERE id = ?')
    .bind(ctx.actor.userId)
    .first<{ email: string; name: string | null }>()
  if (!user) throw apiError('not_signed_in')

  const existing = await credentialsForUser(ctx.sql, ctx.actor.userId)
  const options = await registrationOptions({
    rp,
    userId: ctx.actor.userId,
    userName: user.email,
    ...(user.name ? { userDisplayName: user.name } : {}),
    exclude: existing,
  })
  await storeChallenge(ctx.sql, options.challenge, 'register', rp.id, ctx.actor.userId)
  return Response.json({ object: 'passkey_options', rp_id: rp.id, options })
})

/** `POST /v1/auth/passkey/register/verify` — store it. */
passkeys.post('/register/verify', withContext(), async (c) => {
  const ctx = c.get('ctx')
  if (!ctx.actor.userId) throw apiError('not_signed_in')
  const rp = relyingParty(ctx.env)
  const body = VerifyBody.extend({ name: z.string().max(80).optional() }).parse(await c.req.json())

  const pending = await consumeChallenge(ctx.sql, body.challenge, 'register')
  // The challenge carries the user it was minted for. Without that check a
  // signed-in visitor could complete somebody else's registration ceremony.
  if (!pending || pending.userId !== ctx.actor.userId) throw invalidCredential()

  const credential = await verifyRegistration({
    rp,
    challenge: body.challenge,
    response: body.response,
  })
  if (!credential) throw invalidCredential()

  await insertCredential(ctx.sql, {
    workspaceId: ctx.workspace.id,
    userId: ctx.actor.userId,
    credential,
    rpId: rp.id,
    ...(body.name ? { name: body.name } : {}),
  }).run()

  return Response.json({ object: 'passkey', created: true }, { status: 201 })
})

/**
 * `DELETE /v1/auth/passkey/:id` — remove one.
 *
 * Removing the last one is allowed only because recovery codes exist; without
 * them this would be a way to lock yourself out of your own instance with a
 * single click, and the API would have helped.
 */
passkeys.delete('/:id', withContext(), async (c) => {
  const ctx = c.get('ctx')
  if (!ctx.actor.userId) throw apiError('not_signed_in')
  const { remainingRecoveryCodes } = await import('../webauthn.ts')

  const rows = await credentialsForUser(ctx.sql, ctx.actor.userId)
  if (rows.length <= 1 && (await remainingRecoveryCodes(ctx.sql, ctx.actor.userId)) === 0) {
    throw apiError('validation_error', {
      message:
        'That is your only passkey and you have no recovery codes left. Generate recovery codes or add a second passkey first.',
    })
  }

  await ctx.sql
    .prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), ctx.actor.userId)
    .run()
  return Response.json({ object: 'passkey', deleted: true })
})
