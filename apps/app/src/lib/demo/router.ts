import * as demo from './data.ts'
import { demoEmail } from './state.ts'

/**
 * The tour's answer to every `/v1` call.
 *
 * `lib/api-client.ts` funnels the whole dashboard through one `request()`, so
 * there is exactly one place to intercept and this is what it calls. The reply
 * is then handed to the *same* Zod schema the real response would have been
 * parsed with — which is the point: a fixture that drifts from the contract
 * fails loudly on the screen that reads it, instead of rendering `undefined` as
 * "NaN%" in a demo nobody is watching closely enough to notice.
 *
 * Unknown paths return an empty list rather than throwing. Thirty-odd screens
 * read this and only the ones worth showing have fixtures; the rest render the
 * empty states they were designed with, which is a truthful answer to "there is
 * nothing here" and a much better outcome than an error boundary.
 */

export class DemoReadOnly extends Error {
  readonly status = 403
  constructor() {
    super('This is a demo — nothing you do here is saved. Deploy your own to send real mail.')
    this.name = 'DemoReadOnly'
  }
}

const list = <T>(data: T[]) => ({
  object: 'list' as const,
  data,
  has_more: false,
  next_cursor: null,
})

type Query = Record<string, unknown> | undefined

const text = (query: Query, key: string): string | undefined => {
  const value = query?.[key]
  return value === undefined || value === null || value === '' ? undefined : String(value)
}

/**
 * The log filters, applied for real.
 *
 * A filter bar that does nothing is worse than no filter bar — it is the one
 * interaction on the page and the demo is about interaction. These are the
 * three the log page actually sends.
 */
const filterLogs = (query: Query) => {
  const status = text(query, 'status')
  const search = text(query, 'search') ?? text(query, 'q')
  const provider = text(query, 'provider')
  const domain = text(query, 'domain_id')
  const wanted = status
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return demo.logs.filter((row) => {
    if (wanted?.length && !wanted.includes(row.status)) return false
    if (provider && row.provider !== provider) return false
    if (domain && row.domain_id !== domain) return false
    if (search) {
      const haystack = `${row.subject} ${row.to.join(' ')} ${row.from}`.toLowerCase()
      if (!haystack.includes(search.toLowerCase())) return false
    }
    return true
  })
}

const filterThreads = (query: Query) => {
  const folder = text(query, 'folder') ?? 'inbox'
  const search = text(query, 'q') ?? text(query, 'search')
  return demo.mailThreads.filter((thread) => {
    if (folder !== 'all' && thread.folder !== folder) return false
    if (search) {
      const haystack = `${thread.subject} ${thread.participants.join(' ')} ${thread.snippet ?? ''}`
      if (!haystack.toLowerCase().includes(search.toLowerCase())) return false
    }
    return true
  })
}

/** `/audiences/aud_x/contacts/con_y` → `['audiences','aud_x','contacts','con_y']`. */
const segmentsOf = (path: string): string[] => path.replace(/^\/+|\/+$/g, '').split('/')

/**
 * Reads are answered; everything else is refused with the same sentence.
 *
 * Deliberately one refusal rather than a per-endpoint story. The visitor is
 * being shown what the product looks like, not being walked through which of
 * its buttons are wired up — and a demo that half-saves things is a demo that
 * lies about what it is.
 */
/**
 * Every screen asks for a page size and the fixtures are longer than most of
 * them want. Honouring `limit` in one place — rather than in twenty `slice`
 * calls — is what makes "the last few messages" a few of them.
 */
const capped = (answer: unknown, query: Query): unknown => {
  const limit = Number(text(query, 'limit'))
  if (!Number.isFinite(limit) || limit <= 0) return answer
  const shape = answer as { object?: string; data?: unknown[] }
  if (shape?.object !== 'list' || !Array.isArray(shape.data)) return answer
  return { ...shape, data: shape.data.slice(0, limit), has_more: shape.data.length > limit }
}

export const demoResponse = (method: string, path: string, query: Query): unknown =>
  capped(answer(method, path, query), query)

