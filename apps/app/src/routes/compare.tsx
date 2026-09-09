import type { ComparisonColumn, ComparisonRow, TerminalLine } from '@mailysend/ui'
import {
  AnchorPills,
  Button,
  Card,
  ComparisonTable,
  Eyebrow,
  GainLossList,
  SectionHeader,
  StepCard,
  Terminal,
} from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { RESEND_FRAMING } from '~/components/marketing/claims'
import { DeployButton } from '~/components/marketing/deploy'
import { PageShell, Section } from '~/components/marketing/page-shell'
import { breadcrumbSchema, pageHead } from '~/seo'

export const Route = createFileRoute('/compare')({
  head: () =>
    pageHead({
      title: 'Compare — MailySend vs Resend, SES, SendGrid, Postmark and Mailgun',
      description:
        'A row-by-row comparison of MailySend against Resend, Amazon SES, SendGrid, Postmark ' +
        'and Mailgun, including where we lose — plus a five-step, reversible migration guide.',
      path: '/compare',
      image: '/og/compare.png',
      jsonLd: [breadcrumbSchema([{ name: 'Compare', path: '/compare' }])],
    }),
  component: ComparePage,
})

const PILLS = [
  { href: '#resend', label: 'vs Resend' },
  { href: '#ses', label: 'vs Amazon SES' },
  { href: '#sendgrid', label: 'vs SendGrid' },
  { href: '#postmark', label: 'vs Postmark' },
  { href: '#mailgun', label: 'vs Mailgun' },
  { href: '#migrate', label: 'Migration guide', emphasis: true },
]

const COLUMNS: ComparisonColumn[] = [
  { key: 'mailysend', label: 'MailySend', emphasis: true },
  { key: 'resend', label: 'Resend' },
  { key: 'ses', label: 'Amazon SES' },
  { key: 'sendgrid', label: 'SendGrid' },
  { key: 'postmark', label: 'Postmark' },
]

const text = (label: string, tone?: 'positive' | 'negative' | 'muted' | 'neutral') =>
  ({ kind: 'text', label, tone }) as const

/**
 * Only rows that stay true when a competitor ships a changelog belong here.
 * The artboard's matrix marked Resend "No" for automations and omitted
 * segmentation entirely; Resend ships broadcasts, automations and segments
 * today, so both rows now read the way a prospect would find them.
 */
const ROWS: ComparisonRow[] = [
  {
    label: 'Model',
    values: {
      mailysend: text('MIT software, your account', 'positive'),
      resend: text('SaaS'),
      ses: text('Cloud primitive'),
      sendgrid: text('SaaS'),
      postmark: text('SaaS'),
    },
  },
  {
    label: 'Cost at 100k/mo',
    values: {
      mailysend: text('~$40 to Cloudflare', 'positive'),
      resend: text('$90'),
      ses: text('~$10 + your infra'),
      sendgrid: text('~$60'),
      postmark: text('~$120'),
    },
  },
  {
    label: 'Native Worker binding',
    values: {
      mailysend: true,
      resend: text('HTTP only', 'muted'),
      ses: text('SDK / HTTP', 'muted'),
      sendgrid: text('HTTP only', 'muted'),
      postmark: text('HTTP only', 'muted'),
    },
  },
  {
    label: 'Automations / drips',
    values: {
      mailysend: text('Workflows', 'positive'),
      resend: text('Yes'),
      ses: false,
      sendgrid: text('Marketing add-on', 'muted'),
      postmark: false,
    },
  },
  {
    label: 'Live segmentation',
    values: {
      mailysend: text('Yes', 'positive'),
      resend: text('Yes'),
      ses: false,
      sendgrid: text('Yes'),
      postmark: false,
    },
  },
  {
    label: 'Inbound + threading',
    values: {
      mailysend: text('Included, free', 'positive'),
      resend: text('Limited', 'muted'),
      ses: text('Build it', 'muted'),
      sendgrid: text('Parse only', 'muted'),
      postmark: text('Parse only', 'muted'),
    },
  },
  {
    label: 'Inbox-placement analytics',
    values: {
      mailysend: text('Per provider', 'positive'),
      resend: text('Delivery only', 'muted'),
      ses: text('CloudWatch', 'muted'),
      sendgrid: text('Partial', 'muted'),
      postmark: text('Strong', 'positive'),
    },
  },
  {
    label: 'Data location',
    values: {
      mailysend: text('Your account', 'positive'),
      resend: text('Theirs', 'muted'),
      ses: text('Your AWS', 'positive'),
      sendgrid: text('Theirs', 'muted'),
      postmark: text('Theirs', 'muted'),
    },
  },
  {
    label: 'Who is on call',
    values: {
      mailysend: text('You', 'negative'),
      resend: text('Them', 'positive'),
      ses: text('AWS', 'positive'),
      sendgrid: text('Them', 'positive'),
      postmark: text('Them', 'positive'),
    },
  },
]

