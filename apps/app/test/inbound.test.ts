import { r2Key } from '@mailysend/core'
import type { QueueBatch } from '@mailysend/platform'
import { beforeEach, describe, expect, it } from 'vitest'
import { consumeInbound, type InboundJob } from '../src/server/consumers/inbound.ts'
import { handleInboundEmail, resolveMailbox } from '../src/server/inbound-handler.ts'
import { claimFor, type Harness, harness, sessionFor, verifiedDomain } from './harness.ts'

/**
 * The catch-all, and the two places a message can vanish.
 *
 * The receiving panel has always told the operator that binding the catch-all
 * in Cloudflare is what makes "every address below start arriving", while the
 * handler demanded an exact `inbound_mailboxes.address` match and the consumer
 * dropped anything it could not resolve without a log line or a row. So these
 * tests pin three properties: the toggle actually delivers, turning it off
 * actually bounces, and neither stage can disagree with the other about which
 * mailbox owns an address.
 */

let h: Harness
let cookie: string

beforeEach(async () => {
  h = await harness()
  const userId = await claimFor(h)
  cookie = await sessionFor(h, userId)
  await verifiedDomain(h, 'acme.dev')
})

const mime = (to: string) =>
  [
    'From: ana@example.com',
    `To: ${to}`,
    'Subject: Where is my order?',
    'Message-ID: <one@example.com>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'It never arrived.',
    '',
  ].join('\r\n')

async function addMailbox(
  address: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const res = await h.fetch('/v1/inbound/mailboxes', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ address, ...extra }),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as { id: string }
}

async function patchMailbox(id: string, body: Record<string, unknown>): Promise<void> {
  const res = await h.fetch(`/v1/inbound/mailboxes/${id}`, {
    method: 'PATCH',
    cookie,
    body: JSON.stringify(body),
  })
  expect(res.status).toBe(200)
}

/** Runs the real `email()` handler and reports what it decided. */
async function receive(to: string): Promise<{ rejection: string | null; queued: InboundJob[] }> {
  const queued: InboundJob[] = []
  const env = {
    ...h.env,
    INBOUND_QUEUE: {
      send: async (body: InboundJob) => void queued.push(body),
      sendBatch: async () => {},
    },
  } as unknown as typeof h.env

  let rejection: string | null = null
  const raw = mime(to)
  await handleInboundEmail(
    {
      from: 'ana@example.com',
      to,
      raw: new Response(raw).body as ReadableStream,
      rawSize: raw.length,
      headers: new Headers(),
      setReject: (reason: string) => {
        rejection = reason
      },
    },
    env,
  )
  return { rejection, queued }
}

const rejections = async (): Promise<{ recipient: string; diagnostic: string }[]> => {
  const rows = await h.sql
    .prepare(
      `SELECT recipient, diagnostic FROM message_events WHERE type = 'inbound.rejected' ORDER BY created_at`,
    )
    .all<{ recipient: string; diagnostic: string }>()
  return rows.results
}

