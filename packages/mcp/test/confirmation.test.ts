import { hmacHex } from '@mailysend/core'
import { describe, expect, it } from 'vitest'
import { ConfirmationGate, canonicalize, MemoryConsumedTokens } from '../src/confirmation.ts'
import { harness, ids, SEND_ARGS } from './harness.ts'

const approve = async (h: Awaited<ReturnType<typeof harness>>, token: string) =>
  h.server.approvals.approve(token, 'usr_test')

const request = async (h: Awaited<ReturnType<typeof harness>>, args = SEND_ARGS) => {
  const result = await h.call('send_email', args)
  return { result, token: result.structuredContent.confirmation.token as string }
}

describe('the first call', () => {
  it('never reaches the backend', async () => {
    const h = await harness()
    const { result } = await request(h)
    expect(h.calls.sendEmail).toHaveLength(0)
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.status).toBe('confirmation_required')
  })

  it('describes exactly what would be sent, and says it did not send', async () => {
    const h = await harness()
    const { result } = await request(h, {
      ...SEND_ARGS,
      cc: ['cfo@example.com'],
      text: '  Thanks for your <order>.  ',
    })
    const { summary, approved, expires_at } = result.structuredContent.confirmation
    expect(summary).toMatchObject({
      tool: 'send_email',
      from: 'team@mailysend.com',
      to: ['ada@example.com'],
      cc: ['cfo@example.com'],
      bcc: [],
      subject: 'Your receipt',
      attachment_count: 0,
      thread_id: null,
    })
    expect(summary.preview).toBe('Thanks for your .')
    expect(approved).toBe(false)
    expect(Number.isNaN(Date.parse(expires_at))).toBe(false)
    expect(result.content[0].text).toContain('did not send anything')
    expect(result.content[0].text).toContain('cannot approve it yourself')
  })

  it('does not send however many times it is repeated', async () => {
    const h = await harness()
    for (let i = 0; i < 5; i++) await request(h)
    expect(h.calls.sendEmail).toHaveLength(0)
  })
})

describe('the second call', () => {
  it('sends once the token is approved, and passes the nonce as the idempotency key', async () => {
    const h = await harness()
    const { token } = await request(h)
    expect(await approve(h, token)).toBe(true)

    const sent = await h.call('send_email', { ...SEND_ARGS, confirmation_token: token })
    expect(sent.structuredContent.status).toBe('sent')
    expect(h.calls.sendEmail).toHaveLength(1)
    expect(h.calls.sendEmail[0]!.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{20,}$/)
  })

  it('spends the token, so a replay cannot send a second copy', async () => {
    const h = await harness()
    const { token } = await request(h)
    await approve(h, token)
    await h.call('send_email', { ...SEND_ARGS, confirmation_token: token })

    const replay = await h.call('send_email', { ...SEND_ARGS, confirmation_token: token })
    expect(replay.isError).toBe(true)
    expect(replay.structuredContent.reason).toBe('already_used')
    expect(h.calls.sendEmail).toHaveLength(1)
  })

  it('refuses a token no person has approved', async () => {
    const h = await harness()
    const { token } = await request(h)
    const attempt = await h.call('send_email', { ...SEND_ARGS, confirmation_token: token })
    expect(attempt.isError).toBe(true)
    expect(attempt.structuredContent.reason).toBe('not_approved')
    expect(h.calls.sendEmail).toHaveLength(0)
  })

  it('refuses a token the agent forged with a guessed secret', async () => {
    const h = await harness()
    const forger = new ConfirmationGate({ secret: 'a-secret-the-agent-picked' })
    const minted = await forger.mint({
      tool: 'send_email',
      workspaceId: 'ws_test',
      payload: {},
      summary: {} as never,
    })
    const attempt = await h.call('send_email', {
      ...SEND_ARGS,
      confirmation_token: minted.token,
    })
    expect(attempt.structuredContent.reason).toBe('invalid_token')
    expect(h.calls.sendEmail).toHaveLength(0)
  })

  it('refuses a token whose claims were edited to look approved', async () => {
    const h = await harness()
    const { token } = await request(h)
    const [encoded, signature] = token.split('.')
    const claims = JSON.parse(atob(encoded!.replace(/-/g, '+').replace(/_/g, '/')))
    claims.exp = claims.exp + 86_400_000
    const tampered = `${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${signature}`
    const attempt = await h.call('send_email', { ...SEND_ARGS, confirmation_token: tampered })
    expect(attempt.structuredContent.reason).toBe('invalid_token')
  })

  it('refuses a token bound to a different message', async () => {
    const h = await harness()
    const { token } = await request(h)
    await approve(h, token)

    const mutated = await h.call('send_email', {
      ...SEND_ARGS,
      to: 'someone-else@example.com',
      confirmation_token: token,
    })
    expect(mutated.isError).toBe(true)
    expect(mutated.structuredContent.reason).toBe('payload_changed')
    expect(h.calls.sendEmail).toHaveLength(0)
  })

  it('treats a cosmetic reshaping of the same message as the same message', async () => {
    const h = await harness()
    const { token } = await request(h, { ...SEND_ARGS, to: 'ada@example.com' })
    await approve(h, token)
    const sent = await h.call('send_email', {
      ...SEND_ARGS,
      to: ['ada@example.com'],
      confirmation_token: token,
    })
    expect(sent.structuredContent.status).toBe('sent')
  })

  it('refuses a token from another tool', async () => {
    const h = await harness()
    const { token } = await request(h)
    await approve(h, token)
    const attempt = await h.call('reply_to_thread', {
      thread_id: ids.thread,
      text: 'On it.',
      confirmation_token: token,
    })
    expect(attempt.structuredContent.reason).toBe('wrong_tool')
  })

  it('refuses a token minted for another workspace', async () => {
    const h = await harness()
    const gate = new ConfirmationGate({ secret: 'server-side-secret-never-shared' })
    const minted = await gate.mint({
      tool: 'send_email',
      workspaceId: 'ws_someone_else',
      payload: {},
      summary: {} as never,
    })
    const attempt = await h.call('send_email', { ...SEND_ARGS, confirmation_token: minted.token })
    expect(attempt.structuredContent.reason).toBe('wrong_workspace')
  })

  it('expires', async () => {
    const h = await harness({ ttlSeconds: 60 })
    const { token } = await request(h)
    await approve(h, token)
    h.clock.value += 61_000
    const attempt = await h.call('send_email', { ...SEND_ARGS, confirmation_token: token })
    expect(attempt.structuredContent.reason).toBe('expired')
    expect(h.calls.sendEmail).toHaveLength(0)
  })

  it('refuses a rejected confirmation', async () => {
    const h = await harness()
    const { token } = await request(h)
    await h.server.approvals.reject(token, 'usr_test')
    const attempt = await h.call('send_email', { ...SEND_ARGS, confirmation_token: token })
    expect(attempt.structuredContent.reason).toBe('not_approved')
  })
})

