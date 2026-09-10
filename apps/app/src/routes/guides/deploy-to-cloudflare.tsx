// biome-ignore-all lint/complexity/noUselessFragments: a single-element FactTable cell must stay
// wrapped. Unwrapped, the row literal trips useJsxKeyInIterable — an error rather than an info,
// and a false one, since FactTable keys its own cells from the row key and the column name.
import { Callout, StepCard, Terminal } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Contrast, FactTable, Gotcha, Takeaway } from '~/components/marketing/guide-blocks.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Lede, Mono } from '~/components/marketing/prose.tsx'
import { DEPLOY_URL } from '~/seo'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'deploy-to-cloudflare'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/deploy-to-cloudflare')({
  head: () => guideHead(SLUG),
  component: Page,
})

const RESOURCES: Array<[string, string, string]> = [
  [
    'Workers',
    'The application itself',
    'One script, serving the API, the dashboard and this site. It also holds every queue consumer, the email() handler and three cron triggers.',
  ],
  [
    'Queues',
    'Sends, events and webhooks',
    'Twelve, counting the dead-letter queue — listed below.',
  ],
  [
    'Durable Objects',
    'Coordination',
    'Ten classes, all SQLite-backed — broadcast ranges and counters, sending domains, mailboxes, segments, schedule shards, webhook endpoints and automation runs.',
  ],
  ['D1', 'The database', 'Contacts, messages, domains, keys. SQLite, in your account.'],
  [
    'KV',
    'Hot lookups',
    'Two namespaces. CACHE holds link destinations and cached configuration; SUPPRESSIONS is separate on purpose, because it is permanent and must never share an eviction story with a 300-second key cache.',
  ],
  ['R2', 'Attachments and inbound', 'Raw messages, attachments and the long-term NDJSON archive.'],
  [
    'Workflows',
    'Automations',
    'Long-running, durable multi-step programs. The driver is chosen from the runtime’s own capability rather than from configuration, so it is Workflows here and the scheduler on Node.',
  ],
  [
    'Analytics Engine',
    'Chart queries',
    'Left out of the deploy unless you ask for it. The datasets need no provisioning; they are created on first write.',
  ],
]

/** Batch size, batch timeout and retries are `wrangler.jsonc`'s own consumer block. */
const QUEUES: Array<[string, string, string, string]> = [
  ['ms-send', 'SEND_QUEUE', '10 / 5s', '5'],
  ['ms-send-bulk', 'SEND_BULK_QUEUE', '25 / 10s', '5'],
  ['ms-events-cf', 'consumer only', '100 / 5s', '3'],
  ['ms-events-norm', 'EVENTS_QUEUE', '100 / 5s', '3'],
  ['ms-webhooks', 'WEBHOOKS_QUEUE', '10 / 2s', '6'],
  ['ms-broadcast-pages', 'BROADCAST_QUEUE', '5 / 2s', '5'],
  ['ms-inbound', 'INBOUND_QUEUE', '5 / 5s', '3'],
  ['ms-segments', 'SEGMENTS_QUEUE', '20 / 10s', '4'],
  ['ms-automation-triggers', 'AUTOMATION_QUEUE', '50 / 5s', '4'],
  ['ms-dmarc', 'DMARC_QUEUE', '1 / 30s', '3'],
  ['ms-export', 'EXPORT_QUEUE', '1 / 30s', '3'],
  ['ms-dlq', 'dead letter for all eleven', 'no consumer', '—'],
]

const FIRST_BOOT: Array<[string, string, string]> = [
  ['Migrations', 'Runs every migration the instance does not already have.', 'Idempotent'],
  [
    'Workspace + API key',
    'Creates the workspace and prints one bootstrap API key.',
    'Printed once — only the SHA-256 is stored',
  ],
  [
    'Claim code',
    'Mints and prints one claim code, the lock on /setup.',
    'Printed once — only the SHA-256 is stored',
  ],
  [
    'The two undefaultable values',
    'Resolves the signing secret and the public URL, then persists them.',
    'Yes — both are learned or generated, not configured',
  ],
]

