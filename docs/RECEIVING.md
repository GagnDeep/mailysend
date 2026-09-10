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

Mail to an address that is not a mailbox is rejected at the door with a **550**
rather than silently dropped. A sender who typoed gets told; a spammer probing
for valid addresses learns nothing more than that.

## Cloudflare Email Routing

1. Enable **Email Routing** on the zone in the Cloudflare dashboard. Cloudflare
   publishes the MX records itself.
2. Create a **catch-all** rule and set its action to **Send to a Worker**,
   choosing this instance's Worker script.
3. Create the mailboxes you want in MailySend, on the domain's page under
   **Receiving**.

Confirm it by resolving the domain's MX and checking it points at
`*.mx.cloudflare.net`. As with sending, this needs no API token — it is
observation.

## Mailboxes

On a domain's page, **Receiving** creates and removes mailboxes. An address that
is not listed there does not exist as far as the inbound handler is concerned.

**Agent** on a mailbox exposes it over the MCP endpoint, so an agent can read and
act on that mailbox and only that one.

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
