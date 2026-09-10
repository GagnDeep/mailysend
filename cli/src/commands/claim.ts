import { randomUUID } from 'node:crypto'
import type { FlagSpecs } from '../args.ts'
import { CliError, type CommandContext } from '../command.ts'
import { DEFAULT_BASE_URL, readConfig, writeConfig } from '../config.ts'
import { heading, kv, note, ok, out, style } from '../term.ts'

/**
 * `mailysend claim` — proving you own the deployment, not an inbox.
 *
 * Every other way into a MailySend instance depends on something a fresh or
 * broken deployment may not have: a passkey on a device that still exists, a
 * recovery code somebody wrote down, a verified sending domain, a configured
 * Access policy. This one depends on the thing that is true by definition for
 * whoever deployed it — they can write to its database.
 *
 * So the ceremony is: put a random value into the instance's own `claim_nonces`
 * table, then hand that value back to the instance over HTTP. Nobody who cannot
 * already read and write the deployment's data can produce it, which makes this
 * both the first-run path for people who would rather not use a browser and the
 * permanent break-glass recovery when every credential is gone.
 *
 * Two ways to write the nonce. With `CLOUDFLARE_API_TOKEN` this does it for you
 * through the D1 HTTP API. Without one, it prints the single SQL statement to
 * run — through `wrangler d1 execute`, the dashboard console, or `sqlite3` on a
 * Node deployment — and waits.
 */

export const claimFlags: FlagSpecs = {
  url: { kind: 'string', describe: 'Base URL of the deployment', default: DEFAULT_BASE_URL },
  email: { kind: 'string', describe: 'Address to own the instance' },
  database: { kind: 'string', describe: 'D1 database name', default: 'mailysend' },
  nonce: { kind: 'string', describe: 'A nonce you already wrote into claim_nonces' },
  manual: { kind: 'boolean', describe: 'Print the SQL to run yourself instead of using the API' },
  profile: {
    kind: 'string',
    short: 'p',
    describe: 'Profile to store the key under',
    default: 'default',
  },
}

const CF_API = 'https://api.cloudflare.com/client/v4'

interface CloudflareEnvelope<T> {
  success: boolean
  errors?: { code: number; message: string }[]
  result?: T
}

async function cf<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const body = (await response.json().catch(() => null)) as CloudflareEnvelope<T> | null
  if (!response.ok || !body?.success) {
    const detail = body?.errors?.map((e) => `${e.code} ${e.message}`).join('; ')
    throw new CliError(
      `Cloudflare API call failed (${response.status})${detail ? `: ${detail}` : ''}`,
    )
  }
  return body.result as T
}

/** Writes the nonce through the D1 HTTP API. Returns false when it cannot. */
async function writeNonceViaD1(database: string, nonce: string): Promise<boolean> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!accountId || !token) return false

  const databases = await cf<{ uuid: string; name: string }[]>(
    `/accounts/${accountId}/d1/database?per_page=100`,
    token,
  )
  const match = databases.find((d) => d.name === database) ?? databases[0]
  if (!match) {
    throw new CliError(`No D1 database called ${style.cyan(database)} in that account.`, {
      hint: 'Pass --database with the name shown in the Cloudflare dashboard.',
    })
  }

  await cf(`/accounts/${accountId}/d1/database/${match.uuid}/query`, token, {
    method: 'POST',
    body: JSON.stringify({
      sql: 'INSERT INTO claim_nonces (nonce, created_at) VALUES (?, ?)',
      params: [nonce, new Date().toISOString()],
    }),
  })
  note(`wrote a claim nonce into D1 ${style.dim(match.name)}`)
  return true
}

const manualSql = (nonce: string) =>
  `INSERT INTO claim_nonces (nonce, created_at) VALUES ('${nonce}', '${new Date().toISOString()}');`

export const claim = async (ctx: CommandContext) => {
  const baseUrl = String(ctx.args.flags.url).replace(/\/+$/, '')
  const supplied = ctx.args.flags.nonce as string | undefined
  const nonce = supplied ?? `msc_${randomUUID()}${randomUUID()}`.replace(/-/g, '')
  const manual = ctx.args.flags.manual === true

  heading(`Claiming ${baseUrl}`)

  if (!supplied) {
    const wrote = manual ? false : await writeNonceViaD1(String(ctx.args.flags.database), nonce)
    if (!wrote) {
      out()
      out('  Run this against the instance’s database, then press Enter:')
      out()
      out(
        `    ${style.cyan(`npx wrangler d1 execute ${String(ctx.args.flags.database)} --remote --command "${manualSql(nonce)}"`)}`,
      )
      out()
      out(
        `  On a Node deployment: ${style.dim(`sqlite3 .data/mailysend.db "${manualSql(nonce)}"`)}`,
      )
      out()
      await new Promise<void>((resolve) => {
        process.stdin.resume()
        process.stdin.once('data', () => {
          process.stdin.pause()
          resolve()
        })
      })
    }
  }

  const response = await fetch(`${baseUrl}/v1/setup/claim/cli`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nonce,
      ...(ctx.args.flags.email ? { email: String(ctx.args.flags.email) } : {}),
    }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new CliError(body?.message ?? `The instance refused the claim (${response.status}).`, {
      hint:
        response.status === 404
          ? 'That deployment predates `mailysend claim`. Redeploy it, or claim it in a browser at /setup.'
          : 'Nonces expire after ten minutes and can be spent once. Run the command again for a fresh one.',
    })
  }
  const claimed = (await response.json()) as { email: string; workspace_id: string }

  // A session cookie is no use in a terminal, so mint a key the CLI can store.
  const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? ''
  const keyResponse = await fetch(`${baseUrl}/v1/api-keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'CLI · claim' }),
  })

  if (keyResponse.ok) {
    const key = (await keyResponse.json()) as { token: string }
    const config = await readConfig()
    const name = String(ctx.args.flags.profile)
    config.profiles[name] = { apiKey: key.token, baseUrl }
    config.current = name
    await writeConfig(config)
  }

  out()
  kv([
    ['instance', style.cyan(baseUrl)],
    ['owner', claimed.email],
    ['workspace', claimed.workspace_id],
  ])
  out()
  ok('Claimed. Open /app in a browser and add a passkey from Settings.')
}
