import { Button, Input, Label, StatusDot } from '@mailysend/ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import {
  AUTH_LINK,
  AUTH_LINK_STRONG,
  AuthLayout,
  AuthPre,
} from '~/components/marketing/auth-layout.tsx'
import { DEPLOY_DURATION } from '~/components/marketing/deploy.tsx'
import { breadcrumbSchema, pageHead } from '~/seo'

export const Route = createFileRoute('/sign-in')({
  // `?next=` is where the dashboard redirect parks the page you were aiming
  // for. Validated rather than trusted: a `next` pointing at another origin is
  // an open redirect, so anything that is not a same-site path is dropped.
  validateSearch: (search: Record<string, unknown>): { next?: string } => {
    const next = typeof search.next === 'string' ? search.next : undefined
    return next?.startsWith('/') && !next.startsWith('//') ? { next } : {}
  },
  head: () =>
    pageHead({
      title: 'Sign in',
      description:
        'Sign in to your own MailySend instance. The dashboard runs on your domain behind your ' +
        'Cloudflare Access policy — there is no MailySend account and no credentials we can lose.',
      path: '/sign-in',
      image: '/og/sign-in.png',
      jsonLd: [breadcrumbSchema([{ name: 'Sign in', path: '/sign-in' }])],
    }),
  component: SignInPage,
})

const FOOTER_LINKS = [
  { label: 'Docs', href: '/docs' },
  { label: 'Status', href: '/resources#status' },
  { label: 'Security', href: '/resources#security' },
]

/**
 * The four-line instance summary. Split into label/value/tail because the
 * columns only align while the padding is part of the string.
 */
const INSTANCE_LINES = [
  { label: 'GET  mail.acme.dev/          ', value: '200', tail: '  your Worker' },
  { label: 'AUTH cloudflare access       ', value: 'jwt ok', tail: '  your policy' },
  { label: 'DATA durable objects · d1    ', value: 'eu', tail: '     your region' },
  { label: 'KEYS ms_live_••••4f21        ', value: 'local', tail: '  your secrets' },
]

const PANEL_POINTS = [
  'No MailySend account exists — there is nothing for us to breach.',
  'SSO, MFA and device posture come from your Access policy.',
  'Roles: owner, developer, marketer, read-only — with an audit log.',
]

/** Reads the API's error body, falling back to something a person can act on. */
async function failure(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null
  return body?.message ?? fallback
}

function SignInPage() {
  const { next } = Route.useSearch()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const done = () => navigate({ to: next ?? '/app', replace: true })

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/v1/auth/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      // 202 whether or not the address exists — the server refuses to say, and
      // so does this screen.
      if (!response.ok) throw new Error(await failure(response, 'Could not send a code.'))
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send a code.')
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/v1/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, code }),
      })
      if (!response.ok) throw new Error(await failure(response, 'That code did not work.'))
      done()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not work.')
    } finally {
      setBusy(false)
    }
  }

  const signInWithAccess = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/v1/auth/access', {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) {
        throw new Error(
          await failure(
            response,
            'Cloudflare Access is not configured on this instance. Use a one-time code instead.',
          ),
        )
      }
      done()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Access sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      footerLinks={FOOTER_LINKS}
      panel={
        <>
          <p className="ms-eyebrow m-0 text-accent-on-dark">WHAT YOU’RE SIGNING INTO</p>
          <AuthPre>
            {INSTANCE_LINES.map((line) => (
              <div key={line.label}>
                {line.label}
                <span className="text-code-green">{line.value}</span>
                {line.tail}
              </div>
            ))}
          </AuthPre>
          <ul className="m-0 flex list-none flex-col gap-3.5 p-0 text-[15px] leading-[1.65] text-on-dark-3">
            {PANEL_POINTS.map((point) => (
              <li key={point} className="flex gap-[11px]">
                <span aria-hidden="true" className="font-bold text-accent-on-dark">
                  ·
                </span>
                {point}
              </li>
            ))}
          </ul>
          <p className="m-0 inline-flex items-center gap-2.5 self-start rounded-pill border border-dark-line px-3.5 py-2 text-[13px] text-on-dark-2">
            <StatusDot tone="positive" size={7} pulse className="bg-positive-bright" />
            Your instance · region eu · v1.8.2
          </p>
        </>
      }
    >
      <h1 className="ms-display-2 m-0 mb-2.5">Sign in to your instance</h1>
      <p className="m-0 mb-7 text-[15.5px] leading-[1.6] text-muted">
        Your dashboard lives on your own domain, behind your Cloudflare Access policy. We never see
        these credentials.
      </p>

      {error ? (
        <p
          role="alert"
          className="mb-5 rounded-md border border-warm-border bg-accent-soft px-3.5 py-3 text-[14.5px] text-warning"
        >
          {error}
        </p>
      ) : null}

      {sent ? (
        <form onSubmit={submitCode} className="flex flex-col">
          <p className="m-0 mb-5 text-[15px] leading-[1.6] text-muted">
            We sent a six-digit code to <strong className="text-ink">{email}</strong>. It expires in
            ten minutes.
          </p>
          <Label htmlFor="signin-code" className="mb-[7px]">
            Sign-in code
          </Label>
          <Input
            id="signin-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            required
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            className="mb-3.5 h-[50px] rounded-md font-mono tracking-[0.3em]"
          />
          <Button
            type="submit"
            disabled={busy || code.length !== 6}
            className="h-[50px] w-full rounded-md text-[15px]"
          >
            {busy ? 'Checking…' : 'Sign in'}
          </Button>
          <button
            type="button"
            onClick={() => {
              setSent(false)
              setCode('')
              setError(null)
            }}
            className="mt-3.5 cursor-pointer border-none bg-transparent text-[14px] text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Use a different address
          </button>
        </form>
      ) : (
        <form onSubmit={submitEmail} className="flex flex-col">
          <Button
            type="button"
            onClick={signInWithAccess}
            disabled={busy}
            className="h-[52px] w-full rounded-md text-[15px]"
          >
            Continue with Cloudflare Access
          </Button>

          <div className="my-6 flex items-center gap-3.5">
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
            <span className="ms-eyebrow">or email a one-time code</span>
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
          </div>

          <Label htmlFor="signin-email" className="mb-[7px]">
            Work email
          </Label>
          <Input
            id="signin-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@acme.dev"
            className="mb-3.5 h-[50px] rounded-md"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={busy}
            className="h-[50px] w-full rounded-md text-[15px]"
          >
            {busy ? 'Sending…' : 'Email me a code'}
          </Button>
        </form>
      )}

      <p className="mt-[26px] border-t border-line pt-[22px] text-[14.5px] leading-[1.7] text-muted">
        No instance yet?{' '}
        <a href="/sign-up" className={AUTH_LINK_STRONG}>
          Run the setup wizard
        </a>{' '}
        after you{' '}
        <a href="/resources#selfhost" className={AUTH_LINK_STRONG}>
          deploy to Cloudflare
        </a>{' '}
        — {DEPLOY_DURATION}.
      </p>
      <p className="mt-3.5 text-[13.5px] leading-[1.7] text-muted-2">
        Locked out?{' '}
        <a href="/docs#auth" className={AUTH_LINK}>
          Reset the Access policy
        </a>{' '}
        from your Cloudflare dashboard, or{' '}
        <a href="/resources#security" className={AUTH_LINK}>
          read the auth notes
        </a>
        .
      </p>
    </AuthLayout>
  )
}
