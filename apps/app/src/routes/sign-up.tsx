import type { TerminalLine } from '@mailysend/ui'
import { Button, cn, Input, Label, MonoChip, Terminal } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AUTH_LINK_STRONG, AuthLayout, AuthPre } from '~/components/marketing/auth-layout.tsx'
import { breadcrumbSchema, pageHead } from '~/seo'

export const Route = createFileRoute('/sign-up')({
  head: () =>
    pageHead({
      title: 'Set up your instance',
      description:
        'The three-screen setup wizard that runs on your own MailySend deploy: name the ' +
        'workspace, add a sending domain with SPF, DKIM and DMARC written for you, then send.',
      path: '/sign-up',
      image: '/og/sign-up.png',
      jsonLd: [breadcrumbSchema([{ name: 'Set up your instance', path: '/sign-up' }])],
    }),
  component: SignUpPage,
})

const FOOTER_LINKS = [
  { label: 'Quickstart', href: '/docs#quickstart' },
  { label: 'Migrating from Resend', href: '/compare#migrate' },
]

const DNS_RECORDS = [
  { name: 'TXT  send        ', value: 'v=spf1 include:spf.acme.dev ~all' },
  { name: 'TXT  ms1._domainkey  ', value: 'p=MIGfMA0GCSq…' },
  { name: 'TXT  _dmarc      ', value: 'v=DMARC1; p=none; rua=…' },
]

const FIRST_SEND_LINES: TerminalLine[] = [
  { kind: 'command', text: 'npx mailysend send --to you@acme.dev --subject "It works"' },
  { kind: 'success', text: '✓ em_7Kq2xR9vTb  delivered  41ms' },
]

const PANEL_STEPS = [
  {
    step: '01',
    title: 'Workspace & owner',
    description: 'Stored in your D1 database, behind your Access policy.',
  },
  {
    step: '02',
    title: 'Domain & DNS',
    description: 'Written automatically on Cloudflare DNS, copy-paste anywhere else.',
  },
  {
    step: '03',
    title: 'Key & first send',
    description: 'Scoped key as a Worker secret, then a live test send from the CLI.',
  },
]

const fieldClass = 'mb-4 h-[50px] rounded-md'

