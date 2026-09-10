/**
 * Every section of the docs page, once.
 *
 * The sidebar, the `?q=` filter, the `TechArticle` JSON-LD on /docs and the
 * `## Docs` list in the generated llms.txt all read this array, so a section
 * can never appear in the navigation and be missing from the structured data,
 * or vice versa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS FILE MUST STAY PURE DATA. NO IMPORTS — not even `import type`.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `scripts/llms.ts` reads it through `tsx`, where the `~` alias does not exist.
 * `DocSection` is therefore declared here rather than extending
 * `TechArticleEntry` from `~/seo`; the shapes are structural, and docs.tsx
 * still hands the array straight to `techArticleSchemas`, so a divergence is a
 * type error at the one place that matters.
 */
export interface DocSection {
  anchor: string
  headline: string
  description: string
  /** The sidebar label, which the artboard abbreviates for the long headings. */
  navLabel: string
  group: string
}

export const DOC_SECTIONS: DocSection[] = [
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
      'Typed errors that name the fix, and a fixed-window limit per workspace: 600 sends a minute, 1,000 requests a minute everywhere else.',
  },
]

export const DOC_GROUP_ORDER = ['START', 'SENDING', 'MARKETING', 'RECEIVE & REACT', 'PLATFORM']
