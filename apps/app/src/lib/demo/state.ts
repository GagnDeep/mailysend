import { useSyncExternalStore } from 'react'

/**
 * Is this browser in the tour, and who said so.
 *
 * Two facts, kept in two places for two reasons. The cookie is what
 * `server.ts` reads to let the SSR render of `/app` through without a session —
 * it has to be a cookie because that decision is made on the server, before any
 * script runs. The address is kept in `localStorage` because it never needs to
 * leave the browser again: it was already filed server-side when the tour
 * started, and the only thing the dashboard does with it is put the visitor's
 * own name in the top-right.
 *
 * Neither is a credential. See `server/api/demo.ts`.
 */

const COOKIE = 'ms_demo_tour'
const EMAIL_KEY = 'mailysend.demo.email'

/** Read synchronously, because `request()` has to know before the first fetch. */
export const isDemo = (): boolean => {
  if (typeof document === 'undefined') return false
  // A real session ends the tour, and it ends it server-side: `sessionResponse`
  // expires this cookie on the same response that issues the session, because
  // `ms_session` is `HttpOnly` and a script here could not see it to defer to
  // it. See `server/session.ts`.
  return document.cookie.split('; ').some((pair) => pair === `${COOKIE}=1`)
}

export const demoEmail = (): string => {
  if (typeof window === 'undefined') return 'you@example.com'
  try {
    return window.localStorage.getItem(EMAIL_KEY) || 'you@example.com'
  } catch {
    // Private mode throws on storage. A tour that refuses to start because it
    // cannot remember an address is the wrong trade.
    return 'you@example.com'
  }
}

const listeners = new Set<() => void>()

const announce = () => {
  for (const listener of listeners) listener()
}

/**
 * Starts the tour: files the address, takes the cookie, remembers the address.
 *
 * The POST is what makes this more than a client-side flag — the address is
 * filed as a contact on the deployment, and the cookie comes back on the same
 * response, so there is no window where one happened and the other did not.
 */
export const startDemo = async (email: string, source: string): Promise<void> => {
  const response = await fetch('/v1/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, source }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message ?? 'Could not start the demo.')
  }
  try {
    window.localStorage.setItem(EMAIL_KEY, email)
  } catch {
    /* see demoEmail */
  }
  announce()
}

/**
 * Ends it. The cookie is cleared server-side — a `Max-Age=0` from the origin
 * that set it is the only deletion that works in every browser — and the local
 * copy of the address goes with it, because keeping a stranger's address in a
 * shared browser after they said they were done is not ours to do.
 */
export const endDemo = async (): Promise<void> => {
  await fetch('/v1/demo', { method: 'DELETE' }).catch(() => null)
  try {
    window.localStorage.removeItem(EMAIL_KEY)
  } catch {
    /* see demoEmail */
  }
  announce()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * `useSyncExternalStore` rather than `useState` + an effect: the server
 * snapshot is `false`, the client's is read from the cookie, and React is told
 * about the difference instead of discovering it as a hydration mismatch.
 */
export const useDemo = (): boolean => useSyncExternalStore(subscribe, isDemo, () => false)
