/**
 * Creates the account resources `wrangler deploy` refuses to deploy without.
 *
 * The Deploy to Cloudflare button provisions less than the docs imply, and
 * wrangler validates every binding before it uploads, so a clean account used
 * to fail one resource at a time — first `Queue "ms-events-cf" does not exist`,
 * then `KV namespace 'PLACEHOLDER' is not valid`. Each failure came after a
 * 4.5 MB upload and told the operator to go and run something by hand, which is
 * not a one-click deploy.
 *
 * The only hook the inferred Workers Builds flow gives us is the build command,
 * so this runs at the end of `build:cf`:
 *
 *   - queues   created by name; twelve of them, including the dead-letter queue
 *   - R2       created by name
 *   - D1 + KV  created if absent, then their ids written into the generated
 *              wrangler config, because those ids cannot be known in advance
 *
 * Everything is matched by name first and created only when missing, so the
 * second and every later build is a no-op. That matters more than it sounds:
 * re-creating the SUPPRESSIONS namespace instead of reusing it would silently
 * empty the one list that must never be lost.
 *
 * It runs only inside Workers Builds (`WORKERS_CI=1`) or when you set
 * `MS_ENSURE_RESOURCES=1`. A local `pnpm run build:cf` must never create things
 * in somebody's account as a side effect of building.
 *
 * If the build token cannot create a resource, this does not fail the build.
 * The ids are simply left out, which is exactly the shape wrangler's own
 * automatic provisioning expects — so the deploy still gets a chance to create
 * them itself, and only then fails with wrangler's own message.
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

if (!process.env.WORKERS_CI && process.env.MS_ENSURE_RESOURCES !== '1') {
  console.log('[resources] not in Workers Builds; skipping (MS_ENSURE_RESOURCES=1 to force)')
  process.exit(0)
}

const wrangler = async (args) => {
  const { stdout } = await execFileAsync('npx', ['wrangler', ...args], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

/**
 * The failure, not the npm preamble.
 *
 * `npx` prints its own warnings about this repo's pnpm settings on every
 * invocation, and they are long enough to fill 240 characters on their own —
 * so every diagnostic here read "npm warn Unknown project config…" and the
 * actual Cloudflare error was truncated away entirely.
 */
const short = (error) => {
  const text = `${error?.stderr ?? ''}${error?.stdout ?? ''}` || String(error?.message ?? error)
  const useful = text
    .split('\n')
    .filter((line) => !/^\s*npm\s+(warn|notice)\b/i.test(line))
    .join('\n')
  return (useful.trim() || text).replace(/\s+/g, ' ').trim().slice(0, 240)
}

