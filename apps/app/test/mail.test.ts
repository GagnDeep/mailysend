import { r2Key } from '@mailysend/core'
import type { QueueBatch } from '@mailysend/platform'
import { beforeEach, describe, expect, it } from 'vitest'
import { consumeInbound, type InboundJob } from '../src/server/consumers/inbound.ts'
import { handleInboundEmail, parseAuthResults } from '../src/server/inbound-handler.ts'
import { claimFor, type Harness, harness, sessionFor, verifiedDomain } from './harness.ts'

/**
 * The mail pipeline, end to end.
 *
 * Every bug this release fixes was invisible to a unit test and obvious the
 * moment a message went through the real path: a `WHERE enabled = 1` against a
 * column that does not exist, a thread table with no writer, an attachment
 * written to storage with no row pointing at it. So these tests deliver real
 * MIME through the real handler and the real consumer, then read the result
 * back through the real API.
 */

let h: Harness
let cookie: string

beforeEach(async () => {
  h = await harness()
  const userId = await claimFor(h)
  cookie = await sessionFor(h, userId)
  await verifiedDomain(h, 'acme.dev')
})

/** A minimal but genuine RFC 5322 message. */
function mime(
  opts: {
    from?: string
    to?: string
    subject?: string
    messageId?: string
    inReplyTo?: string
    references?: string
    html?: string
  } = {},
): string {
  const lines = [
    `From: ${opts.from ?? 'ana@example.com'}`,
    `To: ${opts.to ?? 'support@acme.dev'}`,
    `Subject: ${opts.subject ?? 'Where is my order?'}`,
    `Message-ID: ${opts.messageId ?? '<one@example.com>'}`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.references ? [`References: ${opts.references}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    opts.html ?? '<p>It never arrived.</p>',
    '',
  ]
  return lines.join('\r\n')
}

/** Puts a message in storage and runs the consumer over it, as the queue would. */
async function deliver(job: Partial<InboundJob> & { raw: string }): Promise<string> {
  const inboundId = job.inbound_id ?? `inb_${Math.random().toString(36).slice(2, 12).toUpperCase()}`
  const rawKey = job.raw_key ?? r2Key.rawInbound('ws_default', inboundId)
  await h.blob.put(rawKey, job.raw)
  const body: InboundJob = {
    workspace_id: 'ws_default',
    inbound_id: inboundId,
    raw_key: rawKey,
    to: job.to ?? 'support@acme.dev',
    from: job.from ?? 'ana@example.com',
    ...(job.auth ? { auth: job.auth } : {}),
    received_at: job.received_at ?? new Date().toISOString(),
  }
  await consumeInbound(batchOf(body), h.env)
  return inboundId
}

function batchOf(body: InboundJob): QueueBatch<InboundJob> {
  return {
    queue: 'ms-inbound',
    messages: [
      { id: '1', timestamp: new Date(), attempts: 1, body, ack: () => {}, retry: () => {} },
    ],
    ackAll: () => {},
    retryAll: () => {},
  } as unknown as QueueBatch<InboundJob>
}

async function addMailbox(address = 'support@acme.dev'): Promise<string> {
  const res = await h.fetch('/v1/inbound/mailboxes', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ address }),
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { id: string }).id
}

const listThreads = async () => {
  const res = await h.fetch('/v1/mail/threads', { cookie })
  expect(res.status).toBe(200)
  return (await res.json()) as {
    data: {
      id: string
      subject: string
      unread: boolean
      message_count: number
      has_attachments: boolean
      folder: string
    }[]
  }
}

describe('receiving', () => {
  it('rejects mail for an address that is not a mailbox', async () => {
    let rejection: string | null = null
    await handleInboundEmail(
      {
        from: 'ana@example.com',
        to: 'nobody@acme.dev',
        raw: new Response('x').body!,
        rawSize: 1,
        headers: new Headers(),
        setReject: (reason) => {
          rejection = reason
        },
      },
      h.env,
    )
    expect(rejection).toMatch(/^550 5\.1\.1 No such mailbox: nobody@acme\.dev$/)
  })

  /**
   * The regression this whole release starts from. `inbound_mailboxes` has no
   * `enabled` column, so the handler's lookup threw inside Cloudflare's mail
   * pipeline and every message was deferred and then bounced.
   */
  it('accepts mail for a mailbox that exists', async () => {
    await addMailbox()
    let rejection: string | null = null
    await handleInboundEmail(
      {
        from: 'ana@example.com',
        to: 'support@acme.dev',
        raw: new Response(mime()).body!,
        rawSize: mime().length,
        headers: new Headers({ 'authentication-results': 'mx; spf=pass; dkim=pass; dmarc=pass' }),
        setReject: (reason) => {
          rejection = reason
        },
      },
      h.env,
    )
    expect(rejection).toBeNull()
    const stored = await h.blob.list({ prefix: 'rawin/' })
    expect(stored.objects).toHaveLength(1)
  })

  it('puts a delivered message in a thread the API can see', async () => {
    await addMailbox()
    await deliver({ raw: mime() })

    const threads = await listThreads()
    expect(threads.data).toHaveLength(1)
    expect(threads.data[0]?.subject).toBe('Where is my order?')
    expect(threads.data[0]?.unread).toBe(true)
    expect(threads.data[0]?.folder).toBe('inbox')
  })

  it('does not duplicate a message the queue delivers twice', async () => {
    await addMailbox()
    const raw = mime()
    const inboundId = 'inb_DUPLICATE0000000000000000'
    await deliver({ raw, inbound_id: inboundId })
    await deliver({ raw, inbound_id: inboundId })

    const threads = await listThreads()
    expect(threads.data).toHaveLength(1)
    expect(threads.data[0]?.message_count).toBe(1)
  })

  it('records the authentication verdicts the edge saw', async () => {
    await addMailbox()
    await deliver({
      raw: mime(),
      auth: { spf: 'pass', dkim: 'fail', dmarc: 'pass' },
    })
    const threads = await listThreads()
    const detail = await h.fetch(`/v1/mail/threads/${threads.data[0]!.id}`, { cookie })
    const body = (await detail.json()) as { messages: { spf: string; dkim: string }[] }
    expect(body.messages[0]?.spf).toBe('pass')
    expect(body.messages[0]?.dkim).toBe('fail')
  })

  it('threads a reply onto its parent by In-Reply-To', async () => {
    await addMailbox()
    await deliver({ raw: mime({ messageId: '<one@example.com>' }) })
    await deliver({
      raw: mime({
        messageId: '<two@example.com>',
        inReplyTo: '<one@example.com>',
        subject: 'Re: Where is my order?',
      }),
    })

    const threads = await listThreads()
    expect(threads.data).toHaveLength(1)
    expect(threads.data[0]?.message_count).toBe(2)
  })

  it('threads on References when In-Reply-To was rewritten away', async () => {
    await addMailbox()
    await deliver({ raw: mime({ messageId: '<one@example.com>' }) })
    await deliver({
      raw: mime({
        messageId: '<three@example.com>',
        references: '<one@example.com>',
        subject: 'Fwd: Where is my order?',
      }),
    })

    const threads = await listThreads()
    expect(threads.data).toHaveLength(1)
    const detail = await h.fetch(`/v1/mail/threads/${threads.data[0]!.id}`, { cookie })
    const body = (await detail.json()) as { messages: { matched_by: string }[] }
    expect(body.messages[1]?.matched_by).toBe('references')
  })

  it('keeps a message it cannot parse, rather than dropping it', async () => {
    await addMailbox()
    // Three attempts then `recordRawOnly`, which is the path that must not lose
    // the message. The body is absent from storage, so parsing cannot succeed.
    const job: InboundJob = {
      workspace_id: 'ws_default',
      inbound_id: 'inb_BROKEN000000000000000000',
      raw_key: 'rawin/ws_default/missing.eml',
      to: 'support@acme.dev',
      from: 'ana@example.com',
      received_at: new Date().toISOString(),
    }
    const batch = batchOf(job)
    ;(batch.messages[0] as { attempts: number }).attempts = 3
    await consumeInbound(batch, h.env)

    const threads = await listThreads()
    expect(threads.data).toHaveLength(1)
    expect(threads.data[0]?.subject).toBe('(unparsed message)')
  })
})

describe('authentication results', () => {
  it('reads each method out of the header', () => {
    expect(parseAuthResults('mx.acme.dev; spf=pass; dkim=fail; dmarc=none')).toEqual({
      spf: 'pass',
      dkim: 'fail',
      dmarc: 'none',
    })
  })

  it('is null when there is no header at all, rather than guessing a pass', () => {
    expect(parseAuthResults(null)).toEqual({ spf: null, dkim: null, dmarc: null })
  })
})

describe('sending from the mail surface', () => {
  it('files an accepted send as a sent conversation', async () => {
    const res = await h.fetch('/v1/mail/send', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        from: 'team@acme.dev',
        to: ['ana@example.com'],
        subject: 'Your order shipped',
        text: 'It is on the way.',
      }),
    })
    expect(res.status).toBe(200)

    const sent = await h.fetch('/v1/mail/threads?folder=sent', { cookie })
    const body = (await sent.json()) as { data: { subject: string; last_direction: string }[] }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.subject).toBe('Your order shipped')
    expect(body.data[0]?.last_direction).toBe('out')
  })

  it('puts a reply in the same conversation as the message it answers', async () => {
    await addMailbox()
    await deliver({ raw: mime({ messageId: '<one@example.com>' }) })
    const threads = await listThreads()
    const threadId = threads.data[0]!.id

    const res = await h.fetch('/v1/mail/send', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        thread_id: threadId,
        from: 'support@acme.dev',
        to: ['ana@example.com'],
        text: 'It shipped this morning.',
      }),
    })
    expect(res.status).toBe(200)

    const detail = await h.fetch(`/v1/mail/threads/${threadId}`, { cookie })
    const body = (await detail.json()) as {
      messages: { direction: string; reply_to: string | null; subject: string }[]
    }
    expect(body.messages).toHaveLength(2)
    expect(body.messages[1]?.direction).toBe('out')
    expect(body.messages[1]?.subject).toBe('Re: Where is my order?')
    // The reply token — minted for the first time in this release, so that a
    // reply to our reply can be threaded with certainty instead of guessed.
    expect(body.messages[1]?.reply_to).toMatch(/^thr\+.+@acme\.dev$/)
  })
})

describe('identities', () => {
  /**
   * The From menu used to be a template string: `mail@` concatenated onto the
   * first verified domain. It offered an address nobody had created and never
   * offered the mailboxes somebody had. These assertions are about the list
   * being derived from the data.
   */
  it('lists real mailboxes ahead of the synthetic domain address', async () => {
    await verifiedDomain(h, 'beta.dev')
    await addMailbox('support@acme.dev')

    const res = await h.fetch('/v1/mail/identities', { cookie })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { address: string; source: string; can_receive_replies: boolean }[]
      sendable_domains: { name: string }[]
    }

    expect(body.data.map((i) => i.address)).toEqual(['support@acme.dev', 'hello@beta.dev'])
    expect(body.data[0]?.source).toBe('mailbox')
    // The distinction the old picker could not express: sending from an address
    // with no mailbox behind it works, and the reply goes nowhere.
    expect(body.data[0]?.can_receive_replies).toBe(true)
    expect(body.data[1]?.can_receive_replies).toBe(false)
    expect(body.sendable_domains.map((d) => d.name).sort()).toEqual(['acme.dev', 'beta.dev'])
    expect(body.data.some((i) => i.address.startsWith('mail@'))).toBe(false)
  })

  it('offers nothing for a domain that is not verified', async () => {
    await h.sql.prepare("UPDATE domains SET status = 'pending' WHERE name = 'acme.dev'").run()
    const res = await h.fetch('/v1/mail/identities', { cookie })
    const body = (await res.json()) as { data: unknown[]; sendable_domains: unknown[] }
    expect(body.data).toHaveLength(0)
    expect(body.sendable_domains).toHaveLength(0)
  })

  it('accepts a send from a local part nobody created a mailbox for', async () => {
    // The gate is the domain, not the local part. A person who verified a
    // domain may send as any address on it; the warning about replies going
    // nowhere is advisory, and lives in the composer.
    const res = await h.fetch('/v1/mail/send', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        from: 'invoices-q3@acme.dev',
        to: ['ana@example.com'],
        subject: 'Invoice',
        text: 'Attached.',
      }),
    })
    expect(res.status).toBe(200)

    const sent = await h.fetch('/v1/mail/threads?folder=sent', { cookie })
    const body = (await sent.json()) as { data: { subject: string }[] }
    expect(body.data).toHaveLength(1)
  })

  it('refuses a send from a domain the workspace has not verified', async () => {
    const res = await h.fetch('/v1/mail/send', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        from: 'anyone@somebody-elses.dev',
        to: ['ana@example.com'],
        subject: 'Nope',
        text: 'Nope.',
      }),
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('carries an explicit reply-to over the minted thread token', async () => {
    await addMailbox()
    await deliver({ raw: mime({ messageId: '<one@example.com>' }) })
    const threadId = (await listThreads()).data[0]!.id

    await h.fetch('/v1/mail/send', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        thread_id: threadId,
        from: 'support@acme.dev',
        to: ['ana@example.com'],
        text: 'Write to the other desk instead.',
        reply_to: ['billing@acme.dev'],
      }),
    })

    const detail = await h.fetch(`/v1/mail/threads/${threadId}`, { cookie })
    const body = (await detail.json()) as { messages: { reply_to: string | null }[] }
    expect(body.messages[1]?.reply_to).toBe('billing@acme.dev')
  })
})

describe('organising', () => {
  it('archives and restores a conversation', async () => {
    await addMailbox()
    await deliver({ raw: mime() })
    const threadId = (await listThreads()).data[0]!.id

    await h.fetch(`/v1/mail/threads/${threadId}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ folder: 'archive' }),
    })
    expect((await listThreads()).data.map((t) => t.folder)).toEqual(['archive'])

    const counts = await h.fetch('/v1/mail/counts', { cookie })
    const body = (await counts.json()) as { folders: Record<string, { threads: number }> }
    expect(body.folders.archive?.threads).toBe(1)
    expect(body.folders.inbox?.threads).toBe(0)
  })

  it('marks a conversation read, and its messages with it', async () => {
    await addMailbox()
    await deliver({ raw: mime() })
    const threadId = (await listThreads()).data[0]!.id

    await h.fetch(`/v1/mail/threads/${threadId}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ unread: false }),
    })
    expect((await listThreads()).data[0]?.unread).toBe(false)
  })

  it('deletes a conversation and everything under it', async () => {
    await addMailbox()
    await deliver({ raw: mime() })
    const threadId = (await listThreads()).data[0]!.id

    const res = await h.fetch(`/v1/mail/threads/${threadId}`, { method: 'DELETE', cookie })
    expect(res.status).toBe(200)
    expect((await listThreads()).data).toHaveLength(0)
    const search = await h.fetch('/v1/mail/threads?q=order', { cookie })
    expect(((await search.json()) as { data: unknown[] }).data).toHaveLength(0)
  })
})

describe('search', () => {
  beforeEach(async () => {
    await addMailbox()
    await deliver({ raw: mime({ subject: 'Refund for order 4182', from: 'ana@example.com' }) })
    await deliver({
      raw: mime({
        subject: 'Shipping delay',
        from: 'raj@other.test',
        messageId: '<delay@other.test>',
      }),
    })
  })

  it('finds a conversation by a word in its subject', async () => {
    const res = await h.fetch('/v1/mail/threads?q=refund', { cookie })
    const body = (await res.json()) as { data: { subject: string }[] }
    expect(body.data.map((t) => t.subject)).toEqual(['Refund for order 4182'])
  })

  it('filters by sender', async () => {
    const res = await h.fetch(`/v1/mail/threads?q=${encodeURIComponent('from:raj')}`, { cookie })
    const body = (await res.json()) as { data: { subject: string }[] }
    expect(body.data.map((t) => t.subject)).toEqual(['Shipping delay'])
  })

  it('negates an operator', async () => {
    const res = await h.fetch(`/v1/mail/threads?q=${encodeURIComponent('-from:raj')}`, { cookie })
    const body = (await res.json()) as { data: { subject: string }[] }
    expect(body.data.map((t) => t.subject)).toEqual(['Refund for order 4182'])
  })

  /**
   * The property the segment DSL has and this must have too: a value is never
   * part of the SQL string, so there is no input that can change the shape of
   * the query. The rows have to still be there afterwards.
   */
  it('treats an injection attempt as text', async () => {
    for (const attack of [
      "from:x' OR 1=1 --",
      "subject:'; DROP TABLE mail_threads; --",
      'label:") OR ("a"="a',
      'in:inbox); DELETE FROM mail_messages; --',
    ]) {
      const res = await h.fetch(`/v1/mail/threads?q=${encodeURIComponent(attack)}`, { cookie })
      expect(res.status).toBe(200)
    }
    const still = await h.fetch('/v1/mail/threads', { cookie })
    expect(((await still.json()) as { data: unknown[] }).data).toHaveLength(2)
  })
})

describe('test mode', () => {
  /**
   * The feature that makes the inbox useful on a brand-new instance: no domain
   * verified for live sending, no provider credentials, no DNS — and a message
   * you compose still arrives, with its body and its original MIME intact.
   */
  it('delivers a test-mode send back into the inbox', async () => {
    const { consumeSend } = await import('../src/server/send/consumer.ts')
    const testHarness = await harness()
    const userId = await claimFor(testHarness)
    const testCookie = await sessionFor(testHarness, userId)
    await verifiedDomain(testHarness, 'acme.dev')

    // A test-environment session is what the environment switch produces.
    const jobs: unknown[] = []
    testHarness.env.SEND_QUEUE = {
      send: async (job: unknown) => {
        jobs.push(job)
      },
      sendBatch: async () => {},
    } as never

    const res = await testHarness.fetch('/v1/mail/send', {
      method: 'POST',
      cookie: testCookie,
      body: JSON.stringify({
        from: 'team@acme.dev',
        to: ['someone@example.com'],
        subject: 'Does this thing work?',
        html: '<p>Apparently it does.</p>',
        // The queued path specifically: this test drives the consumer itself,
        // and needs the job in its hands rather than already delivered.
        immediate: false,
      }),
    })
    expect(res.status).toBe(200)
    expect(jobs).toHaveLength(1)

    // Force the message into the test environment, as the environment switch
    // would, then run the consumer over the job the accept path enqueued.
    const job = jobs[0] as { envelope: { environment: string } }
    job.envelope.environment = 'test'
    await testHarness.sql.prepare("UPDATE messages SET environment = 'test'").run()
    await testHarness.sql.prepare("UPDATE mail_threads SET environment = 'test'").run()
    await testHarness.sql.prepare("UPDATE mail_messages SET environment = 'test'").run()
    await consumeSend(batchOf(job as never) as never, testHarness.env)

    const delivered = await testHarness.fetch('/v1/mail/threads?folder=inbox', {
      cookie: testCookie,
      headers: { 'ms-environment': 'test' },
    })
    const body = (await delivered.json()) as {
      data: { id: string; subject: string; last_direction: string }[]
    }
    expect(body.data.map((t) => t.subject)).toContain('Does this thing work?')

    const thread = body.data.find((t) => t.last_direction === 'in')!
    const detail = await testHarness.fetch(`/v1/mail/threads/${thread.id}`, {
      cookie: testCookie,
      headers: { 'ms-environment': 'test' },
    })
    const full = (await detail.json()) as { messages: { html: string; has_raw: boolean }[] }
    expect(full.messages[0]?.html).toContain('Apparently it does.')
    // The original MIME, kept — so "raw .eml" is a real tab and not a promise.
    expect(full.messages[0]?.has_raw).toBe(true)
  })
})

/**
 * The composer's default, and the reason it is the default.
 *
 * A queue is an excellent way to send a hundred thousand messages and a poor
 * way to send one: it adds a hop that has to exist (Cloudflare Queues are not
 * on every plan) and has to be consumed. When either is untrue the API still
 * answers 202, the composer still says Sent, and the message sits at `sending`
 * with no provider and no error — which is the state the user reported and the
 * one state nobody can act on from the outside.
 */
describe('immediate sending', () => {
  it('delivers a test-mode send inline, with no consumer and no queue', async () => {
    const testHarness = await harness()
    const userId = await claimFor(testHarness)
    const testCookie = await sessionFor(testHarness, userId)
    await verifiedDomain(testHarness, 'acme.dev')

    const jobs: unknown[] = []
    testHarness.env.SEND_QUEUE = {
      send: async (job: unknown) => {
        jobs.push(job)
      },
      sendBatch: async () => {},
    } as never

    const res = await testHarness.fetch('/v1/mail/send', {
      method: 'POST',
      cookie: testCookie,
      headers: { 'ms-environment': 'test' },
      body: JSON.stringify({
        from: 'team@acme.dev',
        to: ['someone@example.com'],
        subject: 'Straight through',
        html: '<p>No queue involved.</p>',
      }),
    })
    expect(res.status).toBe(200)
    // Nothing was handed to the queue, and yet the mail arrived.
    expect(jobs).toHaveLength(0)

    const delivered = await testHarness.fetch('/v1/mail/threads?folder=inbox', {
      cookie: testCookie,
      headers: { 'ms-environment': 'test' },
    })
    const body = (await delivered.json()) as { data: { subject: string }[] }
    expect(body.data.map((t) => t.subject)).toContain('Straight through')
  })

  it('records the failure on the send itself rather than leaving it at sending', async () => {
    const testHarness = await harness()
    const userId = await claimFor(testHarness)
    const testCookie = await sessionFor(testHarness, userId)
    await verifiedDomain(testHarness, 'acme.dev')

    const res = await testHarness.fetch('/v1/mail/send', {
      method: 'POST',
      cookie: testCookie,
      body: JSON.stringify({
        from: 'team@acme.dev',
        to: ['someone@example.com'],
        subject: 'Nowhere to go',
        text: 'No provider is configured on this instance.',
      }),
    })
    expect(res.status).toBe(200)
    const { id } = (await res.json()) as { id: string }

    // By the time the composer's request returns, the message has a verdict:
    // a permanent failure with a reason a person can read, not `sending`.
    const detail = await testHarness.fetch(`/v1/emails/${id}`, { cookie: testCookie })
    const email = (await detail.json()) as {
      last_event: string
      provider: string | null
      error: string | null
    }
    expect(email.last_event).toBe('failed')
    expect(email.error).toMatch(/no sending provider is configured/i)
    // And routed-then-refused, so the reader is not left with `unassigned`.
    expect(email.provider).toBe('cloudflare')
  })

  it('still queues when the caller asks it to', async () => {
    const testHarness = await harness()
    const userId = await claimFor(testHarness)
    const testCookie = await sessionFor(testHarness, userId)
    await verifiedDomain(testHarness, 'acme.dev')

    const jobs: unknown[] = []
    testHarness.env.SEND_QUEUE = {
      send: async (job: unknown) => {
        jobs.push(job)
      },
      sendBatch: async () => {},
    } as never

    const res = await testHarness.fetch('/v1/mail/send', {
      method: 'POST',
      cookie: testCookie,
      body: JSON.stringify({
        from: 'team@acme.dev',
        to: ['someone@example.com'],
        subject: 'Take your time',
        text: 'Bulk traffic still belongs on a queue.',
        immediate: false,
      }),
    })
    expect(res.status).toBe(200)
    expect(jobs).toHaveLength(1)
  })

  it('sends inline when there is no queue binding at all', async () => {
    const testHarness = await harness()
    const userId = await claimFor(testHarness)
    const testCookie = await sessionFor(testHarness, userId)
    await verifiedDomain(testHarness, 'acme.dev')

    // A deployment on a plan without Queues. Asking to queue cannot be honoured,
    // and dropping the message would be the worst of the available outcomes.
    testHarness.env.SEND_QUEUE = undefined as never

    const res = await testHarness.fetch('/v1/mail/send', {
      method: 'POST',
      cookie: testCookie,
      headers: { 'ms-environment': 'test' },
      body: JSON.stringify({
        from: 'team@acme.dev',
        to: ['someone@example.com'],
        subject: 'No queue here',
        html: '<p>Delivered anyway.</p>',
        immediate: false,
      }),
    })
    expect(res.status).toBe(200)

    const delivered = await testHarness.fetch('/v1/mail/threads?folder=inbox', {
      cookie: testCookie,
      headers: { 'ms-environment': 'test' },
    })
    const body = (await delivered.json()) as { data: { subject: string }[] }
    expect(body.data.map((t) => t.subject)).toContain('No queue here')
  })
})

/**
 * The response the browser is actually given, checked against the schema the
 * browser actually parses it with.
 *
 * The thread list echoes the parsed query back, and the client's schema said
 * `string[]` while the server had always sent `{operator, value, negated}[]`.
 * Zod rejected the whole response, so clicking any mailbox in the rail — which
 * is just `mailbox:<id>` in the search box — replaced the conversation list
 * with "Could not load your conversations". Typechecking cannot see across the
 * wire; this can.
 */
describe('the wire format the dashboard parses', () => {
  it('returns a thread list the client schema accepts, query and all', async () => {
    const { MailThreadList } = await import('../src/lib/api-client.ts')
    const listHarness = await harness()
    const userId = await claimFor(listHarness)
    const listCookie = await sessionFor(listHarness, userId)
    await verifiedDomain(listHarness, 'acme.dev')

    const created = await listHarness.fetch('/v1/inbound/mailboxes', {
      method: 'POST',
      cookie: listCookie,
      body: JSON.stringify({ address: 'support@acme.dev' }),
    })
    expect(created.status).toBeLessThan(300)
    const mailbox = (await created.json()) as { id: string }

    // Exactly what the rail puts in the search box when a mailbox is clicked.
    const res = await listHarness.fetch(
      `/v1/mail/threads?q=${encodeURIComponent(`mailbox:${mailbox.id} -is:read urgent`)}`,
      { cookie: listCookie },
    )
    expect(res.status).toBe(200)
    const parsed = MailThreadList.safeParse(await res.json())
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.success).toBe(true)
    expect(parsed.data?.query).toEqual([
      { operator: 'mailbox', value: mailbox.id, negated: false },
      { operator: 'is', value: 'read', negated: true },
      { operator: null, value: 'urgent', negated: false },
    ])
  })
})

/**
 * The guarantee behind inline sending: no path leaves a message at `sending`.
 *
 * The lease is what makes redelivery safe, and it is also what a dead worker
 * leaves behind — a row claimed by nobody, past `queued`, short of `failed`,
 * with no provider and no error. This is the sweep that ends that state, one
 * way or the other.
 */
describe('sends whose worker died', () => {
  const stuck = async (h: Harness, cookie: string) => {
    const res = await h.fetch('/v1/mail/send', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        from: 'team@acme.dev',
        to: ['someone@example.com'],
        subject: 'Held',
        text: 'Leased and abandoned.',
        immediate: false,
      }),
    })
    const { id } = (await res.json()) as { id: string }
    // Exactly what `handleOne` writes when it claims a message, with a lease
    // that has since expired and no verdict after it.
    await h.sql
      .prepare(
        `UPDATE messages SET status = 'sending', state_rank = 20, lease_until = ? WHERE id = ?`,
      )
      .bind(Date.now() - 10 * 60_000, id)
      .run()
    return id
  }

  it('fails an abandoned send whose envelope is gone, with a reason', async () => {
    const { reclaimStuckSends } = await import('../src/server/send/consumer.ts')
    const h2 = await harness()
    const userId = await claimFor(h2)
    const cookie = await sessionFor(h2, userId)
    await verifiedDomain(h2, 'acme.dev')
    const id = await stuck(h2, cookie)

    await reclaimStuckSends(h2.env, 'ws_default')

    const row = await h2.sql
      .prepare('SELECT status, error_message, lease_until FROM messages WHERE id = ?')
      .bind(id)
      .first<{ status: string; error_message: string; lease_until: number | null }>()
    expect(row?.status).toBe('failed')
    expect(row?.error_message).toMatch(/interrupted/i)
    expect(row?.lease_until).toBeNull()
  })

  it('leaves a lease that has not expired alone', async () => {
    const { reclaimStuckSends } = await import('../src/server/send/consumer.ts')
    const h2 = await harness()
    const userId = await claimFor(h2)
    const cookie = await sessionFor(h2, userId)
    await verifiedDomain(h2, 'acme.dev')
    const id = await stuck(h2, cookie)
    // A slow SMTP conversation, still in progress. Stealing it is the double
    // send the lease exists to prevent.
    await h2.sql
      .prepare('UPDATE messages SET lease_until = ? WHERE id = ?')
      .bind(Date.now() + 60_000, id)
      .run()

    await reclaimStuckSends(h2.env, 'ws_default')

    const row = await h2.sql
      .prepare('SELECT status FROM messages WHERE id = ?')
      .bind(id)
      .first<{ status: string }>()
    expect(row?.status).toBe('sending')
  })
})