const STEPS = [
  {
    step: 1,
    title: 'Deploy your instance',
    description: 'One click or one command. Nothing points at it yet.',
  },
  {
    step: 2,
    title: 'Import your data',
    description:
      'Audiences, contacts, suppression list and 30 days of history, over their API or a CSV.',
  },
  {
    step: 3,
    title: 'Swap the client',
    description: 'Compat shim keeps your existing calls and react-email templates unchanged.',
  },
  {
    step: 4,
    title: 'Send through Resend, at first',
    description: 'Your reputation and IPs do not move. Only the control plane does.',
  },
  {
    step: 5,
    title: 'Shift traffic, watch placement',
    description:
      '10% → 50% → 100% to Cloudflare or SES, with per-provider placement charts to justify each step.',
  },
]

const MIGRATE_LINES: TerminalLine[] = [
  { kind: 'command', text: 'npx mailysend import resend --key re_xxx --history 30d' },
  {
    kind: 'success',
    text: '✓ 3 audiences · 28,700 contacts · 1,412 suppressions · 412k events',
  },
  { kind: 'output', text: '' },
  { kind: 'command', text: 'npx mailysend domains set acme.dev --provider resend' },
  { kind: 'success', text: '✓ control plane switched · wire unchanged' },
  { kind: 'output', text: '' },
  { kind: 'command', text: 'npx mailysend traffic acme.dev --cloudflare 10%' },
  { kind: 'success', text: '✓ 10% via cloudflare · placement dashboard live' },
  { kind: 'output', text: '' },
  { kind: 'command', text: 'npx mailysend rollback' },
  { kind: 'success', text: '✓ back to 100% resend · 1.2s' },
]

const proseClasses = 'text-[15.5px] leading-[1.7] text-muted'

