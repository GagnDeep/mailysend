import { describe, expect, it } from 'vitest'
import { SENDING_TOOLS, TOOL_NAMES, TOOLS } from '../src/tools.ts'
import { harness } from './harness.ts'

const NINE = [
  'send_email',
  'list_emails',
  'get_email',
  'search_threads',
  'get_thread',
  'reply_to_thread',
  'list_domains',
  'get_analytics',
  'create_contact',
]

describe('the tool surface', () => {
  it('is exactly nine tools, named as specified', async () => {
    const { rpc } = await harness()
    const listed = (await rpc('tools/list')).result.tools as { name: string }[]
    expect(listed).toHaveLength(9)
    expect(listed.map((t) => t.name).sort()).toEqual([...NINE].sort())
    expect([...TOOL_NAMES].sort()).toEqual([...NINE].sort())
  })

  it('emits input schemas as plain JSON Schema with no nested $schema', async () => {
    const { rpc } = await harness()
    const listed = (await rpc('tools/list')).result.tools as Record<string, any>[]
    for (const tool of listed) {
      expect(tool.inputSchema, tool.name).toBeTypeOf('object')
      expect(tool.inputSchema.type, tool.name).toBe('object')
      expect(tool.inputSchema.$schema, tool.name).toBeUndefined()
      expect(JSON.stringify(tool.inputSchema)).not.toContain('$schema')
      expect(tool.description, tool.name).toBeTypeOf('string')
    }
  })

  it('derives the send schema from the contract rather than restating it', async () => {
    const { rpc } = await harness()
    const listed = (await rpc('tools/list')).result.tools as Record<string, any>[]
    const send = listed.find((t) => t.name === 'send_email')!
    // The fields that come straight out of `SendEmailRequest`.
    expect(Object.keys(send.inputSchema.properties)).toEqual(
      expect.arrayContaining(['from', 'to', 'subject', 'html', 'text', 'attachments', 'tags']),
    )
    expect(send.inputSchema.properties.subject.maxLength).toBe(998)
    expect(send.inputSchema.properties.confirmation_token.type).toBe('string')
  })

  it('marks the sending tools as requiring confirmation, machine-readably', async () => {
    const { rpc } = await harness()
    const listed = (await rpc('tools/list')).result.tools as Record<string, any>[]
    for (const name of SENDING_TOOLS) {
      const tool = listed.find((t) => t.name === name)!
      expect(tool['x-mailysend-confirmation']).toBe('required')
      expect(tool._meta['mailysend/confirmation']).toBe('required')
      expect(tool.annotations.readOnlyHint).toBe(false)
      expect(tool.annotations.destructiveHint).toBe(true)
      expect(tool.annotations.openWorldHint).toBe(true)
      expect(tool.inputSchema.properties.confirmation_token).toBeDefined()
    }
  })

  it('leaves read-only tools free of the confirmation contract', async () => {
    const { rpc } = await harness()
    const listed = (await rpc('tools/list')).result.tools as Record<string, any>[]
    const readOnly = listed.filter((t) => !SENDING_TOOLS.includes(t.name))
    expect(readOnly).toHaveLength(7)
    for (const tool of readOnly) {
      expect(tool['x-mailysend-confirmation'], tool.name).toBeUndefined()
      expect(tool.inputSchema.properties?.confirmation_token, tool.name).toBeUndefined()
    }
    for (const name of [
      'list_emails',
      'get_email',
      'search_threads',
      'get_thread',
      'list_domains',
      'get_analytics',
    ]) {
      expect(listed.find((t) => t.name === name)!.annotations.readOnlyHint, name).toBe(true)
    }
  })

  it('never leaks the handler or the permission requirement onto the wire', async () => {
    const { rpc } = await harness()
    const listed = (await rpc('tools/list')).result.tools as Record<string, any>[]
    for (const tool of listed) {
      expect(tool.handler).toBeUndefined()
      expect(tool.permission).toBeUndefined()
    }
    expect(TOOLS.every((t) => typeof t.handler === 'function')).toBe(true)
  })
})

describe('read tools', () => {
  it('lists emails', async () => {
    const { call, calls } = await harness()
    const result = await call('list_emails', { limit: 10 })
    expect(calls.listEmails).toBe(1)
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.data).toHaveLength(1)
    expect(result.content[0].text).toContain('Your receipt')
  })

  it('reports a missing email as a tool error rather than a protocol error', async () => {
    const { call } = await harness()
    const result = await call('get_email', { email_id: 'em_00000000000000000000000000' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No message')
  })

  it('rejects arguments the contract refuses, with the field named', async () => {
    const { call } = await harness()
    const result = await call('get_email', { email_id: 'not-an-id' })
    expect(result.isError).toBe(true)
    expect(result.structuredContent.issues[0]).toContain('email_id')
  })

  it('searches threads through the mailbox index', async () => {
    const { call } = await harness()
    const result = await call('search_threads', { query: 'refund' })
    expect(result.structuredContent.data[0].subject).toContain('Refund')
  })

  it('returns analytics with the audience class stated', async () => {
    const { call } = await harness()
    const result = await call('get_analytics', {})
    expect(result.structuredContent.audience_class).toBe('human')
    expect(result.content[0].text).toContain('human')
  })

  it('lists domains and creates contacts', async () => {
    const { call, calls } = await harness()
    expect((await call('list_domains')).structuredContent.data[0].name).toBe('mailysend.com')
    const created = await call('create_contact', { email: 'ada@example.com' })
    expect(calls.createContact).toBe(1)
    expect(created.structuredContent.object).toBe('contact')
  })
})
