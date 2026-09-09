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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const generated = join(root, 'apps/app/.output-cf/server/wrangler.json')

const config = JSON.parse(readFileSync(generated, 'utf8'))
const serverDir = dirname(generated)

// `configPath`/`userConfigPath` are wrangler's own bookkeeping about where it
// read the config from; carrying them into a file at a different path would be
// a lie, and they are not inputs.
delete config.configPath
delete config.userConfigPath

const fromRoot = (p) => relative(root, resolve(serverDir, p)).split('\\').join('/')

config.main = fromRoot(config.main)
if (config.assets?.directory) config.assets.directory = fromRoot(config.assets.directory)

const out = join(root, 'wrangler.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`)
console.log(`[wrangler] wrote ${relative(root, out)} → ${config.main}`)
