# Receiving

A verified sending domain does not receive mail. Sending and receiving are two
independent setups on the same domain, and this is the half that used to have no
screen at all.

## The shape of it

```
somebody@example.com
  → your provider's inbound service (MX)
  → its catch-all rule, bound to this instance's Worker
  → email() handler → INBOUND_QUEUE → mail_threads / mail_messages
  → /app/mail
```

Two things have to be true and they are configured in different places, which is
why the first test message so often bounces. Cloudflare has to deliver the
domain **to this Worker** — its catch-all rule, zone-side — and the address has
to exist **here**, as a mailbox or through one marked catch-all.

Mail to an address that is neither is rejected at the door with a **550** rather
than silently dropped. A sender who typoed gets told; a spammer probing for
valid addresses learns nothing more than that. Both outcomes — delivered and
rejected — are written to the event timeline, so a rejection is distinguishable
from a Worker that was never invoked.

## The catch-all toggle

A mailbox can be marked **Catch-all**, and then every address on its domain
lands in it: `anything@example.com` reaches the catch-all when no mailbox
matches exactly. Exact addresses always win, so a mailbox with its own webhook
and its own threads keeps receiving its own mail with a catch-all beside it.

One per domain. Turning it on somewhere else turns it off here rather than
failing — two catch-alls would make delivery depend on row order.

It is **off by default**, including on every mailbox that existed before this
column did. Cloudflare's catch-all rule and this switch are not the same thing:
the first decides what reaches the Worker, the second decides what the Worker
accepts.

## Checking it

**Check receiving** on a domain resolves its apex MX and reports whether it
points at `*.mx.cloudflare.net`, alongside how many mailboxes the domain has and
whether one of them is the catch-all. That is the whole of what can be observed:
Cloudflare does not expose the catch-all *rule* over its API, so a verified MX
means mail reaches Cloudflare, not that it reaches you.

A resolver that will not answer reports `error`, not `failed` — the same
distinction the sending checks make, and for the same reason.

## Cloudflare Email Routing

1. Enable **Email Routing** on the zone in the Cloudflare dashboard. Cloudflare
   publishes the MX records itself.
2. Create a **catch-all** rule and set its action to **Send to a Worker**,
   choosing this instance's Worker script.
3. Create the mailboxes you want in MailySend, on the domain's page under
   **Receiving** — and turn on **Catch-all** on one of them if you want the rest
   of the domain to arrive rather than bounce.

Confirm it with **Check receiving** on the domain's page, which resolves the MX
and checks it points at `*.mx.cloudflare.net`. As with sending, this needs no API
token — it is observation.

## Mailboxes

On a domain's page, **Receiving** creates and removes mailboxes. An address that
is not listed there does not exist as far as the inbound handler is concerned.

**Agent** on a mailbox scopes the MCP endpoint to it. The rule is opt-in rather
than fail-closed: a workspace that has never marked a mailbox is unscoped, and
marking the first one is what turns the switch into a boundary — from then on an
agent's `search_threads`, `get_thread` and `reply_to_thread` see only the
mailboxes you have marked. A conversation outside them reads as *not found*
rather than *forbidden*, because "forbidden" would leak the subject line the
boundary exists to protect. See [MCP.md](MCP.md).

**Forward to webhook** on a mailbox posts each parsed message to one of your
webhook endpoints, signed and retried on the same ladder as every other event.
See [WEBHOOKS.md](WEBHOOKS.md).

## Threading

Every inbound message is attached to a conversation, and the product records
*how* — `matched_by` — because the confidence differs enormously and pretending
otherwise produces threads that are quietly wrong.

| `matched_by` | Confidence | What happened |
|---|---|---|
| `reply_token` | Highest | The reply came back to the per-thread address we minted (`thr+<token>@…`). The thread is identified, not guessed. |
| `in_reply_to` | High | The sender echoed the `Message-ID` of a message in this thread. |
| `references` | Good | The `References` header names a message here. Clients rewrite this header more freely than `In-Reply-To`. |
| `subject_participants` | **A guess** | No threading header survived. Attached on subject and participants — two unrelated messages with the same subject between the same people would land together. |
| `new` | — | Nothing matched, so this started a conversation. |

The reading pane shows this per message. When it says *a guess*, believe it.

## What is captured

- The full original, stored in R2 and readable as **Raw .eml** in the reader.
- **SPF, DKIM and DMARC** results, parsed out of `Authentication-Results` — the
  handler received this header from the start and used to discard it.
- Attachment bytes **and** the rows that point at them. Earlier versions wrote
  the bytes to R2 with no column and no route, so they were unreachable.
- A spam score and a parse status, both surfaced rather than acted on silently.

## Duplicates

Delivery is at-least-once. A second copy of the same `raw_key` does not create a
second message — that is asserted by a test, because a queue that retries is a
queue that will eventually deliver the same message twice.

## See also

- [MAIL.md](MAIL.md) — reading, replying, and test mode.
- [SENDING.md](SENDING.md) — the other half of a domain.
