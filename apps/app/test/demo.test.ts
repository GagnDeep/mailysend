import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The tour's fixtures, checked against the contracts the API is written to.
 *
 * This is the whole safety argument for `lib/demo/`. Thirty-odd screens read a
 * hand-written dataset, and nothing about writing one by hand stops a field
 * from being named `opens` where the schema says `open_count` — the screen
 * would render a blank cell and nobody looking at a demo would think to
 * question it. So every fixture goes through `schema.parse` on the way out, and
 * this drives every read the dashboard actually makes so that a drifted field
 * fails here rather than in front of a visitor.
 *
 * It also asserts the other half: that a write is refused. A demo that appears
 * to save something is worse than no demo.
 */

// `isDemo()` reads `document.cookie`, and this suite runs in node. Mocking the
// one state module is cheaper and more honest than faking a DOM: what is under
// test is the router and the fixtures, not how the cookie is read.
vi.mock('~/lib/demo/state.ts', () => ({
  isDemo: () => true,
  demoEmail: () => 'visitor@example.com',
  useDemo: () => true,
  startDemo: async () => {},
  endDemo: async () => {},
}))

const { createApiClient, ApiClientError } = await import('~/lib/api-client.ts')
const demoData = await import('~/lib/demo/data.ts')

const api = createApiClient({ environment: 'live' })

describe('the demo answers every read the dashboard makes', () => {
  const domainId = demoData.domains[0]?.id as string
  const audienceId = demoData.audiences[0]?.id as string
  const templateId = demoData.templates[0]?.id as string
  const broadcastId = demoData.broadcasts[0]?.id as string
  const automationId = demoData.automations[0]?.id as string
  const segmentId = demoData.segments[0]?.id as string
  const webhookId = demoData.webhooks[0]?.id as string
  const logId = demoData.logs[0]?.id as string
  const threadId = demoData.mailThreads[0]?.id as string

  const reads: [string, () => Promise<unknown>][] = [
    ['me', () => api.me()],
    ['listLogs', () => api.listLogs()],
    ['getEmailDetail', () => api.getEmailDetail(logId)],
    ['listEmails', () => api.listEmails()],
    ['getEmail', () => api.getEmail(logId)],
    ['listDomains', () => api.listDomains()],
    ['getDomain', () => api.getDomain(domainId)],
    ['listApiKeys', () => api.listApiKeys()],
    ['listAudiences', () => api.listAudiences()],
    ['getAudience', () => api.getAudience(audienceId)],
    ['listContacts', () => api.listContacts(audienceId)],
    ['searchContacts', () => api.searchContacts('a')],
    ['listSegments', () => api.listSegments()],
    ['getSegment', () => api.getSegment(segmentId)],
    ['listTemplates', () => api.listTemplates()],
    ['getTemplate', () => api.getTemplate(templateId)],
    ['listTemplateVersions', () => api.listTemplateVersions(templateId)],
    ['listBroadcasts', () => api.listBroadcasts()],
    ['getBroadcast', () => api.getBroadcast(broadcastId)],
    ['listAutomations', () => api.listAutomations()],
    ['getAutomation', () => api.getAutomation(automationId)],
    ['listWebhooks', () => api.listWebhooks()],
    ['getWebhook', () => api.getWebhook(webhookId)],
    ['listWebhookAttempts', () => api.listWebhookAttempts(webhookId)],
    ['listSuppressions', () => api.listSuppressions()],
    ['listMailboxes', () => api.listMailboxes()],
    ['listConfirmations', () => api.listConfirmations()],
    ['analytics', () => api.analytics()],
    ['placement', () => api.placement()],
    ['listSeedTests', () => api.listSeedTests()],
    ['listProviders', () => api.listProviders()],
    ['providerCatalog', () => api.providerCatalog()],
    ['getSettings', () => api.getSettings()],
    ['listMembers', () => api.listMembers()],
    ['listInvites', () => api.listInvites()],
    ['getPreferenceCentre', () => api.getPreferenceCentre()],
    ['listMailThreads', () => api.listMailThreads()],
    ['mailCounts', () => api.mailCounts()],
    ['getMailThread', () => api.getMailThread(threadId)],
    ['listMailMessages', () => api.listMailMessages(threadId)],
    ['listMailIdentities', () => api.listMailIdentities()],
    ['listMailLabels', () => api.listMailLabels()],
    ['listMailDrafts', () => api.listMailDrafts()],
  ]

  for (const [name, read] of reads) {
    it(`${name} parses against the real schema`, async () => {
      await expect(read()).resolves.toBeDefined()
    })
  }

  it('never reaches the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await api.listLogs()
    await api.analytics()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('the demo refuses to change anything', () => {
  beforeEach(() => vi.restoreAllMocks())

  const writes: [string, () => Promise<unknown>][] = [
    ['createDomain', () => api.createDomain({ name: 'example.com' })],
    ['verifyDomain', () => api.verifyDomain(demoData.domains[0]?.id as string)],
    ['createApiKey', () => api.createApiKey({ name: 'test' })],
    ['createAudience', () => api.createAudience({ name: 'test' })],
    ['deleteTemplate', () => api.deleteTemplate(demoData.templates[0]?.id as string)],
    ['sendBroadcast', () => api.sendBroadcast(demoData.broadcasts[0]?.id as string)],
    ['updateSettings', () => api.updateSettings({ open_tracking: false })],
    ['sendMail', () => api.sendMail({ to: ['someone@example.com'] })],
  ]

  for (const [name, write] of writes) {
    it(`${name} fails with the demo's own explanation`, async () => {
      await expect(write()).rejects.toThrow(/nothing you do here is saved/i)
      await expect(write()).rejects.toBeInstanceOf(ApiClientError)
    })
  }
})

describe('the log filters actually filter', () => {
  it('narrows to a status the log page asked for', async () => {
    const page = await api.listLogs({ status: 'bounced' })
    expect(page.data.length).toBeGreaterThan(0)
    expect(page.data.every((row) => row.status === 'bounced')).toBe(true)
  })

  it('searches the subject and the recipients', async () => {
    const first = demoData.logs[0]
    const page = await api.listLogs({ search: first?.subject ?? '' })
    expect(page.data.length).toBeGreaterThan(0)
  })
})

describe('the fixtures are worth showing', () => {
  it('has enough log rows that the page is a page', () => {
    expect(demoData.logs.length).toBeGreaterThan(50)
  })

  it('includes the failures the log page exists to explain', () => {
    const statuses = new Set(demoData.logs.map((row) => row.status))
    expect(statuses.has('bounced')).toBe(true)
    expect(statuses.has('complained')).toBe(true)
  })

  it('signs the visitor in as themselves', () => {
    expect(demoData.demoUser('rina@acme.dev').email).toBe('rina@acme.dev')
  })
})
