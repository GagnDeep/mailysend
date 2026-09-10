import {
  AnchorPills,
  Button,
  Card,
  CodeTabs,
  cn,
  Eyebrow,
  Metric,
  Progress,
  SectionHeader,
  StatusBadge,
} from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { OWNERSHIP_BADGE } from '~/components/marketing/claims.ts'
import { DeployButton } from '~/components/marketing/deploy.tsx'
import { PageShell, Section } from '~/components/marketing/page-shell.tsx'
import { breadcrumbSchema, pageHead } from '~/seo'

export const Route = createFileRoute('/use-cases')({
  head: () =>
    pageHead({
      title: 'Use cases',
      description:
        'Seven jobs one email API should cover: login codes, receipts, digests, onboarding drips, newsletters, a support inbox and mailboxes for AI agents — all on your own Cloudflare Workers.',
      path: '/use-cases',
      image: '/og/use-cases.png',
      jsonLd: [breadcrumbSchema([{ name: 'Use cases', path: '/use-cases' }])],
    }),
  component: UseCasesPage,
})

const PAD = 'py-[clamp(56px,7vw,88px)]'

const ANCHORS = [
  { href: '#otp', label: 'OTP & auth' },
  { href: '#receipts', label: 'Receipts' },
  { href: '#notifications', label: 'Notifications' },
  { href: '#onboarding', label: 'Onboarding drips' },
  { href: '#broadcasts', label: 'Newsletters' },
  { href: '#support', label: 'Support inbox' },
  { href: '#agents', label: 'AI agents' },
]

/** The artboard's `✓` list, as a real list so it is announced as one. */
const CheckList = ({ items }: { items: string[] }) => (
  <ul className="mt-6 flex list-none flex-col gap-2.5 p-0">
    {items.map((item) => (
      <li key={item} className="flex gap-2.5 text-[14.5px] leading-[1.5] text-muted">
        <span aria-hidden="true" className="text-positive">
          ✓
        </span>
        {item}
      </li>
    ))}
  </ul>
)

interface MonoRow {
  /** The leading keyword, coloured like a command in the artboard. */
  key?: string
  text: string
  /** The right-hand annotation — a live count, or what the step did. */
  note?: string
}

/**
 * The dark monospace listing the artboard uses for the workflow trace and the
 * agent tool list. It is not a code sample — nothing here is meant to be
 * pasted — so it deliberately has no copy button, unlike `CodeTabs`.
 */
const MonoListing = ({ rows, caption }: { rows: MonoRow[]; caption: string }) => (
  <div className="overflow-hidden rounded-block bg-ink">
    <div className="border-b border-dark-line-soft px-[22px] py-3 font-mono text-[11px] tracking-[0.1em] text-on-dark-5">
      {caption}
    </div>
    <div className="overflow-x-auto p-[22px] font-mono text-[13px] leading-[1.9]">
      {rows.map((row) => (
        <div key={row.text} className="flex min-w-[380px] items-baseline gap-6">
          {row.key ? (
            <span className="w-[56px] shrink-0 text-accent-on-dark">{row.key}</span>
          ) : null}
          <span className="whitespace-pre text-on-dark">{row.text}</span>
          {row.note ? (
            <span className="ms-num ml-auto shrink-0 text-on-dark-4">{row.note}</span>
          ) : null}
        </div>
      ))}
    </div>
  </div>
)

const Split = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('grid items-center gap-10 lg:grid-cols-2', className)}>{children}</div>
)

const OTP_CODE = `export default {
  async fetch(req, env) {
    const code = crypto.randomUUID().slice(0, 6);
    await env.MAIL.send({
      from: 'Acme <login@acme.dev>',
      to: email,
      subject: \`\${code} is your code\`,
      template_id: 'tpl_login',
      data: { code },
      tags: [{ name: 'stream', value: 'auth' }],
    }, { idempotencyKey: \`otp-\${sessionId}\` });
    return Response.json({ ok: true });
  },
};`

const RECEIPT_CODE = `// Stripe webhook -> receipt with the PDF attached
await ms.emails.send({
  from: 'billing@acme.dev',
  to: invoice.customer_email,
  subject: \`Receipt \${invoice.number}\`,
  react: <Receipt invoice={invoice} />,
  attachments: [{ filename: 'invoice.pdf',
                  path: invoice.pdf_url }],
  tags: [{ name: 'stream', value: 'billing' }],
});`

