import { BarRow, Card, CTABand, Eyebrow, SectionHeader } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import {
  CostCalculator,
  resendCost,
  selfHostedCost,
  sendgridCost,
  sesProviderCost,
} from '~/components/marketing/cost-calculator.tsx'
import { DEPLOY_DURATION, DeployButton } from '~/components/marketing/deploy.tsx'
import { PageShell, Section } from '~/components/marketing/page-shell.tsx'
import { breadcrumbSchema, pageHead } from '~/seo'

export const Route = createFileRoute('/stack')({
  head: () =>
    pageHead({
      title: 'The stack, and what it costs',
      description:
        'The eleven Cloudflare products MailySend runs on, what each one does, ' +
        'what Cloudflare charges for it, and worked bills at 10k, 100k and 1M emails a month.',
      path: '/stack',
      image: '/og/stack.png',
      jsonLd: [breadcrumbSchema([{ name: 'Stack & cost', path: '/stack' }])],
    }),
  component: StackPage,
})

interface StackRow {
  product: string
  role: string
  /** The headline rate. */
  cost: string
  /** What happens past the included tier — muted under the rate. */
  beyond?: string
}

const STACK: StackRow[] = [
  {
    product: 'Workers',
    role: 'The API itself: auth, validation, rate limits, template render, webhook fan-out',
    cost: '$5/mo · 10M req incl.',
    beyond: 'then $0.30/M',
  },
  {
    product: 'Email Service (send)',
    role: 'Outbound delivery, DKIM signing, SPF/DMARC set up automatically',
    cost: '3,000/mo incl.',
    beyond: 'then $0.35/1k',
  },
  {
    product: 'Email Routing (receive)',
    role: 'Inbound catch-all into a Worker, 25 MB per message',
    cost: 'Free',
  },
  {
    product: 'Queues',
    role: 'Throttling, retries, dead-letter queue for batches and broadcasts',
    cost: '$0.40 / M ops',
    beyond: '1M free/mo',
  },
  {
    product: 'Durable Objects',
    role: 'Per-domain sender state, scheduling alarms, broadcast progress, mailbox threads',
    cost: 'Included in Workers Paid',
    beyond: 'then per req + duration',
  },
  {
    product: 'D1',
    role: 'Contacts, audiences, segments, templates, message index',
    cost: '25B reads/mo incl.',
    beyond: '$0.75/M writes over',
  },
  {
    product: 'KV',
    role: 'Suppression list and API-key cache — read on every single send',
    cost: 'Included',
    beyond: 'cents at this scale',
  },
  {
    product: 'R2',
    role: 'Attachments, raw MIME archive, event exports — zero egress fees',
    cost: '$0.015/GB-mo',
    beyond: 'no egress charge',
  },
  {
    product: 'Workflows',
    role: 'Automations: multi-day drips, branching, durable retries',
    cost: 'Billed as Workers',
    beyond: 'requests + CPU',
  },
  {
    product: 'Analytics Engine + Access',
    role: 'Event stream behind every chart; SSO in front of the dashboard',
    cost: 'Included',
    beyond: 'with Workers Paid',
  },
]

interface ExampleLine {
  label: string
  amount: string
  /** The self-hosted total: ruled off above and set in ink. */
  total?: boolean
  /** The competitor's price for the same volume, set back in muted. */
  compare?: boolean
}

interface Example {
  kicker: string
  volume: string
  lines: ExampleLine[]
}

const EXAMPLES: Example[] = [
  {
    kicker: 'SIDE PROJECT',
    volume: '10,000 emails',
    lines: [
      { label: 'Workers Paid', amount: '$5.00' },
      { label: '7,000 emails @ $0.35/1k', amount: '$2.45' },
      { label: 'D1 · KV · R2 · Queues', amount: '$0.00' },
      { label: 'Self-hosted total', amount: '$7.45', total: true },
      { label: 'Resend Pro', amount: '$20.00', compare: true },
    ],
  },
  {
    kicker: 'GROWING SAAS',
    volume: '100,000 emails',
    lines: [
      { label: 'Workers Paid', amount: '$5.00' },
      { label: '97,000 emails @ $0.35/1k', amount: '$33.95' },
      { label: 'D1 writes, R2 25 GB, Queues', amount: '≈$1.20' },
      { label: 'Self-hosted total', amount: '≈$40', total: true },
      { label: 'Resend Pro 100k', amount: '$90.00', compare: true },
    ],
  },
  {
    kicker: 'AT SCALE',
    volume: '1,000,000 emails',
    lines: [
      { label: 'Workers Paid', amount: '$5.00' },
      { label: '997,000 emails @ $0.35/1k', amount: '$348.95' },
      { label: 'Storage, queues, analytics', amount: '≈$9' },
      { label: 'Self-hosted total', amount: '≈$363', total: true },
      { label: 'Or route via SES provider', amount: '≈$115', compare: true },
    ],
  },
]

