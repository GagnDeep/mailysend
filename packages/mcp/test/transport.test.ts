import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '../src/server.ts'
import { harness, LIVE_KEY, SEND_ARGS } from './harness.ts'

const parseSse = (body: string) => {
  const lines = body.trim().split('\n')
  expect(lines[0]).toBe('event: message')
  return JSON.parse(lines[1]!.replace(/^data: /, ''))
}

describe('initialize', () => {
  it('advertises the protocol version, tools and instructions', async () => {
    const { rpc } = await harness()
    const body = await rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })
    expect(body.jsonrpc).toBe('2.0')
    expect(body.result.protocolVersion).toBe('2025-06-18')
    expect(body.result.capabilities.tools).toBeDefined()
    expect(body.result.serverInfo.name).toBe('mailysend')
    expect(body.result.instructions).toContain('never send on their first call')
  })

  it('answers an older client in the revision it asked for', async () => {
    const { rpc } = await harness()
    const body = await rpc('initialize', { protocolVersion: '2024-11-05' })
    expect(body.result.protocolVersion).toBe('2024-11-05')
  })

  it('falls back to the current revision for an unknown one', async () => {
    const { rpc } = await harness()
    const body = await rpc('initialize', { protocolVersion: '1999-01-01' })
    expect(body.result.protocolVersion).toBe(PROTOCOL_VERSION)
  })
})

describe('framing', () => {
  it('answers JSON when the client accepts JSON', async () => {
    const { post } = await harness()
    const response = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('mcp-protocol-version')).toBe(PROTOCOL_VERSION)
    expect(((await response.json()) as any).result.tools).toHaveLength(9)
  })

  it('answers an SSE stream when the client asks for one', async () => {
    const { post } = await harness()
    const response = await post(
      { jsonrpc: '2.0', id: 7, method: 'tools/list' },
      { accept: 'text/event-stream' },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const payload = parseSse(await response.text())
    expect(payload.id).toBe(7)
    expect(payload.result.tools).toHaveLength(9)
  })

  it('honours Accept order when a client lists both', async () => {
    const { post } = await harness()
    const sse = await post(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { accept: 'text/event-stream, application/json' },
    )
    expect(sse.headers.get('content-type')).toContain('text/event-stream')

    const json = await post(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { accept: 'application/json, text/event-stream' },
    )
    expect(json.headers.get('content-type')).toContain('application/json')
  })

  it('streams a tool call over SSE identically to JSON', async () => {
    const { post } = await harness()
    const body = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_domains', arguments: {} },
    }
    const sse = parseSse(await (await post(body, { accept: 'text/event-stream' })).text())
    const json = (await (await post(body)).json()) as any
    expect(sse.result.structuredContent).toEqual(json.result.structuredContent)
  })

  it('refuses an Accept header for a framing it does not speak', async () => {
    const { post } = await harness()
    const response = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { accept: 'text/plain' })
    expect(response.status).toBe(406)
  })

  it('treats a wildcard Accept as acceptable', async () => {
    const { post } = await harness()
    const response = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { accept: '*/*' })
    expect(response.status).toBe(200)
  })

  it('answers a notification with 202 and no body', async () => {
    const { post } = await harness()
    const response = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('refuses anything but POST', async () => {
    const { handler } = await harness()
    const response = await handler(
      new Request('https://api.mailysend.com/mcp', {
        method: 'GET',
        headers: { authorization: `Bearer ${LIVE_KEY}` },
      }),
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toContain('POST')
  })

  it('answers a CORS preflight', async () => {
    const { handler } = await harness()
    const response = await handler(
      new Request('https://api.mailysend.com/mcp', { method: 'OPTIONS' }),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
  })
})

describe('JSON-RPC errors', () => {
  it('reports a parse error', async () => {
    const { post } = await harness()
    const body = (await (await post('{not json')).json()) as any
    expect(body.error.code).toBe(-32700)
  })

  it('reports an invalid request', async () => {
    const { post } = await harness()
    const body = (await (await post({ id: 1, method: 'ping' })).json()) as any
    expect(body.error.code).toBe(-32600)
  })

  it('reports method not found', async () => {
    const { rpc } = await harness()
    expect((await rpc('does/not/exist')).error.code).toBe(-32601)
  })

  it('reports invalid params for an unknown tool', async () => {
    const { rpc } = await harness()
    const body = await rpc('tools/call', { name: 'nope', arguments: {} })
    expect(body.error.code).toBe(-32602)
    expect(body.error.message).toContain('nope')
  })

  it('reports invalid params when `name` is missing', async () => {
    const { rpc } = await harness()
    expect((await rpc('tools/call', {})).error.code).toBe(-32602)
  })

  it('rejects a JSON-RPC batch, which the 2025-06-18 revision removed', async () => {
    const { post } = await harness()
    const body = (await (
      await post([
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', id: 2, method: 'ping' },
      ])
    ).json()) as any
    expect(body.error.code).toBe(-32600)
    expect(body.error.message).toContain('batching')
  })

  it('surfaces a backend failure as an internal error, not a crash', async () => {
    const h = await harness()
    // A tool whose backend throws must still produce a well-formed envelope.
    const body = await h.rpc('tools/call', {
      name: 'send_email',
      arguments: { ...SEND_ARGS, subject: '' },
    })
    expect(body.result.isError).toBe(true)
  })
})