const answer = (method: string, path: string, query: Query): unknown => {
  if (method !== 'GET') {
    // Two exceptions, because both are pure reads wearing a POST: the segment
    // editor's preview and the agent queue's list-with-a-filter.
    if (path === '/segments/preview') return segmentPreview()
    throw new DemoReadOnly()
  }

  const parts = segmentsOf(path)
  const [head, first, second, third] = parts

  switch (head) {
    case 'me':
      return demo.demoUser(demoEmail())

    case 'logs':
      return first ? demo.logDetail(first) : list(filterLogs(query).slice(0, 50))

    case 'emails': {
      const ids = new Set(filterLogs(query).map((row) => row.id))
      return first
        ? demo.emails.find((row) => row.id === first)
        : list(demo.emails.filter((row) => ids.has(row.id)).slice(0, 50))
    }

    case 'domains': {
      if (!first) return list(demo.domains)
      const domain = demo.domains.find((d) => d.id === first) ?? demo.domains[0]
      return domain
    }

    case 'api-keys':
      return list(demo.apiKeys)

    case 'audiences': {
      if (!first) return list(demo.audiences)
      if (second === 'contacts') {
        if (third) return demo.contacts(first).find((c) => c.id === third)
        return list(demo.contacts(first))
      }
      return demo.audiences.find((a) => a.id === first) ?? demo.audiences[0]
    }

    case 'contacts':
      // `/contacts/search` — the composer's lookahead.
      return list(
        demo
          .contacts(demo.AUDIENCE_IDS.customers)
          .filter((c) => c.email.includes((text(query, 'q') ?? '').toLowerCase()))
          .slice(0, 8)
          .map((c) => ({
            object: 'contact_suggestion' as const,
            id: c.id,
            audience_id: c.audience_id,
            email: c.email,
            name: [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
          })),
      )

    case 'segments':
      return first
        ? (demo.segments.find((s) => s.id === first) ?? demo.segments[0])
        : list(demo.segments)

    case 'templates': {
      if (!first) return list(demo.templates)
      if (second === 'versions') {
        const versions = demo.templateVersions(first)
        return third ? versions.find((v) => v.version === Number(third)) : list(versions)
      }
      return demo.templates.find((t) => t.id === first) ?? demo.templates[0]
    }

    case 'broadcasts':
      return first
        ? (demo.broadcasts.find((b) => b.id === first) ?? demo.broadcasts[0])
        : list(demo.broadcasts)

    case 'automations':
      return first
        ? (demo.automations.find((a) => a.id === first) ?? demo.automations[0])
        : list(demo.automations)

    case 'webhooks': {
      if (!first) return list(demo.webhooks)
      if (second === 'attempts') return list(demo.webhookAttempts(first))
      return demo.webhooks.find((w) => w.id === first) ?? demo.webhooks[0]
    }

    case 'suppressions':
      return list(demo.suppressions)

    case 'inbound':
      return list(demo.mailboxes)

    case 'mcp':
      return list(demo.confirmations)

    case 'providers':
      if (first === 'catalog') return list([])
      return {
        ...list(demo.providers),
        environment_fallback: ['cloudflare'],
        default_provider: 'cloudflare',
      }

    case 'analytics':
      if (first === 'placement') return demo.placementReport
      if (first === 'placement-tests') {
        return second ? demo.seedTests.find((t) => t.id === second) : list(demo.seedTests)
      }
      return demo.analyticsFor(text(query, 'granularity'))

    case 'workspace':
      if (first === 'settings') return demo.settings
      if (first === 'members') return list(demo.members(demoEmail()))
      if (first === 'invites') return list(demo.invites)
      return demo.settings

    case 'preference-centre':
      return demo.preferenceCentre

    case 'mail': {
      if (first === 'counts') return demo.mailCounts
      if (first === 'identities') return demo.mailIdentities
      if (first === 'labels') return list(demo.mailLabels)
      if (first === 'drafts') return list([])
      if (first === 'threads') {
        if (!second) return { ...list(filterThreads(query)), query: [] }
        if (third === 'messages') return list(demo.mailMessages(second))
        return demo.mailThreadDetail(second)
      }
      if (first === 'messages') {
        if (third === 'headers') return list(demo.mailHeaders)
        const thread = demo.mailThreads.find((t) =>
          demo.mailMessages(t.id).some((m) => m.id === second),
        )
        return demo
          .mailMessages(thread?.id ?? demo.mailThreads[0]?.id ?? '')
          .find((m) => m.id === second)
      }
      return list([])
    }

    default:
      return list([])
  }
}

/**
 * The `.eml` the reader shows when somebody clicks "original".
 *
 * Assembled rather than stored: the point of that view is that the headers are
 * the ones the message actually carried, and a fixture that is plausibly shaped
 * makes that point as well as a 40 KB blob would.
 */
export const demoRawMessage = (id: string): string => {
  const message = demo.mailThreads
    .flatMap((thread) => demo.mailMessages(thread.id))
    .find((m) => m.id === id)
  if (!message) return 'No stored original.'
  return [
    `Received: from mx.example.net by route1.mx.cloudflare.net; ${message.at}`,
    `Authentication-Results: mx.cloudflare.net; spf=${message.spf ?? 'none'}; dkim=${message.dkim ?? 'none'}; dmarc=${message.dmarc ?? 'none'}`,
    `Message-ID: ${message.message_id ?? '<unknown>'}`,
    `From: ${message.from_name ? `${message.from_name} <${message.from}>` : message.from}`,
    `To: ${message.to.join(', ')}`,
    `Subject: ${message.subject}`,
    `Date: ${message.at}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    message.text ?? '',
  ].join('\n')
}

/** A real answer would need the segment parser; this is the shape of one. */
const segmentPreview = () => ({
  valid: true,
  describe: 'contacts who opened or clicked in the last 30 days',
  error: null,
  match_count: 2_918,
  sample: demo.contacts(demo.AUDIENCE_IDS.customers).slice(0, 5),
})
