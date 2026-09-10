import { Callout, StepCard, Terminal } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'self-host-on-a-node-server'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/self-host-on-a-node-server')({
  head: () => guideHead(SLUG),
  component: Page,
})

const ENV_VARS: Array<[string, string, string]> = [
  [
    'MS_SECRET',
    'run',
    'Signs tracking, unsubscribe and reply tokens. Unset, a 32-byte value is generated on first boot and persisted, so links survive restarts. Set but shorter than 32 characters is refused outright — that is a mistake rather than a choice.',
  ],
  [
    'MS_PUBLIC_URL',
    'run + build',
    'The canonical origin. Tracking links use it at run time; the sitemap is generated from it at build time. A build with no host ships no sitemap rather than a wrong one.',
  ],
  [
    'MS_LANDING',
    'run + build',
    'marketing serves the public site at /; app redirects to the dashboard, or to /setup while unclaimed. At build time it also decides whether this build may publish mailysend.com as its canonical host.',
  ],
  [
    'MS_TARGET',
    'build',
    'node or cloudflare. Selects the platform adapters and the output directory; pnpm build:node sets it for you.',
  ],
  [
    'MS_DATA_DIR',
    'run',
    'Where SQLite and blobs live on disk — mailysend.db, plus a blobs/ directory. Back this up; it is the whole of your data.',
  ],
]

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You have the same application running under a process manager behind nginx, reading its
          configuration from one <Mono>.env</Mono> file, with its data in a directory you can back
          up. Everything the product does — broadcasts, automations, inbound, analytics — runs on
          the platform adapters, with three capabilities that resolve differently off Workers and
          are named below rather than left to be discovered.
        </p>
      }
    >
      {{
        'what-changes': (
          <>
            <Lede>
              Less than you would expect. The build emits a Worker-shaped module —{' '}
              <Mono>{'{ fetch, queue, email, scheduled }'}</Mono> — because that is what the whole
              codebase is written against, and the Node listener’s entire job is to open a socket
              and turn Node streams into <Mono>Request</Mono> and <Mono>Response</Mono>.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Everything platform-shaped — the database, the queue, the blob store, the key-value
              cache — is reached through <Mono>@mailysend/platform</Mono> rather than imported
              directly, so the seam is one package rather than a runtime branch in every file. That
              is what makes “the Node target runs the same code” checkable by reading rather than by
              trusting. <Mono>node-server.mjs</Mono> is deliberately one file with no dependencies
              for the same reason, and it does exactly two things worth knowing about: prerendered
              HTML and hashed assets are served straight from <Mono>.output/client</Mono> without
              touching the application, and everything else goes to the same <Mono>fetch</Mono> the
              Workers runtime would have called.
            </p>
            <h3 className="mt-7 mb-2 text-[15px] font-semibold text-ink">
              What the adapters do instead
            </h3>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Queues become a SQLite table and a poller.</strong> The
              five properties the code above actually depends on are at-least-once delivery, per
              message ack and retry, delayed visibility, batching, and a dead-letter path after a
              bounded number of attempts — all reproducible with a <Mono>visible_at</Mono> column
              and a transactional claim. Note the deliberate absence of an ordering guarantee, which
              matches Cloudflare Queues: the event pipeline’s monotonic state ladder does not need
              ordering, and promising it here would let ordering-dependent code creep in that then
              breaks on Workers.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Durable Objects become in-process actors</strong>, which
              is the constraint that shapes the whole deployment: one process, in fork mode, forever
              — see the next section for why that is not a preference.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Automations run on the scheduler, not on Workflows.
              </strong>{' '}
              The driver is selected from the runtime’s own capability rather than from
              configuration, because promising Workflows on a runtime with no Workflows engine would
              surface as a confusing failure much later. The step interpreter is the same one, so
              behaviour matches; the durability story is weaker, in that a crash mid-step replays
              from the last write rather than resuming inside it. A Node process also has no
              thirty-second CPU ceiling, so the cap becomes a self-imposed fifteen-minute watchdog —
              a runaway step is still bounded, just far more generously.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Analytics Engine becomes a local table</strong> with the
              same shape — one index, blobs, doubles — rather than being stubbed out, so the Node
              deployment keeps per-event analytics and the dashboard queries whichever of the two is
              present. The three-month retention that constrains Analytics Engine does not apply
              here, and the R2 archive still runs: one archive format across both runtimes is worth
              more than the disk it saves.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The Cloudflare transport is not gone — the binding is.
              </strong>{' '}
              Off Workers there is no <Mono>send_email</Mono> binding, so Cloudflare Email Service
              is reached over its REST endpoint instead, which needs{' '}
              <Mono>CLOUDFLARE_ACCOUNT_ID</Mono> and <Mono>CLOUDFLARE_API_TOKEN</Mono>. If you would
              rather not have a Cloudflare account in the picture at all, the other three transports
              — SES, Resend and generic SMTP — need nothing from this list;{' '}
              <a
                href="/guides/choose-a-sending-transport"
                className="text-accent underline underline-offset-4"
              >
                the transport guide
              </a>{' '}
              has the real ceilings for each.
            </p>
          </>
        ),
        build: (
          <>
            <Lede>
              Two commands, and one environment variable that has to be present during the build
              rather than at run time — which is the source of the most confusing failure on this
              page.
            </Lede>
            <Terminal
              lines={[
                { kind: 'command', text: 'pnpm install --frozen-lockfile' },
                { kind: 'command', text: 'pnpm build:node' },
                { kind: 'success', text: 'Prerendered 42 pages' },
                { kind: 'success', text: 'llms: wrote .output/client/sitemap.xml' },
              ]}
            />
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Prerendering is not decoration.</strong> Every public
              page — marketing, docs and every guide — is rendered to static HTML at build time from
              one list that also drives <Mono>sitemap.xml</Mono>, <Mono>llms.txt</Mono> and{' '}
              <Mono>robots.txt</Mono>, so those four cannot drift apart. Link crawling and
              auto-discovery are both off, deliberately: crawling minted a sitemap URL per deep
              anchor, and auto-discovery swept the per-user dashboard screens into the static output
              and the sitemap, where they must never be cached or indexed. A prerender error fails
              the build, because the alternative — the setting that let it pass — once produced
              “Prerendered 0 pages”, a zero exit code, and a deploy with no static HTML at all.
            </p>
            <Callout variant="warn" title="BUILD TIME IS NOT RUN TIME">
              Prerendering boots the real server to render each page, so the build reads your
              configuration too. Both halves of it now read the <Mono>.env</Mono> at the repository
              root — <Mono>vite.config.ts</Mono> to decide whether a sitemap is written, and{' '}
              <Mono>scripts/llms.ts</Mono>, which runs as a separate process, to write the same host
              into <Mono>robots.txt</Mono>. Fixing only one of them would produce the mirror-image
              bug: a sitemap generated for one host and advertised for another. Only absent keys are
              filled in, so an explicit shell variable still wins.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">This is the bug that hid the longest.</strong>{' '}
              <Mono>MS_PUBLIC_URL</Mono> lives in the <Mono>.env</Mono> the process manager loads at{' '}
              <em>run</em> time, and nothing put it into the shell during{' '}
              <Mono>pnpm build:node</Mono>. So the sitemap host resolved to <Mono>undefined</Mono>,
              the sitemap was silently disabled, and <Mono>robots.txt</Mono> advertised a URL that
              returned 404 for the life of the site. The build reading the same file is what makes{' '}
              <Mono>sitemap.xml</Mono> exist for a self-hoster who sets one variable — and a build
              that still has no host now ships a <Mono>robots.txt</Mono> with no{' '}
              <Mono>Sitemap:</Mono> line at all, rather than pointing crawlers at a page that is not
              there. A sitemap naming somebody else’s host is worse than no sitemap, which is why
              only a build with <Mono>MS_LANDING=marketing</Mono> may publish{' '}
              <Mono>mailysend.com</Mono> as its canonical host.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">You do not need a real signing secret to build.</strong>{' '}
              The prerendering server wants one, so the build generates a random build-scoped value
              when <Mono>MS_SECRET</Mono> is unset: nothing prerendered is signed, and the value
              dies with the process. A real secret in the environment still wins. The Node build
              writes to <Mono>.output</Mono> and the Cloudflare build to <Mono>.output-cf</Mono>,
              with the dev cache in a third directory again, so a running dev server and a
              production build never contend for the same files.
            </p>
          </>
        ),
        run: (
          <>
            <Lede>
              One process on a loopback port, nginx in front of it, and a process manager to restart
              it. Nothing more exotic is needed, and anything more exotic has a cost you should be
              choosing deliberately. The live deployment at mailysend.com is exactly this: a
              checkout at <Mono>/srv/mailysend</Mono>, one PM2 process on{' '}
              <Mono>127.0.0.1:8917</Mono>, nginx terminating TLS.
            </Lede>
            <div className="flex flex-col gap-3.5">
              <StepCard step={1} title="Start it" variant="rule">
                <Terminal
                  className="mt-1.5"
                  lines={[
                    { kind: 'command', text: 'pm2 start ecosystem.config.cjs' },
                    { kind: 'success', text: 'mailysend │ fork │ online │ 127.0.0.1:8917' },
                    { kind: 'command', text: 'pm2 save && pm2 startup' },
                  ]}
                />
                <p className="mt-2 mb-0 text-[14px] leading-[1.6] text-muted-2">
                  The committed <Mono>ecosystem.config.cjs</Mono> runs{' '}
                  <Mono>apps/app/node-server.mjs</Mono> — not <Mono>.output/server/server.js</Mono>,
                  which is the Worker-shaped module and has no socket — with{' '}
                  <Mono>{"node_args: '--enable-source-maps --env-file-if-exists=.env'"}</Mono>. The{' '}
                  <em>if-exists</em> half matters: the same command works on a box that has not been
                  configured yet, which makes a first boot legible rather than a crash loop. If
                  there is no build on disk, the listener says so and names the command to run
                  instead of failing with a module-not-found stack.
                </p>
              </StepCard>
              <StepCard step={2} title="Put nginx in front" variant="rule">
                <Code className="mt-1.5">
                  {
                    'map $http_x_forwarded_proto $ms_forwarded_proto {\n    ""      $scheme;\n    default $http_x_forwarded_proto;\n}\n\nserver {\n  server_name '
                  }
                  <Key>mail.yourdomain.com</Key>
                  {
                    ";\n  client_max_body_size 200M;\n\n  location / {\n    proxy_pass http://127.0.0.1:8917;\n    proxy_http_version 1.1;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection 'upgrade';\n    proxy_set_header Host $host;\n    proxy_set_header X-Forwarded-Host $host;\n    proxy_set_header X-Forwarded-Proto $ms_forwarded_proto;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n  }\n}"
                  }
                </Code>
                <p className="mt-2 mb-0 text-[14px] leading-[1.6] text-muted-2">
                  <Mono>X-Forwarded-Proto</Mono> is load-bearing rather than tidy: without it every
                  absolute URL the app mints — tracking pixels, unsubscribe links, canonical tags —
                  comes out <Mono>http://</Mono> on an <Mono>https</Mono> site.{' '}
                  <Mono>client_max_body_size</Mono> is what lets an attachment upload through, and
                  nginx’s 1 MB default rejects it with a 413 before the application ever sees it.
                </p>
              </StepCard>
            </div>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Fork mode, exactly one instance.</strong> Cluster mode
              looks like free throughput and is not. On Node the Durable Objects are in-process
              actors, and an actor’s entire job is to be a single serialisation point per key — two
              processes would each hold their own broadcast cursors and their own copy of the daily
              quota governor, and the governor would then grant twice what it should. That is not a
              race you would notice in testing; it is a reputation incident on the first large send.
              Scaling out on Node means putting the actors behind a shared service, not adding
              workers here.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The rest of the process definition is a set of answers
              </strong>{' '}
              to questions you would otherwise find out the hard way:{' '}
              <Mono>kill_timeout: 12000</Mono> gives the runtime time to finish a batch and close
              its SQLite handles, <Mono>{"max_memory_restart: '900M'"}</Mono> turns a leak into a
              restart rather than a dead box, and <Mono>{"min_uptime: '20s'"}</Mono> with{' '}
              <Mono>max_restarts: 10</Mono> stops a misconfigured instance from restarting forever
              while looking healthy in <Mono>pm2 list</Mono>.
            </p>
          </>
        ),
        env: (
          <>
            <Lede>
              Five variables carry the weight. The column that matters is the middle one: a variable
              needed at build time and set only at run time is silently ignored, which is a failure
              with no error message — and was, for the whole life of this site’s sitemap.
            </Lede>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="px-4 py-2.5 font-mono text-[12px] font-semibold">variable</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">needed at</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">what it does</th>
                  </tr>
                </thead>
                <tbody>
                  {ENV_VARS.map(([name, when, what]) => (
                    <tr key={name} className="border-line border-t">
                      <td className="px-4 py-2 font-mono text-[13px] text-ink">{name}</td>
                      <td className="px-4 py-2 font-mono text-[12.5px] text-muted-2">{when}</td>
                      <td className="px-4 py-2 text-muted">{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="mt-7 mb-2 text-[15px] font-semibold text-ink">Where each one lives</h3>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Two files, and the split is not arbitrary.</strong>{' '}
              Anything that is not a secret and describes how this box runs the app belongs in the
              PM2 <Mono>env</Mono> block in <Mono>ecosystem.config.cjs</Mono>, which is committed:{' '}
              <Mono>NODE_ENV</Mono>, <Mono>PORT</Mono>, <Mono>HOST</Mono>, <Mono>MS_MODE</Mono>,{' '}
              <Mono>MS_DATA_DIR</Mono> and <Mono>MS_LANDING</Mono>. Anything secret, and anything
              the build also needs, belongs in <Mono>/srv/mailysend/.env</Mono>, which is not
              committed and is loaded at run time by <Mono>--env-file-if-exists=.env</Mono> and at
              build time by the same loader described in the previous section:
            </p>
            <Code>
              <Com>{'# /srv/mailysend/.env — read by the runtime and by the build'}</Com>
              {'\nMS_PUBLIC_URL=https://'}
              <Key>mail.yourdomain.com</Key>
              {'\nMS_SECRET=…                 '}
              <Com>{'# openssl rand -hex 32'}</Com>
              {'\nSES_REGION=…                '}
              <Com>{'# only needed before anyone has signed in'}</Com>
            </Code>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              That is the practical consequence of the build now reading <Mono>.env</Mono>: setting{' '}
              <Mono>MS_PUBLIC_URL</Mono> in one file is what makes <Mono>sitemap.xml</Mono> exist
              for a self-hosted deployment, and it does so without a build environment that has to
              be kept in sync with a runtime one by hand.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Sending credentials mostly do not belong here at all.
              </strong>{' '}
              Configure them in the dashboard under{' '}
              <strong className="text-ink">Settings → Transports</strong>: they are encrypted with
              AES-GCM before storage, keyed by <Mono>MS_DATA_KEY</Mono> or, unset,{' '}
              <Mono>MS_SECRET</Mono>, and are never returned by the API — the response says which
              fields are set, never what they are. The environment variables exist for exactly one
              case, a fresh deployment that must send before anybody has signed in. If you lose them
              you re-enter them; there is no path by which the software can show you a secret back.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Back up the data directory, not the checkout.</strong>{' '}
              <Mono>MS_DATA_DIR</Mono> holds <Mono>mailysend.db</Mono> — contacts, messages, events,
              settings, the queue spool, the local analytics table — and a <Mono>blobs/</Mono>{' '}
              directory with raw inbound MIME and attachments. Everything else on the box is
              reproducible from git.
            </p>
          </>
        ),
        upgrades: (
          <>
            <Lede>
              Pull, build, reload. There is no migrate step to remember, and that is deliberate
              rather than an omission — but the ordering of the other three is still what makes a
              rollback possible rather than theoretical.
            </Lede>
            <Terminal
              lines={[
                { kind: 'command', text: 'cp -a .data .data.bak' },
                { kind: 'command', text: 'git fetch && git checkout <tag>' },
                { kind: 'command', text: 'pnpm install --frozen-lockfile && pnpm build:node' },
                { kind: 'command', text: 'pm2 reload mailysend' },
              ]}
            />
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Migrations run themselves.</strong> The first touch after
              a restart runs any migration the <Mono>_migrations</Mono> table does not already list,
              then ensures the workspace exists — both idempotent, so the cost on every later cold
              start is one indexed lookup. This is the same code path the Cloudflare deployment runs
              on its first request, which is why there is one migration set for D1 and{' '}
              <Mono>node:sqlite</Mono> rather than two that can disagree.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Only ever forward, and additive first.</strong> An
              additive migration is safe to apply while the old code is still running, because the
              old code does not know about the new column. A destructive one is not, and is also the
              thing that makes rolling back impossible — so if you need to remove a column, do it as
              a separate release <em>after</em> the one that stopped using it. The copy of{' '}
              <Mono>.data</Mono> above is the cheap insurance that makes the difference academic;
              take it while the process is stopped if you want it to be exact.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                <Mono>pm2 reload</Mono> drains rather than kills.
              </strong>{' '}
              A hard kill mid-batch is survivable — a send attempt holds a lease, the lease expires,
              and the work is picked up again — but a clean drain is cheaper and does not produce a
              minute of confusing telemetry. With one fork-mode process there is no zero-downtime
              handover to be had, so expect a short gap; nginx will return 502 during it, and that
              is the honest behaviour rather than a queue of requests waiting on a process that may
              not come back.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Then check two things, in this order.</strong>{' '}
              <Mono>GET /v1/health</Mono> answers <Mono>operational</Mono> with a version number and
              the result of a real query against the database, or <Mono>degraded</Mono> with the
              driver’s own error and a <Mono>503</Mono>. <Mono>GET /v1/instance</Mono> then tells
              you what the deployment believes about itself — claimed or not, which sign-in doors
              are open, how many domains are verified. Both are unauthenticated and one request
              each, which makes them cheaper than reading <Mono>logs/mailysend.err.log</Mono> and
              much cheaper than reproducing the failure.
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
