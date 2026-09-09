# Configuration

**Nothing in this file is required to get a working deployment.** Every value
has a default, and the two that cannot be defaulted are generated and stored by
the instance on first boot. This is the reference for when you want to override
something — not a checklist to work through before deploying.

`.env.example` in the repository root is deliberately shorter than this page:
the Deploy to Cloudflare flow builds its variables form from that file, and a
form with eighteen fields is a form nobody finishes.

## What the instance resolves for itself

| Variable | If you leave it unset |
|---|---|
| `MS_SECRET` | A 32-byte secret is generated on first boot and stored in the `settings` table, so it survives restarts and redeploys. Set it explicitly to keep the signing key out of the database and to be able to rotate it. Must be at least 32 characters if you do set it. |
| `MS_PUBLIC_URL` | Learned from the first request's own origin and stored. A deployment first reached on `workers.dev` and later on a custom domain adopts the custom domain; a `localhost` origin is never stored, so development cannot poison a real deployment. |
| `MS_DATA_KEY` | Falls back to `MS_SECRET`. Set it separately if you want to rotate one without the other. |
| `MS_TRACKING_URL` | Falls back to `MS_PUBLIC_URL`. Set it if tracking links should point at a separate host. |

## What you may want to set

| Variable | Default | What it does |
|---|---|---|
| `MS_MODE` | `single` | `single` for a self-hosted instance, `saas` for the hosted product |
| `MS_DEFAULT_PROVIDER` | `cloudflare` | The transport used when a workspace has configured none |
| `MS_OWNER_EMAIL` | — | The address that owns the dashboard. Its first one-time code is printed to the process log while no sending domain is verified |
| `EVENT_DETAIL` | `on` | `off` stops writing a row per event and reconstructs timelines from the R2 archive |
| `MS_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `MS_ACCESS_TEAM` | — | Cloudflare Access team domain, e.g. `acme.cloudflareaccess.com` |
| `MS_ACCESS_AUD` | — | The Access application's AUD tag. Both are required for Access sign-in |
| `PORT` | `8917` | Node deployments only |
| `MS_DATA_DIR` | `./.data` | Node deployments only: SQLite, blobs and the queue spool |

## Sending credentials

**Configure these in the dashboard, not here.** Credentials set through
Settings → Providers are encrypted with AES-GCM before they are stored and are
never returned by the API, and they take precedence over the environment.

The environment variables below exist for one case: a fresh deployment that
needs to send before anybody has logged in. If that is not your situation, skip
them entirely.

| Transport | Variables |
|---|---|
| Cloudflare | Nothing. The `send_email` binding is used when it is present; `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are only needed for the REST fallback |
| Amazon SES | `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, optionally `SES_CONFIGURATION_SET` |
| Resend | `RESEND_API_KEY` |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`tls` \| `starttls` \| `none`), `SMTP_USER`, `SMTP_PASS` |

## Bindings

On Cloudflare these come from `apps/app/wrangler.jsonc`: `DB` (D1), `CACHE` and
`SUPPRESSIONS` (KV), `BUCKET` (R2), ten queues, ten Durable Object classes, two
Analytics Engine datasets and the `send_email` binding.

Most of them are created for you. D1, KV, R2 and the Durable Objects are
provisioned by the Deploy to Cloudflare flow (or by `wrangler deploy`) straight
from that file. **Queues are not** — and `wrangler deploy` refuses to deploy a
Worker that binds a queue which does not exist, so on a clean account the first
deploy used to fail with `Queue "ms-events-cf" does not exist`.

`build:cf` therefore ends by running `scripts/ensure-queues.mjs`, which creates
every queue the config names — producers, consumers and the shared dead-letter
queue — before wrangler validates them. It is idempotent, and it only runs
inside Workers Builds (`WORKERS_CI=1`) or when you set `MS_ENSURE_QUEUES=1`, so
building locally never creates resources in your account as a side effect.

If your build token lacks `Queues:Edit` the script says so and names the
queues, and one idempotent command from your own machine fixes it for good:

```bash
export CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=...
npx mailysend provision
```

Analytics Engine datasets need no provisioning: they are created on first write.

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

The root `build` script is an alias for `build:cf`, so the build command works
whether Cloudflare guesses `pnpm build` or you set it explicitly.

`MS_PUBLIC_URL` is deliberately **not** set in `wrangler.jsonc`. A placeholder
there would pin the instance to a hostname nobody owns — every tracking pixel,
unsubscribe link and canonical tag minted against it — so the value is learned
instead, and setting the variable is how you override that.

On Node there are no bindings. `node:sqlite` backs the database, the filesystem
backs blobs and the queue spool, and the Durable Objects are in-process actors —
which is why `ecosystem.config.cjs` runs exactly one process in fork mode.
