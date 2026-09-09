import { spawn } from 'node:child_process'
import type { FlagSpecs } from '../args.ts'
import { CliError, type CommandContext } from '../command.ts'
import { note, style } from '../term.ts'

/**
 * `deploy` and `dev` are wrangler, wearing our name.
 *
 * Wrapping rather than reimplementing is deliberate: wrangler owns the
 * account, the bindings and the upload protocol, and a second implementation
 * of any of those would be wrong the week Cloudflare changed one. What we add
 * is the environment plumbing and a readable failure when wrangler is missing
 * — everything after `--` is handed over untouched.
 */

export const deployFlags: FlagSpecs = {
  env: { kind: 'string', short: 'e', describe: 'Wrangler environment to target' },
  'dry-run': { kind: 'boolean', short: 'n', describe: 'Build and validate without uploading' },
  config: { kind: 'string', short: 'c', describe: 'Path to wrangler.jsonc' },
}

export const devFlags: FlagSpecs = {
  port: { kind: 'number', short: 'p', describe: 'Local port', default: 8787 },
  remote: { kind: 'boolean', describe: 'Run against real Cloudflare resources' },
  config: { kind: 'string', short: 'c', describe: 'Path to wrangler.jsonc' },
}

const run = (args: string[]): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn('wrangler', args, { stdio: 'inherit', env: process.env })
    child.on('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code
      reject(
        code === 'ENOENT'
          ? new CliError('wrangler is not installed.', {
              hint: 'pnpm add -D wrangler, or npm i -g wrangler.',
            })
          : error,
      )
    })
    child.on('close', (code) => resolve(code ?? 0))
  })

export const deploy = async (ctx: CommandContext) => {
  const args = ['deploy']
  if (ctx.args.flags.env) args.push('--env', String(ctx.args.flags.env))
  if (ctx.args.flags.config) args.push('--config', String(ctx.args.flags.config))
  if (ctx.args.flags.dryRun === true) args.push('--dry-run')
  args.push(...ctx.args.passthrough)

  note(`wrangler ${args.join(' ')}`)
  const code = await run(args)
  if (code !== 0) throw new CliError(`wrangler exited ${code}`, { exitCode: code })
}

export const dev = async (ctx: CommandContext) => {
  const args = ['dev', '--port', String(ctx.args.flags.port ?? 8787)]
  if (ctx.args.flags.remote === true) args.push('--remote')
  if (ctx.args.flags.config) args.push('--config', String(ctx.args.flags.config))
  args.push(...ctx.args.passthrough)

  note(`Local API on ${style.cyan(`http://localhost:${ctx.args.flags.port ?? 8787}`)}`)
  const code = await run(args)
  if (code !== 0) throw new CliError(`wrangler exited ${code}`, { exitCode: code })
}
