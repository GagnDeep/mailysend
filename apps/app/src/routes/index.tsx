import type { ComparisonColumn, ComparisonRow } from '@mailysend/ui'
import {
  Button,
  Card,
  CodeTabs,
  CommandStrip,
  ComparisonTable,
  CTABand,
  Eyebrow,
  FlowConnector,
  FlowNode,
  HairlineRule,
  LogRow,
  Metric,
  MonoChip,
  Pill,
  SectionHeader,
  StatusDot,
  StepCard,
} from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import {
  DEPLOY_DURATION,
  DEPLOY_RANGE,
  DeployButton,
  DeployTerminal,
  SelfHostGuideLink,
} from '~/components/marketing/deploy'
import type { FaqItem } from '~/components/marketing/faq'
import { Faq, toFaqEntries } from '~/components/marketing/faq'
import { GitHubButton } from '~/components/marketing/github-button.tsx'
import { GuideCard } from '~/components/marketing/guide-card.tsx'
import { PageShell, Section } from '~/components/marketing/page-shell'
import { GUIDES } from '~/content/site-map.ts'
import { DEPLOY_URL, faqPageSchema, pageHead, softwareApplicationSchema } from '~/seo'

/**
 * Six guides on the home page, chosen by search intent rather than by track.
 *
 * Hand-picked, and deliberately not `GUIDES.slice(0, 6)`: manifest order is the
 * reading order for someone who has already decided to use MailySend, which is
 * the opposite of who lands here. Adding a guide to the manifest should not
 * silently rearrange the home page.
 */
const FEATURED_GUIDES = [
  'deploy-to-cloudflare',
  'send-your-first-email',
  'spf-dkim-dmarc',
  'why-email-goes-to-spam',
  'what-100k-emails-costs',
  'migrate-from-resend',
]

/**
 * The artboards colour exactly three things inside a code block: string
 * literals mint, imported bindings amber, comments grey. Three one-line
 * components beat a syntax highlighter shipped to the client for samples that
 * never change.
 */
const S = ({ children }: { children: string }) => (
  <span className="text-code-green">{children}</span>
)
const A = ({ children }: { children: string }) => (
  <span className="text-accent-on-dark">{children}</span>
)
const C = ({ children }: { children: string }) => <span className="text-on-dark-5">{children}</span>

/**
 * The hero leads with the `resend` client, not with ours.
 *
 * The README's first code block is a three-line diff against an existing
 * Resend integration, and that is the strongest thing this project has to say:
 * the official client resolves its base URL as
 * `process.env.RESEND_BASE_URL || 'https://api.resend.com'` (verified in
 * resend@6.27.0), so adopting MailySend is an environment variable rather than
 * a rewrite. Opening with `import { MailySend } from 'mailysend'` asked the
 * reader to learn a new SDK before they had a reason to, and buried the claim
 * that actually distinguishes the product. The first-party SDK keeps the tab
 * immediately after it, for whoever is starting fresh.
 */
const RESEND_CODE = `// .env — RESEND_BASE_URL=https://your-deployment/v1

import { Resend } from 'resend';

const resend = new Resend(process.env.MAILYSEND_API_KEY);

await resend.emails.send({
  from: 'you@yourdomain.com',
  to: 'user@example.com',
  subject: 'Your login code',
  react: <LoginCode code="814205" />,
});`

const NODE_CODE = `import { MailySend } from 'mailysend';

const ms = new MailySend(process.env.MAILYSEND_API_KEY);

await ms.emails.send({
  from: 'you@yourdomain.com',
  to: 'user@example.com',
  subject: 'Your login code',
  react: <LoginCode code="814205" />,
});`

// There is no api.mailysend.com — the name does not resolve, and the whole
// argument of this page is that the API is the deployment in *your* account.
// A sample pointed at a hosted endpoint contradicts the sentence above it.
const CURL_CODE = `curl https://your-deployment/v1/emails \\
  -H "Authorization: Bearer $MAILYSEND_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "you@yourdomain.com",
    "to": "user@example.com",
    "subject": "Your login code",
    "html": "<p>Code: 814205</p>"
  }'`

const WORKER_CODE = `// wrangler.jsonc: "mailysend": { "binding": "MAIL" }

export default {
  async fetch(req, env) {
    await env.MAIL.send({
      from: 'you@yourdomain.com',
      to: 'user@example.com',
      subject: 'Your login code',
      text: 'Code: 814205',
    });
    return new Response('sent');
  },
};`

