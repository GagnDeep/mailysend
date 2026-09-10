import type { TerminalLine } from '@mailysend/ui'
import {
  BarRow,
  Button,
  Callout,
  Card,
  cn,
  Eyebrow,
  KeyValue,
  KeyValueList,
  MonoChip,
  SectionHeader,
  StatTile,
  Terminal,
} from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import type { PlacementSource } from '~/components/marketing/claims'
import { DIFFERENTIATORS, OWNERSHIP_BADGE, RESEND_FRAMING } from '~/components/marketing/claims'
import { PageShell, Section } from '~/components/marketing/page-shell'
import type { Confidence } from '~/components/marketing/placement'
import { PlacementRow, SourceTag } from '~/components/marketing/placement'
import { breadcrumbSchema, DEPLOY_URL, pageHead } from '~/seo'

export const Route = createFileRoute('/analytics')({
  head: () =>
    pageHead({
      title: 'Analytics — inbox placement, DMARC and raw events',
      description:
        'Inbox placement per recipient provider with its source named, parsed DMARC aggregate ' +
        'reports, per-template delivery, and every raw event exportable to your own warehouse.',
      path: '/analytics',
      image: '/og/analytics.png',
      jsonLd: [breadcrumbSchema([{ name: 'Analytics', path: '/analytics' }])],
    }),
  component: AnalyticsPage,
})

interface FunnelStep {
  label: string
  value: string
  percent: number
  series: 'ink' | 'positive' | 'positive-bright' | 'accent' | 'amber'
  /** Set only on the row that is modelled rather than observed. */
  source?: PlacementSource
  confidence?: Confidence
}

const FUNNEL: FunnelStep[] = [
  { label: 'Accepted', value: '412,908', percent: 100, series: 'ink' },
  { label: 'Delivered', value: '410,430', percent: 99.4, series: 'positive' },
  {
    label: 'Inbox (not spam)',
    value: '394,439',
    percent: 95.5,
    series: 'positive-bright',
    source: 'estimate',
    confidence: 'medium',
  },
  { label: 'Opened', value: '254,769', percent: 61.7, series: 'accent' },
  { label: 'Clicked', value: '88,161', percent: 21.4, series: 'amber' },
]

/**
 * Placement is never a single number: each provider reports it differently, or
 * not at all. Gmail publishes a postmaster feed, Microsoft publishes SNDS,
 * Apple and Yahoo publish nothing — so those come from seed sends — and
 * "Corporate" is a bucket of thousands of private filters where the honest
 * answer is a model.
 */
const PROVIDERS = [
  { provider: 'Gmail', percent: 98.1, source: 'postmaster', confidence: 'high' },
  { provider: 'Outlook', percent: 89.4, source: 'snds', confidence: 'medium' },
  { provider: 'Apple', percent: 97.2, source: 'seed', confidence: 'medium' },
  { provider: 'Yahoo', percent: 95.8, source: 'seed', confidence: 'medium' },
  { provider: 'Corporate', percent: 93.5, source: 'estimate', confidence: 'low' },
] as const

const BOUNCE_REASONS = [
  { label: 'Mailbox does not exist', value: '1,204', intent: 'default' as const },
  { label: 'Mailbox full', value: '612', intent: 'default' as const },
  { label: 'Policy / reputation block', value: '418', intent: 'negative' as const },
  { label: 'Greylisted, retried OK', value: '244', intent: 'default' as const },
]

const AUTH_ROWS = [
  { label: 'SPF pass', value: '100%', intent: 'positive' as const },
  { label: 'DKIM pass', value: '100%', intent: 'positive' as const },
  { label: 'DMARC alignment', value: '99.98%', intent: 'positive' as const },
  { label: 'Unaligned sources', value: '1 · 3rd-party CRM', intent: 'negative' as const },
]

const TEMPLATE_ROWS = [
  { label: 'tpl_login', value: '99.8% · 1.2s', intent: 'positive' as const },
  { label: 'tpl_receipt', value: '99.6% · 1.4s', intent: 'positive' as const },
  { label: 'tpl_digest_v4', value: '92.1% · 2.9s', intent: 'negative' as const },
  { label: 'tpl_winback', value: '97.4% · 1.8s', intent: 'muted' as const },
]

const EXPORT_LINES: TerminalLine[] = [
  { kind: 'command', text: 'mailysend export --range 30d --to r2://acme-mail/events' },
  { kind: 'comment', text: 'writing  412,908 events · parquet · 41 MB' },
  { kind: 'success', text: '✓ done   r2://acme-mail/events/2026-09/*.parquet' },
  { kind: 'output', text: '' },
  { kind: 'command', text: 'mailysend alerts add \\' },
  { kind: 'output', text: '    --metric complaint_rate --above 0.08% --notify slack' },
  { kind: 'success', text: '✓ alert  al_3Vd created' },
]

