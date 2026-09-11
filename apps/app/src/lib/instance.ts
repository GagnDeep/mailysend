import { useEffect, useState } from 'react'

/**
 * What this deployment can actually do, read once per pre-auth screen.
 *
 * Every sign-in door the UI draws has to come from here rather than from an
 * assumption in the markup. The bug this exists to kill shipped in four places
 * at once: a Cloudflare Access button rendered as the *primary* action on
 * instances where the endpoint answered 501, an "email me a code" form on
 * instances that could not send mail, a link to a setup wizard that did not
 * exist, and a status panel asserting `mail.acme.dev`, `region eu` and
 * `v1.8.2` on every instance in the world.
 */
export interface Instance {
  object: 'instance'
  claimed: boolean
  mode: 'single' | 'saas'
  version: string
  public_url: string
  landing: 'app' | 'marketing'
  auth: {
    passkey: boolean
    access: boolean
    otp: boolean
    device: boolean
    /** True only when the instance has a full OIDC configuration. */
    oidc?: boolean
    /** What the button should say, e.g. "Okta". */
    oidc_label?: string | null
  }
  /**
   * What `/setup` must ask for before it will claim this instance — never who.
   * `code_required` is the first-boot claim code, which is off unless the
   * deployment opted in with `MS_REQUIRE_CLAIM_CODE`; `reserved` says
   * `MS_OWNER_EMAIL` narrows the claim to one address the API does not name.
   */
  claim?: { code_required: boolean; reserved: boolean }
  sending: { ready: boolean; verified_domains: number; last_error: string | null }
  previous_public_url: string | null
}

export type InstanceState =
  | { status: 'loading' }
  | { status: 'ready'; instance: Instance }
  | { status: 'error'; message: string }

/**
 * Client-only on purpose.
 *
 * These pages are prerendered to static HTML at build time, so anything read
 * during render would be frozen into the artefact — a build-time answer about a
 * deployment that does not exist yet. The first paint shows the shape of the
 * page; the doors appear when the instance has told us which ones are real.
 */
export function useInstance(): InstanceState {
  const [state, setState] = useState<InstanceState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetch('/v1/instance', { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`instance check failed (${response.status})`)
        return (await response.json()) as Instance
      })
      .then((instance) => {
        if (!cancelled) setState({ status: 'ready', instance })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // Deliberately not fatal. An instance that cannot answer this is still
        // an instance somebody may be able to sign in to, so the pages fall
        // back to offering every door rather than none.
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not reach this instance.',
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

/** Reads the API's error body, falling back to something a person can act on. */
export async function failure(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null
  return body?.message ?? fallback
}

export const postJson = (path: string, body?: unknown): Promise<Response> =>
  fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