const HERO_SAMPLES = [
  {
    value: 'resend',
    label: 'resend',
    code: RESEND_CODE,
    children: (
      <>
        <C>{'// .env — RESEND_BASE_URL=https://your-deployment/v1'}</C>
        {'\n\nimport '}
        <A>{'{ Resend }'}</A>
        {' from '}
        <S>{"'resend'"}</S>
        {';\n\nconst resend = new Resend('}
        <S>process.env.MAILYSEND_API_KEY</S>
        {');\n\nawait resend.emails.send({\n  from: '}
        <S>{"'you@yourdomain.com'"}</S>
        {',\n  to: '}
        <S>{"'user@example.com'"}</S>
        {',\n  subject: '}
        <S>{"'Your login code'"}</S>
        {',\n  react: <LoginCode code='}
        <S>"814205"</S>
        {' />,\n});'}
      </>
    ),
  },
  {
    value: 'node',
    label: 'mailysend',
    code: NODE_CODE,
    children: (
      <>
        {'import '}
        <A>{'{ MailySend }'}</A>
        {' from '}
        <S>{"'mailysend'"}</S>
        {';\n\nconst ms = new MailySend('}
        <S>process.env.MAILYSEND_API_KEY</S>
        {');\n\nawait ms.emails.send({\n  from: '}
        <S>{"'you@yourdomain.com'"}</S>
        {',\n  to: '}
        <S>{"'user@example.com'"}</S>
        {',\n  subject: '}
        <S>{"'Your login code'"}</S>
        {',\n  react: <LoginCode code='}
        <S>"814205"</S>
        {' />,\n});'}
      </>
    ),
  },
  {
    value: 'curl',
    label: 'curl',
    code: CURL_CODE,
    children: (
      <>
        {'curl https://your-deployment/v1/emails \\\n  -H '}
        <S>"Authorization: Bearer $MAILYSEND_API_KEY"</S>
        {' \\\n  -H '}
        <S>"Content-Type: application/json"</S>
        {' \\\n  -d \'{\n    "from": '}
        <S>"you@yourdomain.com"</S>
        {',\n    "to": '}
        <S>"user@example.com"</S>
        {',\n    "subject": '}
        <S>"Your login code"</S>
        {',\n    "html": '}
        <S>{'"<p>Code: 814205</p>"'}</S>
        {"\n  }'"}
      </>
    ),
  },
  {
    value: 'worker',
    label: 'worker',
    code: WORKER_CODE,
    children: (
      <>
        <C>{'// wrangler.jsonc: "mailysend": { "binding": "MAIL" }'}</C>
        {'\n\nexport default {\n  async fetch(req, env) {\n    await env.MAIL.send({\n      from: '}
        <S>{"'you@yourdomain.com'"}</S>
        {',\n      to: '}
        <S>{"'user@example.com'"}</S>
        {',\n      subject: '}
        <S>{"'Your login code'"}</S>
        {',\n      text: '}
        <S>{"'Code: 814205'"}</S>
        {',\n    });\n    return new Response('}
        <S>{"'sent'"}</S>
        {');\n  },\n};'}
      </>
    ),
  },
]

const SHORT_VERSION = [
  { value: '41ms', label: 'median API latency' },
  { value: '99.99%', label: 'send uptime' },
  { value: '330+', label: 'Cloudflare cities' },
  { value: '0', label: 'cold starts' },
]

const STEPS = [
  {
    step: 1,
    meta: '~40s',
    title: 'Add your domain',
    description:
      'Already on Cloudflare DNS? We write the SPF, DKIM and DMARC records for you and verify in seconds.',
  },
  {
    step: 2,
    meta: '~10s',
    title: 'Create an API key',
    description: null,
  },
  {
    step: 3,
    meta: '3 lines',
    title: 'Send your first email',
    description:
      'SDK, REST, SMTP relay, Wrangler CLI or a native Worker binding — whichever fits your stack.',
  },
]

const TIMELINE = [
  { time: '12:04:03', event: 'accepted', tone: 'text-ink' },
  { time: '12:04:03', event: 'signed dkim', tone: 'text-ink' },
  { time: '12:04:04', event: 'delivered', tone: 'font-bold text-positive' },
]

const PRODUCT_CARDS = [
  {
    kicker: 'TRANSACTIONAL',
    title: 'Emails API',
    description:
      'Single and batch sends, attachments, scheduling, idempotency keys, tags, custom headers, reply-to threading.',
    tags: ['/v1/emails', '/batch', 'schedule_at'],
  },
  {
    kicker: 'MARKETING',
    title: 'Broadcasts & audiences',
    description:
      'Contact lists in D1, a no-code editor, segments, scheduled sends, automatic unsubscribe handling and one-click list headers.',
    tags: ['/broadcasts', '/audiences', '/contacts'],
  },
  {
    kicker: 'INBOUND',
    title: 'Receive & reply',
    description:
      'Catch-all inbound over Cloudflare Email Routing, parsed to JSON, attachments in R2, threaded per-mailbox in a Durable Object.',
    tags: ['/inbound', 'threads'],
  },
  {
    kicker: 'OBSERVABILITY',
    title: 'Logs, webhooks, analytics',
    description:
      'Searchable message log with full payloads, signed webhooks with retries, and per-tag delivery analytics from Analytics Engine.',
    tags: ['email.delivered', 'email.bounced'],
  },
  {
    kicker: 'AUTHORING',
    title: 'Templates in JSX',
    description:
      'Write email as React components, preview across 40 clients, version every template, render to HTML and plain text at the edge.',
    tags: ['react', 'mjml', 'handlebars'],
  },
]

/**
 * `shipped` is the honest half of this list.
 *
 * One SDK is written, tested and published; the other eight are a generator
 * invocation against the OpenAPI document this API already serves. Showing all
 * nine as if they were equally real is the kind of small lie that a page headed
 * "honest comparisons" cannot afford, so the tiles say which is which.
 */
