import {
  AnchorPills,
  Button,
  Callout,
  Card,
  CTABand,
  Eyebrow,
  MonoChip,
  Pill,
  SectionHeader,
  StatusDot,
} from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import {
  DEPLOY_DURATION,
  DEPLOY_DURATION_LONG,
  DeployTerminal,
} from '~/components/marketing/deploy'
import { PageShell, Section } from '~/components/marketing/page-shell'
import { breadcrumbSchema, DEPLOY_URL, pageHead, REPO_URL } from '~/seo'
import { VERSION } from '~/version'

const ANCHORS = [
  { href: '#selfhost', label: 'Self-host guide' },
  { href: '#changelog', label: 'Changelog' },
  { href: '#glossary', label: 'Glossary' },
  { href: '#blog', label: 'Engineering notes' },
  { href: '#security', label: 'Security' },
  { href: '#status', label: 'Status' },
  { href: '#sitemap', label: 'Sitemap' },
]

interface DeployFact {
  term: string
  body: ReactNode
}

const DEPLOY_FACTS: DeployFact[] = [
  {
    term: 'Prerequisites',
    body: (
      <>
        A Cloudflare account with Workers Paid ($5/mo, required for sending) and a domain you
        control.
      </>
    ),
  },
  {
    term: 'Updates',
    body: (
      <>
        <code className="font-mono text-[13px] text-ink">npx mailysend upgrade</code> — migrations
        run in order, with a dry run first.
      </>
    ),
  },
  {
    term: 'Rollback',
    body: (
      <>
        Worker versions are immutable;{' '}
        <code className="font-mono text-[13px] text-ink">rollback</code> flips traffic back in about
        a second.
      </>
    ),
  },
  {
    term: 'Leaving',
    body: <>Export everything to R2 and delete the Worker. Your data was always yours.</>,
  },
]

interface ChangelogEntry {
  date: string
  version: string
  title: string
  body: ReactNode
}

/**
 * Releases, not a story about releases.
 *
 * This list used to claim eight dated versions up to `v1.8.2` for a repository
 * at 0.1.0. The version chip now comes from `package.json` at build time and
 * the history lives where it is actually recorded — the tags on GitHub — so
 * this page cannot drift from the software again.
 */
const RELEASES: ChangelogEntry[] = [
  {
    date: '2026-09-10',
    version: `v${VERSION}`,
    title: 'First public release',
    body: (
      <>
        The API, the dashboard, the four transports, the CLI and the one-click deploy.{' '}
        <a
          href={`${REPO_URL}/releases`}
          rel="noreferrer"
          className="font-semibold text-accent hover:text-ink"
        >
          Every tagged release →
        </a>
      </>
    ),
  },
]

const GLOSSARY: { term: string; body: ReactNode }[] = [
  {
    term: 'SPF',
    body: (
      <>
        A DNS record listing who may send as your domain. One record, no more than ten lookups deep.
      </>
    ),
  },
  {
    term: 'DKIM',
    body: (
      <>
        A cryptographic signature proving the message wasn’t altered. Use 2048-bit keys and rotate
        yearly.
      </>
    ),
  },
  {
    term: 'DMARC',
    body: (
      <>
        Tells inboxes what to do when SPF and DKIM disagree. Start at{' '}
        <code className="font-mono text-[13px] text-ink">p=none</code>, read reports, then
        quarantine.
      </>
    ),
  },
  {
    term: 'BIMI',
    body: (
      <>
        Your logo in the inbox, once DMARC is enforced. Needs a VMC certificate; nice-to-have, not
        urgent.
      </>
    ),
  },
  {
    term: 'Hard vs soft bounce',
    body: (
      <>
        Hard means the address is dead — never retry, suppress immediately. Soft is temporary and
        worth retrying.
      </>
    ),
  },
  {
    term: 'Complaint rate',
    body: (
      <>
        Spam-button presses over sends. Keep under 0.1%; above 0.3% and providers start blocking
        you.
      </>
    ),
  },
  {
    term: 'Inbox placement',
    body: (
      <>
        The number that matters: delivered <em>and</em> not in spam. Only seed testing and provider
        signals reveal it.
      </>
    ),
  },
  {
    term: 'Stream separation',
    body: (
      <>
        Keep OTPs away from newsletters — different tags, ideally different subdomains, so marketing
        can’t sink auth.
      </>
    ),
  },
]

/**
 * The notes are teasers: a section label, a headline and a summary, with no
 * body, author or publication date anywhere on the artboard. `BlogPosting`
 * requires a `datePublished`, and inventing one to satisfy a validator is
 * exactly the kind of structured data that earns a manual action — so these
 * render as cards and emit no schema until the posts themselves exist.
 */
