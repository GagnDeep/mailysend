<div align="center">

# MailySend

**Resend, on _your_ Cloudflare.**

A complete email platform — transactional sending, marketing broadcasts, automations,
inbound mail with threading, and deliverability analytics — that runs entirely on
Cloudflare Workers, in your own account. MIT licensed. Also runs on a plain Node server.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/GagnDeep/mailysend)

</div>

---

## What this is

Resend's API, reimplemented on Cloudflare's primitives, plus the things a self-hosted
platform can do that a hosted one cannot: your data stays in your account, your retention
policy is yours, and the bill is Cloudflare's usage price rather than a per-email markup.

The API is **drop-in compatible**. If you already use Resend:

```diff
  import { Resend } from 'resend'
- const resend = new Resend(process.env.RESEND_API_KEY)
+ // one environment variable — RESEND_BASE_URL=https://your-mailysend.workers.dev/v1
+ const resend = new Resend(process.env.MAILYSEND_API_KEY)
```

The `resend` npm package honours `RESEND_BASE_URL`, so that is genuinely the whole
migration. There is also a first-party SDK (`mailysend`) and a compatibility shim
(`mailysend/compat`) exporting a `Resend` class with the same method names.

## What it does

| | |
|---|---|
| **Transactional sending** | `POST /v1/emails`, batch up to 100, scheduling up to 30 days, idempotency keys, attachments, tags |
| **Four transports** | Cloudflare Email Service (default), Amazon SES v2, Resend, generic SMTP — with deterministic routing and failover |
| **Marketing** | Audiences, contacts, live segments with a real query DSL, broadcasts with A/B testing, automations |
| **Inbound** | Mailboxes, MIME parsing, threading, full-text search, attachments in R2 |
| **Deliverability** | Delivery events, bounce classification, DMARC aggregate report parsing, inbox placement with its source labelled |
| **Analytics** | Opens and clicks with bot/MPP classification, per-domain and per-tag breakdowns, daily rollups, long-term archive |
| **Agents** | An MCP server with nine tools, and mandatory human confirmation before anything sends |

## Two ways to run it

### 1. Cloudflare Workers (the one-click path)

Press the button. It forks the repo, creates the KV namespaces, the D1 database and the
R2 bucket, and wires the GitHub Action.

**The button alone is not sufficient, and we say so rather than letting you find out.**
Queues, Analytics Engine datasets and the Email Service sending domain do not
auto-provision. `.github/workflows/deploy.yml` runs `scripts/provision.ts` before
`wrangler deploy` to create them, so the real path is:

```
button → repo → CI → provision → migrate → deploy
```

You will need two repository secrets: `CLOUDFLARE_ACCOUNT_ID` and a
`CLOUDFLARE_API_TOKEN` with `Workers Scripts:Edit`, `Queues:Edit`, `D1:Edit`,
`Workers KV:Edit`, `Workers R2:Edit`, `Account Analytics:Read` and `Email Sending:Edit`.

### 2. A Node server

No Cloudflare account required at all. `node:sqlite` backs the database, the filesystem
backs blobs, and in-process actors back the Durable Objects — the same code, a different
driver.

```bash
pnpm install
pnpm build:node
MS_SECRET=$(openssl rand -hex 32) \
MS_OWNER_EMAIL=you@your-domain.com \
PORT=8917 node apps/app/node-server.mjs
```

`node-server.mjs` is the listener. The build emits `.output/server/server.js`, which is a
Worker-shaped module (`export default { fetch, queue, email, scheduled }`) with no socket
of its own — running it directly exits immediately. `node-server.mjs` opens the port,
serves `.output/client` (the prerendered pages and hashed assets) straight from disk, and
hands everything else to the same `fetch` the Worker runtime would have called.

First boot creates the workspace and prints one API key. It is printed exactly once,
because only its SHA-256 hash is stored.

### Getting into the dashboard

The API takes a key; the dashboard takes a session, and there are two ways to get one.

**Cloudflare Access** is the intended path: set `MS_ACCESS_TEAM` and `MS_ACCESS_AUD` and
the sign-in page trades the Access assertion for a session. The assertion is verified
against your team's published keys — signature, `aud`, `exp` — never merely decoded.

**A one-time code** is the bootstrap, and it is emailed through this deployment's own
send path. That creates a chicken-and-egg problem on a brand-new instance, which has no
verified sending domain and therefore cannot email anybody: so while no domain is
verified, the code for `MS_OWNER_EMAIL` — and only that address — is printed to the
process log instead. Once a domain verifies, it is emailed like everything else.

