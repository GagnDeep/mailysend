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
import { failure, type Instance, postJson, useInstance } from '~/lib/instance.ts'
import { assertPasskey, PasskeyError, passkeysSupported } from '~/lib/passkey.ts'
import { breadcrumbSchema, DEPLOY_URL, pageHead } from '~/seo'

/**
 * Sign in.
 *
 * Every door on this page is rendered from `/v1/instance`, never from an
 * assumption. The version this replaced offered "Continue with Cloudflare
 * Access" as the *primary* action on every deployment in the world — including
 * the overwhelming majority where the endpoint answers 501 because Access was
 * never configured — and offered an emailed one-time code on instances with no
 * verified sending domain, which cannot send one. A door drawn on a wall is
 * worse than no door: the person trying to get in spends their time on it.
 */
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
        'Sign in to your own MailySend instance with a passkey. The dashboard runs on your ' +
        'domain — there is no MailySend account and no credentials we can lose.',
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

const PANEL_POINTS = [
  'No MailySend account exists — there is nothing for us to breach.',
  'A passkey cannot be phished and never leaves your device.',
  'Roles: owner, developer, marketer, read-only — with an audit log.',
]

type Mode = 'choose' | 'code-sent' | 'recovery'

function SignInPage() {
  const { next } = Route.useSearch()
  const navigate = useNavigate()
  const state = useInstance()
  const instance = state.status === 'ready' ? state.instance : null

  const [mode, setMode] = useState<Mode>('choose')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const done = () => navigate({ to: next ?? '/app', replace: true })

  const run = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(err instanceof PasskeyError || err instanceof Error ? err.message : fallback)
    } finally {
      setBusy(false)
    }
  }

  const signInWithPasskey = () =>
    run(async () => {
      const { challenge, response } = await assertPasskey('/v1/auth/passkey/options')
      const verify = await postJson('/v1/auth/passkey/verify', { challenge, response })
      if (!verify.ok) throw new Error(await failure(verify, 'That passkey was not accepted.'))
      done()
    }, 'That passkey was not accepted.')

  const submitEmail = (event: FormEvent) => {
    event.preventDefault()
    return run(async () => {
      const response = await postJson('/v1/auth/otp', { email })
      if (!response.ok) throw new Error(await failure(response, 'Could not send a code.'))
      const body = (await response.json()) as { status?: string }
      // The server says `unavailable` when this deployment has no verified
      // sending domain. It used to say `sent` and this page used to promise an
      // inbox that would never receive anything.
      if (body.status === 'unavailable') {
        setNotice(
          'This instance cannot send email yet — no sending domain is verified. Sign in with a passkey, or add a domain from the dashboard first.',
        )
        return
      }
      setMode('code-sent')
    }, 'Could not send a code.')
  }

  const submitCode = (event: FormEvent) => {
    event.preventDefault()
    return run(async () => {
      const response = await postJson('/v1/auth/session', { email, code })
      if (!response.ok) throw new Error(await failure(response, 'That code did not work.'))
      done()
    }, 'That code did not work.')
  }

  const submitRecovery = (event: FormEvent) => {
    event.preventDefault()
    return run(async () => {
      const response = await postJson('/v1/auth/recovery', { code: recovery })
      if (!response.ok) throw new Error(await failure(response, 'That recovery code is not valid.'))
      done()
    }, 'That recovery code is not valid.')
  }

  const signInWithAccess = () =>
    run(async () => {
      const response = await postJson('/v1/auth/access')
      if (!response.ok) throw new Error(await failure(response, 'Access sign-in failed.'))
      done()
    }, 'Access sign-in failed.')

  // An instance nobody has claimed has nothing to sign in to yet.
  if (instance && !instance.claimed) return <Unclaimed />

  return (
    <AuthLayout footerLinks={FOOTER_LINKS} panel={<Panel instance={instance} />}>
      <h1 className="ms-display-2 m-0 mb-2.5">Sign in to your instance</h1>
      <p className="m-0 mb-7 text-[15.5px] leading-[1.6] text-muted">
        Your dashboard lives on your own domain. We never see these credentials — they never leave
        this deployment.
      </p>

      {instance?.previous_public_url ? (
        <p className="mb-5 rounded-md border border-line bg-tint px-3.5 py-3 text-[14px] leading-[1.6] text-muted">
          This instance moved from{' '}
          <strong className="text-ink">{new URL(instance.previous_public_url).host}</strong>.
          Passkeys created there cannot be used here — sign in with a recovery code and register a
          new one.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mb-5 rounded-md border border-warm-border bg-accent-soft px-3.5 py-3 text-[14.5px] text-warning"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="mb-5 rounded-md border border-line bg-tint px-3.5 py-3 text-[14.5px] leading-[1.6] text-muted">
          {notice}
        </p>
      ) : null}

      {mode === 'code-sent' ? (
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
          <TextButton
            onClick={() => {
              setMode('choose')
              setCode('')
              setError(null)
            }}
          >
            Use a different address
          </TextButton>
        </form>
      ) : mode === 'recovery' ? (
        <form onSubmit={submitRecovery} className="flex flex-col">
          <p className="m-0 mb-5 text-[15px] leading-[1.6] text-muted">
            One of the ten codes you saved when this instance was claimed. Each works once.
          </p>
          <Label htmlFor="signin-recovery" className="mb-[7px]">
            Recovery code
          </Label>
          <Input
            id="signin-recovery"
            autoFocus
            value={recovery}
            onChange={(event) => setRecovery(event.target.value)}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            className="mb-3.5 h-[50px] rounded-md font-mono"
          />
          <Button
            type="submit"
            disabled={busy || recovery.length < 8}
            className="h-[50px] w-full rounded-md text-[15px]"
          >
            {busy ? 'Checking…' : 'Sign in'}
          </Button>
          <TextButton
            onClick={() => {
              setMode('choose')
              setError(null)
            }}
          >
            Back
          </TextButton>
        </form>
      ) : (
        <div className="flex flex-col">
          {passkeysSupported() ? (
            <Button
              type="button"
              onClick={signInWithPasskey}
              disabled={busy}
              className="h-[52px] w-full rounded-md text-[15px]"
            >
              {busy ? 'Waiting for your device…' : 'Sign in with a passkey'}
            </Button>
          ) : (
            <p className="m-0 mb-2 text-[14px] leading-[1.6] text-muted">
              This browser cannot use a passkey. Use a recovery code, or a browser that can.
            </p>
          )}

          {/* Rendered only when the instance says Access is configured. */}
          {instance?.auth.access ? (
            <>
              <Divider label="or" />
              <Button
                type="button"
                variant="outline"
                onClick={signInWithAccess}
                disabled={busy}
                className="h-[50px] w-full rounded-md text-[15px]"
              >
                Continue with Cloudflare Access
              </Button>
            </>
          ) : null}

          {/*
            Single sign-on, offered only when the instance reports a complete
            OIDC configuration — the same rule that removed the Access button
            from instances that had never configured Access. This is a plain
            link rather than a fetch: the flow is a top-level redirect and has
            to be one, so the provider can set its own cookies and show its own
            consent screen.
          */}
          {instance?.auth.oidc ? (
            <>
              <Divider label="or" />
              <Button asChild variant="outline" className="h-[50px] w-full rounded-md text-[15px]">
                <a href="/v1/auth/oidc/start">
                  Continue with {instance.auth.oidc_label ?? 'single sign-on'}
                </a>
              </Button>
            </>
          ) : null}

          {/* Likewise the emailed code: offered only when mail can be sent. */}
          {instance?.auth.otp ? (
            <>
              <Divider label="or email a one-time code" />
              <form onSubmit={submitEmail} className="flex flex-col">
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
                  placeholder="you@your-domain.dev"
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
            </>
          ) : null}

          <TextButton onClick={() => setMode('recovery')}>Use a recovery code</TextButton>
        </div>
      )}

      <p className="mt-[26px] border-t border-line pt-[22px] text-[14.5px] leading-[1.7] text-muted">
        No instance yet?{' '}
        <a href={DEPLOY_URL} rel="noreferrer" className={AUTH_LINK_STRONG}>
          Deploy to Cloudflare
        </a>{' '}
        — {DEPLOY_DURATION} — then open <code className="font-mono text-[13.5px]">/setup</code> on
        your own domain.
      </p>
      <p className="mt-3.5 text-[13.5px] leading-[1.7] text-muted-2">
        Locked out with no passkey and no codes? Run{' '}
        <code className="font-mono">npx mailysend claim --url …</code> from a machine that can reach
        this deployment’s database —{' '}
        <a href="/docs#auth" className={AUTH_LINK}>
          the auth notes
        </a>{' '}
        explain why that is proof enough.
      </p>
    </AuthLayout>
  )
}