const MILLION_BARS = [
  { label: 'SES provider', percent: 9, value: '≈$115', series: 'positive-bright' as const },
  { label: 'MailySend on CF', percent: 29, value: '≈$363', series: 'accent' as const },
  { label: 'SendGrid', percent: 48, value: '≈$600', series: 'neutral' as const },
  { label: 'Resend', percent: 52, value: '≈$650', series: 'neutral' as const },
  { label: 'Postmark', percent: 96, value: '≈$1,206', series: 'neutral' as const },
]

const TIPS: { title: string; body: string }[] = [
  {
    title: 'Keep the Worker warm',
    body:
      'MIME parsing on a cold path is the most common CPU-time surprise. ' +
      'We batch parse and cache templates in KV.',
  },
  {
    title: 'Batch your D1 writes',
    body:
      'One row per event gets expensive fast. Events land in Analytics Engine; ' +
      'D1 only holds state you query.',
  },
  {
    title: 'Lifecycle your R2 bucket',
    body: 'Attachments and raw MIME move to infrequent-access on your retention window automatically.',
  },
  {
    title: 'Set a budget alert',
    body:
      'The deploy script sets a Cloudflare notification at 2× your expected spend, ' +
      'plus a hard send cap you control.',
  },
]

const th = 'ms-eyebrow border-b border-line px-[18px] py-3.5 text-left font-normal'
const td = 'border-b border-line-soft px-[18px] py-[15px] align-top'

const Money = ({ children }: { children: ReactNode }) => (
  <span className="ms-num font-mono">{children}</span>
)

