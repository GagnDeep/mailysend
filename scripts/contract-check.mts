/**
 * The dashboard contract check.
 *
 * Hits every read-only dashboard endpoint through the dashboard's own client,
 * so each response is parsed by the same Zod schema the screens parse it with.
 * Drift shows up here as a failed parse rather than as an error card.
 *
 * It creates a row of each kind first, on purpose. An empty table parses under
 * any schema — the first version of this check passed while the domains screen
 * was failing in production, because there was no domain to disagree about.
 */
import { createApiClient } from '../apps/app/src/lib/api-client.ts'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8917'
const KEY = process.env.KEY ?? ''
if (!KEY) {
  console.error('Set KEY to an API key (the first one is printed on first boot).')
  process.exit(2)
}
;(globalThis as { MS_PUBLIC_URL?: string }).MS_PUBLIC_URL = BASE

const nativeFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) =>
  nativeFetch(input, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${KEY}` },
  })) as typeof fetch

const api = createApiClient({ environment: 'live' })

/** Rows to disagree about. Created before anything is read back. */
async function seed(): Promise<{ audienceId: string; domainId: string }> {
  const domain = await api.createDomain({ name: `check-${Date.now()}.example` })
  const audience = await api.createAudience({ name: 'Contract check' })
  await api.createContact(audience.id, {
    email: `check-${Date.now()}@example.com`,
    first_name: 'Ada',
    last_name: 'Lovelace',
  })
  await api.createTemplate({
    name: `check-${Date.now()}`,
    subject: 'Contract check',
    html: '<p>Contract check</p>',
  })
  await api.createSegment({
    name: 'Contract check',
    audience_id: audience.id,
    expression: 'last_open_at > 30d',
  })
  await api.createBroadcast({
    name: 'Contract check',
    audience_id: audience.id,
    from: 'Check <check@example.com>',
    subject: 'Contract check',
    html: '<p>Contract check</p>',
  })
  await api.createWebhook({
    url: 'https://example.com/hooks/mailysend',
    events: ['email.delivered', 'email.bounced'],
  })
  await api.createSuppression({ email: 'suppressed@example.com', reason: 'hard_bounce' })
  await api.createApiKey({ name: 'Contract check' })
  return { audienceId: audience.id, domainId: domain.id }
}

const buildChecks = (audienceId: string, domainId: string): [string, () => Promise<unknown>][] => [
  ['domain (by id)', () => api.getDomain(domainId)],
  ['contacts', () => api.listContacts(audienceId, { limit: 5 })],
  [
    'template versions',
    () =>
      api
        .listTemplates({ limit: 1 })
        .then((t) => (t.data[0] ? api.listTemplateVersions(t.data[0].id) : null)),
  ],
  ['emails', () => api.listEmails({ limit: 5 })],
  ['logs', () => api.listLogs({ limit: 5 })],
  ['domains', () => api.listDomains({ limit: 5 })],
  ['api-keys', () => api.listApiKeys({ limit: 5 })],
  ['audiences', () => api.listAudiences({ limit: 5 })],
  ['segments', () => api.listSegments({ limit: 5 })],
  ['templates', () => api.listTemplates({ limit: 5 })],
  ['broadcasts', () => api.listBroadcasts({ limit: 5 })],
  ['automations', () => api.listAutomations({ limit: 5 })],
  ['webhooks', () => api.listWebhooks({ limit: 5 })],
  ['suppressions', () => api.listSuppressions({ limit: 5 })],
  ['inbound threads', () => api.listThreads({ limit: 5 })],
  ['analytics', () => api.analytics({})],
  ['placement', () => api.placement({})],
  ['placement tests', () => api.listSeedTests({ limit: 5 })],
  ['settings', () => api.getSettings()],
  ['members', () => api.listMembers()],
  ['invites', () => api.listInvites()],
  ['preference centre', () => api.getPreferenceCentre()],
]

async function main() {
  const { audienceId, domainId } = await seed()
  let failed = 0
  for (const [name, run] of buildChecks(audienceId, domainId)) {
    try {
      await run()
      console.log(`ok    ${name}`)
    } catch (error) {
      failed++
      console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  process.exit(failed > 0 ? 1 : 0)
}
void main()