There is no password store. A self-hosted email platform that invents one is adding the
single credential most likely to be reused and leaked.

Behind nginx, with PM2:

```bash
pnpm build:node
pm2 start ecosystem.config.cjs
pm2 save
```

`ecosystem.config.cjs` runs one `fork`-mode process on purpose. On Node the Durable
Objects are in-process actors, and an actor's whole job is to be a single serialisation
point per key — two processes would each hold their own broadcast cursors and their own
copy of the daily-quota governor, and the governor would grant twice what it should.

```nginx
server {
    listen 80;
    client_max_body_size 200M;
    server_name your-domain.com;
    location / {
        proxy_pass http://localhost:8917;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

`X-Forwarded-Proto` matters: without it every absolute URL the app mints — tracking
pixels, unsubscribe links, canonical tags — is written as `http://` on an `https` site.

## Sending

```bash
curl https://your-deployment/v1/emails \
  -H "Authorization: Bearer ms_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "from": "you@your-domain.com",
    "to": ["someone@example.com"],
    "subject": "Hello",
    "html": "<p>It works.</p>"
  }'
```

The `id` comes back before any provider is contacted. That is deliberate: the id is
**ours**, minted at accept time, so it survives a failover, a provider migration, and a
provider that loses its own id. `provider_message_id` is recorded later and is
queryable, but it is never the identity of a message.

## Architecture

```
apps/
  app/          TanStack Start SSR + Hono /v1 + /mcp + every Durable Object
                + the email() handler + every queue consumer + cron
  track/        the tracking Worker — /o/*, /c/*, /u/* only, no database binding
  smtp-shim/    SMTP ingress as a container (Workers cannot listen on a TCP port)

packages/
  design-tokens/  colour, type and shape — CSS custom properties + Tailwind theme + TS
  ui/             shadcn primitives rethemed, plus this design's own vocabulary
  contracts/      Zod schemas → validation, OpenAPI, SDKs and dashboard types
  core/           ids, the tenancy seams, every durable key, crypto
  db/             Drizzle schema and one migration set for D1 *and* node:sqlite
  platform/       the runtime seam: Sql, Kv, Blob, Queue, Actor, Analytics
  providers/      cloudflare | ses | resend | smtp adapters, routing and failover
  events/         one normalized schema, deterministic ids, the state ladder
  durable/        every actor class
  segments/       the DSL parser and its parameterised SQL compiler
  templates/      Handlebars, MJML, a restricted JSX AST, and HTML post-processing
  workflows/      the automation step interpreter, on Workflows or the scheduler
  mcp/            the nine-tool MCP server
  sdk-node/       the `mailysend` npm package + `mailysend/compat`
cli/              npx mailysend
```

### The decisions worth knowing

**One codebase, two runtimes.** `packages/platform` defines `Sql`, `Kv`, `Blob`,
`Queue`, `ActorNamespace` and `Analytics` as deliberate *subsets of the Cloudflare APIs*.
The Cloudflare adapters are therefore identity casts — zero cost — and the abstraction
cannot drift, because drifting would mean diverging from the API it is a subset of. D1
and `node:sqlite` are the same engine, so one migration set covers both.

**Prefixed ULIDs.** `em_`, `dom_`, `bc_` — time-sortable, so an id doubles as an index
range key and an R2 partition prefix, and pagination is `WHERE id < ?` rather than an
offset.

**A monotonic state ladder.** Every status write is `WHERE state_rank < ?`. Out-of-order
and duplicate events become no-ops, so the event pipeline needs no ordering guarantees
at all.

**Deterministic event identity.** `event_id = sha256(provider|provider_message_id|type|recipient|unix_second)`.
A redelivered webhook produces a byte-identical id and collapses on an
`INSERT OR IGNORE`. The timestamp is truncated to the second because providers
re-serialise sub-second precision between retries.

**Deterministic provider routing.** The transport is chosen by `stableHash(email_id)`,
so a retry always lands on the same provider and cannot double-send across two. Failover
happens on `transient` and `throttled` errors and **never** on `unknown` — a timeout with
an unknown outcome means the message may already be on the wire.

**Broadcasts are O(1) at the coordinator.** Preparation splits the recipient set into 32
contiguous id ranges; the coordinator stores 32 cursors and nothing else. Its write rate
is ~6/second whether the audience is a thousand contacts or half a million.