const Divider = ({ label }: { label: string }) => (
  <div className="my-6 flex items-center gap-3.5">
    <span aria-hidden="true" className="h-px flex-1 bg-line" />
    <span className="ms-eyebrow">{label}</span>
    <span aria-hidden="true" className="h-px flex-1 bg-line" />
  </div>
)

const TextButton = ({ onClick, children }: { onClick: () => void; children: string }) => (
  <button
    type="button"
    onClick={onClick}
    className="mt-3.5 cursor-pointer self-start border-none bg-transparent text-[14px] text-muted underline-offset-4 hover:text-ink hover:underline"
  >
    {children}
  </button>
)

function Unclaimed() {
  return (
    <AuthLayout footerLinks={FOOTER_LINKS} panel={<Panel instance={null} />}>
      <h1 className="ms-display-2 m-0 mb-2.5">This instance has no owner yet</h1>
      <p className="m-0 mb-7 text-[15.5px] leading-[1.6] text-muted">
        Nothing to sign in to until somebody claims it. If this is your deployment, claim it now —
        anyone who reaches this URL before you can.
      </p>
      <Button asChild className="h-[52px] w-full rounded-md text-[15px]">
        <a href="/setup">Claim this instance</a>
      </Button>
    </AuthLayout>
  )
}

/**
 * The instance summary, from the instance.
 *
 * Every line here used to be a constant in this file: `mail.acme.dev`,
 * `jwt ok` for Access on deployments that had none, `region eu`, a fabricated
 * key fingerprint, and `v1.8.2` against a repository at 0.1.0.
 */