const FLOW_ROWS: MonoRow[] = [
  { key: 'trigger', text: 'user.signed_up', note: '1,204 entered' },
  { key: 'send', text: 'tpl_welcome', note: '99.7% delivered' },
  { key: 'wait', text: '2 days', note: '318 sleeping' },
  { key: 'branch', text: 'contact.projects == 0' },
  { text: '  ├─ send tpl_nudge', note: '412 sent' },
  { text: '  └─ exit', note: '792 converted' },
  { key: 'wait', text: '5 days' },
  { key: 'send', text: 'tpl_case_study', note: '86 sent' },
]

const AGENT_ROWS: MonoRow[] = [
  { key: 'tools', text: 'search_threads · read_message · draft_reply' },
  { text: 'send_with_confirmation · get_delivery_status' },
  { text: 'list_contacts · add_contact · suppress · schedule' },
  { key: 'agent', text: 'reads thr_5Nq → drafts reply → waits for human' },
  { key: 'audit', text: "every action logged with the agent's key" },
]

const STACKS = [
  { name: 'Cloudflare Workers', note: 'Native binding, no HTTP hop' },
  { name: 'Next.js & Remix', note: 'Server actions + JSX templates' },
  { name: 'Hono & Bun', note: 'Typed client, edge-first' },
  { name: 'Rails & Django', note: 'SMTP relay or native SDK' },
  { name: 'Laravel', note: 'Mail driver package' },
  { name: 'Go, Rust, Elixir', note: 'First-party SDKs' },
  { name: 'Java & .NET', note: 'Maven and NuGet packages' },
  { name: 'WordPress', note: 'SMTP plugin config, five fields' },
]

const CARD_TITLE = 'text-[15.5px] font-semibold -tracking-[0.01em]'
const CARD_BODY = 'mt-1.5 text-[14px] leading-[1.6] text-muted'

