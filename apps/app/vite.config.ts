import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { loadDotEnv } from '../../scripts/load-dotenv.ts'
import { PRERENDER_PAGES } from './src/content/site-map.ts'

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
// Must run before anything below reads `process.env`.
loadDotEnv(new URL('../../', import.meta.url))

/**
 * Prerendering boots the server to render each page, and the Node runtime
 * refuses to start in production without a signing secret — correctly, because
 * a guessable one makes every tracking pixel forgeable. A build-scoped random
 * value satisfies that without asking anyone to put a real secret into a build
 * environment: nothing prerendered is signed, and the value dies with the
 * process. A real `MS_SECRET` in the environment still wins.
 */
if (!process.env.MS_SECRET) process.env.MS_SECRET = `${randomUUID()}${randomUUID()}`

/**
 * The one version number.
 *
 * Four screens used to carry a hand-written one — the sign-in panel claimed
 * `v1.8.2` against a repository at 0.1.0 — so it is compiled in from
 * package.json instead, and `/v1/health`, `/v1/instance` and the UI all read
 * the same constant.
 */
const VERSION = createRequire(import.meta.url)('./package.json').version as string

/**
 * Prerendering renders every public page through the real server, and the real
 * server redirects `/` to the dashboard on a self-hosted instance. Without this
 * the build would prerender a 302 — or, with `failOnError`, not build at all.
 * The static output is the marketing site; which of it a deployment actually
 * serves at `/` is a runtime decision.
 *
 * `IS_MARKETING_BUILD` is captured before the default is applied, because one
 * thing does depend on the difference: only the marketing deployment may
 * publish `mailysend.com` as its canonical host.
 *
 * Capturing it into a plain `const` was not enough. Vite evaluates this file
 * once per environment — four times for a Cloudflare build, in one process — so
 * the first load's `MS_LANDING = 'marketing'` default was still in
 * `process.env` when the second load read it, and loads two through four each
 * concluded they were the marketing build. Every fork therefore resolved
 * `sitemapHost` to `https://mailysend.com` and baked it into the bundle,
 * which is precisely the failure this guard exists to prevent. The answer is
 * memoised in an environment variable of its own, so that re-evaluating this
 * file cannot change what it decides.
 */
const ORIGINAL_LANDING = process.env.MS_LANDING_AT_BUILD_START ?? process.env.MS_LANDING ?? ''
process.env.MS_LANDING_AT_BUILD_START = ORIGINAL_LANDING

const IS_MARKETING_BUILD = ORIGINAL_LANDING === 'marketing'
if (!process.env.MS_LANDING) process.env.MS_LANDING = 'marketing'

const sitemapHost =
  process.env.MS_PUBLIC_URL ?? (IS_MARKETING_BUILD ? 'https://mailysend.com' : undefined)

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
 * The list itself lives in `src/content/site-map.ts`, which joins the hand-
 * written public pages with the guides manifest. It used to be a literal here,
 * a second literal in `scripts/llms-full.ts`, a third in `routes/resources.tsx`
 * and a fourth typed out as absolute URLs in `public/llms.txt` — and the four
 * had already drifted, with only three of them aware that `/setup` exists.
 *
 * Everything public is on it: marketing, docs and guides are the acquisition
 * surface, and static HTML is what makes them fast enough for good Core Web
 * Vitals and legible to crawlers and LLM retrievers that do not execute JS.
 * The dashboard is deliberately absent — it is per-user and must not be cached.
 */

export default defineConfig({
  cacheDir,
  /**
   * `__MS_SITE_URL__` is the same host the sitemap is generated with, compiled
   * in so that `seo/site.ts` cannot disagree with `sitemap.xml` and
   * `robots.txt` about which site this is. It used to read a
   * `VITE_PUBLIC_URL` that is set nowhere in this repository, so it always
   * fell back to the literal `https://mailysend.com` — which meant every
   * one-click Cloudflare deploy shipped canonicals, `og:url`s and JSON-LD
   * `@id`s naming a domain its operator does not own. An empty value is the
   * honest answer for a build with no configured host, and `absoluteUrl`
   * turns it into site-relative URLs that resolve to whoever is serving them.
   */
  define: {
    __MS_VERSION__: JSON.stringify(VERSION),
    __MS_SITE_URL__: JSON.stringify(sitemapHost ?? ''),
  },
  resolve: {
    alias: [
      /**
       * The one module that differs between the two targets, and it has to be
       * matched before `~` or the prefix rule below swallows it.
       *
       * An exported Durable Object class has to extend `DurableObject` from
       * `cloudflare:workers` or Workers refuses every RPC call to it — and that
       * specifier does not resolve anywhere else, so it cannot sit in code the
       * Node build also loads. Swapping the base class here keeps the seam to a
       * single file instead of a runtime branch in every actor.
       */
      ...(target === 'cloudflare'
        ? [
            {
              find: '~/server/actor-base.ts',
              replacement: fileURLToPath(
                new URL('./src/server/actor-base.cloudflare.ts', import.meta.url),
              ),
            },
          ]
        : []),
      { find: '~', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
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
        // A prerender that throws must break the build. With this false, a
        // server error on every route produced "Prerendered 0 pages", a zero
        // exit, and a deploy whose marketing site had no static HTML at all —
        // the entire SEO argument, gone silently. It stayed hidden until the
        // Cloudflare build failed two steps later for a different reason.
        failOnError: true,
        concurrency: 4,
      },
      pages: PRERENDER_PAGES,
      // A self-hosted build must never publish `mailysend.com` as its own
      // canonical host: the sitemap it ships would point every crawler at
      // somebody else's site. So the literal belongs to the marketing build
      // alone; another build uses its own configured URL, and a build that has
      // neither ships no sitemap rather than a wrong one — a sitemap with the
      // wrong host is worse than none, and the generator refuses a host-less
      // one anyway.
      sitemap: sitemapHost ? { enabled: true, host: sitemapHost } : { enabled: false },
    }),
    react(),
    tailwindcss(),
    ...(target === 'cloudflare' ? [cloudflare({ viteEnvironment: { name: 'ssr' } })] : []),
  ],
})