const filterChip = (label: string, active = false) => (
  <MonoChip key={label} tone={active ? 'ink' : 'neutral'} size="md">
    {label}
  </MonoChip>
)

function AnalyticsPage() {
  return (
    <PageShell>
      <Section className="pt-16 pb-10">
        <div className="flex flex-col items-center text-center">
          <Eyebrow>ANALYTICS</Eyebrow>
          <h1 className="mt-[18px] max-w-[20ch] font-display text-[clamp(40px,5.4vw,72px)] leading-[0.98] font-medium -tracking-[0.035em]">
            Not just “sent”. <em className="text-accent italic">Landed.</em>
          </h1>
          <p className="mt-[22px] max-w-[60ch] text-[19px] leading-[1.55] text-muted">
            Resend and friends show you a delivery percentage and call it analytics. MailySend
            charts inbox placement per provider, parses your DMARC reports, names the template
            burning your reputation — and hands you the raw events, because it is all running in
            your account.
          </p>
          <div className="mt-[30px] flex flex-wrap justify-center gap-3">
            <Button asChild>
              <a href={DEPLOY_URL} rel="noreferrer">
                Deploy and see your own numbers
              </a>
            </Button>
            <Button asChild variant="outline" className="border-line hover:border-ink">
              <a href="/dashboard-tour">Product tour</a>
            </Button>
          </div>
        </div>
      </Section>

      <Section className="pb-14">
        <Card className="rounded-panel p-[clamp(20px,3vw,32px)] shadow-lg">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3.5">
            <h2 className="font-display text-[21px] font-medium -tracking-[0.02em]">
              Deliverability · last 30 days
            </h2>
            <div className="flex flex-wrap gap-2">
              {filterChip('30d', true)}
              {filterChip('tag: receipt')}
              {filterChip('domain: acme.dev')}
            </div>
          </div>

          <div className="mb-7 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3.5">
            <StatTile label="SENT" value="412,908" delta="+18% vs prev" intent="positive" />
            <StatTile label="DELIVERED" value="99.4%" delta="2,478 failed" />
            {/*
              The one tile on the page that is not a count of events. An SMTP
              250 means the receiver accepted the message, not that it reached
              an inbox, so this number is modelled from seed sends and
              postmaster feeds — and it says so, in the tile, with a tilde.
            */}
            <StatTile
              label="INBOX PLACEMENT"
              value="~96.1%"
              delta={
                <span className="flex flex-wrap items-center gap-2">
                  −1.8pt · Outlook
                  <SourceTag source="estimate" confidence="medium" />
                </span>
              }
              intent="negative"
              tone="alert"
            />
            <StatTile label="OPEN RATE" value="61.7%" delta="privacy-adjusted" />
            <StatTile
              label="COMPLAINTS"
              value="0.02%"
              delta="safe · limit 0.1%"
              intent="positive"
            />
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6">
            <div className="min-w-0">
              <Eyebrow wide className="mb-3.5">
                FUNNEL
              </Eyebrow>
              <div className="flex flex-col gap-2.5">
                {FUNNEL.map((step) => (
                  <div key={step.label}>
                    <BarRow
                      layout="stacked"
                      label={
                        step.source ? (
                          <span className="flex items-center gap-2">
                            {step.label}
                            <SourceTag source={step.source} confidence={step.confidence ?? 'low'} />
                          </span>
                        ) : (
                          step.label
                        )
                      }
                      percent={step.percent}
                      value={step.value}
                      series={step.series}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="min-w-0">
              <Eyebrow wide className="mb-3.5">
                INBOX PLACEMENT BY PROVIDER
              </Eyebrow>
              <div className="flex flex-col gap-3">
                {PROVIDERS.map((row) => (
                  <PlacementRow key={row.provider} {...row} />
                ))}
              </div>
              <p className="mt-3.5 text-[13px] leading-[1.6] text-muted-2">
                Delivery events tell you a receiver accepted the message. Placement comes from seed
                sends and provider postmaster feeds; anything else on this row is a model, and is
                labelled as one.
              </p>
              <Callout
                variant="warn"
                title="Alert · Outlook placement dropped 1.8pt in 6 days"
                className="mt-[18px]"
              >
                Correlated with template{' '}
                <span className="font-mono text-[12.5px]">tpl_digest_v4</span> — 3 image-only blocks
                and a shortened link domain. Suggested fix ready.
              </Callout>
            </div>
          </div>
        </Card>
      </Section>

      <Section id="dmarc" className="pb-16">
        {/* The artboard gives this band no heading at all, which leaves the
            three cards floating with nothing to announce them. */}
        <h2 className="sr-only">Bounces, authentication and per-template delivery</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(290px,1fr))] gap-[18px]">
          <Card className="p-6">
            <h3 className="ms-eyebrow mb-3 font-normal">BOUNCE REASONS</h3>
            <KeyValueList className="gap-2.5">
              {BOUNCE_REASONS.map((row) => (
                <KeyValue key={row.label} mono {...row} />
              ))}
            </KeyValueList>
            <p className="mt-3.5 text-[13px] text-muted-2">
              Grouped by SMTP code, with the raw remote response one click away.
            </p>
          </Card>

          <Card className="p-6">
            <h3 className="ms-eyebrow mb-3 font-normal">AUTH &amp; DMARC</h3>
            <KeyValueList className="gap-2.5">
              {AUTH_ROWS.map((row) => (
                <KeyValue key={row.label} mono {...row} />
              ))}
            </KeyValueList>
            <p className="mt-3.5 text-[13px] text-muted-2">
              We parse your aggregate DMARC reports so you never open an XML file again.
            </p>
          </Card>

          <Card className="p-6">
            <h3 className="ms-eyebrow mb-3 font-normal">BY TEMPLATE</h3>
            <KeyValueList className="gap-2.5">
              {TEMPLATE_ROWS.map((row) => (
                <KeyValue
                  key={row.label}
                  label={<span className="font-mono text-[12.5px]">{row.label}</span>}
                  value={row.value}
                  intent={row.intent}
                />
              ))}
            </KeyValueList>
            <p className="mt-3.5 text-[13px] text-muted-2">
              Delivery rate and median time-to-inbox, per template version.
            </p>
          </Card>
        </div>
      </Section>

      {/*
        This section used to be headed "The features people keep asking Resend
        for" and listed automations, segmentation and A/B tests as things Resend
        does not do. Resend ships all of them now, so the claim is retired: we
        still build every one of these features, we just stop describing them as
        holes in someone else's product. What is left is what stays true.
      */}
      <Section id="missing" tone="dark" className="py-[72px]">
        <Eyebrow className="text-accent-on-dark">{OWNERSHIP_BADGE}</Eyebrow>
        <h2 className="mt-3.5 mb-3 max-w-[26ch] font-display text-[clamp(32px,3.8vw,50px)] leading-[1.04] font-medium -tracking-[0.03em]">
          {RESEND_FRAMING}
        </h2>
        <p className="mb-[34px] max-w-[64ch] text-[17px] leading-[1.6] text-on-dark-3">
          Broadcasts, automations, live segments and A/B tests are all in here — and so is
          everything below, which is the part that does not change when a competitor ships a
          changelog. These are properties of where the software runs and who owns the data.
        </p>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-3.5 p-0">
          {DIFFERENTIATORS.map((item) => (
            <li key={item.title} className="rounded-tile border border-dark-line bg-dark p-5">
              <h3 className="mb-[7px] text-[16px] font-semibold">{item.title}</h3>
              <p className="m-0 text-[14px] leading-[1.6] text-on-dark-3">{item.description}</p>
              {item.href ? (
                <a
                  href={item.href}
                  className="mt-3 inline-block text-[13.5px] font-semibold text-accent-on-dark no-underline hover:text-paper"
                >
                  {item.linkLabel}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section className="py-16">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-center gap-10">
          <div className="min-w-0">
            <SectionHeader
              eyebrow="RAW DATA"
              title="Your events, your warehouse."
              lede="Charts are the summary; the events are the truth. Every event is queryable over the API, streamable to a webhook, and exportable to object storage on a schedule — so analytics never becomes a reason you can’t leave."
            />
            <a
              href="/docs#analytics"
              className="mt-4 inline-block text-[15px] font-semibold text-accent no-underline hover:text-ink"
            >
              Analytics API reference →
            </a>
          </div>
          <Terminal
            lines={EXPORT_LINES}
            caption="EXPORT &amp; ALERTS"
            copyable
            className="min-w-0 rounded-card"
          />
        </div>
      </Section>

      <Section className="pb-20">
        <Card className={cn('rounded-block p-[clamp(28px,4vw,52px)] text-center')}>
          <h2 className="mb-3 font-display text-[clamp(28px,3.4vw,42px)] leading-[1.06] font-medium -tracking-[0.03em]">
            See it against your own sending.
          </h2>
          <p className="mx-auto mb-6 max-w-[52ch] text-[16.5px] text-muted">
            Import 30 days of history from Resend, SES or SendGrid and MailySend will chart it next
            to ours — before you move a single send.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild>
              <a href={DEPLOY_URL} rel="noreferrer">
                Deploy free
              </a>
            </Button>
            <Button asChild variant="outline" className="border-line hover:border-ink">
              <a href="/compare#migrate">Migration guide</a>
            </Button>
          </div>
        </Card>
      </Section>
    </PageShell>
  )
}
