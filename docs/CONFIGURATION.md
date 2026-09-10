# Configuration

**Nothing in this file is required to get a working deployment.** Every value
has a default, and the two that cannot be defaulted are generated and stored by
the instance on first boot. This is the reference for when you want to override
something — not a checklist to work through before deploying.

`.env.example` in the repository root is deliberately shorter than this page,
and every key in it carries a value. The Deploy to Cloudflare flow builds its
variables form from that file, showing key names only — never the comments — and
stores each answer as a secret, which it renders masked. So a key shipped with
an empty value becomes a blank, mandatory-looking password box with nothing to
explain it. Keys with no sensible default therefore live here instead, and are
set after deploying:

```bash
npx wrangler secret put MS_OWNER_EMAIL
```

## What the instance resolves for itself

| Variable | If you leave it unset |
|---|---|
| `MS_SECRET` | A 32-byte secret is generated on first boot and stored in the `settings` table, so it survives restarts and redeploys. Set it explicitly to keep the signing key out of the database and to be able to rotate it. Must be at least 32 characters if you do set it. |
| `MS_PUBLIC_URL` | Learned from the first request's own origin and stored. A deployment first reached on `workers.dev` and later on a custom domain adopts the custom domain; a `localhost` origin is never stored, so development cannot poison a real deployment, and a `workers.dev` request can no longer drag an instance back off its custom domain. **Passkeys are bound to this hostname** — see "First run" below. |
| `MS_DATA_KEY` | Falls back to `MS_SECRET`. Set it separately if you want to rotate one without the other. |
| `MS_TRACKING_URL` | Falls back to `MS_PUBLIC_URL`. Set it if tracking links should point at a separate host. |

## What you may want to set

| Variable | Default | What it does |
|---|---|---|
| `MS_MODE` | `single` | `single` for a self-hosted instance, `saas` for the hosted product |
| `MS_DEFAULT_PROVIDER` | `cloudflare` | The transport used when a workspace has configured none |
| `MS_OWNER_EMAIL` | — | Optional and *restrictive*: it does not create an owner, it limits who may claim the instance at `/setup`. Setting it also means `/setup` does not ask for the first-boot claim code — one lock instead of two. Not on the deploy form |
| `MS_LANDING` | `app` when `MS_MODE=single`, else `marketing` | What `/` serves: `app` redirects to the dashboard (or `/setup` while unclaimed), `marketing` serves the public site |
| `EVENT_DETAIL` | `on` | `off` stops writing a row per event and reconstructs timelines from the R2 archive |
| `MS_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `MS_ACCESS_TEAM` | — | Cloudflare Access team domain, e.g. `acme.cloudflareaccess.com` |
| `MS_ACCESS_AUD` | — | The Access application's AUD tag. Both are required for Access sign-in |
| `PORT` | `8917` | Node deployments only |
| `MS_DATA_DIR` | `./.data` | Node deployments only: SQLite, blobs and the queue spool |

## First run

A fresh deployment has no verified sending domain, no identity provider and
nobody to email, so its first session cannot come from any of those. It comes
from claiming the instance.

**`/setup`** is where that happens. It asks for the **claim code** printed once
in the deployment's log on first boot — `wrangler tail`, or the Worker's *Logs*
tab — which is what makes a public URL safe before you have opened it: whoever
finds the deployment cannot claim it without reading its log. A deployment that
booted before this existed has no stored code and is not asked for one, and
setting `MS_OWNER_EMAIL` narrows the claim to one address instead. Then the
visitor registers a passkey and becomes the owner; the claim is one conditional insert, so two simultaneous
claimants produce exactly one owner. Ten single-use recovery codes are shown
once. The two steps after it — add a sending domain, mint a key and send a test
— are both skippable.

`GET /v1/instance` is unauthenticated and is what every pre-auth screen renders
from, so a door is only offered when it is open:

```jsonc
{ "object": "instance", "claimed": true, "mode": "single", "version": "0.1.0",
  "public_url": "https://mail.example.com", "landing": "app",
  "auth":    { "passkey": true, "access": false, "otp": true, "device": true },
  "sending": { "ready": true, "verified_domains": 1, "last_error": null } }
```

It carries no secrets and no per-address facts. `auth.access` is
`Boolean(MS_ACCESS_TEAM && MS_ACCESS_AUD)`; `auth.otp` is whether any domain is
verified — a global fact, so it leaks nothing about anybody's address. Until it
is true, `POST /v1/auth/otp` answers `202 {"status":"unavailable"}` rather than
claiming to have sent mail.

### Ways in, and the way back in

| Path | Needs | Notes |
|---|---|---|
| Passkey | a claimed instance | Discoverable, so no email is typed |
| Recovery code | one of the ten | Single-use; regenerate from Settings |
| Cloudflare Access | `MS_ACCESS_TEAM` + `MS_ACCESS_AUD` | Assertion verified against your team's keys: signature, `iss`, `aud`, `exp` |
| Emailed code | a verified sending domain | Sent from the domain flagged default, not the oldest one |
| `npx mailysend claim` | write access to the instance's D1 | Break-glass; works before *and* after the claim |
| `npx mailysend login` | a browser already signed in | Device code approved at **Settings → Access** |

`mailysend claim` proves control of the deployment rather than of an inbox: it
writes a one-time nonce into the instance's own database — through the D1 HTTP
API when `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are set, otherwise
by printing the exact `wrangler d1 execute` command — and then proves it knows
that value. Only somebody who can write that database can produce it, which is
why it is safe to leave available permanently.