const NOTES: { section: string; title: string; body: ReactNode }[] = [
  {
    section: 'ARCHITECTURE',
    title: 'Why every mailbox is its own Durable Object',
    body: (
      <>
        Threading, search and attachment state per mailbox, with SQLite inside the object — and what
        that means for isolation and cost.
      </>
    ),
  },
  {
    section: 'DELIVERABILITY',
    title: 'Reading DMARC reports so you never have to',
    body: (
      <>
        Parsing aggregate XML at the edge, spotting unaligned third-party senders, and turning it
        into one number.
      </>
    ),
  },
  {
    section: 'COST',
    title: 'A million emails for the price of a dinner',
    body: (
      <>
        Every Cloudflare line item at three volumes, and the four habits that keep the bill boring.{' '}
        <a href="/stack" className="font-semibold text-accent hover:text-ink">
          The numbers →
        </a>
      </>
    ),
  },
]

const SECURITY: { term: string; body: ReactNode }[] = [
  {
    term: 'Data path',
    body: (
      <>
        Your Workers, your Durable Objects, your R2, your region. We have no production access, no
        telemetry on message content.
      </>
    ),
  },
  {
    term: 'Auth',
    body: (
      <>
        Dashboard behind Cloudflare Access (SSO, MFA, device posture). API keys are scoped, hashed
        and revocable.
      </>
    ),
  },
  {
    term: 'Compliance',
    body: (
      <>
        Cloudflare’s own certifications cover the infrastructure. As the operator, you’re the data
        controller — the repo ships a{' '}
        <a href="/legal/dpa" className="font-semibold text-accent hover:text-ink">
          DPA template
        </a>{' '}
        and sub-processor list.
      </>
    ),
  },
  {
    term: 'GDPR erase',
    body: (
      <>
        Deleting a contact cascades through D1, KV suppressions, R2 attachments and the event
        stream.
      </>
    ),
  },
  {
    term: 'Disclosure',
    body: (
      <>
        Report vulnerabilities through the repo’s security policy; fixes ship as a patch release
        with an advisory.
      </>
    ),
  },
  {
    term: 'Licence & terms',
    body: (
      <>
        MIT. Use it commercially, fork it, resell it. No warranty, no support obligation — the
        honest trade for $0.{' '}
        <a href="/legal/terms" className="font-semibold text-accent hover:text-ink">
          Terms →
        </a>
      </>
    ),
  },
]

const DEPENDENCIES = [
  'Workers',
  'Email Service',
  'Email Routing',
  'Queues · DO · D1 · R2',
  'Workflows',
  'SDK registries',
]

const SITEMAP = [
  { href: '/', label: 'Home', blurb: 'What it is, in three lines of code' },
  { href: '/docs', label: 'Docs', blurb: 'Quickstart, full API, SDKs, providers' },
  { href: '/analytics', label: 'Analytics', blurb: 'Placement, DMARC, exports, alerts' },
  { href: '/stack', label: 'Stack & cost', blurb: 'Eleven Cloudflare products, priced' },
  { href: '/pricing', label: 'What it costs', blurb: 'No plans — the calculator' },
  { href: '/use-cases', label: 'Use cases', blurb: 'OTPs, receipts, drips, inbound, agents' },
  {
    href: '/compare',
    label: 'Compare & migrate',
    blurb: 'Resend, SES, SendGrid, Postmark, Mailgun',
  },
  { href: '/dashboard-tour', label: 'Product tour', blurb: 'Six dashboard screens' },
  { href: '/resources', label: 'Resources', blurb: 'Deploy guide, changelog, glossary, status' },
  { href: '/sign-in', label: 'Sign in', blurb: 'Cloudflare Access or a one-time code' },
  { href: '/setup', label: 'Setup', blurb: 'Claim your instance after the deploy' },
  { href: '/legal/privacy', label: 'Privacy', blurb: 'What we hold, and what we cannot see' },
  { href: '/legal/terms', label: 'Terms', blurb: 'MIT, as-is, and acceptable use' },
  { href: '/legal/dpa', label: 'DPA', blurb: 'Roles, sub-processors, transfers' },
]

export const Route = createFileRoute('/resources')({
  head: () =>
    pageHead({
      title: 'Resources',
      description:
        'Deploy MailySend to your own Cloudflare account, read the changelog, learn the eight ' +
        'deliverability terms that decide whether mail arrives, and see how security works when ' +
        'there is no vendor in the path.',
      path: '/resources',
      image: '/og/resources.png',
      jsonLd: [breadcrumbSchema([{ name: 'Resources', path: '/resources' }])],
    }),
  component: ResourcesPage,
})

const definitionGrid = 'grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3'

