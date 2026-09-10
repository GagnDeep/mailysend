import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useAppScope } from './scope.tsx'

/**
 * The client-side backstop.
 *
 * The real guard is in `server.ts`: `/app/*` is checked against the session
 * cookie before a byte is rendered, because this component ran after hydration
 * and the shell — sidebar, topbar, workspace name — had already streamed to
 * whoever asked. This is what catches a session that expires while the tab is
 * open, and what routes an unclaimed instance to `/setup`.
 *
 * Only 401 redirects. A 500 from `/v1/me` means the instance is unwell, and
 * bouncing someone to a sign-in page they can't complete would hide that.
 */
export const RequireSession = ({ children }: { children: ReactNode }) => {
  const { user, userLoading, userError } = useAppScope()
  const navigate = useNavigate()
  // Captured on the first render rather than tracked: reading the live location
  // and redirecting to it produces `/sign-in?next=/sign-in?next=…` growing once
  // per effect run, because the redirect itself changes what is being read.
  const [target] = useState(() =>
    typeof window === 'undefined' ? '/app' : window.location.pathname + window.location.search,
  )
  const sent = useRef(false)

  const unauthenticated = userError?.status === 401

  useEffect(() => {
    if (!unauthenticated || sent.current) return
    sent.current = true
    // An instance with no owner has no session to be missing, and sending
    // someone to a sign-in page that cannot work is the loop this whole change
    // exists to break. One fetch, only on the failure path.
    const toSignIn = () =>
      navigate({
        to: '/sign-in',
        search: target.startsWith('/app') ? { next: target } : {},
        replace: true,
      })

    void fetch('/v1/instance')
      .then(async (response) =>
        response.ok ? ((await response.json()) as { claimed?: boolean }) : null,
      )
      .then((body) => {
        if (body?.claimed === false) {
          window.location.replace('/setup')
          return
        }
        toSignIn()
      })
      .catch(toSignIn)
  }, [unauthenticated, navigate, target])

  if (unauthenticated) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-[15px] text-muted">
        Checking your session…
      </div>
    )
  }
  // `user === undefined` while the first `/v1/me` is in flight is not an error
  // state and gets no spinner of its own: the screens below already render
  // their own skeletons, and a full-page flash on every navigation is worse.
  if (userLoading && !user) return children
  return children
}
