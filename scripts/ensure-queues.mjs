/**
 * Creates the queues the Worker binds, before `wrangler deploy` validates them.
 *
 * `wrangler deploy` refuses to deploy a Worker that produces to or consumes
 * from a queue that does not exist yet — the whole upload is rejected with
 * `Queue "ms-events-cf" does not exist`. Queues are not among the resources the
 * Deploy to Cloudflare button provisions from `wrangler.jsonc` (D1, KV and R2
 * are), so on a clean account the very first deploy always failed here.
 *
 * The one hook the inferred Workers Builds flow gives us is the build command,
 * so this runs at the end of `build:cf` — but only inside Workers Builds
 * (`WORKERS_CI=1`), or when you ask for it explicitly with
 * `MS_ENSURE_QUEUES=1`. A local `pnpm run build:cf` must never reach out and
 * create resources in somebody's account as a side effect of building.
 *
 * Creation is idempotent: an "already exists" response is the success case, and
 * it is by far the most common one, since only the first deploy of an account
 * creates anything.
 */

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

if (!process.env.WORKERS_CI && process.env.MS_ENSURE_QUEUES !== '1') {
  console.log('[queues] not in Workers Builds; skipping (set MS_ENSURE_QUEUES=1 to force)')
  process.exit(0)
}

/** Strips `//` comments so the jsonc config parses. Block comments are unused. */
const readJsonc = (path) =>
  JSON.parse(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => (/^\s*\/\//.test(line) ? '' : line))
      .join('\n'),
  )

const config = readJsonc(join(root, 'apps/app/wrangler.jsonc'))
const queues = config.queues ?? {}

// Producers, consumers and dead-letter targets are three different lists and a
// queue may appear in only one of them — `ms-events-cf` has no producer here,
// because Cloudflare itself publishes to it.
const names = [
  ...(queues.producers ?? []).map((p) => p.queue),
  ...(queues.consumers ?? []).flatMap((c) => [c.queue, c.dead_letter_queue]),
].filter((name) => typeof name === 'string' && name.length > 0)

const wanted = [...new Set(names)].sort()
console.log(`[queues] ensuring ${wanted.length}: ${wanted.join(', ')}`)

const existing = new Set()
try {
  const { stdout } = await run('npx', ['wrangler', 'queues', 'list', '--json'], { cwd: root })
  for (const queue of JSON.parse(stdout)) existing.add(queue.queue_name ?? queue.name)
} catch (error) {
  // Listing is an optimisation, not a precondition; creation is idempotent.
  console.log(`[queues] could not list existing queues (${short(error)}); creating all`)
}

const failures = []
for (const name of wanted) {
  if (existing.has(name)) {
    console.log(`[queues]   = ${name}`)
    continue
  }
  try {
    await run('npx', ['wrangler', 'queues', 'create', name], { cwd: root })
    console.log(`[queues]   + ${name}`)
  } catch (error) {
    const message = short(error)
    if (/already exists/i.test(message)) {
      console.log(`[queues]   = ${name}`)
      continue
    }
    console.log(`[queues]   ! ${name}: ${message}`)
    failures.push(name)
  }
}

function short(error) {
  const text = `${error?.stderr ?? ''}${error?.stdout ?? ''}` || String(error?.message ?? error)
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

if (failures.length > 0) {
  console.error(
    [
      '',
      `[queues] could not create: ${failures.join(', ')}`,
      '',
      'The deploy will fail on the first of these. The build token needs the',
      '`Queues:Edit` permission. Create the queues once from your own machine',
      'with a token that has it, and this build will pass from then on:',
      '',
      '  export CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=...',
      '  npx mailysend provision',
      '',
    ].join('\n'),
  )
  process.exit(1)
}
