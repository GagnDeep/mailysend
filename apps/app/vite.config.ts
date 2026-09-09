import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * One config, two deployment targets.
 *
 *   MS_TARGET=cloudflare → a Worker + static assets, for the one-click deploy.
 *   MS_TARGET=node       → .output/server/server.js, which is what runs behind
 *                          nginx on a plain server (including mailysend.com).
 *
 * The application code is identical; only the platform bindings differ, and
 * those are resolved through @mailysend/platform rather than imported directly.
 */
/**
 * Prerendering boots the server to render each page, and the Node runtime
 * refuses to start in production without a signing secret — correctly, because
 * a guessable one makes every tracking pixel forgeable. A build-scoped random
 * value satisfies that without asking anyone to put a real secret into a build
 * environment: nothing prerendered is signed, and the value dies with the
 * process. A real `MS_SECRET` in the environment still wins.
 */
if (!process.env.MS_SECRET) process.env.MS_SECRET = `${randomUUID()}${randomUUID()}`

const target = process.env.MS_TARGET === 'cloudflare' ? 'cloudflare' : 'node'
const isDev = process.env.NODE_ENV !== 'production'

/**
 * Dev and build write to different directories on purpose.
 *
 * Vite's dev cache and the production bundle otherwise share `.vite` and
 * `dist`, which means a `pnpm build` while a dev server is running can serve
 * half-written chunks — and, worse, a deploy can pick up dev-transformed
 * modules. Keeping them apart makes "is this the dev tree or the build tree?"
 * unambiguous, which matters when the two are on the same box.
 */
const cacheDir = '.vite-dev'
const outDir = target === 'cloudflare' ? '.output-cf' : '.output'

/**
 * Routes that prerender to static HTML at build time.
 *
 * Everything public is on this list: marketing and docs are the acquisition
 * surface, and static HTML is what makes them fast enough for good Core Web
 * Vitals and legible to crawlers and LLM retrievers that do not execute JS.
 * The dashboard is deliberately absent — it is per-user and must not be cached.
 */
const PRERENDER_ROUTES = [
  '/',
  '/docs',
  '/analytics',
  '/stack',
  '/pricing',
  '/use-cases',
  '/compare',
  '/dashboard-tour',
  '/resources',
  '/sign-in',
  '/sign-up',
  '/legal/privacy',
  '/legal/terms',
  '/legal/dpa',
]

export default defineConfig({
  cacheDir,
  resolve: {
    alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir,
    // Source maps in production are what make a stack trace from a customer's
    // browser actionable. They cost nothing at runtime.
    sourcemap: true,
  },
  server: {
    port: 8917,
    strictPort: true,
  },
  plugins: [
    tanstackStart({
      srcDirectory: 'src',
      // Both paths resolve under `srcDirectory`, so they must NOT repeat `src/`.
      // With `src/routes` here the generator scanned `src/src/routes`, threw ENOENT
      // into a caught-and-logged handler, and never emitted the routes manifest —
      // which surfaced much later as `Cannot convert undefined or null to object`
      // in the SSR manifest plugin, with no mention of a path anywhere in it.
      router: { routesDirectory: 'routes', generatedRouteTree: 'routeTree.gen.ts' },
      server: { entry: 'server.ts' },
      prerender: {
        enabled: !isDev,
        // `pages` below is the authoritative list of public documents, and the
        // two switches here are what keep anything else out of it — the sitemap
        // is generated from the same list that drives prerendering.
        //
        // Crawling followed the deep anchors the design leans on and minted a
        // sitemap URL per fragment, but a fragment resolves inside the document
        // it belongs to: `/docs#api` needs no page and no <loc> of its own.
        crawlLinks: false,
        // Auto-discovery adds every static route in the router, which swept the
        // nineteen per-user dashboard screens into both the static output and
        // sitemap.xml. They must not be cached and must not be indexed.
        autoStaticPathsDiscovery: false,
        failOnError: false,
        concurrency: 4,
      },
      pages: PRERENDER_ROUTES.map((path) => ({
        path,
        prerender: { enabled: true },
        sitemap: {
          priority: path === '/' ? 1 : path === '/docs' ? 0.9 : 0.7,
          changefreq: 'weekly',
        },
      })),
      sitemap: { enabled: true, host: process.env.MS_PUBLIC_URL ?? 'https://mailysend.com' },
    }),
    react(),
    tailwindcss(),
    ...(target === 'cloudflare' ? [cloudflare({ viteEnvironment: { name: 'ssr' } })] : []),
  ],
})
