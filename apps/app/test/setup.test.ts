import { hashApiKey } from '@mailysend/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { claimInstance, isClaimed } from '../src/server/bootstrap.ts'
import { CLAIM_CODE, claimFor, type Harness, harness } from './harness.ts'

/**
 * First run.
 *
 * The property under test is not "setup works" — it is that setup can happen
 * *exactly once*, because the loser of a race holding a working credential is
 * not a failed claim, it is a second owner.
 */

let h: Harness

const nonce = async (value = 'msc_test_nonce_value_0000000000') => {
  await h.sql
    .prepare('INSERT INTO claim_nonces (nonce, created_at) VALUES (?, ?)')
    .bind(value, new Date().toISOString())
    .run()
  return value
}

beforeEach(async () => {
  h = await harness()
})

describe('claiming', () => {
  it('starts unclaimed and offers a registration challenge', async () => {
    const response = await h.fetch('/v1/setup/claim/options', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@acme.dev', claim_code: CLAIM_CODE }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      user_id: string
      rp_id: string
      options: { challenge: string }
    }
    expect(body.rp_id).toBe('mail.acme.dev')
    expect(body.user_id).toMatch(/^usr_/)
    expect(body.options.challenge).toBeTruthy()
  })

  it('will not hand the instance to whoever finds the URL first', async () => {
    // Dropping MS_OWNER_EMAIL from the deploy form removed the only thing
    // standing between a fresh deployment and a passer-by. The code printed on
    // first boot is what replaced it, so an absent or wrong one must not pass.
    const without = await h.fetch('/v1/setup/claim/options', {
      method: 'POST',
      body: JSON.stringify({ email: 'stranger@else.dev' }),
    })
    expect(without.status).toBe(401)

    const wrong = await h.fetch('/v1/setup/claim/options', {
      method: 'POST',
      body: JSON.stringify({ email: 'stranger@else.dev', claim_code: 'WRON-GCOD-E000' }),
    })
    expect(wrong.status).toBe(401)
  })

  it('refuses to offer one once the instance has an owner', async () => {
    await claimFor(h)
    const response = await h.fetch('/v1/setup/claim/options', {
      method: 'POST',
      body: JSON.stringify({ email: 'someone@else.dev' }),
    })
    expect(response.status).toBe(409)
  })

  it('restricts the claimant to MS_OWNER_EMAIL when it is set', async () => {
    const restricted = await harness({ MS_OWNER_EMAIL: 'Owner@Acme.dev' })
    const wrong = await restricted.fetch('/v1/setup/claim/options', {
      method: 'POST',
      body: JSON.stringify({ email: 'someone@else.dev' }),
    })
    expect(wrong.status).toBe(401)

    // Case and surrounding whitespace are the operator's, not a credential.
    const right = await restricted.fetch('/v1/setup/claim/options', {
      method: 'POST',
      body: JSON.stringify({ email: ' owner@acme.dev ' }),
    })
    expect(right.status).toBe(200)
  })

  it('lets exactly one of two simultaneous claimants win', async () => {
    const [first, second] = await Promise.all([claimInstance(h.sql), claimInstance(h.sql)])
    expect([first, second].filter(Boolean)).toHaveLength(1)
    expect(await isClaimed(h.sql)).toBe(true)
  })
})

describe('the CLI claim', () => {
  it('trades a nonce written into the database for an owner session', async () => {
    const value = await nonce()
    const response = await h.fetch('/v1/setup/claim/cli', {
      method: 'POST',
      body: JSON.stringify({ nonce: value, email: 'owner@acme.dev' }),
    })
    expect(response.status).toBe(200)
    expect(h.cookieFrom(response)).toMatch(/^ms_session=/)
    expect(await isClaimed(h.sql)).toBe(true)
  })

  it('spends the nonce exactly once', async () => {
    const value = await nonce()
    await h.fetch('/v1/setup/claim/cli', { method: 'POST', body: JSON.stringify({ nonce: value }) })
    const replay = await h.fetch('/v1/setup/claim/cli', {
      method: 'POST',
      body: JSON.stringify({ nonce: value }),
    })
    expect(replay.status).toBe(401)
  })

  it('refuses a nonce nobody wrote', async () => {
    const response = await h.fetch('/v1/setup/claim/cli', {
      method: 'POST',
      body: JSON.stringify({ nonce: 'msc_not_a_real_nonce_at_all_0000' }),
    })
    expect(response.status).toBe(401)
  })

  it('still works after the instance is claimed — it is the break-glass path', async () => {
    await claimFor(h)
    const value = await nonce()
    const response = await h.fetch('/v1/setup/claim/cli', {
      method: 'POST',
      body: JSON.stringify({ nonce: value, email: 'owner@acme.dev' }),
    })
    expect(response.status).toBe(200)
  })
})

describe('recovery codes', () => {
  const CODE = 'ABCDE-FGHJK-MNPQR-STVWX'

  const give = async (userId: string) => {
    await h.sql
      .prepare(
        `INSERT INTO recovery_codes (id, workspace_id, user_id, code_hash, created_at)
         VALUES ('rcv_TEST0000000000000000000000','ws_default',?,?,?)`,
      )
      .bind(userId, await hashApiKey(CODE.replace(/-/g, '')), new Date().toISOString())
      .run()
  }

  it('signs in once and never again', async () => {
    const userId = await claimFor(h)
    await give(userId)

    const first = await h.fetch('/v1/auth/recovery', {
      method: 'POST',
      body: JSON.stringify({ code: CODE }),
    })
    expect(first.status).toBe(200)
    expect(h.cookieFrom(first)).toMatch(/^ms_session=/)

    const second = await h.fetch('/v1/auth/recovery', {
      method: 'POST',
      body: JSON.stringify({ code: CODE }),
    })
    expect(second.status).toBe(401)
  })

  it('accepts the code however it was typed', async () => {
    const userId = await claimFor(h)
    await give(userId)
    const response = await h.fetch('/v1/auth/recovery', {
      method: 'POST',
      body: JSON.stringify({ code: ' abcde fghjk mnpqr stvwx ' }),
    })
    expect(response.status).toBe(200)
  })

  it('refuses one that was never issued', async () => {
    await claimFor(h)
    const response = await h.fetch('/v1/auth/recovery', {
      method: 'POST',
      body: JSON.stringify({ code: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ' }),
    })
    expect(response.status).toBe(401)
  })
})
