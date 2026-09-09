/// <reference types="vite/client" />
import { color } from '@mailysend/design-tokens'
import { TooltipProvider } from '@mailysend/ui'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { graph, organizationSchema, SITE_NAME, SITE_TWITTER, webSiteSchema } from '~/seo'
import appCss from '~/styles.css?url'

/**
 * The root contributes the document-wide head and nothing page-specific.
 *
 * Meta tags dedupe by `name`/`property` with the deepest match winning, so
 * defaults here are safely overridden by each route. Links do not dedupe —
 * which is exactly why the canonical is emitted per route and never here, or
 * every page would ship two of them and point at the wrong one half the time.
 *
 * `title` and `description` are deliberately absent. Every route supplies its
 * own, and a default here would not be overridden on the one route that has no
 * match at all — the 404, which renders outside the route tree and therefore
 * would have shipped the home page's title beside its own. A 404 that describes
 * itself as the home page is a soft 404, and gets indexed as one.
 */
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      // Read from the token module rather than typed as a literal: the browser
      // chrome colour has to match the page background exactly, and a CSS
      // variable cannot reach a meta tag.
      { name: 'theme-color', content: color.paper },
      { property: 'og:site_name', content: SITE_NAME },
      { property: 'og:locale', content: 'en_US' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:site', content: SITE_TWITTER },
      {
        'script:ld+json': graph([organizationSchema(), webSiteSchema()]),
      } as unknown as { name: string },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      // The faces are self-hosted and same-origin, so a preload is the whole
      // optimisation — there is no third-party connection left to warm up.
      {
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        href: '/fonts/instrument-sans-latin.woff2',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        href: '/fonts/bricolage-grotesque-latin.woff2',
        crossOrigin: 'anonymous',
      },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: RootDocument,
  component: Outlet,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
        <Scripts />
      </body>
    </html>
  )
}