function ResourcesPage() {
  return (
    <PageShell>
      <Section className="pt-16 pb-12 sm:pt-24">
        <Eyebrow>RESOURCES</Eyebrow>
        <h1 className="ms-display-1 mt-4 max-w-[16ch]">Everything else</h1>
        <p className="mt-5 max-w-[62ch] text-[17.5px] leading-[1.65] text-muted">
          The deploy guide, what changed lately, the deliverability words nobody explains, how
          security works when there’s no vendor in the path, and a map of every page.
        </p>
        <AnchorPills items={ANCHORS} align="start" className="mt-8" />
      </Section>

      <Section id="selfhost" tone="card" className="scroll-mt-24 py-16 sm:py-20">
        <SectionHeader
          eyebrow="DEPLOY TO CLOUDFLARE"
          title={
            <>
              One click, your account,
              <br />
              {DEPLOY_DURATION}.
            </>
          }
          align="start"
          lede="The button creates the D1 database, the KV namespaces and the R2 bucket, then builds and deploys. Queues and the analytics datasets are one command it cannot run for you, so we say so. Nothing needs configuring to boot: the instance migrates its own schema, generates its own signing secret and learns its own public URL on the first request. Nothing is sent to us — there is no us in the path."
        />

        {/*
          `grid-cols-1` rather than the implicit single column: an implicit
          track is sized to its items’ min-content, and the terminal in the
          second card is wider than a phone, so the row grew past the viewport
          instead of the terminal scrolling inside its own box.
        */}
        <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card className="flex flex-col gap-4 p-6">
            <Eyebrow>FROM THE BROWSER</Eyebrow>
            <p className="m-0 text-[14.5px] leading-[1.65] text-muted">
              Press the button and pick your Cloudflare account. Every variable on the form is
              optional and already filled in, because there is nothing you have to know yet. D1, KV
              and R2 are created for you; queues and the analytics datasets need one command
              afterwards, and the app tells you when it needs it.
            </p>
            <Button asChild size="lg" className="mt-auto self-start">
              {/* Cloudflare's own flow, not our sign-up: this section *is* the
                  self-host guide, so the button here has to be the button. */}
              <a href={DEPLOY_URL} rel="noreferrer">
                Deploy to Cloudflare
                <MonoChip tone="accent" size="sm" className="tracking-[0.1em]">
                  1-CLICK
                </MonoChip>
              </a>
            </Button>
          </Card>

          <Card className="flex flex-col gap-4 p-6">
            <Eyebrow>FROM YOUR TERMINAL</Eyebrow>
            <DeployTerminal verbose />
            <p className="m-0 text-[14.5px] leading-[1.65] text-muted">
              Or clone the repo and run{' '}
              <code className="font-mono text-[13px] text-ink">pnpm run deploy:cf</code> with your
              own wrangler config — it builds both Workers and hands the upload to wrangler.
              Reviewable, scriptable, CI-friendly. Budget {DEPLOY_DURATION_LONG}.
            </p>
          </Card>
        </div>

        <Callout
          variant="warn"
          title="The SMTP relay is a container, not a Worker"
          className="mt-8"
        >
          <p className="m-0">
            <code className="font-mono text-[13px]">smtp.your-domain.com:587</code> cannot run on
            Workers — there is no inbound TCP listener — so the relay ships as an OCI container
            image you run yourself, on Cloudflare Containers, Fly, or any VM. If you would rather
            not run one, point your app at Cloudflare’s own{' '}
            <code className="font-mono text-[13px]">smtp.mx.cloudflare.net:465</code> instead. The
            trade-off is not subtle: those sends bypass MailySend entirely, so they will not appear
            in your logs, analytics or webhooks.
          </p>
          <p className="m-0 mt-3">
            <a href="/docs#smtp" className="font-semibold text-accent hover:text-ink">
              SMTP relay docs →
            </a>
          </p>
        </Callout>

        <dl className={`${definitionGrid} mt-10 lg:grid-cols-4`}>
          {DEPLOY_FACTS.map((fact) => (
            <div key={fact.term}>
              <dt className="text-[14.5px] font-semibold text-ink">{fact.term}</dt>
              <dd className="m-0 mt-1.5 text-[14px] leading-[1.6] text-muted">{fact.body}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="changelog" className="scroll-mt-24 py-16 sm:py-20">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="ms-display-2 m-0">Changelog</h2>
          <MonoChip size="lg">v{VERSION}</MonoChip>
        </div>
        <ol className="mt-8 grid list-none gap-4 p-0">
          {RELEASES.map((entry) => (
            <li
              key={entry.version}
              className="grid grid-cols-1 gap-x-8 gap-y-2 rounded-tile border border-line bg-card p-5 md:grid-cols-[minmax(0,300px)_1fr]"
            >
              <div>
                <div className="ms-num font-mono text-[12px] text-muted-2">
                  <time dateTime={entry.date}>{entry.date}</time> · {entry.version}
                </div>
                <div className="mt-1 text-[16px] font-semibold -tracking-[0.01em] text-ink">
                  {entry.title}
                </div>
              </div>
              <p className="m-0 text-[14.5px] leading-[1.65] text-muted">{entry.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="glossary" tone="card" className="scroll-mt-24 py-16 sm:py-20">
        <SectionHeader
          title="Deliverability glossary"
          align="start"
          lede="The eight terms that decide whether your email arrives. In plain language, with what to actually do."
        />
        <dl className={`${definitionGrid} mt-10`}>
          {GLOSSARY.map((item) => (
            <div key={item.term} className="rounded-tile border border-line bg-paper p-5">
              <dt className="text-[15px] font-semibold text-ink">{item.term}</dt>
              <dd className="m-0 mt-1.5 text-[14px] leading-[1.6] text-muted">{item.body}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="blog" className="scroll-mt-24 py-16 sm:py-20">
        <h2 className="ms-display-2 m-0">Engineering notes</h2>
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
          {NOTES.map((note) => (
            <article key={note.title} className="rounded-tile border border-line bg-card p-6">
              <Eyebrow>{note.section}</Eyebrow>
              <h3 className="mt-3 mb-2 text-[18px] font-semibold -tracking-[0.015em] text-ink">
                {note.title}
              </h3>
              <p className="m-0 text-[14.5px] leading-[1.65] text-muted">{note.body}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section id="security" tone="card" className="scroll-mt-24 py-16 sm:py-20">
        <SectionHeader
          title="Security, privacy & terms"
          align="start"
          lede="MailySend is software, not a service, which changes the security story: your mail never touches infrastructure we operate. What we owe you is safe defaults and readable code."
        />
        <dl className={`${definitionGrid} mt-10`}>
          {SECURITY.map((item) => (
            <div key={item.term}>
              <dt className="text-[14.5px] font-semibold text-ink">{item.term}</dt>
              <dd className="m-0 mt-1.5 text-[14px] leading-[1.6] text-muted">{item.body}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="status" className="scroll-mt-24 py-16 sm:py-20">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="ms-display-2 m-0">Status</h2>
          <Pill tone="positive" size="lg" mono={false}>
            <StatusDot tone="positive" pulse />
            All dependencies operational
          </Pill>
        </div>
        <p className="mt-5 max-w-[68ch] text-[16.5px] leading-[1.65] text-muted">
          Your instance’s uptime is Cloudflare’s uptime — there’s no MailySend service to go down.
          This page tracks the Cloudflare products MailySend depends on, plus the health of the SDK
          registries and the docs.
        </p>
        <ul className="mt-8 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {DEPENDENCIES.map((name) => (
            <li
              key={name}
              className="flex items-center justify-between gap-3 rounded-tile border border-line bg-card px-4 py-3.5"
            >
              <span className="text-[14.5px] font-semibold text-ink">{name}</span>
              <span className="flex items-center gap-2 font-mono text-[11.5px] text-positive">
                <StatusDot tone="positive" />
                operational
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="sitemap" tone="card" className="scroll-mt-24 py-16 sm:py-20">
        <SectionHeader
          title="Every page"
          align="start"
          lede="No dead ends. If you ever feel lost, this is the map."
        />
        <nav aria-label="All pages" className="mt-10">
          <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {SITEMAP.map((page) => (
              <li key={page.href}>
                <a
                  href={page.href}
                  className="block rounded-tile border border-line bg-paper p-4 no-underline transition-colors duration-[0.18s] hover:border-ink"
                >
                  <span className="block text-[15px] font-semibold text-ink">{page.label}</span>
                  <span className="mt-1 block text-[13.5px] leading-[1.5] text-muted-2">
                    {page.blurb}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </Section>

      <Section className="py-16 sm:py-20">
        <CTABand
          eyebrow="YOUR ACCOUNT, YOUR MAIL"
          title="Nothing to sign up for. Just deploy it."
          description={`One command, ${DEPLOY_DURATION_LONG}.`}
          actions={
            <>
              <Button asChild variant="accent" size="lg">
                <a href={DEPLOY_URL} rel="noreferrer">
                  Deploy to Cloudflare
                </a>
              </Button>
              <a
                href="/docs#quickstart"
                className="self-center text-[14.5px] font-semibold text-on-dark-3 underline underline-offset-4 hover:text-paper"
              >
                or read the quickstart first
              </a>
            </>
          }
        />
      </Section>
    </PageShell>
  )
}
