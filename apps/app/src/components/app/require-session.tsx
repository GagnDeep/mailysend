import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useAppScope } from './scope.tsx'

/**
 * The signed-out redirect.
 *
 * Without this, a visitor with no session gets the dashboard chrome with an
 * `missing_api_key` alert inside every panel — technically accurate and
 * completely unhelpful, since the answer is "sign in", not "check your API
 * key". Session state is only knowable on the client (the cookie is read by the
 * `/v1/me` call, and these screens are never prerendered), so the check lives
 * in an effect rather than in `beforeLoad`.
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
    navigate({
      to: '/sign-in',
      search: target.startsWith('/app') ? { next: target } : {},
      replace: true,
    })
  }, [unauthenticated, navigate, target])

  if (unauthenticated) return null
  // `user === undefined` while the first `/v1/me` is in flight is not an error
  // state and gets no spinner of its own: the screens below already render
  // their own skeletons, and a full-page flash on every navigation is worse.
  if (userLoading && !user) return children
  return children
}