describe('the catch-all', () => {
  it('delivers to an address that has no mailbox of its own', async () => {
    const { id } = await addMailbox('support@acme.dev')
    await patchMailbox(id, { is_catch_all: true })

    const { rejection, queued } = await receive('anything@acme.dev')
    expect(rejection).toBeNull()
    expect(queued[0]?.mailbox_id).toBe(id)
    expect(queued[0]?.matched).toBe('catch_all')
  })

  /**
   * Turning the toggle off does not turn receiving off.
   *
   * It used to: the domain went back to answering 550 for every address but
   * `support@`, which is a bounce for a Cloudflare rule that is still correctly
   * routing the whole domain here. The handler now adopts the domain instead,
   * so what the toggle actually decides is *which* mailbox the rest of the
   * domain lands in — never whether it is accepted.
   */
  it('keeps accepting the rest of the domain once the toggle is off', async () => {
    const { id } = await addMailbox('support@acme.dev')
    await patchMailbox(id, { is_catch_all: true })
    await patchMailbox(id, { is_catch_all: false })

    const { rejection, queued } = await receive('anything@acme.dev')
    expect(rejection).toBeNull()
    expect(queued[0]?.matched).toBe('catch_all')
    expect(queued[0]?.mailbox_id).not.toBe(id)

    // Nothing was refused, so there is nothing to record as a refusal.
    expect(await rejections()).toHaveLength(0)

    const adopted = await h.sql
      .prepare('SELECT address FROM inbound_mailboxes WHERE id = ?')
      .bind(queued[0]?.mailbox_id)
      .first<{ address: string }>()
    expect(adopted?.address).toBe('catch-all@acme.dev')
  })

  /**
   * C2/C3 still hold, for the one recipient that is genuinely refused: a domain
   * nobody in this deployment has added. That check is the security boundary —
   * without it a routing rule aimed here would file a stranger's mail into this
   * workspace — so the reject path keeps its legible trace.
   */
  it('bounces a domain nobody here owns, and says so legibly', async () => {
    const { rejection, queued } = await receive('anything@not-ours.test')
    expect(rejection).toMatch(/^550 5\.1\.1 No such mailbox: anything@not-ours\.test$/)
    expect(queued).toHaveLength(0)

    const rows = await rejections()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.recipient).toBe('anything@not-ours.test')
    expect(rows[0]?.diagnostic).toContain('not-ours.test')
  })

  it('never steals mail from an address that owns a mailbox', async () => {
    const catchAll = await addMailbox('hello@acme.dev')
    await patchMailbox(catchAll.id, { is_catch_all: true })
    const exact = await addMailbox('support@acme.dev')

    const { queued } = await receive('support@acme.dev')
    expect(queued[0]?.mailbox_id).toBe(exact.id)
    expect(queued[0]?.matched).toBe('address')
  })

  it('holds one catch-all per domain', async () => {
    const first = await addMailbox('one@acme.dev')
    await patchMailbox(first.id, { is_catch_all: true })
    const second = await addMailbox('two@acme.dev')
    await patchMailbox(second.id, { is_catch_all: true })

    const list = await h.fetch('/v1/inbound/mailboxes', { cookie })
    const body = (await list.json()) as { data: { id: string; is_catch_all: boolean }[] }
    expect(body.data.filter((row) => row.is_catch_all).map((row) => row.id)).toEqual([second.id])
  })

  it('resolves the same mailbox at the door and in the consumer', async () => {
    const { id } = await addMailbox('support@acme.dev')
    await patchMailbox(id, { is_catch_all: true })

    const { queued } = await receive('anyone@acme.dev')
    const direct = await resolveMailbox(h.sql, 'ws_default', 'anyone@acme.dev')
    expect(direct?.id).toBe(queued[0]?.mailbox_id)
  })
})

describe('a mailbox that disappears mid-flight', () => {
  it('records the drop instead of returning in silence', async () => {
    const { id } = await addMailbox('support@acme.dev')
    const { queued } = await receive('support@acme.dev')
    const job = queued[0] as InboundJob

    await h.blob.put(job.raw_key, mime('support@acme.dev'))
    await h.sql.prepare('DELETE FROM inbound_mailboxes WHERE id = ?').bind(id).run()

    await consumeInbound(
      {
        queue: 'ms-inbound',
        messages: [
          {
            id: '1',
            timestamp: new Date(),
            attempts: 1,
            body: job,
            ack: () => {},
            retry: () => {},
          },
        ],
        ackAll: () => {},
        retryAll: () => {},
      } as unknown as QueueBatch<InboundJob>,
      h.env,
    )

    const rows = await rejections()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.diagnostic).toContain('Accepted at the door')
  })
})

describe('storage', () => {
  it('writes the raw bytes under the workspace before enqueuing', async () => {
    const { id } = await addMailbox('support@acme.dev')
    expect(id).toBeTruthy()
    const { queued } = await receive('support@acme.dev')
    expect(queued[0]?.raw_key).toBe(r2Key.rawInbound('ws_default', queued[0]?.inbound_id as string))
    const stored = await h.blob.list({ prefix: 'rawin/' })
    expect(stored.objects).toHaveLength(1)
  })
})