function ComparePage() {
  return (
    <PageShell>
      <Section className="pt-16 pb-8">
        <div className="flex flex-col items-center text-center">
          <Eyebrow>COMPARE &amp; MIGRATE</Eyebrow>
          <h1 className="mt-[18px] max-w-[22ch] font-display text-[clamp(38px,5.2vw,70px)] leading-[0.98] font-medium -tracking-[0.035em]">
            Honest comparisons. Including where we lose.
          </h1>
          <p className="mt-[22px] max-w-[62ch] text-[19px] leading-[1.55] text-muted">
            MailySend is Resend&rsquo;s API shape as software you run on Cloudflare; the others are
            services you rent. That difference decides most of these rows — and it doesn&rsquo;t
            always fall our way.
          </p>
          <AnchorPills items={PILLS} label="Compare sections" className="mt-7 justify-center" />
        </div>
      </Section>

      <Section className="pb-14">
        <h2 className="sr-only">Feature matrix</h2>
        <ComparisonTable
          columns={COLUMNS}
          rows={ROWS}
          labelColumn="minmax(190px, 1.6fr)"
          minWidth={860}
          caption="MailySend compared with Resend, Amazon SES, SendGrid and Postmark. Prices are list prices for 100,000 emails per month as of September 2026."
        />
      </Section>

      {/*
        Copy correction: the artboard claimed Resend has "deliberately no
        automations, no branching flows, no segmentation, no A/B tests". All
        four shipped. Attacking a competitor with a stale changelog is the
        fastest way to lose a reader who has actually used the product, so the
        argument moves to the thing that does not expire: who owns the runtime.
      */}
      <Section id="resend" className="pb-10">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-9">
          <div className="min-w-0">
            <h2 className="mb-3.5 font-display text-[clamp(28px,3.2vw,40px)] leading-[1.05] font-medium -tracking-[0.03em]">
              vs Resend
            </h2>
            <p className={proseClasses}>
              Resend set the bar for developer experience in email, and we copied its API shape on
              purpose. It has also kept shipping: broadcasts, automations, contact segments and A/B
              tests are all in the product today, so any comparison that still calls it
              transactional-only is out of date.
            </p>
            <p className={`${proseClasses} mt-2.5`}>{RESEND_FRAMING}</p>
            <p className={`${proseClasses} mt-2.5`}>
              MailySend is that same surface as MIT-licensed software running in your own Cloudflare
              account, at Cloudflare&rsquo;s prices, with the contacts, events and raw MIME sitting
              in your D1 and R2 under a retention window you set. You trade a managed service for
              ownership — and you can keep Resend as the wire while you decide.
            </p>
            <p className={`${proseClasses} mt-2.5`}>
              <b className="text-ink">Pick Resend if</b> you want someone else on call and never
              want to think about a Worker.
            </p>
          </div>
          <Card className="min-w-0 p-6">
            <GainLossList
              gainsLabel="WHAT YOU GAIN"
              lossesLabel="WHAT YOU TAKE ON"
              gains={[
                'The source, under MIT, running in your Cloudflare account',
                'A native Worker binding instead of an HTTP hop',
                'Inbox placement per provider and parsed DMARC reports',
                'Free inbound with per-mailbox threading, and agent/MCP mailboxes',
                'Retention, data region and deletion you configure',
                'Roughly half the cost at 100k/month',
              ]}
              losses={[
                'You own the deploy, the upgrades and the pager',
                'Cloudflare Email Sending is still a public beta',
                'No support contract to escalate to',
              ]}
            />
          </Card>
        </div>
      </Section>

      <Section id="ses" className="pb-10" width="prose">
        <h2 className="mb-3 font-display text-[clamp(24px,2.6vw,32px)] leading-[1.06] font-medium -tracking-[0.03em]">
          vs Amazon SES
        </h2>
        <p className={proseClasses}>
          SES is the cheapest wire in the industry at about $0.10 per thousand, and it gives you
          almost nothing else: no dashboard worth using, no templates workflow, no contacts, no
          broadcasts, no placement analytics. Teams end up building a small internal product around
          it.
        </p>
        <p className={`${proseClasses} mt-2.5`}>
          So don&rsquo;t choose. MailySend treats SES as a provider: keep this API, these logs,
          these analytics, and send over SES for the price.{' '}
          <a
            href="/docs#providers"
            className="font-semibold text-accent no-underline hover:text-ink"
          >
            One config line →
          </a>
        </p>
      </Section>

      {/*
        `#postmark` and `#mailgun` were nested `<div id>`s inside the SendGrid
        section in the artboard, so the footer's deep links landed inside
        someone else's heading. Each is its own landmark now.
      */}
      <Section id="sendgrid" className="pb-4" width="prose">
        <h2 className="mb-3 font-display text-[26px] font-medium -tracking-[0.03em]">
          vs SendGrid
        </h2>
        <p className={proseClasses}>
          The most feature-complete of the incumbents and the most tiring to use: a large console,
          plan-gated features, and shared IP pools you don&rsquo;t control. Migrations usually start
          after a deliverability incident nobody could explain.
        </p>
        <p className={`${proseClasses} mt-2.5`}>
          We keep the surface small and put every event in front of you.{' '}
          <b className="text-ink">Pick SendGrid if</b> you need one vendor for email, SMS and a
          marketing team with no engineers.
        </p>
      </Section>

      <Section id="postmark" className="pb-4" width="prose">
        <h2 className="mb-3 font-display text-[26px] font-medium -tracking-[0.03em]">
          vs Postmark
        </h2>
        <p className={proseClasses}>
          The gold standard for pure transactional deliverability, with the price to match (around
          $1,206 per million). Their separate streams and reputation discipline are genuinely
          excellent.
        </p>
        <p className={`${proseClasses} mt-2.5`}>
          <b className="text-ink">Pick Postmark if</b> a delayed password reset is a business
          incident and you&rsquo;d rather pay than operate. We&rsquo;re the better fit when you also
          need marketing, inbound and your own data.
        </p>
      </Section>

      <Section id="mailgun" className="pb-12" width="prose">
        <h2 className="mb-3 font-display text-[26px] font-medium -tracking-[0.03em]">vs Mailgun</h2>
        <p className={proseClasses}>
          Strong routing and validation APIs, a dated console, and log retention that costs extra
          the moment you need it. Inbound routing is its best feature — and it&rsquo;s the one thing
          Cloudflare gives away free.
        </p>
        <p className={`${proseClasses} mt-2.5`}>
          <b className="text-ink">Pick Mailgun if</b> you want validation and routing as managed
          services with a support line attached.
        </p>
      </Section>

      <Section id="migrate" className="py-11">
        <SectionHeader
          eyebrow="MIGRATION GUIDE"
          title="Move in an afternoon. Roll back in a minute."
          lede="Because the API shape matches Resend’s and Resend can stay your sending provider, you can migrate without a risky flag day. Five steps, each independently reversible."
        />
        <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
          {STEPS.map((item) => (
            <StepCard key={item.title} variant="tile" {...item} />
          ))}
        </div>
        <Terminal
          lines={MIGRATE_LINES}
          caption="MIGRATION"
          copyable
          className="mt-7 rounded-card"
        />
        <div className="mt-7 flex flex-wrap gap-3">
          <DeployButton label="Deploy to Cloudflare" chip="1-CLICK" />
          <Button asChild variant="outline" className="border-line hover:border-ink">
            <a href="/docs#providers">Provider &amp; failover docs</a>
          </Button>
        </div>
      </Section>
    </PageShell>
  )
}
