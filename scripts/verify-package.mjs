/**
 * Packs the SDK, installs the tarball into a throwaway project, and imports it.
 *
 * This exists because of one trap that is invisible until a user hits it.
 * `package.json` keeps `exports` pointing at `src/*.ts` so the workspace can
 * import the SDK without a build step, and moves them to `dist/*.js` through
 * `publishConfig.exports` at publish time. **pnpm applies `publishConfig`;
 * plain `npm` does not.** So `npm publish` from this directory ships a manifest
 * whose `exports` point at `src/`, which `files` does not include — every
 * import of the published package then fails with ERR_MODULE_NOT_FOUND, and
 * nothing in the repo notices, because the repo resolves those paths fine.
 *
 * The second trap cost a real user a real minute at a real terminal. 0.1.0
 * shipped the library with no `bin`, while forty-odd places in the docs say
 * `npx mailysend provision`, `npx mailysend deploy`, `npx mailysend tail`. So
 * `npx mailysend` answered `could not determine executable to run`, and
 * `npm i -g mailysend` then `mailysend` answered `command not found`. Nothing
 * in the repo could have caught it: `cli/` builds and runs perfectly from the
 * workspace, under a package name that was never published.
 *
 * Testing the source cannot catch either of these. Only the tarball can, so
 * this installs the tarball the same way a stranger would, imports it, and
 * runs its command.
 *
 * Run it before publishing; the release workflow runs it as a gate.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = fileURLToPath(new URL('../packages/sdk-node', import.meta.url))

const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

const scratch = mkdtempSync(join(tmpdir(), 'mailysend-pack-'))
let failed = false

try {
  // pnpm, not npm — see the note above. Using npm here would defeat the check.
  run('pnpm', ['pack', '--pack-destination', scratch], PACKAGE_DIR)
  const tarball = readdirSync(scratch).find((name) => name.endsWith('.tgz'))
  if (!tarball) throw new Error('pnpm pack produced no tarball')

  const consumer = join(scratch, 'consumer')
  run('mkdir', ['-p', consumer])
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'mailysend-pack-probe', private: true, type: 'module' }, null, 2)}\n`,
  )
  run('npm', ['install', '--silent', '--no-audit', '--no-fund', join(scratch, tarball)], consumer)

  // Both entry points, and the one behaviour a broken `exports` map would take
  // with it: the client refusing to build without a base URL.
  const probe = `
    import { MailySend, MailySendError, VERSION } from 'mailysend'
    import { Resend } from 'mailysend/compat'
    const client = new MailySend('ms_live_probe', { baseUrl: 'https://mail.example.test' })
    if (client.http.baseUrl !== 'https://mail.example.test') throw new Error('baseUrl not applied')
    if (typeof MailySendError.is !== 'function') throw new Error('MailySendError missing')
    if (typeof Resend !== 'function') throw new Error('compat entry point missing')
    let refused = false
    try { new MailySend('ms_live_probe') } catch { refused = true }
    if (!refused) throw new Error('a missing base url was not refused')
    console.log('ok ' + VERSION)
  `
  writeFileSync(join(consumer, 'probe.mjs'), probe)
  const version = run('node', ['probe.mjs'], consumer).trim()

  // The `bin`. `npm install` links it into node_modules/.bin, which is exactly
  // what `npx mailysend` resolves, so running it from there exercises the same
  // path a stranger's `npx` does rather than a path only this repo has.
  const cli = join(consumer, 'node_modules', '.bin', 'mailysend')
  const reported = run(cli, ['--version'], consumer).trim()
  const declared = version.replace(/^ok /, '')
  if (reported !== declared) {
    throw new Error(`the bin reports ${reported}, the library reports ${declared}`)
  }

  // `--help` is the one command that must work before anything is configured.
  // It is also where a bundling mistake shows up: a missing import throws on
  // the way to printing, long before any flag is parsed.
  const help = run(cli, ['--help'], consumer)
  for (const command of ['provision', 'deploy', 'tail', 'send', 'login']) {
    if (!help.includes(command)) throw new Error(`\`mailysend --help\` never mentions ${command}`)
  }

  // `provision` is the command the first-run failure report started from, and
  // it is the one command whose implementation used to live outside the
  // tarball. A missing file and a missing environment variable are both
  // non-zero exits, so only the message distinguishes them: assert that it
  // reached its own credentials check rather than died looking for a script.
  let provisionOutput = ''
  try {
    execFileSync(cli, ['provision'], {
      cwd: consumer,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: '',
        CLOUDFLARE_API_TOKEN: '',
      },
    })
  } catch (error) {
    provisionOutput = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  if (!provisionOutput.includes('CLOUDFLARE_ACCOUNT_ID')) {
    throw new Error(
      `\`mailysend provision\` did not reach its credentials check: ${provisionOutput.trim()}`,
    )
  }

  console.log(
    `verify-package: ${version} — both entry points import, \`mailysend --version\` ` +
      `reports ${reported} from node_modules/.bin, and \`provision\` runs from the tarball`,
  )
} catch (error) {
  failed = true
  console.error(`verify-package: ${error instanceof Error ? error.message : error}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

process.exit(failed ? 1 : 0)