function StackPage() {
  return (
    <PageShell>
      <Section className="pt-16 pb-10" innerClassName="flex flex-col items-center text-center">
        <Eyebrow>THE STACK &amp; WHAT IT COSTS</Eyebrow>
        <h1 className="ms-display-1 mt-4.5 max-w-[22ch]">Every line item, in dollars.</h1>
        <p className="mt-5.5 max-w-[62ch] text-[19px] leading-[1.55] text-muted">
          A Resend-style email platform turns out to be eleven Cloudflare products wired together.
          Here is what each one does, what Cloudflare charges for it, and what your bill looks like
          at 10,000, 100,000 and a million emails a month — with the SaaS list prices next to it.
        </p>
      </Section>

      <Section id="stack" className="pt-6 pb-14">
        {/*
          A real `<table>`, not the artboard's three-column CSS grid. The grid
          reads to a screen reader as thirty-six unrelated cells: no column
          headers, no row association, no way to ask what "Free" belongs to.
        */}
        <div className="overflow-x-auto rounded-panel border border-line bg-card">
          <table className="w-full min-w-[680px] border-collapse text-[14.5px]">
            <caption className="sr-only">
              Cloudflare products MailySend runs on, what each does, and what it costs
            </caption>
            <thead>
              <tr>
                <th scope="col" className={`${th} w-[24%]`}>
                  CLOUDFLARE PRODUCT
                </th>
                <th scope="col" className={`${th} w-[45%]`}>
                  WHAT IT DOES HERE
                </th>
                <th scope="col" className={`${th} w-[31%]`}>
                  WHAT IT COSTS
                </th>
              </tr>
            </thead>
            <tbody>
              {STACK.map((row) => (
                <tr key={row.product}>
                  <th scope="row" className={`${td} text-left font-semibold`}>
                    {row.product}
                  </th>
                  <td className={`${td} text-muted`}>{row.role}</td>
                  <td className={`${td} ms-num font-mono text-[13px]`}>
                    {row.cost}
                    {row.beyond ? (
                      <>
                        <br />
                        <span className="text-muted-2">{row.beyond}</span>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-5 max-w-[80ch] text-[13.5px] leading-relaxed text-muted-2">
          Cloudflare Email Sending entered public beta in April 2026: it requires a Workers Paid
          plan ($5/month minimum), includes 3,000 emails per account per month, and charges $0.35
          per 1,000 after that. Inbound Email Routing stays free. Rates shown are Cloudflare's list
          prices at time of writing — check their pricing pages before you budget.
        </p>
      </Section>

      <Section id="calculator" className="pb-16">
        <CostCalculator
          eyebrow="CALCULATOR"
          title="What will you actually pay?"
          lede="Drag to your monthly volume. MailySend runs in your own Cloudflare account, so your bill is Cloudflare's list prices. The others are published plan rates for the same volume."
          /*
            MailySend against products, not against a bare wire.

            This used to highlight MailySend on Cloudflare beside a raw Amazon
            SES tile — $47.95 next to $10 at 100k — which reads as MailySend
            being nearly five times the price of the alternative. It is not the
            alternative: SES is an SMTP wire with no dashboard, no logs, no
            analytics and no inbound, and MailySend runs *on top of it* for the
            same $0.10 per thousand. So the cheapest honest configuration of
            this product leads, Cloudflare sits beside it as the zero-account
            option, and the bare wire is a footnote rather than a competitor.
          */
          tiles={[
            {
              label: 'MAILYSEND + SES',
              cost: sesProviderCost,
              basis: '$5 Workers + $0.10/1k · one config line',
              highlight: true,
            },
            {
              label: 'MAILYSEND + CLOUDFLARE',
              cost: selfHostedCost,
              basis: '$5 Workers + $0.35/1k over 3,000 · no second account',
            },
            { label: 'RESEND', cost: resendCost, basis: 'Free → Pro → Pro 100k → quote' },
            { label: 'SENDGRID', cost: sendgridCost, basis: '≈$0.60 per 1,000' },
          ]}
          note={
            <>
              Same product either way — same API, same logs, same analytics, same inbound. The
              backend is one line of configuration, and you can change it later.{' '}
              <span className="text-on-dark-2">
                Amazon SES on its own is ~$0.10 per 1,000 plus your own infrastructure: no
                dashboard, no event timeline, no inbound, and CloudWatch for analytics.
              </span>{' '}
              <a href="/docs#providers" className="text-accent-on-dark">
                How providers work →
              </a>
            </>
          }
        />
      </Section>

      <Section id="examples" className="pb-16">
        <SectionHeader eyebrow="WORKED EXAMPLES" title="Three real shapes of bill" />
        <div className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
          {EXAMPLES.map((example) => (
            <Card key={example.kicker} className="p-6">
              <Eyebrow className="tracking-[0.1em]">{example.kicker}</Eyebrow>
              <p className="ms-display-3 mt-1.5 mb-3.5 text-[26px]">{example.volume}</p>
              <dl className="flex flex-col gap-2 text-[14px] text-muted">
                {example.lines.map((line) => (
                  <div
                    key={line.label}
                    className={
                      line.total
                        ? 'flex justify-between gap-3 border-t border-line pt-2.5 font-semibold text-ink'
                        : line.compare
                          ? 'flex justify-between gap-3 text-muted-2'
                          : 'flex justify-between gap-3'
                    }
                  >
                    <dt>{line.label}</dt>
                    <dd>
                      <Money>{line.amount}</Money>
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          ))}
        </div>
      </Section>

      <Section className="pb-16">
        <Card className="p-[clamp(22px,3vw,34px)]">
          <Eyebrow className="mb-5 tracking-[0.12em]">
            ONE MILLION TRANSACTIONAL EMAILS · MONTHLY LIST PRICE
          </Eyebrow>
          <div className="flex flex-col gap-3.5">
            {MILLION_BARS.map((bar) => (
              <BarRow
                key={bar.label}
                label={bar.label}
                percent={bar.percent}
                value={bar.value}
                series={bar.series}
                labelWidth={150}
                height={26}
              />
            ))}
          </div>
          <p className="mt-5 text-[13.5px] leading-relaxed text-muted-2">
            Competitor figures are published list prices for one million transactional emails,
            gathered September 2026; volume discounts and annual commitments change them.
            Deliverability, not price, should still be your first filter — which is why every number
            here comes with the analytics to check it.
          </p>
        </Card>
      </Section>

      <Section className="pb-20">
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          {TIPS.map((tip) => (
            <Card key={tip.title} className="p-[22px]">
              <p className="mb-2 text-[16.5px] font-semibold">{tip.title}</p>
              <p className="text-[14.5px] leading-[1.65] text-muted">{tip.body}</p>
            </Card>
          ))}
        </div>

        <CTABand
          className="mt-8"
          title={`Run it yourself in ${DEPLOY_DURATION}.`}
          description="One command provisions the whole stack in your account. MIT licensed, no key to ask us for, no bill from us at all."
          actions={
            <>
              <DeployButton chip="1-CLICK" size="lg" />
              <a href="/pricing" className="text-[15px] text-on-dark-2 hover:text-accent-on-dark">
                or see the full pricing page →
              </a>
            </>
          }
        />
      </Section>
    </PageShell>
  )
}
