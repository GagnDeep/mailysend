import { QueryClient } from '@tanstack/react-query'
import { ApiClientError, type Environment } from './api-client.ts'

/**
 * Query keys.
 *
 * Every key starts with the environment because live and test are two separate
 * datasets behind one URL: without it, flipping the switch would show the
 * previous environment's cache for as long as the fetch takes, which is the one
 * moment a reader most needs to trust what is on screen.
 */
export const qk = {
  me: () => ['me'] as const,

  emails: (env: Environment, filters: Record<string, unknown> = {}) =>
    [env, 'emails', filters] as const,
  email: (env: Environment, id: string) => [env, 'email', id] as const,
  emailDetail: (env: Environment, id: string) => [env, 'email', id, 'detail'] as const,

  domains: (env: Environment) => [env, 'domains'] as const,
  domain: (env: Environment, id: string) => [env, 'domain', id] as const,

  apiKeys: (env: Environment) => [env, 'api-keys'] as const,

  audiences: (env: Environment) => [env, 'audiences'] as const,
  audience: (env: Environment, id: string) => [env, 'audience', id] as const,
  contacts: (env: Environment, audienceId: string, filters: Record<string, unknown> = {}) =>
    [env, 'audience', audienceId, 'contacts', filters] as const,
  contact: (env: Environment, audienceId: string, id: string) =>
    [env, 'audience', audienceId, 'contact', id] as const,

  segments: (env: Environment) => [env, 'segments'] as const,
  segment: (env: Environment, id: string) => [env, 'segment', id] as const,
  segmentPreview: (env: Environment, audienceId: string, expression: string) =>
    [env, 'segment-preview', audienceId, expression] as const,

  templates: (env: Environment) => [env, 'templates'] as const,
  template: (env: Environment, id: string) => [env, 'template', id] as const,
  templateVersions: (env: Environment, id: string) => [env, 'template', id, 'versions'] as const,

  broadcasts: (env: Environment) => [env, 'broadcasts'] as const,
  broadcast: (env: Environment, id: string) => [env, 'broadcast', id] as const,

  automations: (env: Environment) => [env, 'automations'] as const,
  automation: (env: Environment, id: string) => [env, 'automation', id] as const,

  webhooks: (env: Environment) => [env, 'webhooks'] as const,
  webhook: (env: Environment, id: string) => [env, 'webhook', id] as const,
  webhookAttempts: (env: Environment, id: string) => [env, 'webhook', id, 'attempts'] as const,

  suppressions: (env: Environment, filters: Record<string, unknown> = {}) =>
    [env, 'suppressions', filters] as const,

  mailThreads: (env: Environment, filters: Record<string, unknown> = {}) =>
    [env, 'mail', 'threads', filters] as const,
  mailThread: (env: Environment, id: string) => [env, 'mail', 'thread', id] as const,
  mailCounts: (env: Environment) => [env, 'mail', 'counts'] as const,
  mailLabels: (env: Environment) => [env, 'mail', 'labels'] as const,
  mailDrafts: (env: Environment) => [env, 'mail', 'drafts'] as const,
  mailHeaders: (env: Environment, id: string) => [env, 'mail', 'headers', id] as const,
  mailRaw: (env: Environment, id: string) => [env, 'mail', 'raw', id] as const,

  threads: (env: Environment, filters: Record<string, unknown> = {}) =>
    [env, 'threads', filters] as const,
  thread: (env: Environment, id: string) => [env, 'thread', id] as const,
  threadMessages: (env: Environment, id: string) => [env, 'thread', id, 'messages'] as const,

  analytics: (env: Environment, params: Record<string, unknown> = {}) =>
    [env, 'analytics', params] as const,
  placement: (env: Environment, params: Record<string, unknown> = {}) =>
    [env, 'placement', params] as const,

  seedTests: (env: Environment) => [env, 'seed-tests'] as const,
  seedTest: (env: Environment, id: string) => [env, 'seed-test', id] as const,

  settings: (env: Environment) => [env, 'settings'] as const,
  // Transports are workspace-wide rather than per-environment: the same
  // credentials carry live and test mail.
  providers: () => ['providers'] as const,
  mailboxes: (env: Environment) => [env, 'mailboxes'] as const,
  providerCatalog: () => ['provider-catalog'] as const,
  members: () => ['members'] as const,
  invites: () => ['invites'] as const,
  preferenceCentre: (env: Environment) => [env, 'preference-centre'] as const,
} as const

/**
 * Retrying a 401 or a 422 just delays the error message by two seconds and
 * three requests. Only the transient classes are worth a second attempt.
 */
const shouldRetry = (failureCount: number, error: unknown): boolean => {
  if (failureCount >= 2) return false
  if (error instanceof ApiClientError) return error.status >= 500 || error.status === 429
  return true
}

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // The dashboard is a live console: a stale counter that never refetches
        // is worse than a brief spinner, but refetching on every window focus
        // while someone alt-tabs through a compose window is noise.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })

/** Human-readable failure text for an error boundary or an inline banner. */
export const errorMessage = (error: unknown): string => {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}