### Passkeys and the instance hostname

A passkey is bound to a hostname. Because `MS_PUBLIC_URL` is *learned*, an
instance that starts on `*.workers.dev` and later answers on `mail.example.com`
changes the WebAuthn relying party, and every passkey registered on the old host
stops working there.

So each credential stores the hostname it was registered for. The dashboard
lists which are still usable, the sign-in page names the previous host when it
sees a mismatch, and the fix is a recovery code plus a re-registration. Moving
deliberately — **Settings → Access** — pins the new value, records the
old one, and tells you the same thing in advance.

If you serve one instance on more than one hostname, set `MS_PUBLIC_URL`
explicitly before anybody registers a passkey.

### Upgrading an existing deployment

Redeploy; the migration runs itself on the first request, and existing API keys,
sessions, domains and messages are untouched. Three things change:

- An instance that already has a member is marked claimed on the first boot
  after the upgrade, so `/setup` cannot be used to take it over. One with no
  member at all is unclaimed — which is the case `/setup` exists for.
- `/` redirects to `/app` (or `/setup`). Set `MS_LANDING=marketing` if your
  deployment is meant to serve the public site at its root.
- `/sign-up` is gone and redirects to `/setup`.

Then add a passkey and generate recovery codes from Settings; until you do, your
only doors are the ones you already had.

## Sending credentials

**Configure these in the dashboard, not here.** Credentials set through
**Settings → Transports** are encrypted with AES-GCM before they are stored and
are never returned by the API — the response says which fields are set, never
what they are — and they take precedence over the environment.

The environment variables below exist for one case: a fresh deployment that
needs to send before anybody has logged in. If that is not your situation, skip
them entirely.

| Transport | Variables |
|---|---|
| Cloudflare | Nothing. The `send_email` binding is used when it is present; `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are only needed for the REST fallback |
| Amazon SES | `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, optionally `SES_CONFIGURATION_SET` |
| Resend | `RESEND_API_KEY` |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`tls` \| `starttls` \| `none`), `SMTP_USER`, `SMTP_PASS` |

When a workspace has configured nothing, `GET /v1/providers` says so explicitly
in `environment_fallback` rather than returning an empty list — an empty list
read as "sending is not set up" when in fact it was, from the variables above.

## Single sign-on (optional)

| Variable | Meaning |
|---|---|
| `MS_OIDC_ISSUER` | The provider's issuer URL, e.g. `https://acme.okta.com` |
| `MS_OIDC_CLIENT_ID` | This application's client id |
| `MS_OIDC_CLIENT_SECRET` | Its secret |
| `MS_OIDC_ALLOWED_DOMAINS` | Comma-separated email domains. Empty means any address the provider vouches for |
| `MS_OIDC_AUTO_PROVISION` | `true` enrols an unknown address on first sign-in. Requires an allowlist |
| `MS_OIDC_LABEL` | What the sign-in button says. Defaults to "single sign-on" |

None of these are on the Cloudflare deploy form — they have no sensible default,
and a key with no default is a blank masked box on that form. Set them with
`wrangler secret put` after deploying.

All three of issuer, client id and secret must be set before the button appears
on the sign-in page. The redirect URI to register with the provider is
`${MS_PUBLIC_URL}/v1/auth/oidc/callback`. See [AUTH.md](AUTH.md).

## Bindings

On Cloudflare these come from `apps/app/wrangler.jsonc`: `DB` (D1), `CACHE` and
`SUPPRESSIONS` (KV), `BUCKET` (R2), ten queues, ten Durable Object classes, two
Analytics Engine datasets and the `send_email` binding.

None of them exist on a fresh account, and `wrangler deploy` validates every
binding *before* it uploads — so a missing resource is not a degraded Worker,
it is a failed deploy, one resource at a time: `Queue "ms-events-cf" does not
exist`, then `KV namespace 'PLACEHOLDER' is not valid`.

So `build:cf` ends by running `scripts/ensure-resources.mjs`, which creates the
twelve queues, the R2 bucket, the D1 database and the two KV namespaces, and
then writes the D1 and KV ids — which are generated and so cannot be committed —
into the config wrangler deploys. Everything is matched by name and created
only when missing, so every build after the first is a no-op. That property is
load-bearing: re-creating `SUPPRESSIONS` instead of reusing it would silently
empty the one list that must never be lost.

It runs only inside Workers Builds (`WORKERS_CI=1`) or when you set
`MS_ENSURE_RESOURCES=1`, so building locally never creates resources in your
account as a side effect. If the build token cannot create something the script
does not fail the build; it leaves the id out, which is exactly the shape
wrangler's own automatic provisioning expects, and the deploy gets a second
chance to create it.