const SDKS = [
  { name: 'Node.js & TypeScript', install: 'npm i mailysend', shipped: true },
  { name: 'Python', install: 'openapi-generator · python', shipped: false },
  { name: 'Go', install: 'openapi-generator · go', shipped: false },
  { name: 'Ruby', install: 'openapi-generator · ruby', shipped: false },
  { name: 'PHP', install: 'openapi-generator · php', shipped: false },
  { name: 'Java & Kotlin', install: 'openapi-generator · java', shipped: false },
  { name: '.NET & C#', install: 'openapi-generator · csharp', shipped: false },
  { name: 'Rust', install: 'openapi-generator · rust', shipped: false },
  { name: 'Elixir', install: 'openapi-generator · elixir', shipped: false },
]

const SURFACES = [
  {
    title: 'CLI',
    body: 'Send, tail logs, manage domains and deploy:',
    code: 'npx mailysend tail',
  },
  {
    title: 'SMTP relay',
    body: 'Rails, Django, Laravel, WordPress — anything that speaks',
    code: ':587',
  },
  {
    title: 'JSX email templates',
    body: 'Component library + 40-client preview:',
    code: 'npm i @mailysend/jsx',
  },
  {
    title: 'MCP server & agent skill',
    body: 'Point Claude or Cursor at your mailbox:',
    code: '/mcp',
  },
]

const ARCHITECTURE_ROWS = [
  [
    { kicker: 'WORKERS', title: 'API edge · auth · rate limits' },
    { kicker: 'QUEUES', title: 'throttling · retries · DLQ' },
  ],
  [
    {
      kicker: 'DURABLE OBJECTS',
      title: 'per-domain sender state, threads, broadcast progress',
    },
    { kicker: 'D1 + KV', title: 'contacts, audiences, suppression list' },
  ],
  [
    { kicker: 'R2', title: 'attachments & raw MIME' },
    // Was `WORKERS AI · spam scoring & drafting`. Nothing in the repo calls
    // Workers AI; the agent surface is the thing that actually exists.
    { kicker: 'MCP ENDPOINT', title: 'nine agent tools, gated sends' },
    { kicker: 'ANALYTICS ENGINE', title: 'event stream & charts' },
  ],
]

const COMPARE_COLUMNS: ComparisonColumn[] = [
  { key: 'ms', label: 'MailySend', emphasis: true },
  { key: 'resend', label: 'Resend' },
  { key: 'sendgrid', label: 'SendGrid' },
]

const COMPARE_ROWS: ComparisonRow[] = [
  {
    label: 'Runs on',
    values: {
      ms: { kind: 'text', label: 'Cloudflare Workers', tone: 'neutral' },
      resend: 'Managed MTA (SES)',
      sendgrid: 'Legacy MTA',
    },
  },
  {
    label: 'Native Worker binding',
    values: {
      ms: { kind: 'text', label: 'Yes', tone: 'positive' },
      resend: { kind: 'text', label: 'HTTP only', tone: 'muted' },
      sendgrid: { kind: 'text', label: 'HTTP only', tone: 'muted' },
    },
  },
  {
    label: 'Inbound + threading',
    values: {
      ms: { kind: 'text', label: 'Included', tone: 'positive' },
      resend: { kind: 'text', label: 'Limited', tone: 'muted' },
      sendgrid: 'Add-on',
    },
  },
  {
    label: 'Self-hostable',
    values: {
      ms: { kind: 'text', label: 'MIT, fully', tone: 'positive' },
      resend: { kind: 'text', label: 'No', tone: 'muted' },
      sendgrid: { kind: 'text', label: 'No', tone: 'muted' },
    },
  },
  {
    label: '100k emails/mo costs',
    values: {
      ms: { kind: 'text', label: '≈$40 to Cloudflare', tone: 'neutral' },
      resend: '$90',
      sendgrid: '≈$60',
    },
  },
]

const COMPAT_CARDS = [
  {
    title: 'Endpoint-for-endpoint',
    body: 'emails, batch, domains, api-keys, audiences, contacts, broadcasts',
  },
  { title: 'Identical webhook names', body: 'Your existing handler needs no edits' },
  {
    title: 'One-command import',
    body: 'Audiences, contacts, suppressions and 30 days of history',
  },
  {
    title: 'Zero-risk cutover',
    body: 'Keep Resend as the upstream provider, shift traffic a percent at a time',
  },
]

/**
 * One array feeds both the accordion and the `FAQPage` JSON-LD. `answer` is the
 * plain-text form the schema needs; `body` carries the links the schema cannot.
 */
