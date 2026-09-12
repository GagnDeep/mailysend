import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/http.ts'
import { API_KEY, BASE_URL, bodyOf, harness, json } from './helpers.ts'

describe('transport', () => {
  it('sends the api key, accept and user-agent on every request', async () => {
    const h = harness([json({ object: 'list', data: [], has_more: false })])
    await h.client.domains.list()

    const { headers, url, init } = h.call()
    expect(init.method).toBe('GET')
    expect(url.href).toBe(`${BASE_URL}/v1/domains`)
    expect(headers.authorization).toBe(`Bearer ${API_KEY}`)
    expect(headers.accept).toBe('application/json')
    expect(headers['user-agent']).toMatch(/^mailysend-node\//)
  })

  it('drops absent query params instead of serialising undefined', async () => {
    const h = harness([json({ object: 'list', data: [], has_more: false })])
    await h.client.emails.list({ limit: 10, after: undefined, status: 'delivered' })

    expect(h.call().url.search).toBe('?limit=10&status=delivered')
  })

  it('trims a trailing slash off the base url', async () => {
    const h = harness([json({ object: 'list', data: [], has_more: false })])
    // Reaching through the client rather than constructing a second one keeps
    // the assertion about the URL that actually goes out.
    expect(h.client.http.baseUrl).toBe(BASE_URL)
  })

  it('encodes path segments that can contain reserved characters', async () => {
    const h = harness([json({ object: 'suppression', id: 'x', deleted: true })])
    await h.client.suppressions.remove('someone+tag@example.com')

    expect(h.call().url.pathname).toBe('/v1/suppressions/someone%2Btag%40example.com')
  })

  it('returns undefined for a 204 rather than failing to parse an empty body', async () => {
    const h = harness([new Response(null, { status: 204 })])
    await expect(h.client.audiences.remove('aud_1')).resolves.toBeUndefined()
  })
})

describe('emails', () => {
  it('send posts the payload to /v1/emails', async () => {
    const h = harness([json({ id: 'em_1', created_at: '2026-01-01T00:00:00Z' })])
    const payload = { from: 'a@example.com', to: 'b@example.com', subject: 'Hi', text: 'Hello' }
    const result = await h.client.emails.send(payload)

    const { url, init } = h.call()
    expect(init.method).toBe('POST')
    expect(url.pathname).toBe('/v1/emails')
    expect(bodyOf(init)).toEqual(payload)
    expect(result.id).toBe('em_1')
  })

  it('batch posts an array to /v1/emails/batch', async () => {
    const h = harness([
      json({ data: [{ id: 'em_1' }, { index: 1, error: { name: 'x', message: 'y' } }] }),
    ])
    const result = await h.client.emails.batch([
      { from: 'a@example.com', to: 'b@example.com', subject: 'One', text: '1' },
      { from: 'a@example.com', to: 'bad', subject: 'Two', text: '2' },
    ])

    expect(h.call().url.pathname).toBe('/v1/emails/batch')
    expect(result.data).toHaveLength(2)
  })

  it('covers get, update, cancel and events', async () => {
    const h = harness([
      json({ object: 'email', id: 'em_1' }),
      json({ object: 'email', id: 'em_1' }),
      json({ object: 'email', id: 'em_1' }),
      json({ object: 'list', data: [], has_more: false }),
    ])

    await h.client.emails.get('em_1')
    await h.client.emails.update('em_1', { scheduled_at: 'in 1 hour' })
    await h.client.emails.cancel('em_1')
    await h.client.emails.events('em_1')

    expect(h.call(0).url.pathname).toBe('/v1/emails/em_1')
    expect(h.call(1).init.method).toBe('PATCH')
    expect(bodyOf(h.call(1).init)).toEqual({ scheduled_at: 'in 1 hour' })
    expect(h.call(2).init.method).toBe('DELETE')
    expect(h.call(3).url.pathname).toBe('/v1/emails/em_1/events')
  })
})

describe('domains', () => {
  it('covers the whole resource', async () => {
    const h = harness(Array.from({ length: 7 }, () => json({ object: 'domain', id: 'dom_1' })))

    await h.client.domains.create({ name: 'example.com' })
    await h.client.domains.list()
    await h.client.domains.get('dom_1')
    await h.client.domains.update('dom_1', { open_tracking: false })
    await h.client.domains.verify('dom_1')
    await h.client.domains.quota('dom_1')
    await h.client.domains.remove('dom_1')

    expect(h.call(0)).toMatchObject({ init: { method: 'POST' } })
    expect(h.call(0).url.pathname).toBe('/v1/domains')
    expect(h.call(1).init.method).toBe('GET')
    expect(h.call(2).url.pathname).toBe('/v1/domains/dom_1')
    expect(h.call(3).init.method).toBe('PATCH')
    expect(h.call(4).url.pathname).toBe('/v1/domains/dom_1/verify')
    expect(h.call(5).url.pathname).toBe('/v1/domains/dom_1/quota')
    expect(h.call(6).init.method).toBe('DELETE')
  })
})

describe('api keys', () => {
  it('covers create, list, get and remove', async () => {
    const h = harness(Array.from({ length: 4 }, () => json({ object: 'api_key', id: 'key_1' })))

    await h.client.apiKeys.create({ name: 'ci' })
    await h.client.apiKeys.list()
    await h.client.apiKeys.get('key_1')
    await h.client.apiKeys.remove('key_1')

    expect(h.call(0).url.pathname).toBe('/v1/api-keys')
    expect(bodyOf(h.call(0).init)).toEqual({ name: 'ci' })
    expect(h.call(2).url.pathname).toBe('/v1/api-keys/key_1')
    expect(h.call(3).init.method).toBe('DELETE')
  })
})

describe('audiences and contacts', () => {
  it('covers audiences', async () => {
    const h = harness(Array.from({ length: 5 }, () => json({ object: 'audience', id: 'aud_1' })))

    await h.client.audiences.create({ name: 'Newsletter' })
    await h.client.audiences.list({ limit: 5 })
    await h.client.audiences.get('aud_1')
    await h.client.audiences.update('aud_1', { name: 'Weekly' })
    await h.client.audiences.remove('aud_1')

    expect(h.call(0).url.pathname).toBe('/v1/audiences')
    expect(h.call(1).url.search).toBe('?limit=5')
    expect(h.call(3).init.method).toBe('PATCH')
    expect(h.call(4).init.method).toBe('DELETE')
  })

  it('covers flat contacts including import', async () => {
    const h = harness(Array.from({ length: 6 }, () => json({ object: 'contact', id: 'con_1' })))

    await h.client.contacts.create({ email: 'a@example.com' })
    await h.client.contacts.list({ audience_id: 'aud_1' })
    await h.client.contacts.get('con_1')
    await h.client.contacts.update('con_1', { first_name: 'Ada' })
    await h.client.contacts.remove('con_1')
    await h.client.contacts.import({ audience_id: 'aud_1', contacts: [{ email: 'b@example.com' }] })

    expect(h.call(0).url.pathname).toBe('/v1/contacts')
    expect(h.call(1).url.search).toBe('?audience_id=aud_1')
    expect(h.call(2).url.pathname).toBe('/v1/contacts/con_1')
    expect(h.call(5).url.pathname).toBe('/v1/contacts/import')
  })

  it('covers contacts nested under an audience', async () => {
    const h = harness(Array.from({ length: 5 }, () => json({ object: 'contact', id: 'con_1' })))

    await h.client.audiences.contacts.create('aud_1', { email: 'a@example.com' })
    await h.client.audiences.contacts.list('aud_1')
    await h.client.audiences.contacts.get('aud_1', 'con_1')
    await h.client.audiences.contacts.update('aud_1', 'con_1', { last_name: 'Lovelace' })
    await h.client.audiences.contacts.remove('aud_1', 'con_1')

    expect(h.call(0).url.pathname).toBe('/v1/audiences/aud_1/contacts')
    expect(h.call(2).url.pathname).toBe('/v1/audiences/aud_1/contacts/con_1')
    expect(h.call(4).init.method).toBe('DELETE')
  })
})

describe('segments', () => {
  it('covers the whole resource', async () => {
    const h = harness(Array.from({ length: 7 }, () => json({ object: 'segment', id: 'seg_1' })))

    await h.client.segments.create({
      name: 'Engaged',
      audience_id: 'aud_1',
      expression: 'opened_last_30d',
    })
    await h.client.segments.list()
    await h.client.segments.preview({ audience_id: 'aud_1', expression: 'opened_last_30d' })
    await h.client.segments.get('seg_1')
    await h.client.segments.update('seg_1', { expression: 'clicked_last_7d' })
    await h.client.segments.recompute('seg_1')
    await h.client.segments.remove('seg_1')

    expect(h.call(2).url.pathname).toBe('/v1/segments/preview')
    expect(h.call(5).url.pathname).toBe('/v1/segments/seg_1/recompute')
  })
})

describe('templates', () => {
  it('covers versions, publish, rollback, preview and test', async () => {
    const h = harness(Array.from({ length: 10 }, () => json({ object: 'template', id: 'tpl_1' })))

    await h.client.templates.create({ name: 'Welcome' })
    await h.client.templates.list()
    await h.client.templates.get('tpl_1')
    await h.client.templates.update('tpl_1', { subject: 'Hi' })
    await h.client.templates.createVersion('tpl_1', { html: '<p>hi</p>' })
    await h.client.templates.listVersions('tpl_1')
    await h.client.templates.publish('tpl_1')
    await h.client.templates.rollback('tpl_1', { version: 2 })
    await h.client.templates.preview('tpl_1', { data: { name: 'Ada' } })
    await h.client.templates.test('tpl_1', { to: 'a@example.com' })

    expect(h.call(4).url.pathname).toBe('/v1/templates/tpl_1/versions')
    expect(h.call(5).init.method).toBe('GET')
    expect(h.call(6).url.pathname).toBe('/v1/templates/tpl_1/publish')
    expect(bodyOf(h.call(7).init)).toEqual({ version: 2 })
    expect(h.call(8).url.pathname).toBe('/v1/templates/tpl_1/preview')
    expect(h.call(9).url.pathname).toBe('/v1/templates/tpl_1/test')
  })

  it('preview posts an empty object when no data is supplied', async () => {
    const h = harness([json({ subject: null, html: '', text: '' })])
    await h.client.templates.preview('tpl_1')

    expect(bodyOf(h.call().init)).toEqual({})
  })
})

describe('broadcasts', () => {
  it('covers the whole resource', async () => {
    const h = harness(Array.from({ length: 6 }, () => json({ object: 'broadcast', id: 'bc_1' })))

    await h.client.broadcasts.create({ audience_id: 'aud_1', from: 'a@example.com', subject: 'Hi' })
    await h.client.broadcasts.list()
    await h.client.broadcasts.get('bc_1')
    await h.client.broadcasts.update('bc_1', { subject: 'Hello' })
    await h.client.broadcasts.send('bc_1', { scheduled_at: 'tomorrow at 9am' })
    await h.client.broadcasts.remove('bc_1')

    expect(h.call(4).url.pathname).toBe('/v1/broadcasts/bc_1/send')
    expect(bodyOf(h.call(4).init)).toEqual({ scheduled_at: 'tomorrow at 9am' })
  })
})

describe('automations', () => {
  it('covers enrollment and lifecycle endpoints', async () => {
    const h = harness(Array.from({ length: 10 }, () => json({ object: 'automation', id: 'aut_1' })))

    await h.client.automations.create({
      name: 'Onboarding',
      trigger: { type: 'contact_created', audience_id: 'aud_1' },
      steps: [{ type: 'send', subject: 'Welcome' }],
    })
    await h.client.automations.list()
    await h.client.automations.get('aut_1')
    await h.client.automations.update('aut_1', { name: 'Onboarding v2' })
    await h.client.automations.activate('aut_1')
    await h.client.automations.pause('aut_1')
    await h.client.automations.enrollments('aut_1', { status: 'active' })
    await h.client.automations.enroll('aut_1', { contact_ids: ['con_1'] })
    await h.client.automations.unenroll('aut_1', 'con_1')
    await h.client.automations.stats('aut_1')

    expect(h.call(4).url.pathname).toBe('/v1/automations/aut_1/activate')
    expect(h.call(5).url.pathname).toBe('/v1/automations/aut_1/pause')
    expect(h.call(6).url.search).toBe('?status=active')
    expect(h.call(7).url.pathname).toBe('/v1/automations/aut_1/enroll')
    expect(h.call(8).url.pathname).toBe('/v1/automations/aut_1/enrollments/con_1')
    expect(h.call(8).init.method).toBe('DELETE')
    expect(h.call(9).url.pathname).toBe('/v1/automations/aut_1/stats')
  })
})

describe('suppressions', () => {
  it('covers create, list and bulk', async () => {
    const h = harness(Array.from({ length: 3 }, () => json({ object: 'suppression' })))

    await h.client.suppressions.create({ email: 'a@example.com', reason: 'manual' })
    await h.client.suppressions.list({ reason: 'hard_bounce' })
    await h.client.suppressions.bulk({ suppressions: [{ email: 'b@example.com' }] })

    expect(h.call(1).url.search).toBe('?reason=hard_bounce')
    expect(h.call(2).url.pathname).toBe('/v1/suppressions/bulk')
  })
})

describe('webhooks', () => {
  it('covers the whole resource', async () => {
    const h = harness(Array.from({ length: 7 }, () => json({ object: 'webhook', id: 'wh_1' })))

    await h.client.webhooks.create({ url: 'https://example.com/hook', events: ['email.sent'] })
    await h.client.webhooks.list()
    await h.client.webhooks.get('wh_1')
    await h.client.webhooks.update('wh_1', { status: 'disabled' })
    await h.client.webhooks.deliveries('wh_1')
    await h.client.webhooks.replay('wh_1', 'del_1')
    await h.client.webhooks.test('wh_1')

    expect(h.call(4).url.pathname).toBe('/v1/webhooks/wh_1/deliveries')
    expect(h.call(5).url.pathname).toBe('/v1/webhooks/wh_1/deliveries/del_1/replay')
    expect(h.call(6).url.pathname).toBe('/v1/webhooks/wh_1/test')
  })
})

describe('analytics', () => {
  it('covers every report', async () => {
    const h = harness(Array.from({ length: 8 }, () => json({ object: 'list', data: [] })))

    await h.client.analytics.overview({ granularity: 'day' })
    await h.client.analytics.timeseries()
    await h.client.analytics.byDomain()
    await h.client.analytics.byTag()
    await h.client.analytics.engagement({ audience_class: 'human' })
    await h.client.analytics.placement()
    await h.client.analytics.createPlacementTest({ domain_id: 'dom_1' })
    await h.client.analytics.getPlacementTest('plt_1')

    expect(h.call(0).url.pathname).toBe('/v1/analytics/overview')
    expect(h.call(0).url.search).toBe('?granularity=day')
    expect(h.call(1).url.pathname).toBe('/v1/analytics/timeseries')
    expect(h.call(2).url.pathname).toBe('/v1/analytics/by-domain')
    expect(h.call(3).url.pathname).toBe('/v1/analytics/by-tag')
    expect(h.call(4).url.search).toBe('?audience_class=human')
    expect(h.call(5).url.pathname).toBe('/v1/analytics/placement')
    expect(h.call(6).url.pathname).toBe('/v1/analytics/placement-tests')
    expect(h.call(7).url.pathname).toBe('/v1/analytics/placement-tests/plt_1')
  })
})

describe('inbound', () => {
  it('covers threads, replies and messages', async () => {
    const h = harness(Array.from({ length: 4 }, () => json({ object: 'list', data: [] })))

    await h.client.inbound.listThreads({ unread: true })
    await h.client.inbound.getThread('thr_1')
    await h.client.inbound.reply('thr_1', { text: 'Thanks!' })
    await h.client.inbound.getMessage('inb_1')

    expect(h.call(0).url.pathname).toBe('/v1/inbound/threads')
    expect(h.call(0).url.search).toBe('?unread=true')
    expect(h.call(1).url.pathname).toBe('/v1/inbound/threads/thr_1')
    expect(h.call(2).url.pathname).toBe('/v1/inbound/threads/thr_1/reply')
    expect(h.call(3).url.pathname).toBe('/v1/inbound/messages/inb_1')
  })
})

describe('the published package', () => {
  /**
   * `VERSION` is a literal in `src/http.ts` because the published bundle has no
   * package.json to read at runtime — it is bundled for Workers and Deno as
   * much as for Node. That makes it the one value that can silently disagree
   * with what npm actually shipped, and it is the value every request announces
   * in its `user-agent`, so a stale one misattributes traffic in the server's
   * own logs. Bump one, and this fails until you bump the other.
   */
  it('announces the version it was published as', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string }

    expect(VERSION).toBe(manifest.version)
  })
})
