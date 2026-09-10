# Webhooks

Events pushed to your endpoint, signed, retried, and recorded attempt by
attempt — because "did my webhook fire?" is a question a log has to be able to
answer.

## The signature

Every delivery carries:

```
MailySend-Signature: t=<unix seconds>,v1=<hex hmac>
```

`v1` is `HMAC-SHA256(secret, "<t>.<raw body>")`. Verify against the **raw**
body, before any JSON parsing — a re-serialised body is a different byte string
and will not match.

The timestamp is inside the signed material, so a captured delivery cannot be
replayed outside the tolerance window even though its signature stays valid.
Tolerance is **300 seconds**, and the comparison is constant-time.

```ts
import { verifyWebhook } from '@mailysend/core'

const ok = await verifyWebhook(endpointSecret, request.headers.get('MailySend-Signature') ?? '', rawBody)
if (!ok) return new Response('bad signature', { status: 400 })
```

## Delivery and retries

At-least-once, deliberately. A receiver must be idempotent on `event_id`.

- Each attempt is a POST with a **10-second** timeout. A non-2xx or a timeout is
  a failure.
- The queue carries the first **6 attempts**, backing off `10s → 20s → 40s …`
  capped at an hour.
- Anything still failing is handed to a Durable Object, which walks **3h → 6h →
  12h → 24h** on alarms and then gives up. Two mechanisms rather than one
  because a queue cannot hold a message for a day, and an actor alarm is the
  wrong tool for a delivery that will succeed on the second try.
- After **20 consecutive failures** the endpoint is **disabled**. A permanently
  broken endpoint is a retry amplifier, and disabling it is kinder than
  hammering it for a week. The counter resets on any success.

Every attempt is written to `webhook_deliveries` with its response status, body
and duration, and is visible on the endpoint's page — including a replay.

## Inbound forwarding

A mailbox can name one of your endpoints as its **forward webhook**, and each
parsed inbound message is then posted to it as `inbound.received`, carrying the
mailbox, thread and message ids, the envelope, the subject, a snippet, the R2
key of the raw message, and whether it arrived by exact address or the domain's
catch-all.

It goes through this same ladder rather than an inline POST: an inbound forward
has no business having weaker delivery guarantees than a bounce notification. A
forward to a disabled or deleted endpoint is logged and skipped — the mail is
filed either way.

See [RECEIVING.md](RECEIVING.md).

## See also

- [SENDING.md](SENDING.md) — the events a send produces.
- [MCP.md](MCP.md) — for an agent that would rather pull than be pushed to.