This is also why no `database_id` or KV `id` appears in `wrangler.jsonc`. A
generated id cannot be committed, and a literal placeholder is worse than
omitting one — it passes JSON validation and fails the deploy.

### When a deploy fails on queue consumers

```
✘ [ERROR] Trigger configuration for "…" was only partially updated:
    Queue consumers:
      - A request to the Cloudflare API (/accounts/…/queues) failed.
        - An unknown error has occurred [code: 10013]
```

The script uploaded; only the trigger update failed, and the build is reported
as failed regardless. The error names neither the queue nor the reason, but the
list of consumers wrangler prints immediately above it does: whichever declared
queue is *missing* from that list is the one that failed.

There are two causes, and the build log now names both before the deploy runs.
The queue does not exist — a build token without `Queues:Edit`, or a creation
that did not take. Or another Worker already consumes it: a queue has exactly
one consumer and these names are account-global, so **two MailySend
deployments on one Cloudflare account collide on every queue.** Deploy the
second one to a different account, or remove the first Worker's consumers.

### Analytics Engine is left out unless you ask for it

The dataset bindings are dropped from the generated config, and the deploy is
the reason: a binding is validated at upload, and an account that has not
clicked Enable on the Analytics Engine page fails the whole thing with

```
You need to enable Analytics Engine. Head to the Cloudflare Dashboard to
enable [code: 10089]
```

after a 6 MB upload. That is not something a one-click deploy should die on,
and the binding is not load-bearing: Analytics Engine is the hot query layer
for the dashboard's charts — sampled under load, three months of retention —
while every count of record comes from D1, and the events consumer already
treats the binding as optional.

Enable Analytics Engine on the account, then build with
`MS_ANALYTICS_ENGINE=1` to include the bindings. The datasets themselves need
no provisioning; they are created on first write.

If you would rather do it yourself, one idempotent command covers the same
ground:

```bash
export CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=...
npx mailysend provision
```

That token needs `Queues:Edit`, plus `Workers Scripts:Edit`, `D1:Edit`,
`Workers KV:Edit` and `Workers R2:Edit` if you deploy with the same token
instead of using the button. `.github/workflows/deploy.yml` runs provision and
deploy in that order on `workflow_dispatch` if you would rather it happened in
CI.

## Workers Builds

Cloudflare infers the build and deploy commands from the repository, and its
inference used to be wrong here in two ways. Both are now fixed in the repo, so
**the inferred commands work and there is nothing to change in the dashboard.**
What follows is why, because the failures are silent-looking and worth
recognising.

It proposes `pnpm deploy`, and `deploy` is one of pnpm's own subcommands, so
the built-in wins and the script of that name never runs — it fails with
`ERR_PNPM_INVALID_DEPLOY_TARGET: This command requires one parameter`. No
script in this repository is called `deploy` any more, precisely so that
nothing can land on that trap again.

It then proposes a bare `npx wrangler deploy`, run from the repository root. In
a pnpm workspace with no config at the root, wrangler cannot tell which package
is the Worker and stops before doing anything:

```
✘ [ERROR] The Cloudflare application detection logic has been run in the root
of a workspace instead of targeting a specific project.
```

So `build:cf` ends by writing a root `wrangler.json` (`scripts/emit-root-wrangler.mjs`)
— a copy of the config Vite generates next to the bundle, with its two path
fields rewritten to be root-relative. Bindings still have exactly one source of
truth: the root file is regenerated from the generated one on every build, is
build output, and is gitignored.

If you would rather be explicit, under **Workers → your Worker → Settings → Builds**:

| | |
|---|---|
| Build command | `pnpm run build:cf` |
| Deploy command | `npx wrangler deploy -c apps/app/.output-cf/server/wrangler.json` |

Two details there are load-bearing. `build:cf` rather than `build:node`: the
Node target emits `.output/server/server.js`, a socket server that is not a
Worker. And `-c` pointing into `.output-cf/server/`: Vite generates the wrangler
config it deploys from, next to the bundle. `apps/app/wrangler.jsonc` is the
*input* to that generation — deploying it directly points `main` at TypeScript
source.

`sitemap.xml` is written at build time and needs a host, so it is emitted only
when the build has one: `MS_PUBLIC_URL`, or `MS_LANDING=marketing` (which is
what `mailysend.com` builds with, and the only build allowed to publish
`mailysend.com` as its canonical host). A self-hosted build with neither ships
no sitemap rather than one pointing crawlers at somebody else's site — the
runtime `MS_LANDING` is a separate decision and can still be `app`.

The root `build` script is an alias for `build:cf`, so the build command works
whether Cloudflare guesses `pnpm build` or you set it explicitly.

`MS_PUBLIC_URL` is deliberately **not** set in `wrangler.jsonc`. A placeholder
there would pin the instance to a hostname nobody owns — every tracking pixel,
unsubscribe link and canonical tag minted against it — so the value is learned
instead, and setting the variable is how you override that.

On Node there are no bindings. `node:sqlite` backs the database, the filesystem
backs blobs and the queue spool, and the Durable Objects are in-process actors —
which is why `ecosystem.config.cjs` runs exactly one process in fork mode.