/** Wrangler prints banners and telemetry notices around its JSON. */
const parseJson = (stdout) => {
  const start = stdout.search(/[[{]/)
  if (start < 0) return null
  try {
    return JSON.parse(stdout.slice(start))
  } catch {
    return null
  }
}

const list = async (args) => {
  try {
    return parseJson(await wrangler(args)) ?? []
  } catch (error) {
    console.log(`[resources] could not list (${args.join(' ')}): ${short(error)}`)
    return []
  }
}

/** Strips `//` comments so the jsonc config parses. Block comments are unused. */
const readJsonc = (path) =>
  JSON.parse(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => (/^\s*\/\//.test(line) ? '' : line))
      .join('\n'),
  )

const source = readJsonc(join(root, 'apps/app/wrangler.jsonc'))

// ---------------------------------------------------------------------------
// Queues. Producers, consumers and dead-letter targets are three different
// lists and a queue may appear in only one — `ms-events-cf` has no producer
// here, because Cloudflare itself publishes to it.
// ---------------------------------------------------------------------------

const queueNames = [
  ...(source.queues?.producers ?? []).map((p) => p.queue),
  ...(source.queues?.consumers ?? []).flatMap((c) => [c.queue, c.dead_letter_queue]),
].filter((name) => typeof name === 'string' && name.length > 0)

const wantedQueues = [...new Set(queueNames)].sort()

/**
 * Whether a queue exists, asked one queue at a time.
 *
 * `wrangler queues list` has no `--json` — the flag was passed anyway, so the
 * command failed on every build with "Unknown argument: json", the existing set
 * came back empty, and creation was attempted for all twelve queues every time.
 * That was survivable because "already exists" is swallowed, and it is why it
 * went unnoticed: the script reported success while knowing nothing.
 *
 * `queues info` answers for one queue and, unlike a list, says who consumes it.
 */
const queueInfo = async (name) => {
  try {
    return await wrangler(['queues', 'info', name])
  } catch {
    return null
  }
}

const createQueue = async (name) => {
  try {
    await wrangler(['queues', 'create', name])
    console.log(`[resources] + queue ${name}`)
    return true
  } catch (error) {
    const message = short(error)
    if (/already exists/i.test(message)) return true
    console.log(`[resources] ! queue ${name}: ${message}`)
    return false
  }
}

const info = new Map()
for (const name of wantedQueues) info.set(name, await queueInfo(name))

for (const [name, existing] of info) {
  if (existing) continue
  // Creation is eventually consistent, so the confirmation is a fresh probe
  // rather than the create call's own exit status.
  await createQueue(name)
  info.set(name, await queueInfo(name))
}

/**
 * What `wrangler deploy` is about to do with these, and why it can fail.
 *
 * Deploy attaches every consumer this Worker declares. If the queue is missing,
 * or if another Worker already consumes it — a queue has exactly one consumer,
 * and these names are account-global, so a second MailySend deployment on one
 * account collides with the first — the trigger update fails with
 *
 *   A request to the Cloudflare API (/accounts/…/queues) failed.
 *   An unknown error has occurred [code: 10013]
 *
 * which names neither the queue nor the reason. The script uploads fine and the
 * build is reported as failed regardless. Neither case can be fixed from here
 * without breaking somebody else's deployment, so both are said plainly, with
 * the queue named, while the log is still in front of whoever ran the build.
 */
const declaredConsumers = [...new Set((source.queues?.consumers ?? []).map((c) => c.queue))]
const scriptName = source.name

for (const queue of declaredConsumers) {
  const existing = info.get(queue)
  if (!existing) {
    console.log(
      `[resources] ! queue ${queue} does not exist and this Worker consumes it — the deploy will ` +
        `fail its trigger update with a generic [code: 10013]. Create it with \`npx wrangler ` +
        `queues create ${queue}\`, or check the build token carries Queues:Edit.`,
    )
    continue
  }
  // The consumer line names the script; anything else holding it is the other
  // way this fails, and the only fix is a decision somebody has to make.
  const other = [...existing.matchAll(/consumer[^\n]*?([\w.-]+)\s*$/gim)]
    .map((m) => m[1])
    .find((consumerName) => consumerName && scriptName && consumerName !== scriptName)
  if (other) {
    console.log(
      `[resources] ! queue ${queue} is already consumed by "${other}", not "${scriptName}". A ` +
        'queue has exactly one consumer and these names are account-global, so two MailySend ' +
        'deployments on one account collide here. Use a separate Cloudflare account, or remove ' +
        "the other Worker's consumer.",
    )
  }
}

const missing = wantedQueues.filter((name) => !info.get(name))
console.log(`[resources] = ${wantedQueues.length - missing.length}/${wantedQueues.length} queues`)

// ---------------------------------------------------------------------------
// R2. Buckets are addressed by name, so nothing has to be written back.
// ---------------------------------------------------------------------------

for (const bucket of source.r2_buckets ?? []) {
  if (!bucket.bucket_name) continue
  try {
    await wrangler(['r2', 'bucket', 'create', bucket.bucket_name])
    console.log(`[resources] + r2 ${bucket.bucket_name}`)
  } catch (error) {
    const message = short(error)
    if (!/already (exists|owned)/i.test(message)) {
      console.log(`[resources] ! r2 ${bucket.bucket_name}: ${message}`)
    }
  }
}

// ---------------------------------------------------------------------------
// D1 and KV, whose ids are generated and therefore have to be discovered and
// patched into the config wrangler will deploy.
// ---------------------------------------------------------------------------

const patch = { d1: new Map(), kv: new Map() }

for (const database of source.d1_databases ?? []) {
  const name = database.database_name
  if (!name) continue
  let found = (await list(['d1', 'list', '--json'])).find((d) => d.name === name)
  if (!found) {
    try {
      await wrangler(['d1', 'create', name])
      found = (await list(['d1', 'list', '--json'])).find((d) => d.name === name)
      if (found) console.log(`[resources] + d1 ${name}`)
    } catch (error) {
      console.log(`[resources] ! d1 ${name}: ${short(error)}`)
    }
  }
  const id = found?.uuid ?? found?.id
  if (id) patch.d1.set(database.binding, id)
}

/**
 * Wrangler titles a namespace `<worker>-<binding>`, and the worker may have
 * been renamed at deploy time, so the binding suffix is the only stable part to
 * match on.
 */
const kvTitleFor = (namespaces, binding) =>
  namespaces.find((n) => n.title === binding || n.title?.endsWith(`-${binding}`))

for (const namespace of source.kv_namespaces ?? []) {
  const binding = namespace.binding
  let namespaces = await list(['kv', 'namespace', 'list'])
  let found = kvTitleFor(namespaces, binding)
  if (!found) {
    try {
      await wrangler(['kv', 'namespace', 'create', binding])
      namespaces = await list(['kv', 'namespace', 'list'])
      found = kvTitleFor(namespaces, binding)
      if (found) console.log(`[resources] + kv ${found.title}`)
    } catch (error) {
      console.log(`[resources] ! kv ${binding}: ${short(error)}`)
    }
  }
  if (found?.id) patch.kv.set(binding, found.id)
}

// ---------------------------------------------------------------------------
// Write the discovered ids into every config a deploy might read.
// ---------------------------------------------------------------------------

const targets = [
  join(root, 'wrangler.json'),
  join(root, 'apps/app/.output-cf/server/wrangler.json'),
].filter((path) => existsSync(path))

for (const path of targets) {
  const config = JSON.parse(readFileSync(path, 'utf8'))
  for (const database of config.d1_databases ?? []) {
    const id = patch.d1.get(database.binding)
    if (id) database.database_id = id
    else delete database.database_id
  }
  for (const namespace of config.kv_namespaces ?? []) {
    const id = patch.kv.get(namespace.binding)
    if (id) namespace.id = id
    else delete namespace.id
  }
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
}

const named = (map) => [...map.entries()].map(([k, v]) => `${k}=${v.slice(0, 8)}…`).join(' ')
console.log(`[resources] bound ${named(patch.d1)} ${named(patch.kv)}`.trimEnd())
