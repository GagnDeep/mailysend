import {
  Button,
  Callout,
  Card,
  cn,
  Input,
  Label,
  MonoChip,
  StepCard,
  Terminal,
} from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { OWNERSHIP_BADGE } from '~/components/marketing/claims.ts'
import { DEPLOY_DURATION_LONG } from '~/components/marketing/deploy.tsx'
import { PageShell } from '~/components/marketing/page-shell.tsx'
import type { TechArticleEntry } from '~/seo'
import { breadcrumbSchema, DEPLOY_URL, pageHead, techArticleSchemas } from '~/seo'

/**
 * Every section of the page, once.
 *
 * The sidebar, the `?q=` filter and the `TechArticle` JSON-LD all read this
 * array, so a section can never appear in the navigation and be missing from
 * the structured data, or vice versa.
 */
interface DocSection extends TechArticleEntry {
  /** The sidebar label, which the artboard abbreviates for the long headings. */
  navLabel: string
  group: string
}

const DOC_SECTIONS: DocSection[] = [
  {
    anchor: 'intro',
    group: 'START',
    navLabel: 'Introduction',
    headline: 'Introduction',
    description:
      'A Resend-compatible email platform on Cloudflare Workers: one REST API for transactional sends, broadcasts, automations, inbound mail and analytics, MIT licensed.',
  },
  {
    anchor: 'quickstart',
    group: 'START',
    navLabel: 'Quickstart',
    headline: 'Quickstart',
    description: 'Install the SDK, send your first email, and tail the delivery log.',
  },
  {
    anchor: 'domains',
    group: 'START',
    navLabel: 'Domains & DNS',
    headline: 'Domains & DNS',
    description:
      'Publish SPF, DKIM and DMARC records for a sending domain — written and verified automatically on Cloudflare DNS.',
  },
  {
    anchor: 'auth',
    group: 'START',
    navLabel: 'Authentication',
    headline: 'Authentication',
    description: 'API keys scoped by permission, domain and environment.',
  },
  {
    anchor: 'api',
    group: 'SENDING',
    navLabel: 'Emails API',
    headline: 'Emails API',
    description:
      'Send, read, reschedule and cancel email through /v1/emails, including the full request body reference.',
  },
  {
    anchor: 'batch',
    group: 'SENDING',
    navLabel: 'Batch & schedule',
    headline: 'Batch & scheduling',
    description:
      'Fan out up to 100 messages per call through Cloudflare Queues, and hold scheduled mail in a Durable Object alarm.',
  },
  {
    anchor: 'attachments',
    group: 'SENDING',
    navLabel: 'Attachments',
    headline: 'Attachments',
    description:
      'Attach base64 content or a URL fetched at send time, with the per-transport size ceiling for each provider.',
  },
  {
    anchor: 'idempotency',
    group: 'SENDING',
    navLabel: 'Idempotency & tags',
    headline: 'Idempotency & tags',
    description:
      'Deduplicate retries with an Idempotency-Key for 24 hours, and slice every chart and log by indexed tags.',
  },
  {
    anchor: 'templates',
    group: 'SENDING',
    navLabel: 'Templates (JSX)',
    headline: 'Templates (JSX, MJML, Handlebars)',
    description:
      'Version server-side templates and send by template_id, or render React locally and send HTML.',
  },
  {
    anchor: 'audiences',
    group: 'MARKETING',
    navLabel: 'Audiences & contacts',
    headline: 'Audiences & contacts',
    description:
      'Contacts in D1 with arbitrary custom fields, and live segments defined as saved filters.',
  },
  {
    anchor: 'broadcasts',
    group: 'MARKETING',
    navLabel: 'Broadcasts',
    headline: 'Broadcasts',
    description:
      'Create broadcasts in the API or the visual editor, with live counts, pause/resume, throttling and per-link click maps.',
  },
  {
    anchor: 'automations',
    group: 'MARKETING',
    navLabel: 'Automations',
    headline: 'Automations',
    description:
      'Drip sequences, welcome flows and win-backs on Cloudflare Workflows: durable steps, waits measured in days, branching on your own events.',
  },
  {
    anchor: 'inbound',
    group: 'RECEIVE & REACT',
    navLabel: 'Inbound email',
    headline: 'Inbound email',
    description:
      'Inbound mail parsed to JSON with headers, bodies, attachments in R2, spam score and thread identity.',
  },
  {
    anchor: 'webhooks',
    group: 'RECEIVE & REACT',
    navLabel: 'Webhooks',
    headline: 'Webhooks',
    description:
      'HMAC-signed events retried with exponential backoff for 24 hours and replayable from the dashboard.',
  },
  {
    anchor: 'suppressions',
    group: 'RECEIVE & REACT',
    navLabel: 'Suppressions',
    headline: 'Suppressions',
    description:
      'Automatic per-workspace suppression of hard bounces and complaints, with an explicit 422 on a suppressed send.',
  },
  {
    anchor: 'analytics',
    group: 'RECEIVE & REACT',
    navLabel: 'Analytics API',
    headline: 'Analytics API',
    description:
      'Query the same Analytics Engine data the dashboard charts, grouped by tag, template, domain, provider or country.',
  },
  {
    anchor: 'providers',
    group: 'PLATFORM',
    navLabel: 'Providers: CF, SES, Resend',
    headline: 'Providers: Cloudflare, Amazon SES, Resend',
    description:
      'Choose the wire that carries the mail per domain — Cloudflare Email Service, Amazon SES or Resend — with automatic failover.',
  },
  {
    anchor: 'smtp',
    group: 'PLATFORM',
    navLabel: 'SMTP relay',
    headline: 'SMTP relay',
    description:
      'An SMTP front door for Rails, Django, Laravel, WordPress and anything legacy, with the same logs and webhooks as API sends.',
  },
  {
    anchor: 'sdks',
    group: 'PLATFORM',
    navLabel: 'SDKs & CLI',
    headline: 'SDKs & CLI',
    description:
      'A first-party Node/TypeScript SDK with a Resend-compatible shim, plus the OpenAPI document every other language generates a client from.',
  },
  {
    anchor: 'mcp',
    group: 'PLATFORM',
    navLabel: 'MCP & agents',
    headline: 'MCP & agents',
    description:
      'An MCP endpoint with nine tools, where every agent send is attributed and requires an explicit confirmation step.',
  },
  {
    anchor: 'errors',
    group: 'PLATFORM',
    navLabel: 'Errors & rate limits',
    headline: 'Errors & rate limits',
    description:
      'Typed errors that name the fix, and a default limit of 10 requests per second per key with a burst of 50.',
  },
]

