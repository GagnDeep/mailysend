import { hashApiKey, newRecoveryCode, normalizeRecoveryCode } from '@mailysend/core'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  consumeChallenge,
  credentialsForUser,
  insertCredential,
  spendRecoveryCode,
  storeChallenge,
  touchCredential,
} from '../src/server/webauthn.ts'
import { claimFor, type Harness, harness, sessionFor } from './harness.ts'

/**
 * Passkeys, minus the authenticator.
 *
 * A real assertion cannot be forged in a test without shipping a software
 * authenticator, and a fake one signed by a fake key would only prove that
 * `@simplewebauthn` was called. What is worth pinning is everything around the
 * ceremony, because that is where this instance can lock somebody out: a
 * challenge that can be replayed, a sign count that goes backwards, a
 * credential registered for a hostname the instance no longer answers on, and
 * the delete button that removes the last way in.
 */

let h: Harness
let userId: string
let cookie: string

const fixture = (rpId = 'mail.acme.dev', credentialId = 'cred-one') =>
  insertCredential(h.sql, {
    workspaceId: 'ws_default',
    userId,
    rpId,
    name: 'Test key',
    credential: { credentialId, publicKey: 'cHVibGlj', signCount: 4 },
  }).run()

beforeEach(async () => {
  h = await harness()
  userId = await claimFor(h)
  cookie = await sessionFor(h, userId)
})

describe('challenges', () => {
  it('can be spent exactly once', async () => {
    await storeChallenge(h.sql, 'chal-1', 'authenticate', 'mail.acme.dev')
    expect(await consumeChallenge(h.sql, 'chal-1', 'authenticate')).toBeTruthy()
    expect(await consumeChallenge(h.sql, 'chal-1', 'authenticate')).toBeNull()
  })

  it('cannot be spent as the other kind of ceremony', async () => {
    await storeChallenge(h.sql, 'chal-2', 'register', 'mail.acme.dev', userId)
    expect(await consumeChallenge(h.sql, 'chal-2', 'authenticate')).toBeNull()
  })

  it('expires', async () => {
    await storeChallenge(h.sql, 'chal-3', 'authenticate', 'mail.acme.dev')
    await h.sql
      .prepare('UPDATE webauthn_challenges SET expires_at = ? WHERE challenge = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), 'chal-3')
      .run()
    expect(await consumeChallenge(h.sql, 'chal-3', 'authenticate')).toBeNull()
  })
})

describe('sign counts', () => {
  it('accepts a counter that moves forward and refuses one that goes back', async () => {
    await fixture()
    const [row] = await credentialsForUser(h.sql, userId)

    const forward = await touchCredential(h.sql, row!.id, 9).run()
    expect((forward as { meta?: { changes?: number } }).meta?.changes).toBe(1)

    // A counter below the stored one means the authenticator has been cloned.
    const backwards = await touchCredential(h.sql, row!.id, 5).run()
    expect((backwards as { meta?: { changes?: number } }).meta?.changes).toBe(0)
  })
})

describe('GET /v1/auth/passkey', () => {
  it('says which credentials still work on this hostname', async () => {
    await fixture('mail.acme.dev', 'here')
    await fixture('mailysend.workers.dev', 'there')

    const body = (await (await h.fetch('/v1/auth/passkey', { cookie })).json()) as {
      data: { rp_id: string; usable_here: boolean }[]
    }
    expect(body.data).toHaveLength(2)
    expect(body.data.find((p) => p.rp_id === 'mail.acme.dev')?.usable_here).toBe(true)
    // Registered before the instance moved to its custom domain: still listed,
    // so the banner can explain it, but honest about being unusable.
    expect(body.data.find((p) => p.rp_id === 'mailysend.workers.dev')?.usable_here).toBe(false)
  })

  it('needs a session, not a key', async () => {
    expect((await h.fetch('/v1/auth/passkey')).status).toBe(401)
  })
})

describe('DELETE /v1/auth/passkey/:id', () => {
  it('refuses to remove the last way in', async () => {
    await fixture()
    const [row] = await credentialsForUser(h.sql, userId)
    const response = await h.fetch(`/v1/auth/passkey/${row!.id}`, { method: 'DELETE', cookie })
    expect(response.status).toBe(422)
    expect(await h.sql.prepare('SELECT COUNT(*) AS n FROM webauthn_credentials').first()).toEqual({
      n: 1,
    })
  })

  it('allows it once a recovery code exists', async () => {
    await fixture()
    const code = newRecoveryCode()
    await h.sql
      .prepare(
        `INSERT INTO recovery_codes (id, workspace_id, user_id, code_hash, created_at)
         VALUES ('rcv_TEST00000000000000000000','ws_default',?,?,?)`,
      )
      .bind(userId, await hashApiKey(normalizeRecoveryCode(code)), new Date().toISOString())
      .run()

    const [row] = await credentialsForUser(h.sql, userId)
    const response = await h.fetch(`/v1/auth/passkey/${row!.id}`, { method: 'DELETE', cookie })
    expect(response.status).toBe(200)
  })

  it('cannot remove a passkey belonging to somebody else', async () => {
    await fixture()
    await fixture('mail.acme.dev', 'second')

    // A second member, with their own passkey so the last-way-in guard is not
    // what refuses them.
    const stranger = 'usr_STRANGER0000000000000000'
    const now = new Date().toISOString()
    await h.sql
      .prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,?)')
      .bind(stranger, 'stranger@acme.dev', now)
      .run()
    await h.sql
      .prepare(
        `INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES ('ws_default',?,'member',?)`,
      )
      .bind(stranger, now)
      .run()
    await insertCredential(h.sql, {
      workspaceId: 'ws_default',
      userId: stranger,
      rpId: 'mail.acme.dev',
      credential: { credentialId: 'stranger-one', publicKey: 'cHVibGlj', signCount: 0 },
    }).run()
    await insertCredential(h.sql, {
      workspaceId: 'ws_default',
      userId: stranger,
      rpId: 'mail.acme.dev',
      credential: { credentialId: 'stranger-two', publicKey: 'cHVibGlj', signCount: 0 },
    }).run()

    const [row] = await credentialsForUser(h.sql, userId)
    const response = await h.fetch(`/v1/auth/passkey/${row!.id}`, {
      method: 'DELETE',
      cookie: await sessionFor(h, stranger),
    })
    // The delete is scoped by user, so it reports success and removes nothing.
    expect(response.status).toBe(200)
    expect(await credentialsForUser(h.sql, userId)).toHaveLength(2)
  })
})

describe('recovery codes', () => {
  it('are spendable once, and the format people actually retype is accepted', async () => {
    const code = newRecoveryCode()
    expect(code).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/)
    await h.sql
      .prepare(
        `INSERT INTO recovery_codes (id, workspace_id, user_id, code_hash, created_at)
         VALUES ('rcv_SPEND000000000000000000','ws_default',?,?,?)`,
      )
      .bind(userId, await hashApiKey(normalizeRecoveryCode(code)), new Date().toISOString())
      .run()

    // The route normalises what a person types; the helper is given the
    // canonical form and is the thing that guarantees single use.
    const spent = await spendRecoveryCode(h.sql, normalizeRecoveryCode(code))
    expect(spent?.userId).toBe(userId)
    expect(await spendRecoveryCode(h.sql, normalizeRecoveryCode(code))).toBeNull()
  })
})
