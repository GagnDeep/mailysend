import {
  Button,
  Card,
  Eyebrow,
  FlowConnector,
  FlowNode,
  Kbd,
  KeyValue,
  KeyValueList,
  LogRow,
  Metric,
  MonoChip,
  Progress,
  StatTile,
  StatusBadge,
  StatusDot,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { DeployButton } from '~/components/marketing/deploy.tsx'
import { PageShell, Section } from '~/components/marketing/page-shell.tsx'
import { breadcrumbSchema, pageHead } from '~/seo'

export const Route = createFileRoute('/dashboard-tour')({
  head: () =>
    pageHead({
      title: 'Product tour',
      description:
        'A click-by-click tour of the MailySend dashboard: overview, delivery logs, broadcasts, automations, the inbound mailbox and domains & keys — running on your own subdomain.',
      path: '/dashboard-tour',
      image: '/og/dashboard-tour.png',
      jsonLd: [breadcrumbSchema([{ name: 'Product tour', path: '/dashboard-tour' }])],
    }),
  component: DashboardTourPage,
})

const SPARK = [34, 52, 41, 68, 57, 79, 62, 88, 71, 94, 66, 81]

const PanelNote = ({ children }: { children: ReactNode }) => (
  <p className="mt-6 max-w-[70ch] text-[14.5px] leading-[1.6] text-muted">{children}</p>
)

const TileTitle = ({ children }: { children: ReactNode }) => (
  <div className="text-[15px] font-semibold -tracking-[0.01em]">{children}</div>
)

const BOUNCE_DETAIL = (
  <div className="flex flex-col gap-4">
    <div>
      <Eyebrow wide>REMOTE RESPONSE</Eyebrow>
      <pre className="mt-2 overflow-x-auto rounded-code bg-ink p-4 font-mono text-[12.5px] leading-[1.75] text-on-dark">
        {`550 5.1.1 <old@dead-domain.com>: Recipient address rejected:
      User unknown in virtual mailbox table`}
        <span className="block text-code-green">
          {'→ address added to suppression list · 12:41:08'}
        </span>
        <span className="block text-code-green">
          {'→ webhook email.bounced delivered · 200 · 88ms'}
        </span>
      </pre>
    </div>
    <span className="text-[13.5px] text-muted">
      Payload, headers, DKIM signature and every webhook attempt are one click away.
    </span>
  </div>
)

function DashboardTourPage() {
  return (
    <PageShell>
      <Section innerClassName="pt-[clamp(48px,6vw,80px)] pb-10">
        <Eyebrow>PRODUCT TOUR</Eyebrow>
        <h1 className="ms-hero mt-4">The dashboard, click by click.</h1>
        <p className="mt-5 max-w-[64ch] text-[18px] leading-[1.55] text-muted">
          The console you’d expect from Resend, plus broadcasts, automations and an inbox — on your
          own subdomain after the deploy. Six screens, no hidden menus. Click the tabs.
        </p>
      </Section>

      <Section id="tour" innerClassName="pb-[clamp(48px,6vw,80px)]">
        <div className="overflow-hidden rounded-panel border border-line bg-card shadow-md">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
            <span
              aria-hidden="true"
              className="grid size-6 place-items-center rounded-sm bg-accent font-mono text-[12px] font-bold text-white"
            >
              M
            </span>
            <span className="font-mono text-[13px] text-ink">mail.acme.dev</span>
            <span className="ml-auto flex items-center gap-2 text-[12.5px] text-muted-2">
              <StatusDot tone="positive" size={7} />
              your Cloudflare account
            </span>
          </div>

          {/*
            Radix Tabs rather than the artboard's bare `<button>`s: the panels
            are only reachable by keyboard at all once the strip is a real
            tablist with arrow-key roving focus.
          */}
          <Tabs defaultValue="overview">
            <TabsList className="px-3.5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
              <TabsTrigger value="broadcasts">Broadcasts</TabsTrigger>
              <TabsTrigger value="flows">Automations</TabsTrigger>
              <TabsTrigger value="inbox">Inbound</TabsTrigger>
              <TabsTrigger value="domains">Domains &amp; keys</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="p-[clamp(18px,3vw,28px)]">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
                <StatTile label="SENT TODAY" value="14,208" />
                <StatTile label="DELIVERED" value="99.4%" intent="positive" />
                <StatTile label="BOUNCED" value="86" />
                <StatTile label="P50 API" value="41ms" />
                <StatTile label="CF SPEND · MTD" value="$38.12" />
              </div>
              <div
                aria-hidden="true"
                className="mt-5 flex h-[92px] items-end gap-1.5 rounded-tile border border-line-soft bg-tint p-3"
              >
                {SPARK.map((height) => (
                  <span
                    key={height}
                    className="flex-1 rounded-chip bg-neutral-bar"
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card className="p-4">
                  <TileTitle>Top template</TileTitle>
                  <p className="mt-1.5 text-[13.5px] text-muted">
                    <code className="font-mono text-accent">tpl_login</code> · 8,411 sent · 99.8%
                    delivered
                  </p>
                </Card>
                <Card className="p-4">
                  <TileTitle>Needs attention</TileTitle>
                  <p className="mt-1.5 text-[13.5px] text-muted">
                    Outlook placement −1.8pt ·{' '}
                    <a href="/analytics" className="text-accent hover:text-ink">
                      investigate
                    </a>
                  </p>
                </Card>
                <Card className="p-4">
                  <TileTitle>Queue depth</TileTitle>
                  <p className="mt-1.5 text-[13.5px] text-muted">0 waiting · last drain 3s ago</p>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="logs" className="p-[clamp(18px,3vw,28px)]">
              <div className="flex flex-wrap gap-2">
                <MonoChip tone="accent" size="sm">
                  status: bounced
                </MonoChip>
                <MonoChip size="sm">tag: digest</MonoChip>
                <MonoChip size="sm">last 7 days</MonoChip>
                <MonoChip size="sm">+ filter</MonoChip>
              </div>
              <div className="mt-4 overflow-hidden rounded-tile border border-line-soft bg-card">
                <LogRow
                  status="bounced"
                  subject="Weekly digest"
                  recipient="old@dead-domain.com"
                  timestamp="12:41:08"
                  defaultExpanded
                  details={BOUNCE_DETAIL}
                />
                <LogRow
                  status="bounced"
                  subject="Weekly digest"
                  recipient="jamie@gone.io"
                  timestamp="12:41:07"
                />
                <LogRow
                  status="temporary_failure"
                  subject="Weekly digest"
                  recipient="full@mailbox.net"
                  timestamp="12:40:52"
                />
              </div>
              <PanelNote>
                Logs are your R2 bucket and your Analytics Engine dataset — retention is a config
                value, and export is one command.
              </PanelNote>
            </TabsContent>

            <TabsContent value="broadcasts" className="p-[clamp(18px,3vw,28px)]">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <b className="text-[15.5px]">September changelog</b>
                    <StatusBadge status="sending" size="sm" />
                  </div>
                  <Progress value={64} className="mt-4" />
                  <div className="ms-num mt-2.5 font-mono text-[12px] text-muted-2">
                    18,402 of 28,700 · 5,000/min · pause anytime
                  </div>
                  <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line-soft pt-4">
                    <Metric size="sm" value="42.1%" label="Opens" />
                    <Metric size="sm" value="9.8%" label="Clicks" />
                    <Metric size="sm" value="0.11%" label="Unsub" />
                  </div>
                </Card>
                <Card className="p-5">
                  <Eyebrow wide>A/B TEST · SUBJECT</Eyebrow>
                  <div className="mt-4 flex flex-col gap-3">
                    <div>
                      <div className="flex justify-between gap-3 text-[13.5px]">
                        <span>A · “September changelog”</span>
                        <span className="ms-num font-mono text-muted">38.4%</span>
                      </div>
                      <Progress value={38.4} tone="neutral" className="mt-1.5" />
                    </div>
                    <div>
                      <div className="flex justify-between gap-3 text-[13.5px]">
                        <span>B · “What shipped in September”</span>
                        <span className="ms-num font-mono text-positive">45.9%</span>
                      </div>
                      <Progress value={45.9} tone="positive" className="mt-1.5" />
                    </div>
                  </div>
                  <p className="mt-4 text-[13px] text-muted-2">
                    B promoted automatically to the remaining 80%.
                  </p>
                </Card>
                <Card className="p-5">
                  <Eyebrow wide>AUDIENCE · LIVE SEGMENT</Eyebrow>
                  <pre className="mt-4 overflow-x-auto rounded-code bg-ink p-4 font-mono text-[12.5px] leading-[1.75] text-on-dark">
                    {`plan = 'pro'
AND last_open < 30d
AND country IN ('DE','FR')`}
                  </pre>
                  <p className="mt-4 text-[13px] text-muted-2">
                    28,700 contacts · recomputed continuously in D1
                  </p>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="flows" className="p-[clamp(18px,3vw,28px)]">
              <div className="mx-auto max-w-[640px]">
                <FlowNode
                  kicker="TRIGGER"
                  title="user.signed_up"
                  meta="from your app's webhook · 1,204 entered this month"
                />
                <FlowConnector arrow />
                <FlowNode kicker="SEND" title="tpl_welcome" meta="delivered 99.7% · opened 71%" />
                <FlowConnector arrow />
                <FlowNode
                  kicker="WAIT"
                  title="2 days"
                  meta="durable step on Cloudflare Workflows · 318 waiting now"
                />
                <FlowConnector arrow />
                <FlowNode
                  kicker="BRANCH"
                  title="contact.projects == 0"
                  tone="accent"
                  meta={
                    <>
                      → send <code className="font-mono text-accent-on-dark">tpl_nudge</code> (412)
                      · else exit (792)
                    </>
                  }
                />
              </div>
              <PanelNote>
                Waits are alarms, not cron jobs — a two-day step costs nothing while it sleeps, and
                the whole flow runs on Cloudflare Workflows inside your own account.
              </PanelNote>
            </TabsContent>

            <TabsContent value="inbox" className="p-[clamp(18px,3vw,28px)]">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
                <Card className="p-4">
                  <div className="font-mono text-[12.5px] text-muted">support@acme.dev</div>
                  <ul className="mt-3 flex list-none flex-col gap-1 p-0">
                    <li className="rounded-md bg-accent-soft p-3">
                      <div className="text-[14px] font-semibold">Can’t log in after reset</div>
                      <div className="mt-0.5 text-[12.5px] text-muted-2">
                        ana@customer.io · 4m ago · 3 messages
                      </div>
                    </li>
                    <li className="rounded-md p-3">
                      <div className="text-[14px] font-semibold">Invoice question</div>
                      <div className="mt-0.5 text-[12.5px] text-muted-2">jo@studio.io · 1h ago</div>
                    </li>
                    <li className="rounded-md p-3">
                      <div className="text-[14px] font-semibold">Feature request: SSO</div>
                      <div className="mt-0.5 text-[12.5px] text-muted-2">
                        sam@bigco.com · 3h ago
                      </div>
                    </li>
                  </ul>
                </Card>
                <Card className="p-5">
                  <div className="text-[16px] font-semibold">Can’t log in after reset</div>
                  <p className="mt-2.5 text-[14.5px] leading-[1.6] text-muted">
                    I clicked the reset link twice and now both codes say expired. Attaching a
                    screenshot.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <MonoChip size="sm">screenshot.png · R2</MonoChip>
                    <MonoChip size="sm" tone="positive">
                      spam 0.02
                    </MonoChip>
                    <MonoChip size="sm">thr_5Nq</MonoChip>
                  </div>
                  <div className="mt-5 rounded-tile border border-accent-border bg-accent-soft p-4">
                    <Eyebrow wide className="text-warning">
                      AGENT DRAFT · NEEDS YOUR OK
                    </Eyebrow>
                    <p className="mt-2 text-[14px] leading-[1.6] text-ink">
                      “Both links expire after one use — I’ve sent a fresh code and extended it to
                      30 minutes…”
                    </p>
                    <div className="mt-4 flex gap-2">
                      <Button size="sm">Send reply</Button>
                      <Button size="sm" variant="outline">
                        Edit
                      </Button>
                    </div>
                  </div>
                </Card>
              </div>
              <PanelNote>
                Inbound is free on Cloudflare Email Routing. Each mailbox is its own Durable Object
                with SQLite, so threads, search and attachments stay isolated — and an agent can
                work the queue over MCP with confirmation before anything sends.
              </PanelNote>
            </TabsContent>

            <TabsContent value="domains" className="p-[clamp(18px,3vw,28px)]">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <b className="text-[15.5px]">acme.dev</b>
                    <StatusBadge status="verified" size="sm" />
                  </div>
                  <KeyValueList className="mt-4">
                    <KeyValue rule label="SPF" value="pass" mono intent="positive" />
                    <KeyValue rule label="DKIM (2048)" value="pass" mono intent="positive" />
                    <KeyValue rule label="DMARC" value="p=quarantine" mono />
                    <KeyValue rule label="Provider" value="cloudflare" mono />
                    <KeyValue label="Failover" value="ses" mono />
                  </KeyValueList>
                </Card>
                <Card className="p-5">
                  <Eyebrow wide>API KEYS</Eyebrow>
                  <ul className="mt-4 flex list-none flex-col gap-3 p-0">
                    <li>
                      <div className="text-[14px] font-semibold">prod worker</div>
                      <div className="mt-0.5 font-mono text-[12px] text-muted-2">
                        ms_live_••••4f21 · sending only · acme.dev
                      </div>
                    </li>
                    <li>
                      <div className="text-[14px] font-semibold">ci</div>
                      <div className="mt-0.5 font-mono text-[12px] text-muted-2">
                        ms_test_••••9ab0 · full access · sandbox
                      </div>
                    </li>
                    <li>
                      <div className="text-[14px] font-semibold">analytics reader</div>
                      <div className="mt-0.5 font-mono text-[12px] text-muted-2">
                        ms_live_••••77c3 · read only
                      </div>
                    </li>
                  </ul>
                </Card>
                <Card className="p-5">
                  <Eyebrow wide>ACCESS &amp; AUDIT</Eyebrow>
                  <ul className="mt-4 flex list-none flex-col gap-2 p-0 text-[13.5px] text-muted">
                    <li>SSO through Cloudflare Access · Google + Okta</li>
                    <li>Roles: owner, developer, marketer, read-only</li>
                    <li>Audit log of every key, template and send</li>
                    <li>
                      <a href="/docs#auth" className="text-accent hover:text-ink">
                        Key scoping docs →
                      </a>
                    </li>
                  </ul>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </Section>

      <Section id="principles" innerClassName="pb-[clamp(56px,7vw,88px)]">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="p-5">
            <Eyebrow wide>THE RULE WE DESIGN TO</Eyebrow>
            <div className="mt-2 text-[15px] font-semibold -tracking-[0.01em]">
              Never a dead end
            </div>
            <p className="mt-1.5 text-[14px] leading-[1.6] text-muted">
              Every failure state names the cause, the fix, and links to the doc. Every empty state
              has one obvious next action. No screen ends in “contact support”.
            </p>
          </Card>
          <Card className="p-5">
            <Eyebrow wide>SHORTCUTS</Eyebrow>
            <div className="mt-2 text-[15px] font-semibold -tracking-[0.01em]">Keyboard first</div>
            <p className="mt-1.5 text-[14px] leading-[1.6] text-muted">
              <Kbd keys={['⌘', 'K']} /> jumps to any message, domain, template or doc page.{' '}
              <Kbd keys={['G', 'L']} /> for logs, <Kbd keys={['G', 'B']} /> for broadcasts.
            </p>
          </Card>
          <Card className="p-5">
            <Eyebrow wide>YOUR INSTANCE</Eyebrow>
            <div className="mt-2 text-[15px] font-semibold -tracking-[0.01em]">
              Signed in with Cloudflare Access
            </div>
            <p className="mt-1.5 text-[14px] leading-[1.6] text-muted">
              The dashboard sits behind your Access policy, so there’s no extra password to manage.{' '}
              <a href="/sign-in" className="text-accent hover:text-ink">
                See the sign-in screen →
              </a>
            </p>
          </Card>
        </div>

        <div className="mt-10 rounded-block bg-ink p-[clamp(28px,4vw,48px)] text-paper">
          <div className="grid items-center gap-8 lg:grid-cols-[1.2fr_auto]">
            <div>
              <h2 className="ms-display-2">This, on your own domain, today.</h2>
              <p className="mt-3.5 max-w-[46ch] text-[16.5px] leading-[1.6] text-on-dark-3">
                One click provisions it in your Cloudflare account. Nothing to cancel later.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <DeployButton chip="1-CLICK" variant="accent" size="lg" />
              <Button asChild variant="ghost" className="text-on-dark-3 hover:text-paper">
                <a href="/docs#quickstart">or read the quickstart first →</a>
              </Button>
            </div>
          </div>
        </div>
      </Section>
    </PageShell>
  )
}