function SignUpPage() {
  // The only client state on the page. The artboard's wizard is three screens
  // of one form, not three routes — a URL per step would be a shareable link
  // into a half-configured instance.
  const [step, setStep] = useState(1)

  return (
    <AuthLayout
      formWidth="max-w-[430px]"
      footerLinks={FOOTER_LINKS}
      panel={
        <>
          <p className="ms-eyebrow m-0 text-accent-on-dark">SETUP, IN FULL</p>
          <h2 className="ms-display-2 m-0">Three screens, then you’re sending.</h2>
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {PANEL_STEPS.map((item) => (
              <li key={item.step} className="flex items-start gap-3.5">
                <span className="min-w-[22px] font-mono text-[12px] font-bold text-accent-on-dark">
                  {item.step}
                </span>
                <span>
                  <span className="block text-[15.5px] font-semibold">{item.title}</span>
                  <span className="block text-[14px] leading-[1.6] text-on-dark-3">
                    {item.description}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <p className="m-0 rounded-tile border border-dark-line bg-dark p-[18px] text-[14.5px] leading-[1.65] text-on-dark-3">
            Migrating? Step two can import your Resend audiences, contacts and suppression list, and
            keep Resend as the sending provider until you’re ready to switch.{' '}
            <a href="/compare#migrate" className="font-semibold text-accent-on-dark no-underline">
              Migration guide →
            </a>
          </p>
        </>
      }
    >
      <div className="mb-[22px] flex items-center gap-2.5">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            aria-hidden="true"
            className={cn('h-1 flex-1 rounded-[4px]', n <= step ? 'bg-accent' : 'bg-line')}
          />
        ))}
        <span className="ms-num font-mono text-[11px] text-muted-2">STEP {step}/3</span>
      </div>

      {/*
        Presentation only. `src/server` and the setup server functions belong to
        another agent, so this stays a plain `method="post"` form with named
        fields and no submit handler for an action to be attached to. The hidden
        `step` tells that action which screen it is receiving.
      */}
      <form method="post">
        <input type="hidden" name="step" value={step} />

        {step === 1 ? (
          <>
            <h1 className="ms-display-2 m-0 mb-2.5">Name your workspace</h1>
            <p className="m-0 mb-[26px] text-[15.5px] leading-[1.6] text-muted">
              First run after the deploy. This creates the owner account on <em>your</em> instance —
              nothing is sent to us.
            </p>
            <Label htmlFor="signup-workspace" className="mb-[7px]">
              Workspace name
            </Label>
            <Input
              id="signup-workspace"
              name="workspace"
              autoComplete="organization"
              required
              placeholder="Acme"
              className={fieldClass}
            />
            <Label htmlFor="signup-owner-email" className="mb-[7px]">
              Owner email
            </Label>
            <Input
              id="signup-owner-email"
              name="owner_email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@acme.dev"
              className={fieldClass}
            />
            {/* Read-outs, not a choice: the jurisdiction is fixed by the deploy,
                so rendering these as buttons would promise a control that the
                running instance cannot honour. */}
            <div className="mb-[22px] flex flex-wrap gap-2.5">
              <MonoChip size="lg">region: eu</MonoChip>
              <MonoChip size="lg">region: us</MonoChip>
              <MonoChip size="lg" className="text-muted-2">
                jurisdiction pinned at deploy
              </MonoChip>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h1 className="ms-display-2 m-0 mb-2.5">Add a sending domain</h1>
            <p className="m-0 mb-[26px] text-[15.5px] leading-[1.6] text-muted">
              If the domain is on Cloudflare DNS, we write SPF, DKIM and DMARC for you and verify in
              about ten seconds.
            </p>
            <Label htmlFor="signup-domain" className="mb-[7px]">
              Domain
            </Label>
            <Input
              id="signup-domain"
              name="domain"
              autoComplete="off"
              required
              placeholder="acme.dev"
              className={fieldClass}
            />
            <AuthPre tone="paper" className="mb-[22px]">
              {DNS_RECORDS.map((record) => (
                <div key={record.name}>
                  {record.name}
                  <span className="text-positive">{record.value}</span>
                </div>
              ))}
            </AuthPre>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h1 className="ms-display-2 m-0 mb-2.5">Send your first email</h1>
            <p className="m-0 mb-[22px] text-[15.5px] leading-[1.6] text-muted">
              Your key is created and stored as a Worker secret. Copy it once — we can’t show it
              again.
            </p>
            <AuthPre tone="dark" className="mb-[18px]">
              <div>ms_live_9fK2xR7vTbQ4pLmN8yWc3</div>
              <div className="text-on-dark-5">→ scoped: sending · acme.dev · production</div>
            </AuthPre>
            <Terminal lines={FIRST_SEND_LINES} copyable className="mb-[22px] rounded-md" />
          </>
        ) : null}

        <div className="flex flex-wrap gap-2.5">
          {step > 1 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep((current) => Math.max(1, current - 1))}
              className="h-[50px] rounded-md border-line text-[15px]"
            >
              Back
            </Button>
          ) : null}
          {step === 3 ? (
            <Button asChild className="h-[52px] min-w-[180px] flex-1 rounded-md text-[15px]">
              <a href="/app">Open the dashboard →</a>
            </Button>
          ) : null}
          {step < 3 ? (
            <Button
              type="button"
              onClick={() => setStep((current) => Math.min(3, current + 1))}
              className="h-[52px] min-w-[180px] flex-1 rounded-md text-[15px]"
            >
              Continue
            </Button>
          ) : null}
        </div>
      </form>

      <p className="mt-[26px] border-t border-line pt-[22px] text-[14.5px] leading-[1.7] text-muted">
        Haven’t deployed yet?{' '}
        <a href="/resources#selfhost" className={AUTH_LINK_STRONG}>
          Deploy to Cloudflare first
        </a>{' '}
        — this wizard runs on your own instance afterwards. Already set up?{' '}
        <a href="/sign-in" className={AUTH_LINK_STRONG}>
          Sign in
        </a>
        .
      </p>
    </AuthLayout>
  )
}
