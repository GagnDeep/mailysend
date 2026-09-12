import { QUEUES } from '@mailysend/core/keys'
import { CliError, type CommandContext } from '../command.ts'
import { note, ok, out, style } from '../term.ts'

/**
 * The step a wrangler or CI deploy still has to take for itself.
 *
 * KV, D1, R2 and Secrets Store bindings auto-provision from `wrangler.jsonc`.
 * Queues and Analytics Engine datasets do not, and a Worker deployed without
 * them starts fine and then fails on its first send with a binding error. So
 * the sequence a person is told to run — provision, then deploy — has to be a
 * sequence that exists.
 *
 * It is no longer the step the *Deploy button* cannot take: `build:cf` ends by
 * running `scripts/ensure-resources.mjs`, which creates the queues (and the
 * bucket, the database and the namespaces) inside Workers Builds and writes
 * their ids into the config wrangler deploys. This command is for the path
 * that does not go through that build — your own wrangler invocation, or CI.
 *
 * This used to `spawn('node', ['--experimental-strip-types', SCRIPT])` against
 * `scripts/provision.ts`, resolved relative to this file. That works from a
 * checkout and cannot work from the published package: `scripts/` is in no
 * `files` array, so the path points outside the tarball, and
 * `npx mailysend provision` died as `could not determine executable to run`.
 * The work is forty lines of `fetch`; it belongs in the bundle. The repo script
 * is now the wrapper, not the implementation.
 *
 * Everything here is idempotent: re-running it on a provisioned account is a
 * sequence of "already exists" responses, not an error.
 */

export const provisionFlags = {}

const API = 'https://api.cloudflare.com/client/v4'

interface CfResponse<T> {
  success: boolean
  result: T
  errors: { code: number; message: string }[]
}

interface Credentials {
  accountId: string
  apiToken: string
}

const cf = async <T>(
  { accountId, apiToken }: Credentials,
  path: string,
  init: RequestInit = {},
): Promise<CfResponse<T>> => {
  const response = await fetch(`${API}/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  return (await response.json()) as CfResponse<T>
}

/** Queue names are globally unique per account, so "already exists" is success. */
const ensureQueue = async (credentials: Credentials, name: string): Promise<void> => {
  const result = await cf<{ queue_id: string }>(credentials, '/queues', {
    method: 'POST',
    body: JSON.stringify({ queue_name: name }),
  })
  if (result.success) {
    out(`  queue      ${name}  ${style.green('created')}`)
    return
  }
  const exists = result.errors?.some((e) => e.code === 100121 || /already exists/i.test(e.message))
  if (exists) {
    out(`  queue      ${name}  ${style.dim('exists')}`)
    return
  }
  throw new CliError(`queue ${name}: ${result.errors?.map((e) => e.message).join('; ')}`)
}

/**
 * Analytics Engine datasets are created implicitly by the first write, so there
 * is nothing to call — but this must still say so loudly if the token cannot
 * read them, because a silent permission gap surfaces later as empty charts
 * that look like a product bug.
 */
const verifyAnalyticsAccess = async ({ accountId, apiToken }: Credentials): Promise<void> => {
  const response = await fetch(`${API}/accounts/${accountId}/analytics_engine/sql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiToken}` },
    body: 'SELECT 1',
  })
  out(
    response.ok
      ? `  analytics  ${style.green('readable')}`
      : `  analytics  ${style.yellow(`NOT readable (${response.status})`)} — charts stay empty until the token gains Account Analytics:Read`,
  )
}

/**
 * The whole of provisioning, callable from the CLI and from `pnpm provision`.
 *
 * Credentials are read from the environment here rather than taken as an
 * argument so that both entry points fail the same way, with the same message
 * naming the same two variables.
 */
export const runProvision = async (): Promise<void> => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const apiToken = process.env.CLOUDFLARE_API_TOKEN
  if (!accountId || !apiToken) {
    throw new CliError('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.', {
      hint:
        'Create a token with Queues:Edit and Account Analytics:Read (plus the Workers, D1, KV ' +
        'and R2 edit scopes if you also deploy with it), then export both variables.',
    })
  }
  const credentials: Credentials = { accountId, apiToken }

  note(`provisioning queues and analytics datasets in ${accountId} ${style.dim('(idempotent)')}`)
  out()

  for (const queue of Object.values(QUEUES)) await ensureQueue(credentials, queue)
  // The dead-letter queue is not in QUEUES because nothing produces to it
  // directly; wrangler.jsonc names it as every consumer's DLQ.
  await ensureQueue(credentials, 'ms-dlq')

  await verifyAnalyticsAccess(credentials)

  out()
  ok('Provisioned. Deploy next: `mailysend deploy`.')
  note(
    'One manual step remains: add your sending domain under Email → Sending in the Cloudflare ' +
      'dashboard, then run `mailysend domains verify <domain>`. Cloudflare Email Service is in ' +
      'beta and its daily quota ramps with reputation — MailySend learns that ceiling rather ' +
      'than assuming one, so a first large send slows down instead of failing.',
  )
}

export const provision = async (_ctx: CommandContext) => runProvision()
