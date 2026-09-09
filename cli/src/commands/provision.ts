import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CliError, type CommandContext } from '../command.ts'
import { note, style } from '../term.ts'

/**
 * The step the Deploy button cannot take.
 *
 * KV, D1, R2 and Secrets Store bindings auto-provision from `wrangler.jsonc`.
 * Queues and Analytics Engine datasets do not, and a Worker deployed without
 * them starts fine and then fails on its first send with a binding error. This
 * wraps `scripts/provision.ts` so the sequence a person is told to run —
 * provision, then deploy — is a sequence that exists.
 */

export const provisionFlags = {}

const SCRIPT = fileURLToPath(new URL('../../../scripts/provision.ts', import.meta.url))

export const provision = async (_ctx: CommandContext) => {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new CliError('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.', {
      hint:
        'Create a token with Queues:Edit and Account Analytics:Read (plus the Workers, D1, KV ' +
        'and R2 edit scopes if you also deploy with it), then export both variables.',
    })
  }

  note(`provisioning queues and analytics datasets ${style.cyan('(idempotent)')}`)
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn('node', ['--experimental-strip-types', SCRIPT], {
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', reject)
    child.on('close', (status) => resolve(status ?? 0))
  })
  if (code !== 0) throw new CliError(`provisioning exited ${code}`, { exitCode: code })
}