**Segments recompute without scanning.** Behavioural fields are denormalised columns on
`contacts`, a write-driven delta covers edits, and an hourly boundary sweep covers the
genuinely hard case — `last_open < 30d` flips with no write at all — by querying only
the hour that just expired.

## What we are honest about

A deliverability product that overstates what it measures loses credibility permanently,
so these are stated in the docs, in the UI, and here.

- **Delivery semantics.** Exactly-once for API acceptance and for state and event
  accounting. At-least-once for wire delivery, webhook delivery and Analytics Engine
  datapoints. Anyone claiming exactly-once SMTP delivery is lying.
- **One duplicate source is not fully defensible**: the provider accepted the message and
  the worker died before the database write. No provider offers an idempotency key for
  this. It is minimised (`provider_message_id` written first, a 120-second lease) and it
  is measured and alerted on rather than claimed away.
- **Inbox placement is not observable from delivery events.** SMTP `250` means accepted,
  not inboxed. Every placement figure carries `source` (`seed` / `postmaster` / `snds` /
  `estimate`) and a confidence, and estimates are labelled as estimates.
- **Open rates are approximate.** Apple Mail Privacy Protection prefetches every pixel.
  Nothing is discarded — every hit is classified `human` / `mpp` / `proxy_prefetch` /
  `scanner` / `bot` — charts default to `human`, and the privacy-adjusted open rate
  excludes MPP from both sides of the ratio.
- **Cloudflare Email Service is in beta**, Workers Paid only, with a daily quota that
  ramps with reputation and is not published. MailySend *learns* that ceiling (halve on
  rejection, raise at most 2× after a clean day), so a first large send slows down
  instead of generating thousands of errors and a reputation hit.
- **Attachment limits are per transport.** Cloudflare caps a message at 5 MiB (25 MiB
  only to verified destinations); SES at 40 MB. The API returns a typed error naming the
  active provider's limit rather than failing at the wire.
- **SMTP ingress cannot run on Workers.** `connect()` is egress-only and there is no
  inbound TCP listener. `apps/smtp-shim` is a container image. Self-hosters who will not
  run one can point at Cloudflare's own `smtp.mx.cloudflare.net:465` — but those sends
  will not appear in MailySend's logs, analytics or webhooks, and the docs say so.
- **Automations have a real ceiling.** Workflows V2 caps 50,000 concurrent instances.
  Instance mode (exact per-contact timing) is capped at 40,000 active enrollments and
  refuses beyond it. Cohort mode is the default at audience scale: one instance per
  hourly cohort of ≤25,000, which puts 500,000 contacts over a month at roughly 720
  instances — at the cost of timing quantised to the cohort clock.
- **Analytics Engine keeps three months and samples under load.** It is the hot query
  layer for charts. The count of record is `rollups_daily` in SQL, and the archive is
  NDJSON in R2.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `MS_MODE` | `single` | `single` (self-hosted) or `saas` |
| `MS_PUBLIC_URL` | — | Base URL for every link the app mints |
| `MS_TRACKING_URL` | `MS_PUBLIC_URL` | Separate tracking domain, if you have one |
| `MS_SECRET` | — | **Required.** Signs tracking, unsubscribe and reply tokens |
| `MS_DATA_KEY` | `MS_SECRET` | Encrypts stored provider credentials |
| `MS_DEFAULT_PROVIDER` | `cloudflare` | Fallback transport when nothing is configured |
| `EVENT_DETAIL` | `on` | `off` stops writing per-event rows and reconstructs timelines from R2 |
| `MS_OWNER_EMAIL` | — | The dashboard owner. Their first sign-in code is logged while no sending domain is verified |
| `MS_ACCESS_TEAM` | — | Cloudflare Access team domain, e.g. `acme.cloudflareaccess.com` |
| `MS_ACCESS_AUD` | — | The Access application's AUD tag. Both are required for Access sign-in |
| `PORT` / `MS_DATA_DIR` | `8917` / `./.data` | Node deployments only |

Provider credentials set in the dashboard are stored as AES-GCM ciphertext and are never
returned by the API. Environment variables are the fallback, which is what lets a fresh
deployment send on its first request.

## Development

```bash
pnpm install
pnpm dev            # vite dev on :8917
pnpm typecheck
pnpm test
pnpm --filter @mailysend/app preview   # wrangler dev, on Miniflare
```

The dev cache (`.vite-dev`) and the build output (`.output` for Node, `.output-cf` for
Cloudflare) are separate directories, so a running dev server and a production build
never contend for the same files.

## Licence

MIT. See [LICENSE](LICENSE).
