import { Button, Card, Eyebrow, SectionHeader } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import {
  CostCalculator,
  resendCost,
  selfHostedCost,
  sendgridCost,
  sesProviderCost,
} from '~/components/marketing/cost-calculator.tsx'
import { DeployButton } from '~/components/marketing/deploy.tsx'
import { Faq, type FaqItem, toFaqEntries } from '~/components/marketing/faq.tsx'
import { PageShell, Section } from '~/components/marketing/page-shell.tsx'
import { breadcrumbSchema, faqPageSchema, pageHead, softwareApplicationSchema } from '~/seo'

/**
 * Both the accordion and the `FAQPage` JSON-LD read this array, so the answer
 * Google quotes is by construction the answer on the page.
 */
const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'So what’s the catch?',
    answer:
      'There’s no hosted product to upsell you to, so the catch is honest: you own the ' +
      'operations. The deploy provisions everything and updates are one command, but if ' +
      'something breaks at 3am, it’s your Worker. In exchange, no vendor can raise your price ' +
      'or read your mail.',
  },
  {
    question: 'Do I need a Cloudflare account?',
    answer:
      'Yes — that’s the whole model. You need a Cloudflare account with Workers Paid ' +
      '($5/month) and a domain you control. Your domain does not have to be on Cloudflare DNS ' +
      'to receive our records, but sending is easiest when it is.',
  },
  {
    question: 'Can I keep sending through Resend or SES?',
    answer:
      'Yes. A domain can send through Cloudflare Email Service, Amazon SES or Resend, with ' +
      'automatic failover between them. Same API, same logs, same webhooks — so you can ' +
      'migrate at your own pace, or never.',
    body: (
      <>
        Yes. A domain can send through Cloudflare Email Service, Amazon SES or Resend, with
        automatic failover between them. Same API, same logs, same webhooks — so you can migrate at
        your own pace, or never. <a href="/docs#providers">Provider docs →</a>
      </>
    ),
  },
  {
    question: 'Is my code locked in?',
    answer:
      'The API is a drop-in match for Resend’s shape, so the same call works against either. ' +
      'Leaving is a base-URL change in both directions.',
    body: (
      <>
        The API is a drop-in match for Resend’s shape, so the same call works against either.
        Leaving is a base-URL change in both directions.{' '}
        <a href="/compare#migrate">Compatibility details →</a>
      </>
    ),
  },
]

export const Route = createFileRoute('/pricing')({
  head: () =>
    pageHead({
      title: 'Pricing — there are no plans',
      description:
        'MailySend is MIT-licensed software that runs in your own Cloudflare account. ' +
        '$0 for the software, $5/month for Workers Paid with 3,000 emails included, ' +
        '$0.35 per 1,000 after that, and nothing at all to us.',
      path: '/pricing',
      image: '/og/pricing.png',
      jsonLd: [
        breadcrumbSchema([{ name: 'What it costs', path: '/pricing' }]),
        softwareApplicationSchema(),
        faqPageSchema(toFaqEntries(FAQ_ITEMS)),
      ],
    }),
  component: PricingPage,
})

interface PriceTile {
  label: string
  price: string
  /** `/mo`, `/1k` — set small and muted beside the figure. */
  unit?: string
  body: ReactNode
  /** The inverted tile the artboard uses to land the "free" claim. */
  dark?: boolean
}

const PRICE_TILES: PriceTile[] = [
  {
    label: 'THE SOFTWARE',
    price: '$0',
    body: 'MIT licensed. Every feature, no gates, no seat count, no “contact sales”.',
  },
  {
    label: 'CLOUDFLARE WORKERS PAID',
    price: '$5',
    unit: '/mo',
    body: (
      <>
        Required for sending. Includes <b className="font-semibold">3,000 emails/month</b> and the
        Workers, Durable Objects and KV usage this runs on.
      </>
    ),
  },
  {
    label: 'EMAILS AFTER THAT',
    price: '$0.35',
    unit: '/1k',
    body: 'Cloudflare Email Service list price. Or point a domain at Amazon SES for $0.10/1k.',
  },
  {
    label: 'RECEIVING EMAIL',
    price: 'Free',
    body: 'Cloudflare Email Routing costs nothing — inbound, parsing and threading included.',
    dark: true,
  },
]

const INCLUDED: { title: string; body: string }[] = [
  { title: 'Transactional API', body: 'Batch, schedule, cancel, idempotency, tags, attachments' },
  { title: 'Broadcasts & audiences', body: 'Visual editor, live segments, A/B tests, throttling' },
  { title: 'Automations', body: 'Multi-day drips and branching on Cloudflare Workflows' },
  { title: 'Inbound & threading', body: 'Free via Email Routing, attachments in your R2' },
  { title: 'Full analytics', body: 'Inbox placement, DMARC parsing, exports, alerts' },
  {
    title: 'SDK, CLI, SMTP, MCP',
    body: 'Node SDK plus an OpenAPI spec any language generates from',
  },
  { title: 'Log retention you choose', body: 'It’s your R2 bucket — keep a day or seven years' },
  { title: 'SSO & roles', body: 'Cloudflare Access in front, audit log behind' },
]

