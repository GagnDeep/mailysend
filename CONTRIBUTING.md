# Contributing

Thanks for being here. This file exists because the project got its first
outside pull requests before it had one, and every question those PRs raised is
answered below.

---

## One command

```bash
pnpm install
pnpm verify        # lint, typecheck, then the whole suite — the same thing CI runs
```

`pnpm verify` is what the CI workflow runs, so a red X on a pull request is
reproducible on your laptop with one command rather than by reading a log and
guessing which of three steps to re-run.

The three parts separately, when you want a tighter loop:

```bash
pnpm lint          # biome check .
pnpm typecheck     # tsc across every package
pnpm test          # vitest, 1,500-odd tests, ~15s
pnpm test:watch
```

**Please run `pnpm lint` before you push.** Four merged contributions landed
with formatting Biome would have rejected, which broke `pnpm lint` on `main`
and made the next contributor's first command fail for reasons that had nothing
to do with their change. `pnpm format` fixes all of it in place.

## Running it

```bash
pnpm dev                                # vite on :8917, SQLite, no Cloudflare account
pnpm --filter @mailysend/app preview    # wrangler dev, on Miniflare
```

The dev server boots an empty database, migrates it, prints a bootstrap API key
once and tells you to claim `/setup`. There is no seed step and nothing to
configure first — a fresh instance is the normal starting state, not a special
case, and anything that only works after manual setup is a bug.

## What the repository is made of

| | |
|---|---|
| `apps/app` | The Worker and the dashboard. Hono routers under `src/server/api`, TanStack Start routes under `src/routes` |
| `apps/track` | The open/click tracking Worker, separate so a pixel never queues behind an API request |
| `apps/smtp-shim` | SMTP in, HTTP out, for senders that only speak SMTP |
| `packages/contracts` | Zod schemas. The API's shape, the SDK's types and the OpenAPI document all come from here |
| `packages/core`, `db`, `events`, `providers`, `templates`, `segments`, `mcp`, `ui` | The parts the apps share |
| `cli` | `npx mailysend` — provision, deploy, claim, tail, send |
| `scripts` | Build and provisioning. `instance-names.mjs` and `ensure-resources.mjs` decide what a new deployment is allowed to adopt, and both have tests |
| `docs` | The prose the dashboard and the site link into |

## The one rule that matters

**Never draw a door that does not open.**

Most of the commit history is this rule being applied: a deploy form with four
fields and no backing shipped as a form with no fields; a documented hosted API
that did not exist was deleted rather than described; an open rate that counted
Apple's privacy pixels is labelled as adjusted and shows both populations; a
placement figure says whether it was measured against seed mailboxes or
estimated from delivery events.

In practice, when you are about to write code:

- An inferred number is never presented as a measured one.
- "We did not look" and "we looked and found nothing" are different answers and
  the code says which. `null` is not `missing` is not `0`.
- A panel with no query behind it is a lie waiting for the day it is wrong. One
  shipped: a green pulsing dot reading "Send queue drained", on every load,
  including the loads where thousands of messages were stuck.
- An error message says what happened and what to do, in the server's own
  words where it sent any. "Something went wrong" is not a message.

If a change cannot be honest about its own limits, the limits are the feature
that is missing.

## Tests

Vitest everywhere, `@cloudflare/vitest-pool-workers` for the Worker. Projects
are per package, so `npx vitest run --project app suppressions` runs one file.

Two habits worth copying:

**A test is a sentence about what went wrong.** `apps/app/test/domains.test.ts`
is a list of cases where the old code said `verified` about something it had
not established, and each test name says which. A test called
`it('works')` tells the next reader nothing about why it may not be deleted.

**Where two lists have to agree, a test holds them together.**
`contracts.test.ts` holds the status enum against the state-rank ladder;
`openapi.surface.test.ts` holds the OpenAPI document against the registered
routes — it exists because `GET /suppressions/{email}` was in the document,
every generated SDK carried the method, and the router had never registered it.
`schema-usage.test.ts` checks the server's SQL against the shipped schema.
`guides.manifest.test.ts` checks every guide link resolves. If your change
introduces a second place that has to say the same thing as the first, the test
is part of the change.

## Pull requests

- One subject per PR. A formatting sweep mixed into a bug fix makes the bug fix
  unreviewable.
- Say what was broken, how you know, and what the reader should check. A diff
  cannot explain why.
- `pnpm verify` green before you push.
- Comments explain *why*, in prose, at the point the question comes up. The
  codebase is written this way throughout; a comment that restates the line
  below it will be asked about in review.
- New API surface needs an entry in `apps/app/src/server/api/openapi.ts`, or
  `openapi.surface.test.ts` will fail — deliberately. A public endpoint should
  cost documenting it.
- Database changes: edit the Drizzle schema in `packages/db/src/schema`, run
  `pnpm db:generate`, and commit the generated migration. A fresh instance
  migrates itself on its first request, so the migration is the deploy step.

Small, obviously-correct fixes get merged quickly. Something that changes a
default, a wire format or what a screen claims will get questions about the
claim before it gets questions about the code.

## Reporting something

An issue that says what you expected, what happened, and the version from
`/v1/health` is enough to start. A deployment's own logs are the fastest route
to the rest:

```bash
npx wrangler tail            # Cloudflare
npx mailysend tail           # the same, through the CLI
```

If it is a security issue, do not open a public issue — report it privately
through GitHub's security advisories on this repository, or contact the
maintainer directly.

---

MIT licensed, same as the project. By opening a pull request you are offering
your change under that licence.
