import { Button } from '@mailysend/ui'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { RotateCcw } from 'lucide-react'
import { errorMessage } from '../../lib/query.ts'

/**
 * What a route renders when it threw.
 *
 * The router ships no error component unless one is configured, and what it
 * does instead is unmount the tree: a thrown render error took the whole
 * dashboard to a blank white page with the reason in a console nobody has open.
 * The 404 already got a real page; this is the other half of the same decision.
 *
 * `reset` re-runs the route's loaders and re-renders it, which is the right
 * first attempt — most of what throws here is a failed fetch, and a retry is
 * both cheaper and likelier to work than a reload. Reloading is offered second
 * because it is the one that also clears a bad client-side state, and the two
 * do different things, so the screen says which is which rather than offering
 * one button labelled "try again" that does both.
 *
 * The message comes from `errorMessage`, so a failure the server explained in
 * words is shown in those words instead of behind "Something went wrong."
 */
export const RouteError = ({ error, reset }: ErrorComponentProps) => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
    <h1 className="ms-display-3 max-w-[22ch]">This screen didn't load.</h1>
    <p className="mt-4 max-w-[58ch] text-[15.5px] leading-[1.6] text-muted">
      {errorMessage(error)}
    </p>
    <div className="mt-6 flex flex-wrap justify-center gap-3">
      <Button onClick={reset}>
        <RotateCcw aria-hidden="true" />
        Try again
      </Button>
      <Button variant="outline" onClick={() => window.location.reload()}>
        Reload the page
      </Button>
    </div>
    <p className="mt-6 max-w-[58ch] text-[13px] text-muted">
      Nothing was changed by the failure. If it keeps happening, the deployment's own logs are at{' '}
      <code className="font-mono">wrangler tail</code> and the request will be in them.
    </p>
  </div>
)