function PricingPage() {
  return (
    <PageShell>
      <Section className="pt-16 pb-9" innerClassName="flex flex-col items-center text-center">
        <Eyebrow>PRICING</Eyebrow>
        <h1 className="ms-display-1 mt-4.5 max-w-[18ch]">There are no plans.</h1>
        <p className="mt-5.5 max-w-[58ch] text-[19px] leading-[1.55] text-muted">
          Where Resend sells you plans, MailySend is MIT-licensed software that deploys into{' '}
          <em>your</em> Cloudflare account. We don't run a service, don't hold your keys and don't
          send you an invoice — you pay Cloudflare for what you use, at their list prices.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <DeployButton chip="1-CLICK" size="lg" />
          <Button asChild variant="outline" size="lg" className="font-medium">
            <a href="/stack">See every line item</a>
          </Button>
        </div>
      </Section>

      <Section className="pt-2 pb-14">
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
          {PRICE_TILES.map((tile) => (
            <Card key={tile.label} tone={tile.dark ? 'dark' : 'paper'} className="p-[26px]">
              <Eyebrow
                className={tile.dark ? 'tracking-[0.1em] text-accent-on-dark' : 'tracking-[0.1em]'}
              >
                {tile.label}
              </Eyebrow>
              <p className="ms-num mt-2.5 mb-1.5 font-display text-[44px] leading-[1.05] font-medium -tracking-[0.035em]">
                {tile.price}
                {tile.unit ? (
                  <span className="text-[17px] font-normal text-muted-2">{tile.unit}</span>
                ) : null}
              </p>
              <p
                className={
                  tile.dark
                    ? 'text-[14.5px] leading-[1.6] text-on-dark-3'
                    : 'text-[14.5px] leading-[1.6] text-muted'
                }
              >
                {tile.body}
              </p>
            </Card>
          ))}
        </div>
        <p className="mt-4 px-0.5 text-[13.5px] leading-relaxed text-muted-2">
          Cloudflare Email Sending has been in public beta since April 2026: Workers Paid ($5/month
          minimum) is a prerequisite, 3,000 emails per account per month are included, and it's
          $0.35 per 1,000 after that. Verify on Cloudflare's pricing page before you budget — these
          are their numbers, not ours.
        </p>
      </Section>

      <Section id="calculator" className="pb-16">
        <CostCalculator
          eyebrow="YOUR BILL, NOT OURS"
          title="Drag to your volume."
          lede="Left column is what Cloudflare charges you to run MailySend. The rest are published list prices for the same volume elsewhere, for context."
          tiles={[
            {
              label: 'MAILYSEND ON CLOUDFLARE',
              cost: selfHostedCost,
              basis: '$5 + $0.35/1k over 3,000',
              highlight: true,
            },
            {
              label: 'SAME, VIA SES PROVIDER',
              cost: sesProviderCost,
              basis: '$5 + $0.10/1k · one config line',
            },
            {
              label: 'RESEND LIST PRICE',
              cost: resendCost,
              basis: 'Free → Pro → Pro 100k → quote',
            },
            { label: 'SENDGRID LIST PRICE', cost: sendgridCost, basis: '≈$0.60 per 1,000' },
          ]}
          note={
            <>
              Estimates for planning, not a quote. Storage, queues and analytics add cents at small
              volume and single-digit dollars at a million.{' '}
              <a href="/stack#examples" className="text-accent-on-dark">
                Full worked examples →
              </a>
            </>
          }
        />
      </Section>

      <Section id="included" className="pb-16">
        <SectionHeader
          eyebrow="WHAT'S INCLUDED"
          title="All of it. There's no tier to upgrade to."
          lede="Nothing here is an add-on, a seat, or a sales conversation. If it's in the repo, it's yours."
        />
        <ul className="mt-7 grid list-none gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          {INCLUDED.map((item) => (
            <li
              key={item.title}
              className="rounded-tile border border-line bg-card p-[18px] text-[14.5px] leading-[1.6]"
            >
              <b className="font-semibold">{item.title}</b>
              <br />
              <span className="text-muted">{item.body}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="faq" width="prose" className="pb-18">
        <h2 className="ms-display-2 mb-6">Fair questions</h2>
        <Faq items={FAQ_ITEMS} />
      </Section>

      <Section className="pb-20">
        <Card className="rounded-block p-[clamp(28px,4vw,52px)] text-center">
          <h2 className="ms-display-2 mb-3">The cheapest way to find out is to deploy it.</h2>
          {/*
            The artboard said "Forty-eight seconds" here and "48 seconds" on
            Stack. Both were a claim about DNS we can't keep, so the copy now
            says what the deploy actually does and where the time goes.
          */}
          <p className="mx-auto mb-6 max-w-[52ch] text-[16.5px] text-muted">
            About a minute, one command, your account — most of it DNS propagation. Delete it with
            one more if you hate it.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <DeployButton chip="1-CLICK" variant="accent" size="lg" />
            <Button asChild variant="outline" size="lg" className="font-medium">
              <a href="/docs#quickstart">Read the quickstart</a>
            </Button>
          </div>
        </Card>
      </Section>
    </PageShell>
  )
}
