import { createRouter } from '@tanstack/react-router'
import { NotFound } from './components/marketing/not-found.tsx'
import { routeTree } from './routeTree.gen'

/**
 * The Start plugin resolves this file by name and reads `getRouter` from it,
 * so both the export name and the location are load-bearing.
 */
export function getRouter() {
  return createRouter({
    routeTree,
    // The marketing routes are prerendered static HTML with no loaders, so
    // there is nothing to show a pending state for; intent-preloading only
    // costs a fetch of a document the browser will cache anyway.
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    // Without this the router renders its own `<p>Not Found</p>` and warns on
    // every miss. A 404 is a page real traffic lands on, so it gets a real one.
    defaultNotFoundComponent: NotFound,
  })
}