describe('reply_to_thread', () => {
  it('goes through the same gate', async () => {
    const h = await harness()
    const first = await h.call('reply_to_thread', { thread_id: ids.thread, text: 'On it.' })
    expect(first.structuredContent.status).toBe('confirmation_required')
    expect(first.structuredContent.confirmation.summary.thread_id).toBe(ids.thread)
    expect(first.structuredContent.confirmation.summary.subject).toBe('Re: Refund for order 4471')
    expect(h.calls.replyToThread).toHaveLength(0)

    const token = first.structuredContent.confirmation.token
    await approve(h, token)
    const sent = await h.call('reply_to_thread', {
      thread_id: ids.thread,
      text: 'On it.',
      confirmation_token: token,
    })
    expect(sent.structuredContent.status).toBe('sent')
    expect(h.calls.replyToThread).toHaveLength(1)
  })
})

describe('self-approval', () => {
  it('is not offered as a tool', async () => {
    const { rpc } = await harness()
    const names = ((await rpc('tools/list')).result.tools as { name: string }[]).map((t) => t.name)
    for (const forbidden of [
      'approve',
      'approve_confirmation',
      'confirm',
      'confirmations/approve',
    ]) {
      expect(names).not.toContain(forbidden)
    }
    expect(names.some((n) => /approv|confirm/i.test(n))).toBe(false)
  })

  it('is not reachable as a JSON-RPC method', async () => {
    const { rpc, server } = await harness()
    for (const method of [
      'approve',
      'confirmations/approve',
      'confirmation/approve',
      'tools/approve',
      'mailysend/approve',
    ]) {
      const body = await rpc(method, { token: 'anything' })
      expect(body.error.code, method).toBe(-32601)
    }
    // The capability exists — it is simply only reachable from the process that
    // constructed the server, which is the dashboard, not the agent.
    expect(typeof server.approvals.approve).toBe('function')
  })

  it('cannot be reached by passing a token through tools/call', async () => {
    const h = await harness()
    const body = await h.rpc('tools/call', {
      name: 'approve',
      arguments: { token: 'anything' },
    })
    expect(body.error.code).toBe(-32602)
  })
})

describe('the digest', () => {
  it('ignores key order but not content', async () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }))
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }))
    expect(canonicalize({ a: undefined, b: 1 })).toBe(canonicalize({ b: 1 }))
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]))
  })

  it('is an HMAC an agent cannot reproduce without the server key', async () => {
    const a = await hmacHex('server-side-secret-never-shared', 'payload')
    const b = await hmacHex('a-secret-the-agent-picked', 'payload')
    expect(a).not.toBe(b)
  })
})

describe('the spent-token store', () => {
  it('sweeps on the clock it was given, not on wall time', async () => {
    // The gate's clock is often *not* Date.now(): tests freeze it, and a Worker
    // may replay a queue message minted earlier. Sweeping on wall time drops
    // the entry the moment the two disagree, which turns a spent token back
    // into a spendable one.
    const clock = { value: Date.parse('2000-01-01T00:00:00.000Z') }
    const spent = new MemoryConsumedTokens({ now: () => clock.value })
    const exp = clock.value + 600_000

    expect(await spent.consume('tok', exp)).toBe(true)
    expect(await spent.consume('tok', exp)).toBe(false)

    clock.value = exp + 1
    expect(await spent.consume('tok', exp)).toBe(true)
  })
})
