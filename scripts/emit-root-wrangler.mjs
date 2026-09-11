/**
 * Writes a repo-root `wrangler.json` after a Cloudflare build.
 *
 * Cloudflare Workers Builds and the Deploy to Cloudflare button both run their
 * deploy command from the repository root, and both default it to a bare
 * `npx wrangler deploy`. In a pnpm workspace with no config at the root that
 * fails before it does anything:
 *
 *   The Cloudflare application detection logic has been run in the root of a
 *   workspace instead of targeting a specific project.
 *
 * Requiring every operator to edit the deploy command in the dashboard defeats
 * the entire one-click story, so the build leaves a config where the default
 * command already looks. It is a copy of the config Vite generates next to the
 * bundle, with the two path fields rewritten to be root-relative — no second
 * source of truth for bindings, because it is regenerated from the first one on
 * every build. It is build output, and gitignored as such.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scopeResourceNames } from './instance-names.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const generated = join(root, 'apps/app/.output-cf/server/wrangler.json')

const config = JSON.parse(readFileSync(generated, 'utf8'))
const serverDir = dirname(generated)

// `configPath`/`userConfigPath` are wrangler's own bookkeeping about where it
// read the config from; carrying them into a file at a different path would be
// a lie, and they are not inputs.
delete config.configPath
delete config.userConfigPath

/**
 * Analytics Engine is opt-in, because it is opt-in on the account.
 *
 * A dataset binding is validated at upload, and an account that has not clicked
 * Enable on the Analytics Engine page fails the whole deploy:
 *
 *   You need to enable Analytics Engine. Head to the Cloudflare Dashboard to
 *   enable [code: 10089]
 *
 * That is the last thing a one-click deploy should die on, and the binding buys
 * the deployment nothing it cannot live without: AE is the hot query layer for
 * charts, sampled and three-month retained, and `consumeEvents` already treats
 * it as optional — every count of record comes from D1. So the bindings are
 * dropped unless the operator asks for them with `MS_ANALYTICS_ENGINE=1`, in
 * which case they must enable the feature on the account first.
 */
const wantsAnalyticsEngine = process.env.MS_ANALYTICS_ENGINE === '1'
if (!wantsAnalyticsEngine && config.analytics_engine_datasets?.length) {
  const dropped = config.analytics_engine_datasets.map((d) => d.binding).join(', ')
  delete config.analytics_engine_datasets
  console.log(
    `[wrangler] Analytics Engine left out (${dropped}) — set MS_ANALYTICS_ENGINE=1 to include it, ` +
      'after enabling Analytics Engine on the account.',
  )
  // The bundle's own config is deployed by `pnpm deploy:cf` and `wrangler dev`,
  // so it has to agree with the one at the root or the two paths diverge.
  const bundled = JSON.parse(readFileSync(generated, 'utf8'))
  delete bundled.analytics_engine_datasets
  writeFileSync(generated, `${JSON.stringify(bundled, null, 2)}\n`)
}

/**
 * Names that have to be unique on the account are derived from the Worker's.
 *
 * Done here rather than in `wrangler.jsonc` because the Worker's name is only
 * known once the config is resolved, and done before the root copy is written
 * so both configs a deploy might read say the same thing. See
 * `scripts/instance-names.mjs` for what this prevents.
 */
const scoped = scopeResourceNames(config)
if (scoped.length > 0) {
  console.log(`[wrangler] scoped to "${config.name}": ${scoped.join(', ')}`)
  // The bundle's own config is what `pnpm deploy:cf` deploys, so it has to
  // carry the same names as the root copy.
  const bundled = JSON.parse(readFileSync(generated, 'utf8'))
  scopeResourceNames(bundled)
  writeFileSync(generated, `${JSON.stringify(bundled, null, 2)}\n`)
}

const fromRoot = (p) => relative(root, resolve(serverDir, p)).split('\\').join('/')

config.main = fromRoot(config.main)
if (config.assets?.directory) config.assets.directory = fromRoot(config.assets.directory)
// Only read by `wrangler d1 migrations`, never by deploy — but a path that
// resolves to nothing from here would be a trap for whoever runs that next.
for (const database of config.d1_databases ?? []) {
  if (database.migrations_dir) database.migrations_dir = fromRoot(database.migrations_dir)
}

const out = join(root, 'wrangler.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`)
console.log(`[wrangler] wrote ${relative(root, out)} → ${config.main}`)