const GROUP_ORDER = ['START', 'SENDING', 'MARKETING', 'RECEIVE & REACT', 'PLATFORM']

export const Route = createFileRoute('/docs')({
  /**
   * `?q=` is the target of the site-wide `SearchAction` in the root JSON-LD.
   * Declaring a search that goes nowhere is worse than declaring none, so the
   * sidebar filter below actually consumes it.
   */
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    const q = typeof search.q === 'string' ? search.q.trim() : ''
    return q ? { q } : {}
  },
  head: () =>
    pageHead({
      title: 'Docs',
      description:
        'MailySend API documentation: quickstart, domains and DNS, the emails API, batch and scheduling, templates, audiences, broadcasts, automations, inbound mail, webhooks, SDKs and error codes.',
      path: '/docs',
      image: '/og/docs.png',
      jsonLd: [
        breadcrumbSchema([{ name: 'Docs', path: '/docs' }]),
        ...techArticleSchemas('/docs', DOC_SECTIONS),
      ],
    }),
  component: DocsPage,
})

/* Syntax colouring for the dark samples. Three roles is all the artboard uses. */
const Str = ({ children }: { children: ReactNode }) => (
  <span className="text-code-green">{children}</span>
)
const Key = ({ children }: { children: ReactNode }) => (
  <span className="text-accent-on-dark">{children}</span>
)
const Com = ({ children }: { children: ReactNode }) => (
  <span className="text-on-dark-5">{children}</span>
)

/** The plain dark code block — `Terminal` is for `$` commands, this is for source. */
const Code = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('overflow-x-auto rounded-tile bg-ink p-[18px]', className)}>
    <pre className="m-0 whitespace-pre font-mono text-[12.5px] leading-[1.8] text-on-dark">
      {children}
    </pre>
  </div>
)

const Mono = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-[0.92em] text-ink">{children}</span>
)

const Lede = ({ children }: { children: ReactNode }) => (
  <p className="mt-0 mb-4 text-[16.5px] leading-[1.7] text-muted">{children}</p>
)

const methodTone = {
  POST: 'text-positive',
  GET: 'text-accent',
  PATCH: 'text-muted',
  DEL: 'text-warning',
} as const

const Endpoint = ({
  method,
  path,
  note,
  tone,
}: {
  method: string
  path: string
  note?: ReactNode
  tone?: keyof typeof methodTone
}) => (
  <div className="flex flex-wrap items-baseline gap-3 font-mono text-[13px]">
    <span className={cn('min-w-[48px] font-bold', methodTone[tone ?? (method as 'POST')])}>
      {method}
    </span>
    <span>{path}</span>
    {note ? <span className="font-sans text-[14px] text-muted-2">{note}</span> : null}
  </div>
)

/** A section heading plus its `<section>` wrapper, so every anchor is uniform. */
const DocSectionShell = ({
  anchor,
  heading,
  badge,
  children,
}: {
  anchor: string
  heading: string
  badge?: string
  children: ReactNode
}) => (
  <section id={anchor} className="min-w-0 scroll-mt-[92px]">
    <h2 className="ms-display-3 mt-0 mb-3 flex flex-wrap items-center gap-3">
      {heading}
      {badge ? (
        <MonoChip tone="accent" size="sm" className="tracking-[0.1em]">
          {badge}
        </MonoChip>
      ) : null}
    </h2>
    {children}
  </section>
)

const DNS_RECORDS = [
  ['TXT', 'send.yourdomain.com', 'v=spf1 include:spf.mailysend.com ~all'],
  ['TXT', 'ms1._domainkey', 'p=MIGfMA0GCSq… (2048-bit DKIM)'],
  ['TXT', '_dmarc', 'v=DMARC1; p=none; rua=mailto:dmarc@…'],
]

