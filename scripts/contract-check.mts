/**
 * The dashboard contract check.
 *
 * Hits every read-only dashboard endpoint through the dashboard's own client,
 * so each response is parsed by the same Zod schema the screens parse it with.
 * Drift shows up here as a failed parse rather than as an error card.
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

const checks: [string, () => Promise<unknown>][] = [
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
  let failed = 0
  for (const [name, run] of checks) {
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
