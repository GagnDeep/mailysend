import { describe, expect, it } from 'vitest'
import { harness, ids, SEND_ARGS, SENDING_KEY } from './harness.ts'

describe('authentication', () => {
  it('refuses a request with no Authorization header', async () => {
    const { post } = await harness()
    const response = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { key: null })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('Bearer')
    const body = (await response.json()) as any
    expect(body.error.data.code).toBe('missing_api_key')
  })

  it('refuses a token that is not a MailySend key', async () => {
    const { post } = await harness()
    const response = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { key: 'sk_openai_x' })
    expect(response.status).toBe(401)
    expect(((await response.json()) as any).error.data.code).toBe('invalid_api_key')
  })

  it('refuses a well-formed key that resolves to nothing', async () => {
    const { post } = await harness()
    const response = await post(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { key: 'ms_live_unknown' },
    )
    expect(response.status).toBe(401)
    expect(((await response.json()) as any).error.data.code).toBe('invalid_api_key')
  })

  it('never authenticates before it has a key, even for tools/list', async () => {
    const { post } = await harness()
    const response = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { key: null })
    expect(response.status).toBe(401)
  })
})

describe('key permissions', () => {
  it('lets a sending key send', async () => {
    const h = await harness()
    const first = await h.call('send_email', SEND_ARGS, { key: SENDING_KEY })
    expect(first.structuredContent.status).toBe('confirmation_required')
  })

  it('still makes a sending key wait for a human', async () => {
    const h = await harness()
    const first = await h.call('send_email', SEND_ARGS, { key: SENDING_KEY })
    const token = first.structuredContent.confirmation.token
    const second = await h.call(
      'send_email',
      { ...SEND_ARGS, confirmation_token: token },
      { key: SENDING_KEY },
    )
    expect(second.structuredContent.reason).toBe('not_approved')
    expect(h.calls.sendEmail).toHaveLength(0)
  })

  it('refuses a sending key on the management tools', async () => {
    const h = await harness()
    for (const name of [
      'list_emails',
      'get_email',
      'search_threads',
      'get_thread',
      'list_domains',
      'get_analytics',
      'create_contact',
    ]) {
      const body = await h.rpc(
        'tools/call',
        { name, arguments: name === 'get_email' ? { email_id: ids.email } : {} },
        { key: SENDING_KEY },
      )
      expect(body.error.code, name).toBe(-32001)
      expect(body.error.data.code, name).toBe('restricted_api_key')
    }
  })

  it('lists all nine tools regardless of key scope', async () => {
    const h = await harness()
    const body = await h.rpc('tools/list', undefined, { key: SENDING_KEY })
    expect(body.result.tools).toHaveLength(9)
  })
})
