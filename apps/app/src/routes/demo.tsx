import { Button, Input, Label, StatusDot } from '@mailysend/ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { AUTH_LINK, AuthLayout, AuthPre } from '~/components/marketing/auth-layout.tsx'
import { startDemo } from '~/lib/demo/state.ts'
import { useInstance } from '~/lib/instance.ts'
import { breadcrumbSchema, DEPLOY_URL, pageHead } from '~/seo'

/**
 * The way into the product tour.
 *
 * It looks like the sign-in page because it is the same act — you give an
 * address and you end up inside the dashboard — and because the first thing the
 * tour has to establish is that this product's front door is *your* deployment,
 * not an account on ours. The difference is stated rather than implied: there
 * is no password, no passkey and no account, because there is nothing to have
 * an account on. The address is filed as a contact on this deployment (which is
 * itself a MailySend instance, running the software on the page) and that is
 * the whole of what happens to it.
 */
export const Route = createFileRoute('/demo')({
  head: () =>
    pageHead({
      title: 'Try the dashboard',
      description:
        'Open the MailySend dashboard with a month of sample data in it — logs, deliverability, broadcasts, automations and the shared inbox. Read-only, no account, nothing to install.',
      path: '/demo',
      image: '/og/dashboard-tour.png',
      jsonLd: [breadcrumbSchema([{ name: 'Demo', path: '/demo' }])],
    }),
  component: DemoPage,
})

const FOOTER_LINKS = [
  { label: 'Product tour', href: '/dashboard-tour' },
  { label: 'Docs', href: '/docs' },
  { label: 'Pricing', href: '/pricing' },
]

const PANEL_POINTS = [
  'A month of sample sending: 120 messages, three domains, two providers.',
  'Every screen is the real one — same components, same code paths.',
  'Read-only. Nothing saves, and no mail leaves.',
]

function DemoPage() {
  const navigate = useNavigate()
  const state = useInstance()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Offered only by a deployment that is a shop window. On somebody's own
   * instance `/v1/demo` answers 404 and this page would be a door drawn on a
   * wall — so it says what it is instead of failing on submit.
   */
  const available = state.status !== 'ready' || state.instance.landing === 'marketing'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    void startDemo(email.trim(), 'demo-page')
      .then(() => navigate({ to: '/app', replace: true }))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not start the demo.')
        setBusy(false)
      })
  }

  return (
    <AuthLayout footerLinks={FOOTER_LINKS} panel={<Panel />}>
      <h1 className="ms-display-2 m-0 mb-2.5">Open the dashboard</h1>
      <p className="m-0 mb-7 text-[15.5px] leading-[1.6] text-muted">
        The real console, filled with a month of sample sending. No account, nothing to install, and
        nothing you do in it is saved.
      </p>

      {error ? (
        <p
          role="alert"
          className="mb-5 rounded-md border border-warm-border bg-accent-soft px-3.5 py-3 text-[14.5px] text-warning"
        >
          {error}
        </p>
      ) : null}

      {available ? (
        <form onSubmit={submit} className="flex flex-col">
          <Label htmlFor="demo-email" className="mb-[7px]">
            Your email
          </Label>
          <Input
            id="demo-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            className="mb-3.5 h-[50px] rounded-md"
          />
          <Button type="submit" disabled={busy || email.trim().length < 3} className="h-[50px]">
            {busy ? 'Opening…' : 'Open the demo'}
          </Button>
          <p className="m-0 mt-3.5 text-[13px] leading-[1.6] text-muted-2">
            We use it to say hello once and to tell you when something ships. It is stored on this
            deployment — which is MailySend running its own software — and you can unsubscribe from
            the first message. No credit card, because there is nothing to charge for.
          </p>
        </form>
      ) : (
        <p className="rounded-md border border-line bg-tint px-3.5 py-3 text-[14.5px] leading-[1.6] text-muted">
          This is somebody's own MailySend instance, so there is no demo to show you — the dashboard
          here has real mail in it.{' '}
          <a href="/sign-in" className={AUTH_LINK}>
            Sign in
          </a>{' '}
          instead.
        </p>
      )}
    </AuthLayout>
  )
}

const Panel = () => (
  <>
    <div className="flex items-center gap-2 text-[13px] text-on-dark-3">
      <StatusDot tone="positive" />
      Sample data · read-only
    </div>
    <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
      {PANEL_POINTS.map((point) => (
        <li key={point} className="text-[15px] leading-[1.55] text-on-dark-2">
          {point}
        </li>
      ))}
    </ul>
    <AuthPre>{`$ npx mailysend provision
$ npx mailysend deploy
✓ https://mail.yourdomain.com`}</AuthPre>
    <p className="m-0 text-[14px] leading-[1.6] text-on-dark-3">
      When you have finished looking round, the same dashboard on your own domain is two commands
      and about four minutes away.{' '}
      <a
        href={DEPLOY_URL}
        rel="noreferrer"
        className="font-semibold text-accent-on-dark no-underline"
      >
        Deploy it →
      </a>
    </p>
  </>
)
