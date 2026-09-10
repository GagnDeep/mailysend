import type { Sql } from '@mailysend/platform'
import {
  CloudflareProvider,
  nodeConnect,
  type Provider,
  type ProviderEntry,
  ProviderRouter,
  ResendProvider,
  SesProvider,
  SmtpProvider,
} from '@mailysend/providers'
import type { Env } from '../env.ts'

/**
 * Builds the provider router for a workspace.
 *
 * Configuration comes from two places, in this order: the workspace's own
 * `provider_configs` rows, and — where a workspace has configured nothing —
 * the deployment's environment variables. That fallback is what makes the
 * one-click deploy work: a fresh install has no rows in any table yet, but it
 * does have a `send_email` binding, so it can send immediately.
 */

export interface ProviderRow {
  provider: 'cloudflare' | 'ses' | 'resend' | 'smtp'
  enabled: number | boolean
  priority: number
  weight: number
  credentials: string | null
  config: string | null
}

let cachedConnect: Awaited<ReturnType<typeof nodeConnect>> | null = null

/**
 * The socket factory for the SMTP transport.
 *
 * `cloudflare:sockets` cannot be statically imported in a Node build — the
 * specifier does not resolve — so it is loaded dynamically and only when a
 * workspace actually configures SMTP. Most deployments never take this path.
 */
async function resolveConnect(): Promise<Awaited<ReturnType<typeof nodeConnect>>> {
  if (cachedConnect) return cachedConnect
  try {
    const sockets = await import(/* @vite-ignore */ 'cloudflare:sockets')
    cachedConnect = sockets.connect as never
  } catch {
    cachedConnect = await nodeConnect()
  }
  return cachedConnect!
}

async function buildProvider(
  name: ProviderRow['provider'],
  credentials: Record<string, string>,
  config: Record<string, unknown>,
  env: Env,
): Promise<Provider | null> {
  switch (name) {
    case 'cloudflare': {
      const accountId = credentials.account_id ?? env.CLOUDFLARE_ACCOUNT_ID
      const apiToken = credentials.api_token ?? env.CLOUDFLARE_API_TOKEN
      // Without a binding and without REST credentials there is no transport
      // here, only the shape of one. Returning a provider anyway made
      // `router.providers.length === 0` unreachable, so "nothing is configured"
      // surfaced as an `auth` failure from deep inside the adapter — a kind that
      // never retries and never explains itself.
      if (!env.SEND_EMAIL && !(accountId && apiToken)) return null
      return new CloudflareProvider({
        // The binding is strictly better than REST when it exists: no HTTP hop,
        // no token to leak, and it is the design's central performance claim.
        ...(env.SEND_EMAIL ? { binding: env.SEND_EMAIL } : {}),
        accountId,
        apiToken,
      })
    }

    case 'ses': {
      const accessKeyId = credentials.access_key_id ?? env.SES_ACCESS_KEY_ID
      const secretAccessKey = credentials.secret_access_key ?? env.SES_SECRET_ACCESS_KEY
      if (!accessKeyId || !secretAccessKey) return null
      return new SesProvider({
        accessKeyId,
        secretAccessKey,
        region: (config.region as string) ?? env.SES_REGION ?? 'us-east-1',
        configurationSetName: (config.configuration_set as string) ?? env.SES_CONFIGURATION_SET,
      })
    }

    case 'resend': {
      const apiKey = credentials.api_key ?? env.RESEND_API_KEY
      return apiKey ? new ResendProvider({ apiKey }) : null
    }

    case 'smtp': {
      const host = (config.host as string) ?? env.SMTP_HOST
      if (!host) return null
      return new SmtpProvider({
        host,
        port: Number((config.port as string) ?? env.SMTP_PORT ?? 587),
        secure: ((config.secure as string) ?? env.SMTP_SECURE ?? 'starttls') as
          | 'tls'
          | 'starttls'
          | 'none',
        // The catalog the Settings form is built from calls these `username`
        // and `password`; this read used to call them `user` and `pass`, so
        // credentials saved through the UI were stored, decrypted, and ignored
        // in favour of the environment. Both spellings are accepted on read so
        // rows written before the fix keep working.
        user: credentials.username ?? credentials.user ?? env.SMTP_USER,
        pass: credentials.password ?? credentials.pass ?? env.SMTP_PASS,
        ehloName: (config.ehlo as string) ?? new URL(env.MS_PUBLIC_URL).hostname,
        connect: await resolveConnect(),
      })
    }
  }
}

/**
 * One provider, built the way the router would build it.
 *
 * The Settings screen's test button needs exactly this and nothing else: the
 * workspace's stored credentials if there are any, the deployment's variables
 * if there are not, and `null` when neither can stand the transport up — which
 * is a different answer from "it failed".
 */