function Panel({ instance }: { instance: Instance | null }) {
  const host = instance ? new URL(instance.public_url).host : '…'
  return (
    <>
      <p className="ms-eyebrow m-0 text-accent-on-dark">WHAT YOU’RE SIGNING INTO</p>
      <AuthPre>
        <div>
          {'HOST '}
          <span className="text-code-green">{host}</span>
          {'  your Worker'}
        </div>
        <div>
          {'AUTH '}
          <span className="text-code-green">passkey</span>
          {instance?.auth.access ? ' · access' : ''}
          {instance?.auth.oidc ? ' · sso' : ''}
          {instance?.auth.otp ? ' · email code' : ''}
        </div>
        <div>
          {'SEND '}
          <span className="text-code-green">
            {instance ? `${instance.sending.verified_domains} verified domain(s)` : '…'}
          </span>
        </div>
        <div>
          {'KEYS '}
          <span className="text-code-green">local</span>
          {'  your secrets'}
        </div>
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
      {instance ? (
        <p className="m-0 inline-flex items-center gap-2.5 self-start rounded-pill border border-dark-line px-3.5 py-2 text-[13px] text-on-dark-2">
          <StatusDot tone="positive" size={7} pulse className="bg-positive-bright" />
          Your instance · {instance.mode === 'single' ? 'self-hosted' : 'hosted'} · v
          {instance.version}
        </p>
      ) : null}
    </>
  )
}