const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'Do I need a Cloudflare account?',
    answer:
      'Yes — that is the model. MailySend runs on your Cloudflare account, so you need one with the $5/month Workers Paid plan (Cloudflare requires it for sending, and it includes the first 3,000 emails each month). Your sending domain does not have to use Cloudflare DNS, but verification is instant when it does.',
  },
  {
    question: 'How hard is migrating from Resend?',
    answer:
      'Our REST shape is deliberately compatible: same field names, same status values, same webhook event names. Most teams change the base URL and the API key. We also import your audiences, contacts and suppression list from a CSV or directly over the API.',
    body: (
      <>
        Our REST shape is deliberately compatible: same field names, same status values, same
        webhook event names. Most teams change the base URL and the API key. We also import your
        audiences, contacts and suppression list from a CSV or directly over the API.{' '}
        <a href="/compare#migrate">Migration guide →</a>
      </>
    ),
  },
  {
    question: 'Who actually delivers the mail?',
    answer:
      'Cloudflare does. Outbound uses Cloudflare Email Service (public beta since April 2026); inbound arrives through Cloudflare Email Routing, which is free. MailySend handles DKIM signing, feedback-loop processing and automatic suppression on top. You can also point a domain at Amazon SES or Resend instead — same API either way.',
  },
  {
    question: 'Is there an SMTP option?',
    answer:
      'Yes — your instance exposes smtp.yourdomain.com:587 with an API key as the password. Useful for Rails, Django, WordPress and anything that already speaks SMTP. Everything sent over SMTP shows up in the same logs and webhooks. On Workers the relay is an OCI container image rather than the Worker itself, because Workers has no inbound TCP listener.',
    body: (
      <>
        Yes — your instance exposes{' '}
        <span className="font-mono text-[14px]">smtp.yourdomain.com:587</span> with an API key as
        the password. Useful for Rails, Django, WordPress and anything that already speaks SMTP.
        Everything sent over SMTP shows up in the same logs and webhooks.{' '}
        <a href="/docs#smtp">How the relay is hosted →</a>
      </>
    ),
  },
  {
    question: 'What if I send more than expected?',
    answer:
      'There is no plan limit here — Cloudflare bills you $0.35 per thousand past the 3,000 included each month. The deploy sets a Cloudflare budget notification and an optional hard send cap, so a runaway loop surfaces as a 429 from your own instance rather than a surprise invoice.',
    body: (
      <>
        There is no plan limit here — Cloudflare bills you $0.35 per thousand past the 3,000
        included each month. The deploy sets a Cloudflare budget notification and an optional hard
        send cap, so a runaway loop surfaces as a <span className="font-mono text-[14px]">429</span>{' '}
        from your own instance rather than a surprise invoice.
      </>
    ),
  },
  {
    question: 'Where does my data live?',
    answer:
      'In your own Cloudflare account, in the jurisdiction you choose at deploy — Durable Objects and R2 buckets stay in that region. Retention is a config value, not a plan feature: keep a day or seven years. Nothing routes through us, because there is no us in the data path.',
    body: (
      <>
        In your own Cloudflare account, in the jurisdiction you choose at deploy — Durable Objects
        and R2 buckets stay in that region. Retention is a config value, not a plan feature: keep a
        day or seven years. Nothing routes through us, because there is no us in the data path.{' '}
        <a href="/resources#security">Security details →</a>
      </>
    ),
  },
]

export const Route = createFileRoute('/')({
  head: () =>
    pageHead({
      title: 'MailySend',
      description:
        'A Resend-compatible email platform on Cloudflare Workers: the same API and JSX templates, ' +
        'plus broadcasts, automations, inbound and real analytics — deployed into your own account.',
      path: '/',
      image: '/og/default.png',
      jsonLd: [softwareApplicationSchema(), faqPageSchema(toFaqEntries(FAQ_ITEMS))],
    }),
  component: HomePage,
})