const FAILURES: Array<[string, ReactNode, ReactNode]> = [
  [
    'A binding error during provisioning, not a billing message',
    <>The account is not on Workers Paid. Durable Objects and Queues both require it.</>,
    <>
      Upgrade the account. This is first because it is cheapest to check and looks like anything but
      itself.
    </>,
  ],
  [
    'Every queue collides at once',
    <>
      A second MailySend deployment in the same account. A queue has exactly one consumer and queue
      names are account-global.
    </>,
    <>
      Deploy the second one to a different Cloudflare account, or remove the first Worker’s
      consumers.
    </>,
  ],
  [
    'A failed deploy naming a queue or namespace, after a clean build',
    <>
      The build token cannot create resources. <Mono>ensure-resources.mjs</Mono> does not fail the
      build when a creation is refused; it leaves the id out and lets wrangler try.
    </>,
    <>
      Check the token carries <Mono>Queues:Edit</Mono>.
    </>,
  ],
  [
    'You need to enable Analytics Engine … [code: 10089]',
    <>
      The bindings were included — <Mono>MS_ANALYTICS_ENGINE=1</Mono> — on an account where the
      feature has not been enabled.
    </>,
    <>Enable it on the account, or build without that variable and let D1 answer the charts.</>,
  ],
  [
    'The deploy succeeds and the first send fails',
    <>Email Sending is not enabled on the account.</>,
    <>
      Cloudflare Email Service is in beta, Workers Paid only, with a daily quota that ramps with
      reputation and is not published — MailySend learns that ceiling rather than assuming one.
    </>,
  ],
]

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You have a Worker running in your own Cloudflare account, with its own database, queues
          and storage, and nothing shared with anyone else. It is not yet claimed and it cannot yet
          send, because both of those need a decision from you rather than a default —{' '}
          <a
            href="/guides/claim-your-instance"
            className="text-accent underline underline-offset-4"
          >
            claiming the instance
          </a>{' '}
          is the next five minutes.
        </p>
      }
    >
      {{
        'what-gets-created': (
          <>
            <Lede>
              The deploy creates eight kinds of resource. All of them are in your account, billed to
              you, visible in your dashboard, and deletable by you.
            </Lede>
            <Takeaway>
              There is no MailySend-operated server anywhere in the path — which is the argument for
              this product, and also why nobody here can recover your data for you if you delete it.
            </Takeaway>
            <FactTable
              columns={['Product', 'What it holds', 'Notes']}
              rows={RESOURCES}
              monoFirst={false}
            />
            <FactTable
              columns={['Queue', 'Producer binding', 'Batch / timeout', 'Retries']}
              rows={QUEUES}
              caption="ms-events-cf has no producer here because Cloudflare itself publishes to it. Every consumer dead-letters to ms-dlq, which has no consumer of its own."
            />
            <h3 className="mt-7 mb-2 text-[15px] font-semibold text-ink">
              Who actually creates them
            </h3>
            <Gotcha title="Wrangler validates every binding before it uploads">
              A missing resource does not degrade the Worker — it fails the deploy, one resource at
              a time, each failure after a multi-megabyte upload:{' '}
              <Mono>{'Queue "ms-events-cf" does not exist'}</Mono>, then a KV namespace error, then
              the next. That is why provisioning cannot be left to the deploy.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Not the button, mostly.</strong> The Deploy to Cloudflare
              flow auto-creates the bindings it knows how to auto-create — KV, D1, R2 — and does not
              create queues at all. So <Mono>build:cf</Mono> ends by running{' '}
              <Mono>scripts/ensure-resources.mjs</Mono>, which creates the twelve queues, the R2
              bucket, the D1 database and the two KV namespaces, then writes the generated D1 and KV
              ids into the config wrangler deploys.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                It matches by name and creates only what is missing
              </strong>
              , so every build after the first is a no-op. That property is load-bearing rather than
              tidy: re-creating <Mono>SUPPRESSIONS</Mono> instead of reusing it would silently empty
              the one list that must never be lost. It also refuses to run outside CI — only inside
              Workers Builds (<Mono>WORKERS_CI=1</Mono>) or under <Mono>MS_ENSURE_RESOURCES=1</Mono>{' '}
              — so building locally never creates resources in your account as a side effect of a
              build.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">There is no id in the committed config.</strong>{' '}
              <Mono>apps/app/wrangler.jsonc</Mono> carries no <Mono>database_id</Mono> and no KV{' '}
              <Mono>id</Mono>, because a generated id cannot be committed and a literal placeholder
              is worse than omitting one — it passes JSON validation and then fails the deploy with{' '}
              <Mono>{`KV namespace 'PLACEHOLDER' is not valid`}</Mono>. Omitted, the resource gets
              created and its real id written in. If the build token cannot create something, the
              script leaves the id out rather than failing the build, which is exactly the shape
              wrangler’s own provisioning expects, so the deploy gets a second attempt at it.
            </p>
            <Callout title="ANALYTICS ENGINE IS OPT-IN">
              The dataset bindings are dropped from the generated config unless you build with{' '}
              <Mono>MS_ANALYTICS_ENGINE=1</Mono>, because an account that has not enabled Analytics
              Engine fails the entire deploy with{' '}
              <Mono>{'You need to enable Analytics Engine … [code: 10089]'}</Mono> after the upload.
              The binding is not load-bearing: Analytics Engine is the hot query layer for charts —
              sampled under load, three months of retention — while every count of record comes from
              D1, and the events consumer already treats the binding as optional.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              At rest — nothing sending — this costs the Workers Paid floor and very little else.
              The{' '}
              <a
                href="/guides/what-100k-emails-costs"
                className="text-accent underline underline-offset-4"
              >
                cost guide
              </a>{' '}
              prices it properly, including the point below which a vendor’s free tier is genuinely
              the cheaper answer.
            </p>
          </>
        ),
        'run-it': (
          <>
            <Lede>Two paths to the same place.</Lede>
            <Takeaway>
              The button is faster; the commands let you watch each resource appear, which is worth
              doing once if you are going to operate this.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'Deploy to Cloudflare button',
                  tone: 'good',
                  points: [
                    'Forks the repository into your GitHub account and connects it to Workers Builds',
                    'Nothing to fill in first — every variable has a default or is generated on first boot',
                    <>
                      Uses Cloudflare’s own build token, so no <Mono>CLOUDFLARE_API_TOKEN</Mono> of
                      your own
                    </>,
                  ],
                },
                {
                  label: 'Wrangler, by hand',
                  tone: 'neutral',
                  points: [
                    <>
                      Needs <Mono>CLOUDFLARE_ACCOUNT_ID</Mono> and <Mono>CLOUDFLARE_API_TOKEN</Mono>{' '}
                      in your shell
                    </>,
                    <>
                      The token needs <Mono>Queues:Edit</Mono>, plus{' '}
                      <Mono>Workers Scripts:Edit</Mono>, <Mono>D1:Edit</Mono>,{' '}
                      <Mono>Workers KV:Edit</Mono> and <Mono>Workers R2:Edit</Mono>
                    </>,
                    'Every call is idempotent, so re-running on a provisioned account prints “exists” rather than an error',
                  ],
                },
              ]}
            />
            <div className="flex flex-col gap-3.5">
              <StepCard step={1} title="Deploy" variant="rule">
                <p className="mt-1.5 mb-2 text-[15px] leading-[1.65] text-muted">
                  The one-click deploy builds and deploys, which is where the tables above actually
                  get provisioned. <Mono>.env.example</Mono> carries no keys at all on purpose:
                  Cloudflare builds the deploy form from that file, shows key names without their
                  comments, stores every answer as a secret and does not prefill from the file — so
                  a key with a perfectly good default would render as a blank, masked,
                  mandatory-looking password box.
                </p>
                <a
                  href={DEPLOY_URL}
                  rel="noreferrer"
                  className="inline-block rounded-pill bg-ink px-5 py-2.5 text-[14px] font-semibold text-paper no-underline"
                >
                  Deploy to Cloudflare
                </a>
              </StepCard>
              <StepCard step={2} title="Or do it yourself" variant="rule">
                <Terminal
                  className="mt-1.5"
                  lines={[
                    { kind: 'command', text: 'git clone https://github.com/GagnDeep/mailysend' },
                    { kind: 'command', text: 'pnpm install' },
                    {
                      kind: 'command',
                      text: 'export CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=...',
                    },
                    { kind: 'command', text: 'npx mailysend provision' },
                    { kind: 'command', text: 'pnpm deploy:cf' },
                  ]}
                />
                <p className="mt-2 mb-0 text-[14px] leading-[1.6] text-muted-2">
                  <Mono>provision</Mono> is the interesting one: it creates the queues and the
                  bucket and checks that the token can read the Analytics Engine datasets.
                </p>
              </StepCard>
              <StepCard step={3} title="Check it answered" variant="rule">
                <Terminal
                  className="mt-1.5"
                  caption="GET /v1/health"
                  lines={[
                    { kind: 'command', text: 'curl https://your-worker.workers.dev/v1/health' },
                    { kind: 'output', text: '{ "status": "operational",' },
                    { kind: 'output', text: '  "mode": "single",' },
                    { kind: 'output', text: '  "version": "…",' },
                    { kind: 'output', text: '  "database": "ok",' },
                    { kind: 'output', text: '  "time": "2026-09-11T09:14:02.118Z" }' },
                  ]}
                />
                <p className="mt-2 mb-0 text-[14px] leading-[1.6] text-muted-2">
                  Deliberately unauthenticated, because a load balancer cannot hold a key. It runs a{' '}
                  <Mono>SELECT 1</Mono> against D1 and answers <Mono>200</Mono> when that works;
                  otherwise the status is <Mono>degraded</Mono>, the <Mono>database</Mono> field
                  carries the driver’s own error text, and the response code is <Mono>503</Mono> so
                  that a health check fails rather than reads a body nobody looks at.
                </p>
              </StepCard>
            </div>
            <h3 className="mt-7 mb-2 text-[15px] font-semibold text-ink">
              The commands Workers Builds guesses
            </h3>
            <FactTable
              columns={['Set this', 'To this', 'Because']}
              rows={[
                [
                  'Build command',
                  <>
                    <Mono>pnpm run build:cf</Mono>
                  </>,
                  <>
                    <Mono>build:node</Mono> emits a socket server, not a Worker.
                  </>,
                ],
                [
                  'Deploy command',
                  <>
                    <Mono>npx wrangler deploy -c apps/app/.output-cf/server/wrangler.json</Mono>
                  </>,
                  <>
                    That is the config Vite <em>generates</em> next to the bundle.{' '}
                    <Mono>apps/app/wrangler.jsonc</Mono> is the input to that generation, and
                    deploying it directly points <Mono>main</Mono> at TypeScript source.
                  </>,
                ],
              ]}
              monoFirst={false}
              caption="Workers → your Worker → Settings → Builds. They work without being set; this is what they are."
            />
            <Gotcha title="pnpm deploy is a pnpm subcommand">
              Cloudflare proposes <Mono>pnpm deploy</Mono>, and the built-in always wins, so a
              script of that name never runs — hence <Mono>ERR_PNPM_INVALID_DEPLOY_TARGET</Mono>{' '}
              rather than anything about this repository. No script here is called{' '}
              <Mono>deploy</Mono> any more for exactly that reason.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The other guess fails just as obliquely.</strong>{' '}
              Cloudflare then proposes a bare <Mono>npx wrangler deploy</Mono> from the repository
              root, where wrangler cannot tell which workspace package is the Worker and stops
              before doing anything. So <Mono>build:cf</Mono> ends by writing a root{' '}
              <Mono>wrangler.json</Mono> — a copy of the generated config with its path fields
              rewritten, regenerated on every build and gitignored, so bindings still have one
              source of truth.
            </p>
          </>
        ),
        'first-boot': (
          <>
            <Lede>
              The first request to a fresh instance does four things, and one of them you have to be
              watching for.
            </Lede>
            <FactTable
              columns={['On first request', 'What happens', 'Recoverable later?']}
              rows={FIRST_BOOT}
              monoFirst={false}
            />
            <Gotcha title="Read the log once">
              The API key and the claim code are printed exactly once each, because only their
              SHA-256 hashes are ever stored; there is no screen anywhere in the product that can
              show either of them again. On Workers they land in <Mono>wrangler tail</Mono> and the
              Worker’s <em>Logs</em> tab. Everything else on this page can be done later — this is
              the one thing that has to be done now.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The public URL is learned, not configured.</strong>{' '}
              Nothing pins it in <Mono>wrangler.jsonc</Mono> on purpose: a placeholder hostname
              there would mint every tracking pixel, unsubscribe link and canonical tag against a
              domain nobody owns. Instead the first non-local request’s origin is stored and reused,
              so a deployment first reached on <Mono>workers.dev</Mono> and later on a custom domain
              adopts the custom domain, and a <Mono>localhost</Mono> origin is never stored — which
              is what stops a development request poisoning a real deployment.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The signing secret is generated and kept.</strong> If{' '}
              <Mono>MS_SECRET</Mono> is unset, a 32-byte value is generated on first boot and
              written to the <Mono>settings</Mono> table under a conditional insert, so two isolates
              racing on a cold deployment adopt one value rather than overwriting each other’s.
              Setting it explicitly is still the better posture — it keeps the signing key out of
              the database and lets you rotate it — but it is not something to solve before you can
              deploy.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">What every pre-auth screen reads.</strong>{' '}
              <Mono>GET /v1/instance</Mono> is unauthenticated and reports whether the instance is
              claimed, whether a claim code is required, whether the claim is reserved to an
              address, which sign-in doors are actually open, and whether any domain is verified. It
              carries no secrets and no per-address facts, which is the point: a door is only drawn
              on the page when it is open, and a button that answers 501 is worse than no button.
            </p>
            <Callout title="THE CLAIM WINDOW IS OPEN">
              Until someone claims it, a freshly deployed instance will accept a claim from whoever
              reaches <Mono>/setup</Mono> first — subject to the claim code, which is the lock that
              makes a public URL safe before you get to it. If you would rather narrow it to one
              address instead, set <Mono>MS_OWNER_EMAIL</Mono> with <Mono>wrangler secret put</Mono>{' '}
              (it is deliberately not on the deploy form). When it is set, the code is not asked for
              — one lock rather than two — and{' '}
              <a
                href="/guides/claim-your-instance"
                className="text-accent underline underline-offset-4"
              >
                the next guide
              </a>{' '}
              covers the whole flow.
            </Callout>
            <Gotcha title="Decide the hostname before you register a passkey">
              A passkey is bound to a hostname, and because the public URL is learned, an instance
              that starts on <Mono>*.workers.dev</Mono> and later answers on your own domain changes
              the WebAuthn relying party — every passkey registered on the old host stops working
              there. The instance stores the hostname each credential was registered for and says so
              rather than looking broken, and the fix is a recovery code plus a re-registration. If
              you already know which hostname this deployment will live on, set{' '}
              <Mono>MS_PUBLIC_URL</Mono> before anybody enrols a credential.
            </Gotcha>
          </>
        ),
        'what-is-not-done': (
          <>
            <Lede>Four things the deploy deliberately leaves to you.</Lede>
            <Takeaway>
              Each one is left undone because automating it would make the system less trustworthy
              rather than more convenient.
            </Takeaway>
            <div className="grid gap-3 md:grid-cols-2">
              <StepCard step={1} title="Your DNS is not touched" variant="tile">
                <p className="mt-1.5 mb-0 text-[14.5px] leading-[1.6] text-muted">
                  Publishing SPF, DKIM and DMARC records changes how the entire internet treats mail
                  from your domain. A deploy button that silently rewrote your zone would be doing
                  something you cannot easily inspect or undo, at exactly the moment you have the
                  least context.{' '}
                  <a
                    href="/guides/spf-dkim-dmarc"
                    className="text-accent underline underline-offset-4"
                  >
                    The DNS guide
                  </a>{' '}
                  generates your records and explains each one.
                </p>
              </StepCard>
              <StepCard step={2} title="No domain is verified" variant="tile">
                <p className="mt-1.5 mb-0 text-[14.5px] leading-[1.6] text-muted">
                  Verification is a claim that you control a domain, and pre-verifying one would
                  make the claim meaningless. It has a visible consequence you should expect rather
                  than debug: until a domain is verified there is nothing to send an email with, so{' '}
                  <Mono>POST /v1/auth/otp</Mono> answers{' '}
                  <Mono>202 {'{"status":"unavailable"}'}</Mono> and the sign-in page does not offer
                  emailed codes at all.
                </p>
              </StepCard>
              <StepCard step={3} title="No transport is configured" variant="tile">
                <p className="mt-1.5 mb-0 text-[14.5px] leading-[1.6] text-muted">
                  Which service carries your mail has real consequences for cost, attachment size
                  and what event data you get back — Cloudflare caps a message at 5 MiB where SES
                  allows 40 MB, to name the one that surprises people. Defaulting it would be
                  picking for you and hoping you never looked. See{' '}
                  <a
                    href="/guides/choose-a-sending-transport"
                    className="text-accent underline underline-offset-4"
                  >
                    choosing a transport
                  </a>
                  .
                </p>
              </StepCard>
              <StepCard step={4} title="Receiving is not wired up" variant="tile">
                <p className="mt-1.5 mb-0 text-[14.5px] leading-[1.6] text-muted">
                  Sending and receiving are independent setups on the same domain, and receiving is
                  configured in two places: Email Routing in the Cloudflare dashboard needs a
                  catch-all rule whose action is <em>Send to a Worker</em> pointed at this script,
                  and the domain’s Receiving tab in MailySend needs a mailbox.
                </p>
              </StepCard>
            </div>
            <Gotcha title="I bound the catch-all and nothing arrived">
              Doing only the Cloudflare half is the usual cause. Mail for an address with no mailbox
              and no catch-all is refused at the door with <Mono>550 5.1.1 No such mailbox</Mono>,
              which is the honest answer to a typo and tells a spammer nothing.{' '}
              <em>Check receiving</em> on the domain resolves the MX and names which half is
              missing.
            </Gotcha>
          </>
        ),
        troubleshoot: (
          <>
            <Lede>
              Five failures account for nearly every deploy that does not come up, cheapest to check
              first.
            </Lede>
            <Takeaway>
              The last two are the ones whose error messages point somewhere other than the cause.
            </Takeaway>
            <FactTable columns={['Symptom', 'Cause', 'Fix']} rows={FAILURES} monoFirst={false} />
            <h3 className="mt-7 mb-2 text-[15px] font-semibold text-ink">
              When the deploy fails on queue consumers
            </h3>
            <Code>
              {
                '✘ [ERROR] Trigger configuration for "…" was only partially updated:\n    Queue consumers:\n      - A request to the Cloudflare API (/accounts/…/queues) failed.\n        - An unknown error has occurred [code: 10013]'
              }
            </Code>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              The script uploaded; only the trigger update failed, and the build is reported as
              failed regardless. The message names neither the queue nor the reason — but the list
              of consumers wrangler prints immediately above it does: whichever declared queue is{' '}
              <em>missing</em> from that list is the one that failed. The two causes are rows two
              and three of the table above, a queue that was never created and a queue another
              Worker already consumes.
            </p>
            <FactTable
              columns={['If none of that is it', 'What it tells you', 'Cost']}
              rows={[
                [
                  'GET /v1/health',
                  'Whether the database resolved.',
                  'One request, nothing to set up',
                ],
                [
                  'GET /v1/instance',
                  'What the deployment believes about itself — claimed or not, which doors are open, whether any domain is verified.',
                  'One request, nothing to set up',
                ],
                [
                  'wrangler tail',
                  'What the Worker did instead.',
                  'Needs you to reproduce the failure while watching',
                ],
              ]}
              caption="In that order, and for that reason."
            />
          </>
        ),
      }}
    </GuideLayout>
  )
}