export async function buildProviderFor(
  sql: Sql,
  workspaceId: string,
  name: ProviderRow['provider'],
  env: Env,
): Promise<Provider | null> {
  const row = await sql
    .prepare(
      'SELECT credentials, config FROM provider_configs WHERE workspace_id = ? AND provider = ?',
    )
    .bind(workspaceId, name)
    .first<{ credentials: string | null; config: string | null }>()

  const credentials = row?.credentials ? await decryptCredentials(row.credentials, env) : {}
  const config = row?.config ? (JSON.parse(row.config) as Record<string, unknown>) : {}
  return buildProvider(name, credentials, config, env)
}

/**
 * A provider built for its `dnsRecords` alone, with no credentials.
 *
 * The record set a domain needs is a statement about where its mail will go,
 * not about which secrets happen to be present right now: a fresh deployment
 * that has not yet been given a `send_email` binding still needs Cloudflare's
 * SPF and MX in the zone before its first send, and computing the records from
 * the live router alone meant they appeared only *after* the credentials did —
 * exactly the wrong order.
 *
 * Never used to send. `buildProvider`'s null guard stays as it is, and this is
 * the one caller that deliberately goes around it.
 */
export function recordsOnlyProvider(name: ProviderRow['provider']): Provider | null {
  switch (name) {
    case 'cloudflare':
      return new CloudflareProvider({})
    default:
      return null
  }
}

/**
 * The order the environment fallback is tried in, Cloudflare first.
 *
 * Exported because the Transports screen has to be able to say which transport
 * a workspace that has configured nothing will actually send through. An
 * operator who cannot see the default cannot tell a working default from a
 * silent one.
 */
export function fallbackOrder(env: Env): ProviderRow['provider'][] {
  return [
    ...new Set<ProviderRow['provider']>([
      env.MS_DEFAULT_PROVIDER ?? 'cloudflare',
      'cloudflare',
      'ses',
      'resend',
      'smtp',
    ]),
  ]
}

/**
 * The transport a workspace with no `provider_configs` rows would send through
 * right now, or `null` when this deployment can stand none of them up.
 */
export async function resolveDefaultProvider(env: Env): Promise<ProviderRow['provider'] | null> {
  for (const name of fallbackOrder(env)) {
    if (await buildProvider(name, {}, {}, env)) return name
  }
  return null
}

export async function buildRouter(
  sql: Sql,
  workspaceId: string,
  env: Env,
): Promise<ProviderRouter> {
  const { results } = await sql
    .prepare(
      `SELECT provider, enabled, priority, weight, credentials, config
         FROM provider_configs WHERE workspace_id = ? AND enabled = 1 ORDER BY priority`,
    )
    .bind(workspaceId)
    .all<ProviderRow>()

  const entries: ProviderEntry[] = []
  for (const row of results) {
    const credentials = row.credentials ? await decryptCredentials(row.credentials, env) : {}
    const config = row.config ? (JSON.parse(row.config) as Record<string, unknown>) : {}
    const provider = await buildProvider(row.provider, credentials, config, env)
    if (provider) {
      entries.push({ provider, priority: row.priority, weight: row.weight, enabled: true })
    }
  }

  if (entries.length === 0) {
    // Nothing configured. Fall back to whatever the environment offers, in the
    // order the product recommends, so a fresh deployment can send on first run.
    let priority = 10
    for (const name of fallbackOrder(env)) {
      const provider = await buildProvider(name, {}, {}, env)
      if (provider) {
        entries.push({ provider, priority, weight: 100, enabled: true })
        priority += 10
      }
    }
  }

  return new ProviderRouter(entries)
}

/**
 * Provider credentials are stored as AES-GCM ciphertext, keyed by the
 * deployment's data key. The point is narrow but real: a database backup, a D1
 * export or an accidental `SELECT *` in a support session must not hand over
 * someone's SES secret.
 */
export async function encryptCredentials(plain: Record<string, string>, env: Env): Promise<string> {
  const key = await dataKey(env)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(plain)),
  )
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(ciphertext)))}`
}

export async function decryptCredentials(
  stored: string,
  env: Env,
): Promise<Record<string, string>> {
  const [ivPart, dataPart] = stored.split('.')
  if (!ivPart || !dataPart) return {}
  try {
    const key = await dataKey(env)
    const iv = Uint8Array.from(atob(ivPart), (c) => c.charCodeAt(0))
    const data = Uint8Array.from(atob(dataPart), (c) => c.charCodeAt(0))
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return JSON.parse(new TextDecoder().decode(plain)) as Record<string, string>
  } catch {
    // A key rotation or a restored backup from another deployment lands here.
    // Returning empty degrades to the environment fallback rather than throwing
    // inside the send path.
    console.error('[providers] credential decryption failed — check MS_DATA_KEY')
    return {}
  }
}

const keyCache = new Map<string, CryptoKey>()

async function dataKey(env: Env): Promise<CryptoKey> {
  const material = env.MS_DATA_KEY ?? env.MS_SECRET
  const cached = keyCache.get(material)
  if (cached) return cached
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
  keyCache.set(material, key)
  return key
}
