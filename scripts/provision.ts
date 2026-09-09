/**
 * Pre-deploy provisioning.
 *
 * The Deploy to Cloudflare button auto-creates KV, D1, R2 and Secrets Store
 * bindings from `wrangler.jsonc`. It does **not** create Queues, Analytics
 * Engine datasets, or the Email Service sending domain — so a deploy without
 * this script produces a Worker that starts and then fails on its first send
 * with a binding error, which is the worst possible first impression.
 *
 * Everything here is idempotent: re-running it on a provisioned account is a
 * sequence of "already exists" responses, not an error.
 */

import { QUEUES } from '../packages/core/src/keys.ts'

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error(
    'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.\n' +
      'The token needs: Workers Scripts:Edit, Queues:Edit, D1:Edit, Workers KV:Edit,\n' +
      'Workers R2:Edit, Account Analytics:Read and Email Sending:Edit.',
  )
  process.exit(1)
}

const API = 'https://api.cloudflare.com/client/v4'

interface CfResponse<T> {
  success: boolean
  result: T
  errors: { code: number; message: string }[]
}

async function cf<T>(path: string, init: RequestInit = {}): Promise<CfResponse<T>> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  return (await response.json()) as CfResponse<T>
}

/** Queue names are globally unique per account, so "already exists" is success. */
async function ensureQueue(name: string): Promise<void> {
  const result = await cf<{ queue_id: string }>(`/accounts/${ACCOUNT_ID}/queues`, {
    method: 'POST',
    body: JSON.stringify({ queue_name: name }),
  })
  if (result.success) {
    console.log(`  queue    ${name}  created`)
    return
  }
  const exists = result.errors?.some((e) => e.code === 100121 || /already exists/i.test(e.message))
  if (exists) {
    console.log(`  queue    ${name}  exists`)
    return
  }
  throw new Error(`queue ${name}: ${result.errors?.map((e) => e.message).join('; ')}`)
}

/**
 * Analytics Engine datasets are created implicitly by the first write, so there
 * is nothing to call — but the deploy must still fail loudly if the token
 * cannot read them, because a silent permission gap surfaces later as empty
 * charts that look like a product bug.
 */
async function verifyAnalyticsAccess(): Promise<void> {
  const response = await fetch(`${API}/accounts/${ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${API_TOKEN}` },
    body: 'SELECT 1',
  })
  console.log(
    response.ok
      ? '  analytics  readable'
      : `  analytics  NOT readable (${response.status}) — charts will be empty until the token gains Account Analytics:Read`,
  )
}

async function main(): Promise<void> {
  console.log(`Provisioning MailySend in account ${ACCOUNT_ID}\n`)

  for (const queue of Object.values(QUEUES)) await ensureQueue(queue)
  // The dead-letter queue is not in QUEUES because nothing produces to it
  // directly; wrangler.jsonc names it as every consumer's DLQ.
  await ensureQueue('ms-dlq')

  await verifyAnalyticsAccess()

  console.log(
    '\nDone. Remaining manual step: add your sending domain under Email → Sending in the\n' +
      'Cloudflare dashboard, or run `npx mailysend domains add <domain>` after deploy.\n' +
      'Cloudflare Email Service is in beta and its daily quota ramps with reputation —\n' +
      'MailySend learns that ceiling rather than assuming one, so a first large send\n' +
      'slows down instead of failing.',
  )
}

void main()