function UseCasesPage() {
  return (
    <PageShell>
      <Section innerClassName="pt-[clamp(48px,6vw,80px)] pb-10">
        <Eyebrow>USE CASES</Eyebrow>
        <h1 className="ms-hero mt-4">Seven jobs. One API.</h1>
        <p className="mt-5 max-w-[62ch] text-[18px] leading-[1.55] text-muted">
          Each of these is code you’d otherwise spread across Resend, a marketing tool and a cron
          job. Here they are one deploy, on your own Workers. Pick the one you came for.
        </p>
        <AnchorPills className="mt-8" items={ANCHORS} label="Use cases on this page" />
      </Section>

      <Section id="otp" tone="card" innerClassName={PAD}>
        <Split>
          <div>
            <Eyebrow wide>01 · TIME-CRITICAL</Eyebrow>
            <h2 className="ms-display-2 mt-3.5">Login codes and password resets</h2>
            <p className="mt-4 max-w-[52ch] text-[16.5px] leading-[1.6] text-muted">
              The email that has to arrive in seconds or your support queue fills up. Send from the
              Worker that’s already handling the request — no cross-cloud hop, no cold start, median
              41ms to accept.
            </p>
            <CheckList
              items={[
                'Idempotency keys so a double-click can’t send twice',
                'Separate stream and tag, so a newsletter bounce can’t hurt it',
                // The artboard promised "time to inbox", which delivery events
                // cannot show: a 250 is an acceptance, not a placement.
                'Time-to-accept per provider, plus seed-based placement — not just “delivered”',
              ]}
            />
          </div>
          <CodeTabs
            items={[{ value: 'worker', label: 'worker', code: OTP_CODE }]}
            caption="env.MAIL.send()"
          />
        </Split>
      </Section>

      <Section id="receipts" innerClassName={PAD}>
        <Split>
          <CodeTabs
            items={[{ value: 'node', label: 'node', code: RECEIPT_CODE }]}
            caption="POST /v1/emails"
          />
          <div>
            <Eyebrow wide>02 · MUST BE KEPT</Eyebrow>
            <h2 className="ms-display-2 mt-3.5">Receipts, invoices and statements</h2>
            <p className="mt-4 max-w-[52ch] text-[16.5px] leading-[1.6] text-muted">
              Financial mail you may need to produce years later. Attachments and raw MIME live in
              your own R2 bucket, so retention is a lifecycle rule you write — not a plan tier
              someone sells you.
            </p>
            <CheckList
              items={[
                'Keep seven years of copies at $0.015/GB, no egress fees',
                'Batch up to 100 statements per call, queued and throttled',
                'Exact payload of any historical send, replayable',
              ]}
            />
            {/* The ceiling belongs to whichever transport carries the message,
                so stating one number would be wrong on two of the three. */}
            <p className="mt-6 text-[13.5px] leading-[1.6] text-muted-2">
              Attachment ceilings are per transport: Cloudflare Email Service caps a message at 5
              MiB (25 MiB only to verified destinations), Amazon SES accepts 40 MB.{' '}
              <a href="/docs#attachments" className="text-accent hover:text-ink">
                Attachment docs →
              </a>
            </p>
          </div>
        </Split>
      </Section>

      <Section id="notifications" tone="card" innerClassName={PAD}>
        <SectionHeader
          eyebrow="03 · HIGH VOLUME"
          title="Product notifications & digests"
          lede="Mentions, comments, alerts, weekly summaries. The volume that makes per-email pricing hurt, and the category where bundling saves both money and inboxes."
        />
        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="p-5">
            <div className={CARD_TITLE}>Digest windows in a Durable Object</div>
            <p className={CARD_BODY}>
              Collapse 40 “new comment” emails into one 9am digest per user with an alarm — instead
              of 40 sends and one unsubscribe.
            </p>
          </Card>
          <Card className="p-5">
            <div className={CARD_TITLE}>Per-user preferences</div>
            <p className={CARD_BODY}>
              Categories with their own opt-outs, honoured automatically at send time and in the
              hosted preference centre.
            </p>
          </Card>
          <Card className="p-5">
            <div className={CARD_TITLE}>Cost at scale</div>
            <p className={CARD_BODY}>
              A million notifications is ≈$363 on Cloudflare, or ≈$115 routed via SES.{' '}
              <a href="/stack#examples" className="text-accent hover:text-ink">
                The math →
              </a>
            </p>
          </Card>
        </div>
      </Section>

      <Section id="onboarding" innerClassName={PAD}>
        <Split>
          <div>
            {/* The artboard badged this "THE ONE RESEND CAN'T DO". Resend ships
                automations now, so the claim is false and the section stands on
                where the workflow runs instead of on a competitor's gap. */}
            <Eyebrow wide>04 · {OWNERSHIP_BADGE}</Eyebrow>
            <h2 className="ms-display-2 mt-3.5">Onboarding sequences &amp; win-backs</h2>
            <p className="mt-4 max-w-[52ch] text-[16.5px] leading-[1.6] text-muted">
              Day 0 welcome, day 2 nudge if they haven’t created a project, day 7 case study, stop
              the moment they convert.
            </p>
            <p className="mt-4 max-w-[52ch] text-[16.5px] leading-[1.6] text-muted">
              Here it’s a Cloudflare Workflow running in your own account: durable steps, day-long
              waits that cost nothing while sleeping, branching on your own events, and a live count
              at every node.{' '}
              <a href="/docs#automations" className="text-accent hover:text-ink">
                Automations docs →
              </a>
            </p>
          </div>
          <MonoListing caption="WORKFLOW · onboarding_v3" rows={FLOW_ROWS} />
        </Split>
      </Section>

      <Section id="broadcasts" tone="card" innerClassName={PAD}>
        <Split>
          <div>
            <Eyebrow wide>05 · MARKETING</Eyebrow>
            <h2 className="ms-display-2 mt-3.5">Newsletters &amp; product announcements</h2>
            <p className="mt-4 max-w-[52ch] text-[16.5px] leading-[1.6] text-muted">
              A visual editor your marketer can use, live segments your engineers can query, A/B
              tests that promote the winner on their own, and unsubscribe handling that keeps you
              the right side of CAN-SPAM.
            </p>
            <CheckList
              items={[
                'Create in the API or the editor — editable in both',
                'Throttle per minute, pause and resume mid-send',
                'One-click list-unsubscribe headers and a preference centre',
              ]}
            />
          </div>
          <Card className="p-6">
            <div className="flex items-center justify-between gap-3">
              <b className="text-[16px]">September changelog</b>
              <StatusBadge status="sending" size="sm" />
            </div>
            <Progress value={64} className="mt-4" />
            <div className="ms-num mt-2.5 font-mono text-[12px] text-muted-2">
              18,402 of 28,700 · 5,000/min
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line-soft pt-5 sm:grid-cols-4">
              <Metric size="sm" value="42.1%" label="Opens" />
              <Metric size="sm" value="9.8%" label="Clicks" />
              <Metric size="sm" value="0.11%" label="Unsub" />
              <Metric size="sm" value="B" label="Winner" />
            </div>
          </Card>
        </Split>
      </Section>

      <Section id="support" innerClassName={PAD}>
        <SectionHeader
          eyebrow="06 · INBOUND"
          title="Support inbox & reply-by-email"
          lede="Receiving is free on Cloudflare Email Routing, so “email us back” stops being a feature request. Threads, attachments and search live in a Durable Object per mailbox."
        />
        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="p-5">
            <div className={CARD_TITLE}>Sub-addressing</div>
            <p className={CARD_BODY}>
              <code className="font-mono text-[13px] text-accent">ticket+8f2@acme.dev</code> routes
              a reply straight back to the right object, with HMAC-signed headers.
            </p>
          </Card>
          <Card className="p-5">
            <div className={CARD_TITLE}>Parsed to JSON</div>
            <p className={CARD_BODY}>
              Headers, text, HTML, spam score and attachment keys — one webhook, no MIME parsing in
              your app.
            </p>
          </Card>
          <Card className="p-5">
            <div className={CARD_TITLE}>Ticketing without a ticket tool</div>
            <p className={CARD_BODY}>
              Assignment, status and canned replies are in the dashboard.{' '}
              <a href="/dashboard-tour" className="text-accent hover:text-ink">
                See it →
              </a>
            </p>
          </Card>
        </div>
      </Section>

      <Section id="agents" tone="card" innerClassName={PAD}>
        <Split>
          <div>
            <Eyebrow wide>07 · NEW</Eyebrow>
            <h2 className="ms-display-2 mt-3.5">Email for AI agents</h2>
            <p className="mt-4 max-w-[52ch] text-[16.5px] leading-[1.6] text-muted">
              Agents need a real address: to receive, to read a thread, and to send only when a
              human says yes. That is an MCP endpoint with nine tools, an API key for a credential,
              and a confirmation a person approves in the dashboard before anything leaves.
            </p>
            <CheckList
              items={[
                'Mark a mailbox Agent and it is the only one an agent can read',
                'Sending returns a confirmation first — you approve it, not the agent',
                'Works from Claude, Cursor or your own runtime',
              ]}
            />
          </div>
          <MonoListing caption="MCP · nine tools" rows={AGENT_ROWS} />
        </Split>
      </Section>

      <Section id="stacks" innerClassName={PAD}>
        <SectionHeader eyebrow="BY STACK" title="Wherever your code already runs" />
        <ul className="mt-10 grid list-none grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4 p-0">
          {STACKS.map((stack) => (
            <li key={stack.name} className="rounded-tile border border-line bg-card p-4">
              <b className="text-[15px]">{stack.name}</b>
              <span className="mt-1 block text-[13.5px] text-muted-2">{stack.note}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section innerClassName="pb-[clamp(56px,7vw,88px)]">
        <div className="rounded-block bg-ink p-[clamp(28px,4vw,48px)] text-paper">
          <div className="grid items-center gap-8 lg:grid-cols-[1.2fr_auto]">
            <div>
              <h2 className="ms-display-2">Start with one job. Keep the rest for later.</h2>
              <p className="mt-3.5 max-w-[48ch] text-[16.5px] leading-[1.6] text-on-dark-3">
                Deploy it, send an OTP, and the broadcasts, automations and inbound are already
                sitting there when you need them.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <DeployButton chip="1-CLICK" variant="accent" size="lg" />
              <Button asChild variant="ghost" className="text-on-dark-3 hover:text-paper">
                <a href="/docs#quickstart">or read the quickstart →</a>
              </Button>
            </div>
          </div>
        </div>
      </Section>
    </PageShell>
  )
}