function HomePage() {
  return (
    <PageShell>
      <Section innerClassName="flex flex-col items-center gap-12 pt-[84px] pb-11 text-center">
        {/*
          `w-full` is load-bearing, not decoration: as a flex item under
          `items-center` the column is sized to its content, so on a phone the
          hero grew past the viewport and the display type was clipped on both
          sides. Filling the track and capping at 920px keeps the desktop
          measure and lets the mobile one shrink.
        */}
        <div className="flex w-full min-w-0 max-w-[920px] flex-col items-center">
          <Pill className="px-3.5 py-[7px] text-[11.5px] tracking-[0.08em]">
            <StatusDot tone="accent" size={6} pulse />
            OPEN SOURCE · MIT · CLOUDFLARE WORKERS
          </Pill>
          <h1 className="ms-hero mt-[26px]">
            Resend, on <em className="text-accent italic">your</em> Cloudflare.
          </h1>
          <p className="mt-[22px] max-w-[54ch] text-[20px] leading-[1.5] text-muted">
            The same API, the same JSX templates — plus broadcasts, automations, inbound and real
            analytics. One click deploys it into your own account. No bill from us, ever.
          </p>
          <div className="mt-[34px] flex flex-wrap justify-center gap-3">
            <DeployButton label="Deploy in one click" size="lg" />
            {/*
              Second, and weighted like a primary button rather than a link:
              for an MIT project the repository is a destination people arrive
              wanting, not a footnote to the deploy. Accent stays with the one
              action that provisions infrastructure; this one is ink.
            */}
            <GitHubButton />
            <Button asChild size="lg" variant="outline">
              <a href="#compat">Swap Resend in one line</a>
            </Button>
          </div>
          <a
            href="/docs#quickstart"
            className="mt-[18px] border-muted-3 border-b pb-0.5 text-[15px] text-muted no-underline hover:border-accent hover:text-accent"
          >
            or read the 3-minute quickstart
          </a>
          <CommandStrip
            command="npx mailysend deploy --domain acme.dev"
            note={DEPLOY_RANGE}
            className="mt-[26px] max-w-full"
          />
          <div className="mt-4 flex flex-wrap justify-center gap-x-[22px] gap-y-2 font-mono text-[11.5px] tracking-[0.06em] text-muted-2">
            <span>MIT LICENSED</span>
            <span aria-hidden="true">·</span>
            <span>YOUR ACCOUNT, YOUR DATA</span>
            <span aria-hidden="true">·</span>
            <span>NO VENDOR BILL</span>
          </div>
        </div>

        <div className="w-full min-w-0 max-w-[860px] text-left">
          <CodeTabs
            items={HERO_SAMPLES}
            caption="POST /v1/emails"
            className="shadow-lg"
            footer={
              <div className="flex flex-col gap-2.5">
                <div className="ms-eyebrow tracking-[0.12em] text-on-dark-5">
                  RESPONSE · 200 OK · 41ms
                </div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-[12px] text-on-dark-3">
                  <span className="text-code-green">id:</span>
                  <span>em_7Kq2xR9vTb</span>
                  <span aria-hidden="true" className="text-on-dark-5">
                    ·
                  </span>
                  <span className="rounded-pill bg-positive/20 px-2.5 py-1 text-code-green">
                    queued → delivered
                  </span>
                  <span className="text-on-dark-5">colo</span>
                  <span>FRA</span>
                </div>
              </div>
            }
          />
          <p className="mt-3.5 px-1 font-mono text-[13px] text-muted-2">
            Same call from a Worker, a Lambda or your laptop — and the same shape your Resend code
            already uses.
          </p>
        </div>
      </Section>

      <Section innerClassName="pt-10 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-3 rounded-block border border-line bg-card px-5 py-3.5">
          <Eyebrow wide>THE SHORT VERSION</Eyebrow>
          <div className="flex flex-wrap gap-x-[34px] gap-y-3">
            {SHORT_VERSION.map((item) => (
              <Metric key={item.label} inline size="sm" value={item.value} label={item.label} />
            ))}
          </div>
        </div>
      </Section>

      <Section id="how" innerClassName="py-14">
        <SectionHeader
          eyebrow="HOW IT WORKS"
          title="Four steps. Nothing hidden."
          lede="Most people are sending real email in under five minutes. Every step tells you exactly what happens next."
        />
        <div className="mt-9 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[18px]">
          {STEPS.map((step) => (
            <StepCard
              key={step.step}
              step={step.step}
              meta={step.meta}
              title={step.title}
              description={step.description ?? undefined}
            >
              {step.step === 2 ? (
                <p className="m-0 text-[14px] leading-[1.6] text-muted">
                  Scoped keys (<span className="font-mono text-[13px]">send-only</span>, per-domain,
                  per-environment) that start with{' '}
                  <span className="font-mono text-[13px]">ms_</span>.
                </p>
              ) : null}
            </StepCard>
          ))}
          <StepCard
            step={4}
            meta="live"
            variant="tile-dark"
            title="Watch it land"
            description="Every event — accepted, delivered, opened, bounced — streams to your dashboard and your webhook."
          >
            <a
              href="/dashboard-tour"
              className="mt-3.5 inline-block text-[14px] font-semibold text-accent-on-dark no-underline hover:text-paper"
            >
              See the dashboard →
            </a>
          </StepCard>
        </div>
      </Section>

      <Section tone="card" innerClassName="py-5">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
          {TIMELINE.map((entry) => (
            <div key={entry.event} className="flex items-center gap-3 py-2.5">
              <time className="ms-num min-w-[52px] font-mono text-[11px] text-muted-2">
                {entry.time}
              </time>
              <span className={`font-mono text-[12.5px] ${entry.tone}`}>{entry.event}</span>
              <HairlineRule />
            </div>
          ))}
          <div className="flex items-center gap-3 py-2.5">
            <time className="ms-num min-w-[52px] font-mono text-[11px] text-muted-2">12:06:41</time>
            <span className="font-mono text-[12.5px] font-bold text-accent">opened</span>
            <StatusDot tone="accent" size={7} pulse />
          </div>
        </div>
      </Section>

      <Section id="product" innerClassName="py-16">
        <Eyebrow wide>THE PRODUCT</Eyebrow>
        <h2 className="ms-display-2 mt-3.5 max-w-[24ch]">
          The whole email stack Resend
          <br />
          left on the table.
        </h2>
        <div className="mt-9 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-[18px]">
          {PRODUCT_CARDS.map((card) => (
            <Card key={card.title} className="p-[26px]">
              <div className="mb-3.5 font-mono text-[11px] tracking-[0.1em] text-accent">
                {card.kicker}
              </div>
              <h3 className="m-0 mb-2.5 text-[19px] font-semibold -tracking-[0.01em]">
                {card.title}
              </h3>
              <p className="m-0 mb-3.5 text-[14.5px] leading-[1.65] text-muted">
                {card.description}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {card.tags.map((tag) => (
                  <MonoChip key={tag} size="sm">
                    {tag}
                  </MonoChip>
                ))}
              </div>
            </Card>
          ))}
          <Card tone="dark" className="p-[26px]">
            <div className="mb-3.5 font-mono text-[11px] tracking-[0.1em] text-accent-on-dark">
              AGENTS
            </div>
            <h3 className="m-0 mb-2.5 text-[19px] font-semibold -tracking-[0.01em]">
              MCP server & agent tools
            </h3>
            <p className="m-0 mb-3.5 text-[14.5px] leading-[1.65] text-on-dark-3">
              Give Claude, Cursor or your own agent a mailbox: search threads, draft replies, send
              with explicit confirmation. Built on the Cloudflare Agents SDK.
            </p>
            <a
              href="/docs#mcp"
              className="text-[14px] font-semibold text-accent-on-dark no-underline hover:text-paper"
            >
              MCP docs →
            </a>
          </Card>
        </div>
      </Section>

      <Section id="sdks" innerClassName="pt-2 pb-16">
        <SectionHeader
          eyebrow="SDKS · CLI · MCP"
          title="A first-party SDK, and the spec the rest generate from."
          action={
            <a href="/docs#sdks" className="text-[14.5px] font-semibold no-underline">
              All SDK docs →
            </a>
          }
        />
        <p className="mt-4 mb-[30px] max-w-[62ch] text-[17px] text-muted">
          The Node SDK is written and published, with a Resend-compatible shim — your react-email
          components render unchanged. Every other language generates from the OpenAPI document your
          own deployment serves at <span className="font-mono text-[15px]">/v1/openapi.json</span>,
          so a client is one generator run away and is never out of date with the API it was
          generated from. Alongside them: a CLI, an SMTP relay, JSX templates and an MCP server, all
          MIT licensed.
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(232px,1fr))] gap-3">
          {SDKS.map((sdk) => (
            <div
              key={sdk.name}
              className="rounded-tile border border-line bg-card p-[18px] transition-colors duration-[0.2s] hover:border-ink"
            >
              <div className="mb-2 flex items-center gap-2 text-[15.5px] font-semibold">
                {sdk.name}
                {sdk.shipped ? (
                  <span className="rounded-chip bg-positive-bg px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-positive">
                    SHIPPED
                  </span>
                ) : null}
              </div>
              <div className="overflow-x-auto whitespace-nowrap font-mono text-[12px] text-muted">
                {sdk.install}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(232px,1fr))] gap-3">
          {SURFACES.map((surface) => (
            <div key={surface.title} className="rounded-tile border border-line bg-tint p-[18px]">
              <div className="mb-1.5 text-[15.5px] font-semibold">{surface.title}</div>
              <div className="text-[13.5px] leading-[1.55] text-muted">
                {surface.body} <span className="font-mono text-[12.5px]">{surface.code}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="deploy" innerClassName="pt-2 pb-16">
        <SectionHeader
          eyebrow="TWO WAYS TO RUN IT"
          title={
            <>
              Try it in one click.
              <br />
              Own it forever.
            </>
          }
          lede="There is no MailySend cloud to sign up for. You deploy the platform into your own Cloudflare account — from the browser or from your terminal — and it is yours."
        />
        <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-[18px]">
          <div className="flex flex-col rounded-block border border-line bg-card p-7">
            <Eyebrow className="mb-3.5 tracking-[0.1em]">PATH A · ONE CLICK</Eyebrow>
            <h3 className="ms-display-3 m-0 mb-2.5 text-[25px]">Press the button</h3>
            <p className="m-0 mb-[18px] text-[15px] leading-[1.65] text-muted">
              Deploy to Cloudflare creates D1, KV, R2 and the Durable Objects in your account and
              hands you the dashboard on your own workers.dev subdomain. Queues and the analytics
              datasets take one command afterwards.
            </p>
            <ul className="m-0 mb-[22px] flex list-none flex-col gap-2.5 p-0 text-[14.5px]">
              {[
                `Ready in ${DEPLOY_DURATION} — most of it DNS propagation`,
                'Nothing to fill in — the deploy form has no fields at all',
                'Migrates itself and prints your first API key on boot',
              ].map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span aria-hidden="true" className="font-bold text-positive">
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-auto flex flex-wrap items-center gap-2">
              <DeployButton size="lg" />
              <SelfHostGuideLink />
            </div>
          </div>

          <div className="flex flex-col rounded-block border border-ink bg-ink p-7 text-paper">
            <Eyebrow className="mb-3.5 tracking-[0.1em] text-accent-on-dark">
              PATH B · ONE COMMAND
            </Eyebrow>
            <h3 className="ms-display-3 m-0 mb-2.5 text-[25px]">Or from your terminal</h3>
            <p className="m-0 mb-[18px] text-[15px] leading-[1.65] text-on-dark-3">
              Clone the repo and run the two commands below against your own wrangler config —
              reviewable, scriptable, CI-friendly, and the same thing the button does.
            </p>
            <DeployTerminal className="mb-[18px] border border-dark-line" />
            <Button asChild variant="accent" size="lg" className="mt-auto">
              <a href="/resources#selfhost">
                Read the self-host guide
                <MonoChip tone="ink" size="sm" className="bg-white/20 text-white tracking-[0.1em]">
                  CLI
                </MonoChip>
              </a>
            </Button>
            <div className="mt-3 text-center text-[13px] text-on-dark-4">
              MIT licensed · your data never leaves your account
            </div>
          </div>
        </div>
      </Section>

      <Section id="architecture" tone="dark" innerClassName="py-[72px]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-start gap-10">
          <div className="min-w-0">
            <Eyebrow wide className="text-accent-on-dark">
              ARCHITECTURE
            </Eyebrow>
            <h2 className="ms-display-2 mt-3.5 mb-4">
              Not a black box. Workers, all the way down.
            </h2>
            <p className="m-0 mb-5 max-w-[52ch] text-[16.5px] leading-[1.65] text-on-dark-3">
              Resend hides a managed MTA behind a lovely API. MailySend is eleven Cloudflare
              primitives you already know, wired together in code you can read — so you can reason
              about latency, retries and cost, and own every byte.
            </p>
            <a
              href="/resources#selfhost"
              className="inline-flex items-center gap-2 text-[15px] font-semibold text-accent-on-dark no-underline hover:text-paper"
            >
              Read the self-hosting guide →
            </a>
          </div>
          <div className="flex min-w-0 flex-col gap-2.5">
            {ARCHITECTURE_ROWS.map((row, index) => (
              <div key={row[0]?.kicker} className="flex flex-col gap-2.5">
                {index > 0 ? <FlowConnector arrow tone="dark" /> : null}
                <div className="flex flex-wrap gap-2.5">
                  {row.map((node) => (
                    <FlowNode
                      key={node.kicker}
                      tone="dark"
                      kicker={node.kicker}
                      title={<span className="text-[13.5px] font-normal">{node.title}</span>}
                      className="flex-1 basis-[110px] rounded-code"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section innerClassName="py-16">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-center gap-10">
          <div className="min-w-0">
            <Eyebrow wide>THE DASHBOARD</Eyebrow>
            <h2 className="ms-display-2 mt-3.5 mb-4">Debug a delivery in two clicks.</h2>
            <p className="m-0 mb-[18px] max-w-[52ch] text-[16.5px] leading-[1.65] text-muted">
              Search the log by recipient, tag, status or subject. Open any message to see the exact
              payload you sent, the SMTP conversation, and every webhook attempt with its response
              code.
            </p>
            <Button asChild>
              <a href="/dashboard-tour">
                Take the product tour
                <span aria-hidden="true" className="font-mono text-[13px]">
                  →
                </span>
              </a>
            </Button>
          </div>

          <div className="min-w-0 overflow-hidden rounded-card border border-line bg-card shadow-lg">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="font-mono text-[11.5px] text-muted-2">LOGS</span>
              <span className="ms-num ml-auto font-mono text-[11.5px] text-positive">
                98.7% delivered · 7d
              </span>
            </div>
            <LogRow
              status="opened"
              timestamp="12:06"
              recipient="ana@acme.dev"
              subject="Your login code"
            />
            <LogRow
              status="delivered"
              timestamp="12:04"
              recipient="jo@studio.io"
              subject="Receipt #4821"
            />
            <LogRow
              status="bounced"
              selected
              defaultExpanded
              timestamp="12:41"
              recipient="old@dead-domain.com"
              subject="Weekly digest"
              details={
                <p className="m-0 text-[13px] leading-[1.6] text-muted">
                  Hard bounce. <b className="font-semibold">550 5.1.1</b> — mailbox does not exist.
                  Address added to your suppression list automatically.{' '}
                  <a href="/docs#suppressions">Why?</a>
                </p>
              }
            />
            <LogRow
              status="queued"
              timestamp="12:42"
              recipient="sam@example.com"
              subject="Password reset"
            />
          </div>
        </div>
      </Section>

      <Section innerClassName="pt-6 pb-16">
        <div className="rounded-panel border border-line bg-card p-8">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="ms-display-2 m-0 text-[clamp(26px,3vw,36px)]">
              Same API. Different everything else.
            </h2>
            <a href="/compare" className="text-[14.5px] font-semibold no-underline">
              Full comparison, all four providers →
            </a>
          </div>
          <ComparisonTable
            columns={COMPARE_COLUMNS}
            rows={COMPARE_ROWS}
            minWidth={620}
            labelColumn="minmax(160px, 1.4fr)"
            className="rounded-none border-0 bg-transparent p-0"
          />
        </div>
      </Section>

      {/*
        The AFTER block deliberately keeps `import { Resend } from 'resend'`. The
        official client resolves its base URL as
        `process.env.RESEND_BASE_URL || 'https://api.resend.com'` (verified in
        resend@6.27.0), so the migration is an environment variable and not an
        edit — which is a strictly stronger claim than swapping the import for
        `mailysend/compat`, and the one the README leads with. The shim and the
        first-party SDK stay in the prose: they are the explicit alternative, not
        the cheapest path. If this ever shows a changed import again, check that
        `resend` still reads that variable first.
      */}
      <Section id="compat" innerClassName="pb-16">
        <SectionHeader
          eyebrow="DROP-IN COMPATIBLE"
          title={
            <>
              Already on Resend?
              <br />
              Change one line.
            </>
          }
        />
        <p className="mt-4 mb-[30px] max-w-[64ch] text-[17px] text-muted">
          Same request shape, same field names, same status values, same webhook event names. Your
          react-email templates render unchanged. The official{' '}
          <span className="font-mono">resend</span> client reads{' '}
          <span className="font-mono">RESEND_BASE_URL</span>, so pointing that at your instance is
          the whole migration — the import still comes from{' '}
          <span className="font-mono">resend</span>, and your send calls are untouched. Prefer to be
          explicit? <span className="font-mono">mailysend/compat</span> exports the same{' '}
          <span className="font-mono">Resend</span> class, and there is a first-party{' '}
          <span className="font-mono">mailysend</span> SDK.
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-stretch gap-4">
          <div className="rounded-block border border-line bg-card p-[22px]">
            <Eyebrow className="mb-3 tracking-[0.1em]">BEFORE</Eyebrow>
            <div className="overflow-x-auto rounded-code bg-ink p-4 font-mono text-[12.5px] leading-[1.85] text-on-dark">
              <pre className="m-0 whitespace-pre">
                {'import { Resend } from '}
                <S>{"'resend'"}</S>
                {';\nconst resend = new Resend('}
                <S>{"'re_...'"}</S>
                {
                  ');\n\nawait resend.emails.send({\n  from, to, subject,\n  react: <Receipt order={o} />,\n});'
                }
              </pre>
            </div>
          </div>
          <div className="rounded-block border-[1.5px] border-ink bg-card p-[22px]">
            <Eyebrow className="mb-3 tracking-[0.1em] text-accent">AFTER · SAME IMPORT</Eyebrow>
            <div className="overflow-x-auto rounded-code bg-ink p-4 font-mono text-[12.5px] leading-[1.85] text-on-dark">
              <pre className="m-0 whitespace-pre">
                <C>{'// .env — the only edit\n// RESEND_BASE_URL=https://your-deployment/v1'}</C>
                {'\n\nimport { Resend } from '}
                <S>{"'resend'"}</S>
                {'; '}
                <C>{'// the official client, unchanged'}</C>
                {'\nconst resend = new Resend('}
                <S>{"'ms_...'"}</S>
                {
                  ');\n\nawait resend.emails.send({\n  from, to, subject,\n  react: <Receipt order={o} />,   '
                }
                <C>{'// unchanged'}</C>
                {'\n});'}
              </pre>
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3">
          {COMPAT_CARDS.map((card) => (
            <div
              key={card.title}
              className="rounded-tile border border-line bg-card p-[18px] text-[14.5px] leading-[1.6]"
            >
              <b className="font-semibold">{card.title}</b>
              <br />
              <span className="text-muted">{card.body}</span>
            </div>
          ))}
        </div>
        <div className="mt-[18px] flex flex-wrap items-center gap-3.5">
          <Button asChild>
            <a href="/compare#migrate">Migration guide</a>
          </Button>
          <a href="/docs#providers" className="text-[14.5px] font-semibold no-underline">
            Send through Resend, SES or Cloudflare →
          </a>
        </div>
      </Section>

      <Section id="guides" innerClassName="pt-2 pb-16">
        <SectionHeader
          eyebrow="GUIDES"
          title={
            <>
              {GUIDES.length} guides that
              <br />
              run the real code.
            </>
          }
        />
        <p className="mt-4 mb-[30px] max-w-[64ch] text-[17px] text-muted">
          Task-shaped, not reference. Where a guide explains a rule the product enforces — how a
          bounce is classified, what a segment compiles to, what a hundred thousand emails cost —
          the page imports the same function the product calls, so the answer on the page is the
          answer your instance gives.
        </p>
        <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURED_GUIDES.map((slug) => {
            const guide = GUIDES.find((entry) => entry.slug === slug)
            return guide ? <GuideCard key={slug} guide={guide} /> : null
          })}
        </div>
        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Button asChild>
            <a href="/guides">All {GUIDES.length} guides</a>
          </Button>
          <a href="/docs" className="text-[14.5px] font-semibold no-underline">
            Or the API reference →
          </a>
        </div>
      </Section>

      <Section id="faq" width="prose" innerClassName="pt-2 pb-[72px]">
        <Eyebrow wide>QUESTIONS</Eyebrow>
        <h2 className="ms-display-2 mt-3.5 mb-7">Straight answers, including the awkward ones</h2>
        <Faq items={FAQ_ITEMS} defaultOpen={FAQ_ITEMS[0]?.question} />
      </Section>

      <Section innerClassName="pb-20">
        <CTABand
          title={
            <>
              Your first email is
              <br />
              one deploy away.
            </>
          }
          description="One command, your Cloudflare account, MIT licensed. No MailySend invoice — ever — and no migration lock-in in either direction."
          actions={
            <>
              <Button asChild variant="accent" size="lg">
                <a href={DEPLOY_URL} rel="noreferrer">
                  Deploy to Cloudflare
                  <span aria-hidden="true" className="font-mono text-[13px]">
                    →
                  </span>
                </a>
              </Button>
              <GitHubButton tone="dark" />
              <a
                href="/docs"
                className="text-[15px] text-on-dark-2 no-underline hover:text-accent-on-dark"
              >
                or read the docs first
              </a>
            </>
          }
          footnote={
            <span className="font-mono">npm i mailysend · or any Resend client, repointed</span>
          }
        />
      </Section>
    </PageShell>
  )
}
