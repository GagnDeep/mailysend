import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Make the build read the same `.env` the runtime does.
 *
 * It did not, and that is why `sitemap.xml` never existed. `MS_PUBLIC_URL`
 * lives in a `.env` at the repository root, which the process manager loads at
 * *run* time via `--env-file-if-exists`; nothing put it in the shell during
 * `pnpm build:node`. So the sitemap host was always `undefined`, the sitemap
 * was silently disabled, and `robots.txt` advertised a URL that returned 404
 * for the life of the site.
 *
 * Both halves of the build need it — `vite.config.ts` to enable the sitemap,
 * and `scripts/llms.ts`, which runs as a separate `tsx` process, to write the
 * same host into `robots.txt` and `llms.txt`. Fixing it in only one of them
 * would produce the mirror-image bug: a sitemap generated for one host and
 * advertised for another.
 *
 * Only absent keys are filled in, so an explicit shell variable still wins —
 * the precedence every deploy already assumes. This is not a secret-loading
 * mechanism: the build has no use for credentials, and the one value it needs
 * is the site's own public URL.
 */
export const loadDotEnv = (root = new URL('../', import.meta.url)): void => {
  const file = fileURLToPath(new URL('.env', root))
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1] as string
    if (process.env[key] !== undefined) continue
    process.env[key] = (match[2] ?? '').trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
  }
}