const PROVIDER_ROWS = [
  ['Cloudflare', '$0.35 / 1k', 'Default · lowest latency', 'Zero'],
  ['Amazon SES', '$0.10 / 1k', 'Millions/month, cost-first', 'IAM key'],
  ['Resend', 'your plan', 'Zero-risk migration window', 're_ key'],
]

const ERROR_ROWS: [string, string, ReactNode][] = [
  ['401', 'invalid_api_key', 'Check the key’s environment'],
  ['403', 'domain_not_verified', 'Publish the DKIM record, then verify'],
  ['422', 'suppressed_recipient', 'Address hard-bounced before — see logs'],
  [
    '429',
    'rate_limited',
    <>
      Honour <Mono>Retry-After</Mono>; SDKs do it for you
    </>,
  ],
]

const WEBHOOK_EVENTS = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.opened',
  'email.clicked',
  'email.bounced',
  'email.complained',
  'email.received',
  'contact.unsubscribed',
  'broadcast.finished',
]

/**
 * Third column is honest labelling: one of these is a published package, the
 * rest are a generator run against the OpenAPI document this deployment serves.
 * Listing all nine as if they shipped would be the same kind of stale claim the
 * comparison pages exist to avoid.
 */
const SDKS = [
  ['Node.js / TypeScript', 'npm i mailysend', 'published'],
  ['Python', 'openapi-generator-cli · python', 'generate'],
  ['Go', 'openapi-generator-cli · go', 'generate'],
  ['Ruby', 'openapi-generator-cli · ruby', 'generate'],
  ['PHP (+ Laravel)', 'openapi-generator-cli · php', 'generate'],
  ['Java / Kotlin', 'openapi-generator-cli · java', 'generate'],
  ['.NET / C#', 'openapi-generator-cli · csharp', 'generate'],
  ['Rust', 'openapi-generator-cli · rust', 'generate'],
  ['Elixir', 'openapi-generator-cli · elixir', 'generate'],
]

function DocsSidebar() {
  const { q } = Route.useSearch()
  const [query, setQuery] = useState(q ?? '')

  const needle = query.trim().toLowerCase()
  const matches = needle
    ? DOC_SECTIONS.filter(
        (section) =>
          section.navLabel.toLowerCase().includes(needle) ||
          section.headline.toLowerCase().includes(needle) ||
          section.description.toLowerCase().includes(needle),
      )
    : DOC_SECTIONS

  return (
    <aside className="min-w-0 self-start lg:sticky lg:top-[92px] lg:max-w-[280px]">
      <nav
        aria-label="Documentation"
        className="flex max-h-[calc(100vh-130px)] flex-col gap-0.5 overflow-y-auto rounded-card border border-line bg-card px-3.5 py-4"
      >
        <div className="mb-2 px-2">
          <Label htmlFor="docs-filter" className="sr-only">
            Filter documentation
          </Label>
          <Input
            id="docs-filter"
            type="search"
            value={query}
            placeholder="Filter sections"
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 text-[13.5px]"
          />
          {needle ? (
            <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-muted-2">
              {/* An empty filter that silently hides the whole nav is a dead
                  end, so the count is stated and the way back is one click. */}
              <span aria-live="polite">
                {matches.length} of {DOC_SECTIONS.length} sections
              </span>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="rounded-chip px-1.5 py-0.5 text-accent hover:bg-tint"
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>

        {GROUP_ORDER.map((group) => {
          const items = matches.filter((section) => section.group === group)
          if (items.length === 0) return null
          return (
            <div key={group} className="contents">
              <div className="ms-eyebrow px-2 pt-3 pb-1.5 text-[10.5px]">{group}</div>
              {items.map((section) => (
                <a
                  key={section.anchor}
                  href={`#${section.anchor}`}
                  className="rounded-sm px-2 py-1.5 text-[14px] text-muted no-underline hover:bg-tint hover:text-ink"
                >
                  {section.navLabel}
                </a>
              ))}
            </div>
          )
        })}

        <a
          href="/resources#selfhost"
          className="mt-3 rounded-sm px-2 py-1.5 text-[14px] font-semibold text-accent no-underline hover:bg-tint"
        >
          Self-host guide →
        </a>
      </nav>
    </aside>
  )
}

function DocsPage() {
  return (
    <PageShell>
      <div className="ms-container pt-11">
        <p className="ms-eyebrow m-0 text-[11.5px]">DOCUMENTATION · API v1 · MIT LICENSED</p>
        <h1 className="ms-display-1 mt-3.5 mb-3">Docs</h1>
        <p className="m-0 max-w-[66ch] text-[17.5px] leading-[1.6] text-muted">
          Fifteen minutes end to end, or jump straight to your endpoint. One base URL for
          everything: <MonoChip size="md">https://api.mailysend.com/v1</MonoChip>
        </p>
      </div>

      <div className="ms-container grid items-start gap-10 pt-8 pb-20 lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]">
        <DocsSidebar />

        <article className="flex min-w-0 flex-col gap-11">
          <DocSectionShell anchor="intro" heading="Introduction">
            <Lede>
              MailySend is a Resend-compatible email platform that runs on Cloudflare Workers. One
              REST API covers transactional sends, marketing broadcasts, automations, inbound mail
              and analytics — and if you already call Resend, the request bodies, status values and
              webhook names here are the ones you know. Everything is MIT licensed, so you can read
              the source, fork it, or deploy the platform into your own Cloudflare account.
            </Lede>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['BASE URL', 'api.mailysend.com/v1'],
                ['AUTH', 'Bearer ms_live_…'],
                ['FORMAT', 'JSON · UTF-8'],
              ].map(([label, value]) => (
                <Card key={label} className="p-4">
                  <div className="ms-eyebrow mb-1.5 tracking-normal">{label}</div>
                  <div className="font-mono text-[13px]">{value}</div>
                </Card>
              ))}
            </div>
          </DocSectionShell>

          <DocSectionShell anchor="quickstart" heading="Quickstart">
            <Lede>Three minutes from zero to a delivered email.</Lede>
            <div className="flex flex-col gap-3.5">
              <StepCard step={1} title="Install the SDK" variant="rule">
                <Terminal
                  className="mt-1.5"
                  lines={[{ kind: 'command', text: 'npm install mailysend' }]}
                />
              </StepCard>
              <StepCard step={2} title="Send" variant="rule">
                <Code className="mt-1.5">
                  {'import { MailySend } from '}
                  <Str>'mailysend'</Str>
                  {';\nconst ms = new MailySend(process.env.'}
                  <Key>MAILYSEND_API_KEY</Key>
                  {');\n\nconst { data, error } = await ms.emails.send({\n  from: '}
                  <Str>'MailySend &lt;hello@yourdomain.com&gt;'</Str>
                  {',\n  to: ['}
                  <Str>'user@example.com'</Str>
                  {'],\n  subject: '}
                  <Str>'Hello from the edge'</Str>
                  {',\n  html: '}
                  <Str>'&lt;p&gt;It works.&lt;/p&gt;'</Str>
                  {',\n  tags: [{ name: '}
                  <Str>'category'</Str>
                  {', value: '}
                  <Str>'welcome'</Str>
                  {' }],\n});'}
                </Code>
              </StepCard>
              <StepCard step={3} title="Watch it land" variant="rule">
                <Terminal
                  className="mt-1.5"
                  lines={[
                    { kind: 'command', text: 'npx mailysend tail' },
                    { kind: 'success', text: '12:04:03  em_7Kq2xR  accepted   user@example.com' },
                    {
                      kind: 'success',
                      text: '12:04:04  em_7Kq2xR  delivered  gmail-smtp-in · 41ms',
                    },
                  ]}
                />
              </StepCard>
            </div>
          </DocSectionShell>

          <DocSectionShell anchor="domains" heading="Domains & DNS">
            <Lede>
              Add a domain, then publish three records. If the domain is on Cloudflare DNS we write
              them for you and verify in seconds; anywhere else, copy them into your provider and
              hit verify.
            </Lede>
            <div className="overflow-x-auto rounded-tile border border-line bg-card">
              <table className="w-full min-w-[520px] border-collapse font-mono text-[12.5px]">
                <caption className="sr-only">DNS records required for a sending domain</caption>
                <thead>
                  <tr className="border-b border-line text-left text-muted-2">
                    <th className="w-20 px-3.5 py-3 font-normal">TYPE</th>
                    <th className="w-[200px] px-3.5 py-3 font-normal">NAME</th>
                    <th className="px-3.5 py-3 font-normal">VALUE</th>
                  </tr>
                </thead>
                <tbody>
                  {DNS_RECORDS.map(([type, name, value]) => (
                    <tr key={name} className="border-b border-line-soft last:border-0">
                      <td className="px-3.5 py-3">{type}</td>
                      <td className="px-3.5 py-3">{name}</td>
                      <td className="px-3.5 py-3 text-muted">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 mb-0 text-[15px] leading-[1.7] text-muted">
              Every domain gets its own DKIM key pair, a click-tracking subdomain you control, and
              an optional custom return-path. DMARC reports are parsed for you — see{' '}
              <a href="/analytics#dmarc">DMARC analytics</a>.
            </p>
          </DocSectionShell>

          <DocSectionShell anchor="auth" heading="Authentication">
            <Lede>
              Keys are scoped by permission, domain and environment. A leaked <Mono>send-only</Mono>{' '}
              key can’t read your logs or export contacts.
            </Lede>
            <Code>
              {'curl https://api.mailysend.com/v1/api-keys \\\n  -H '}
              <Str>"Authorization: Bearer $MAILYSEND_API_KEY"</Str>
              {' \\\n  -d \'{ "name": '}
              <Str>"prod worker"</Str>
              {', "permission": '}
              <Str>"sending_access"</Str>
              {',\n        "domain_id": '}
              <Str>"dom_9f2"</Str>
              {" }'"}
            </Code>
          </DocSectionShell>

          <DocSectionShell anchor="api" heading="Emails API">
            <div className="mb-4 flex flex-col gap-2">
              <Endpoint method="POST" path="/v1/emails" note="Send one email" />
              <Endpoint method="POST" path="/v1/emails/batch" note="Up to 100 per call" />
              <Endpoint method="GET" path="/v1/emails/:id" note="Status, events, full payload" />
              <Endpoint method="PATCH" path="/v1/emails/:id" note="Reschedule a queued email" />
              <Endpoint
                method="POST"
                tone="DEL"
                path="/v1/emails/:id/cancel"
                note="Cancel before send"
              />
            </div>
            <Card className="p-[18px]">
              <div className="ms-eyebrow mb-3 tracking-[0.1em]">REQUEST BODY</div>
              <div className="flex flex-col gap-2.5 text-[14.5px] leading-[1.6]">
                <div>
                  <Mono>from</Mono> <span className="text-[12px] text-warning">required</span> —
                  verified sender, optionally with display name.
                </div>
                <div>
                  <Mono>to, cc, bcc</Mono> — up to 50 recipients per message.
                </div>
                <div>
                  <Mono>subject</Mono> <span className="text-[12px] text-warning">required</span>
                </div>
                <div>
                  <Mono>html, text, react, template_id</Mono> — pick one; we generate the missing
                  plain-text part.
                </div>
                <div>
                  <Mono>reply_to, headers, attachments, tags</Mono>
                </div>
                <div>
                  <Mono>schedule_at</Mono> — ISO 8601 or natural language (<Mono>"in 1 hour"</Mono>
                  ).
                </div>
              </div>
            </Card>
          </DocSectionShell>

          <DocSectionShell anchor="batch" heading="Batch & scheduling">
            <Lede>
              Batch sends fan out through Cloudflare Queues, so one slow recipient domain never
              blocks the rest. Scheduled mail is held in a Durable Object alarm — cancel or
              reschedule any time before it fires.
            </Lede>
            <Code>
              {'await ms.emails.batch([\n  { from: f, to: '}
              <Str>'a@example.com'</Str>
              {', subject: '}
              <Str>'Receipt'</Str>
              {', template_id: '}
              <Str>'tpl_r1'</Str>
              {' },\n  { from: f, to: '}
              <Str>'b@example.com'</Str>
              {', subject: '}
              <Str>'Receipt'</Str>
              {', template_id: '}
              <Str>'tpl_r1'</Str>
              {' },\n], { schedule_at: '}
              <Str>'2026-09-10T09:00:00Z'</Str>
              {' });'}
            </Code>
          </DocSectionShell>

          <DocSectionShell anchor="attachments" heading="Attachments">
            <Lede>
              Pass base64 content, or a URL we fetch at send time. Files land in R2 in your own
              bucket when self-hosting.
            </Lede>
            {/*
              The artboard claimed a flat "25 MB total per message, matching
              Cloudflare's message ceiling". Cloudflare Email Service caps a
              send at 5 MiB, and only allows 25 MiB to destinations it has
              verified — so a single number here would bounce mail that the
              docs promised would send.
            */}
            <Callout variant="warn" title="Size limits are per transport" className="mb-4">
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                <li>
                  <Mono>cloudflare</Mono> — 5 MiB per message, raised to 25 MiB only when the
                  destination address is verified.
                </li>
                <li>
                  <Mono>ses</Mono> — 40 MB per message, including encoding overhead.
                </li>
                <li>
                  <Mono>smtp</Mono> — whatever the carrying transport allows; the relay adds no
                  ceiling of its own.
                </li>
              </ul>
              The API rejects an oversized attachment before the send is queued, so you get a 422
              rather than a bounce.
            </Callout>
            <Code>
              {'attachments: [\n  { filename: '}
              <Str>'invoice.pdf'</Str>
              {', path: '}
              <Str>'https://cdn.acme.dev/inv/4821.pdf'</Str>
              {' },\n  { filename: '}
              <Str>'terms.txt'</Str>
              {', content: base64, content_type: '}
              <Str>'text/plain'</Str>
              {' },\n]'}
            </Code>
          </DocSectionShell>

          <DocSectionShell anchor="idempotency" heading="Idempotency & tags">
            <Lede>
              Send <Mono>Idempotency-Key</Mono> and a retry inside 24 hours returns the original
              email instead of a duplicate. Tags are indexed, so every chart and log filter can
              slice by them.
            </Lede>
            <Code>
              {'-H '}
              <Str>"Idempotency-Key: order-4821-receipt"</Str>
              {'\n\ntags: [\n  { name: '}
              <Str>'category'</Str>
              {', value: '}
              <Str>'receipt'</Str>
              {' },\n  { name: '}
              <Str>'plan'</Str>
              {',     value: '}
              <Str>'pro'</Str>
              {' },\n]'}
            </Code>
          </DocSectionShell>

          <DocSectionShell anchor="templates" heading="Templates (JSX, MJML, Handlebars)">
            <Lede>
              Store templates server-side, version every change, and send by{' '}
              <Mono>template_id</Mono> — so marketing can fix a typo without a deploy. Or render
              React locally and send HTML. Both paths preview against 40 clients.
            </Lede>
            <Code>
              <Com>{'// templates/LoginCode.jsx'}</Com>
              {'\nimport { Html, Text, Button } from '}
              <Str>'@mailysend/jsx'</Str>
              {
                ';\n\nexport default ({ code }) => (\n  <Html>\n    <Text>Your code is {code}</Text>\n    <Button href='
              }
              <Str>"https://acme.dev/verify"</Str>
              {'>Verify</Button>\n  </Html>\n);\n\n'}
              <Com>$ npx mailysend templates push # versioned, instant rollback</Com>
            </Code>
          </DocSectionShell>

          <DocSectionShell anchor="audiences" heading="Audiences & contacts">
            <Lede>
              Contacts live in D1 with arbitrary custom fields. Segments are saved SQL-ish filters
              that stay live — <Mono>plan = 'pro' AND last_open &lt; 30d</Mono>.
            </Lede>
            <div className="flex flex-col gap-2">
              <Endpoint method="POST" path="/v1/audiences" />
              <Endpoint method="POST" path="/v1/audiences/:id/contacts" />
              <Endpoint method="GET" path="/v1/audiences/:id/segments/:sid/count" />
              <Endpoint
                method="DEL"
                path="/v1/contacts/:id"
                note="· GDPR erase, cascades everywhere"
              />
            </div>
          </DocSectionShell>

          <DocSectionShell anchor="broadcasts" heading="Broadcasts">
            <Lede>
              Create in the API or the visual editor — either one is editable in both places. A
              broadcast’s progress lives in a Durable Object, so you get live counts, pause/resume,
              throttle control and per-link click maps.
            </Lede>
            <Code>
              {'const b = await ms.broadcasts.create({\n  audience_id: '}
              <Str>'aud_2Kx'</Str>
              {',\n  from: '}
              <Str>'news@yourdomain.com'</Str>
              {',\n  subject: '}
              <Str>'September changelog'</Str>
              {',\n  html: '}
              <Str>{"'<p>Hi {{first_name}} …</p>'"}</Str>
              {',\n  ab_test: { subject_b: '}
              <Str>'What shipped in September'</Str>
              {
                ', split: 0.2 },\n});\nawait ms.broadcasts.send(b.id, { throttle_per_minute: 5000 });'
              }
            </Code>
          </DocSectionShell>

          {/*
            The artboard badged this section `RESEND DOESN'T`. Resend ships
            automations now, so the badge was simply false — and the claim was
            never the point. What is durable is where the workflow runs.
          */}
          <DocSectionShell anchor="automations" heading="Automations" badge={OWNERSHIP_BADGE}>
            <Lede>
              Drip sequences, welcome flows and win-backs run on Cloudflare Workflows: durable
              steps, waits measured in days, branching on your own events. No external
              orchestration, no cron soup — and the workflow executes in your account, against your
              data.
            </Lede>
            <Code>
              {'await ms.automations.create({\n  name: '}
              <Str>'Onboarding'</Str>
              {',\n  trigger: { event: '}
              <Str>'user.signed_up'</Str>
              {' },\n  steps: [\n    { send: '}
              <Str>'tpl_welcome'</Str>
              {' },\n    { wait: '}
              <Str>'2 days'</Str>
              {' },\n    { branch: { if: '}
              <Str>'contact.projects == 0'</Str>
              {',\n                then: [{ send: '}
              <Str>'tpl_nudge'</Str>
              {' }] } },\n  ],\n});'}
            </Code>
          </DocSectionShell>

          <DocSectionShell anchor="inbound" heading="Inbound email">
            <Lede>
              Point a catch-all rule at MailySend and inbound mail arrives as parsed JSON: headers,
              text, HTML, attachments in R2, spam score, and the thread it belongs to.
              Sub-addressing (<Mono>ticket+8f2@yourdomain.com</Mono>) and HMAC-signed reply headers
              keep replies routed to the right object.
            </Lede>
            <Code>
              {'{\n  '}
              <Key>"type"</Key>
              {': '}
              <Str>"email.received"</Str>
              {',\n  '}
              <Key>"thread_id"</Key>
              {': '}
              <Str>"thr_5Nq"</Str>
              {',\n  '}
              <Key>"from"</Key>
              {': '}
              <Str>"ana@acme.dev"</Str>
              {',\n  '}
              <Key>"spam_score"</Key>
              {': 0.02,\n  '}
              <Key>"attachments"</Key>
              {': [{ '}
              <Key>"r2_key"</Key>
              {': '}
              <Str>"inb/5Nq/photo.png"</Str>
              {' }]\n}'}
            </Code>
          </DocSectionShell>

          <DocSectionShell anchor="webhooks" heading="Webhooks">
            <Lede>
              Signed with an HMAC timestamp, retried with exponential backoff for 24 hours, and
              replayable from the dashboard. Every attempt keeps its response code and body so you
              can debug your own endpoint.
            </Lede>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {WEBHOOK_EVENTS.map((event) => (
                <li key={event}>
                  <MonoChip size="md" className="text-[12px]">
                    {event}
                  </MonoChip>
                </li>
              ))}
            </ul>
          </DocSectionShell>

          <DocSectionShell anchor="suppressions" heading="Suppressions">
            <Lede>
              Hard bounces and complaints are suppressed automatically in KV, per workspace, within
              milliseconds — and a suppressed send returns a clear{' '}
              <Mono>422 suppressed_recipient</Mono> instead of silently vanishing. Import your
              existing list on day one so you never re-mail a dead address.
            </Lede>
          </DocSectionShell>

          <DocSectionShell anchor="analytics" heading="Analytics API">
            <Lede>
              Query the same Analytics Engine data the dashboard charts, grouped by tag, template,
              domain, recipient provider or country — and export raw events to R2 or your warehouse.
            </Lede>
            <Code>
              {
                'GET /v1/analytics/deliverability\n  ?group_by=recipient_provider&tag=receipt&range=30d\n\n{ '
              }
              <Key>"gmail.com"</Key>
              {':   { delivered: 0.997, inbox_rate: 0.981, opens: 0.62 },\n  '}
              <Key>"outlook.com"</Key>
              {': { delivered: 0.991, inbox_rate: 0.943, opens: 0.48 } }'}
            </Code>
            {/*
              `delivered` is an SMTP 250 and `inbox_rate` is not: no placement
              figure can be derived from delivery events, so the API labels its
              provenance the same way the Analytics page does.
            */}
            <p className="mt-3.5 mb-0 text-[15px] text-muted">
              Every <Mono>inbox_rate</Mono> carries a <Mono>source</Mono> field — <Mono>seed</Mono>,{' '}
              <Mono>postmaster</Mono>, <Mono>snds</Mono> or <Mono>estimate</Mono> — because an SMTP{' '}
              <Mono>250</Mono> means accepted, not inboxed.{' '}
              <a href="/analytics">See what the analytics look like →</a>
            </p>
          </DocSectionShell>

          <DocSectionShell anchor="providers" heading="Providers: Cloudflare, Amazon SES, Resend">
            <Lede>
              MailySend separates the API you code against from the wire that carries the mail.
              Cloudflare Email Service is the default. Point a domain at Amazon SES for the cheapest
              bulk rate, or keep sending through Resend while you migrate — same SDK, same logs,
              same webhooks.
            </Lede>
            <div className="mb-4 overflow-x-auto rounded-tile border border-line bg-card">
              <table className="w-full min-w-[560px] border-collapse text-[14px]">
                <caption className="sr-only">Sending providers and their rates</caption>
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[11px] text-muted-2">
                    <th className="px-3.5 py-3 font-normal">PROVIDER</th>
                    <th className="px-3.5 py-3 font-normal">RATE</th>
                    <th className="px-3.5 py-3 font-normal">BEST FOR</th>
                    <th className="px-3.5 py-3 font-normal">SETUP</th>
                  </tr>
                </thead>
                <tbody>
                  {PROVIDER_ROWS.map(([provider, rate, bestFor, setup]) => (
                    <tr key={provider} className="border-b border-line-soft last:border-0">
                      <th scope="row" className="px-3.5 py-3.5 text-left font-semibold">
                        {provider}
                      </th>
                      <td className="px-3.5 py-3.5 text-muted">{rate}</td>
                      <td className="px-3.5 py-3.5 text-muted">{bestFor}</td>
                      <td className="px-3.5 py-3.5 text-muted">{setup}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Code>
              {'await ms.domains.update('}
              <Str>'dom_9f2'</Str>
              {', {\n  provider: '}
              <Str>'ses'</Str>
              {',            '}
              <Com>{"// 'cloudflare' | 'ses' | 'resend'"}</Com>
              {'\n  credentials_secret: '}
              <Str>'SES_KEY'</Str>
              {',\n  failover: ['}
              <Str>'cloudflare'</Str>
              {'],  '}
              <Com>{'// auto-retry elsewhere on 5xx'}</Com>
              {'\n});'}
            </Code>
            <p className="mt-3.5 mb-0 text-[15px] leading-[1.7] text-muted">
              Migrating off Resend? Keep <Mono>provider: 'resend'</Mono> on day one, move traffic
              percentage by percentage, then flip to Cloudflare when the charts look boring.{' '}
              <a href="/compare#migrate">Migration guide →</a>
            </p>
          </DocSectionShell>

          <DocSectionShell anchor="smtp" heading="SMTP relay">
            <div className="rounded-tile border border-line bg-card p-[18px] font-mono text-[13px] leading-[2] text-ink">
              <div>
                host<span className="text-muted-2"> ····· </span>smtp.mailysend.com
              </div>
              <div>
                port<span className="text-muted-2"> ····· </span>587 (STARTTLS) · 465 (TLS) · 2587
              </div>
              <div>
                user<span className="text-muted-2"> ····· </span>mailysend
              </div>
              <div>
                pass<span className="text-muted-2"> ····· </span>your API key
              </div>
            </div>
            <p className="mt-3.5 mb-4 text-[15px] leading-[1.7] text-muted">
              Rails, Django, Laravel, WordPress, Jira, anything legacy. SMTP sends appear in the
              same logs, analytics and webhooks as API sends.
            </p>
            {/*
              Workers has no inbound TCP listener, so the relay cannot be part
              of the Worker deploy the rest of these docs describe. Saying so
              here is cheaper than a self-hoster discovering it at :587.
            */}
            <Callout variant="info" title="Self-hosting the relay">
              Workers cannot accept inbound TCP, so <Mono>smtp.&lt;domain&gt;:587</Mono> is not part
              of the Worker deploy — it ships as an OCI container image you run wherever you run
              containers, pointed at your MailySend API key. If you would rather not operate one,
              configure your app against Cloudflare’s own relay at{' '}
              <Mono>smtp.mx.cloudflare.net:465</Mono> instead. The trade-off is worth stating
              plainly: those sends bypass MailySend entirely, so they will <strong>not</strong>{' '}
              appear in your logs, analytics or webhooks.
            </Callout>
          </DocSectionShell>

          <DocSectionShell anchor="sdks" heading="SDKs & CLI">
            <Lede>
              One first-party SDK — Node and TypeScript, MIT, with a Resend-compatible shim — and
              the OpenAPI document every other language generates from, served by your own
              deployment at <Mono>/v1/openapi.json</Mono> so a generated client can never drift from
              the API it was generated against.
            </Lede>
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-2.5 p-0">
              {SDKS.map(([name, install, state]) => (
                <li key={name} className="rounded-code border border-line bg-card p-3.5">
                  <div className="flex items-center gap-2 text-[14.5px] font-semibold">
                    {name}
                    {state === 'published' ? (
                      <span className="rounded-chip bg-positive-bg px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-positive">
                        SHIPPED
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 font-mono text-[12px] text-muted">{install}</div>
                </li>
              ))}
            </ul>
            <Terminal
              className="mt-3.5"
              copyable
              lines={[
                { kind: 'command', text: 'npx mailysend login' },
                {
                  kind: 'command',
                  text: 'npx mailysend send --to me@acme.dev --template tpl_welcome',
                },
                { kind: 'command', text: 'npx mailysend tail --tag receipt --status bounced' },
                { kind: 'command', text: 'npx mailysend domains verify acme.dev' },
                { kind: 'command', text: 'npx mailysend deploy --domain acme.dev   # self-host' },
              ]}
            />
          </DocSectionShell>

          <DocSectionShell anchor="mcp" heading="MCP & agents">
            <Lede>
              Your workspace exposes an MCP endpoint at <Mono>/mcp</Mono> with nine tools: search
              threads, read a message, reply, send, look up delivery status, list domains, read
              analytics, manage contacts. The two that send mail never send on their first call —
              they return a confirmation bound to that exact message, which a person approves at{' '}
              <Mono>/app/approvals</Mono>. There is no MCP method that approves one, so an agent
              holding a valid key still cannot approve its own send.
            </Lede>
            <Code>
              {'{\n  '}
              <Key>"mcpServers"</Key>
              {': {\n    '}
              <Key>"mailysend"</Key>
              {': {\n      '}
              <Key>"url"</Key>
              {': '}
              <Str>"https://api.mailysend.com/mcp"</Str>
              {',\n      '}
              <Key>"headers"</Key>
              {': { '}
              <Key>"Authorization"</Key>
              {': '}
              <Str>"Bearer ms_live_…"</Str>
              {' }\n    }\n  }\n}'}
            </Code>
          </DocSectionShell>

          <DocSectionShell anchor="errors" heading="Errors & rate limits">
            <Lede>
              Errors are typed, human-readable, and always name the fix. Default limit is 10
              requests/second per key, burst 50 — raised on request, and never applied to inbound.
            </Lede>
            <div className="overflow-x-auto rounded-tile border border-line bg-card">
              <table className="w-full min-w-[520px] border-collapse text-[14px]">
                <caption className="sr-only">Error codes and their remedies</caption>
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[11px] text-muted-2">
                    <th className="w-[70px] px-3.5 py-3 font-normal">CODE</th>
                    <th className="px-3.5 py-3 font-normal">TYPE</th>
                    <th className="px-3.5 py-3 font-normal">WHAT TO DO</th>
                  </tr>
                </thead>
                <tbody>
                  {ERROR_ROWS.map(([code, type, remedy]) => (
                    <tr key={code} className="border-b border-line-soft last:border-0">
                      <th scope="row" className="px-3.5 py-3 text-left font-mono text-[13px]">
                        {code}
                      </th>
                      <td className="px-3.5 py-3 font-mono text-[13px]">{type}</td>
                      <td className="px-3.5 py-3 text-muted">{remedy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DocSectionShell>

          <section className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-line bg-card p-[26px]">
            <div className="min-w-0">
              <h2 className="m-0 font-display text-[22px] font-medium -tracking-[0.02em]">
                Ready to send?
              </h2>
              <p className="mt-1 mb-0 text-[15px] text-muted">
                Deploy the platform into your own Cloudflare account in {DEPLOY_DURATION_LONG}. MIT
                licensed, no vendor bill.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button asChild>
                <a href={DEPLOY_URL} rel="noreferrer">
                  Deploy to Cloudflare
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href="/resources#selfhost">Self-host guide</a>
              </Button>
            </div>
          </section>
        </article>
      </div>
    </PageShell>
  )
}
