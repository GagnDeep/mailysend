# MCP & agents

Your deployment exposes a Model Context Protocol endpoint at **`/mcp`** with
nine tools. It was complete and tested long before it had a screen anywhere in
the product, which meant the endpoint existed and nobody could find its URL.
`/app/agents` is that screen; this is the reference behind it.

## Connecting

Streamable HTTP, authenticated with an ordinary API key:

```json
{
  "mcpServers": {
    "mailysend": {
      "type": "http",
      "url": "https://your-deployment/mcp",
      "headers": { "Authorization": "Bearer ms_live_…" }
    }
  }
}
```

There is deliberately **no separate agent credential**. Revoking an agent is
revoking its key, rather than a second permission system nobody remembers to
check.

Protocol versions `2025-06-18`, `2025-03-26` and `2024-11-05` are all answered.
A client pinned to an older revision is a client that will not be upgraded on
our schedule, so it is served the version it asked for where that is possible.

## The nine tools

| Tool | What it does | Key |
|---|---|---|
| `send_email` | Send a message. **Never sends on the first call.** | any |
| `reply_to_thread` | Reply in an inbound thread. Also gated. | any |
| `list_emails` | Sent messages, newest first, with delivery status. Cursor-paginated. | `full_access` |
| `get_email` | One message and its full event timeline. | `full_access` |
| `search_threads` | Full-text search across received mail. | `full_access` |
| `get_thread` | One conversation, its messages and participants. | `full_access` |
| `list_domains` | Sending domains and verification status. | `full_access` |
| `get_analytics` | Delivery, open, click, bounce, complaint over a range. | `full_access` |
| `create_contact` | Add a contact to an audience. Sends nothing. | `full_access` |

The list is the same nine for every key. A key that may not call one is told so
with `restricted_api_key` rather than shown a shorter list — a tool that quietly
disappears reads to a model as a tool that never existed.

Every tool is served by calling this deployment's own `/v1` router in-process,
so an MCP tool and the REST endpoint behind it can never disagree: same
validation, same scopes, same rate limit, same suppression check.

## The confirmation protocol

`send_email` and `reply_to_thread` do not send on their first call. They return a
**confirmation request**: a token bound to the payload digest, the tool and the
workspace, plus a summary of exactly what would be sent and the URL of the
approval channel.

1. Agent calls `send_email` with a message. It gets back
   `confirmation_required`, a token, and a summary.
2. A person opens **`/app/approvals`** and approves or rejects it.
3. Agent calls `send_email` again with the **identical** payload and the token.
   Now it sends.

The token is bound to the payload digest, so an approved confirmation cannot be
redeemed for a different message. It is single-use — `consumed_at` is claimed by
a conditional update — and it expires in minutes, because a stale approval is an
approval for a message nobody remembers.

**There is no `approve` method.** It is not in the JSON-RPC method table, it
cannot be added by a tool, and it has no alias. An agent holding a valid API key
has no reachable path to approving its own send; approval is a person, signed
in, on a page. That asymmetry is the entire security property.

Every decision is written to the audit log with the actor and the source
address.

## What a key scopes

| | |
|---|---|
| `sending_access` | `send_email` and `reply_to_thread`, nothing else. The narrowest useful agent. |
| `full_access` | The above plus reading mail, logs, domains and analytics. |
| Bound to a domain | Can only send from that domain, whatever the agent asks for. |
| Test key | Sends are recorded and never leave the building. The right thing to hand a new agent first. |

## Mailbox scoping

A mailbox marked **Agent** (a domain's Receiving tab) scopes what an agent can
read. The rule is opt-in rather than fail-closed: a workspace that has never
marked a mailbox is unscoped, and marking the first one is what turns the switch
into a boundary. From then on `search_threads`, `get_thread` and
`reply_to_thread` see only marked mailboxes.

A conversation outside them reads as *not found* rather than *forbidden* — the
distinction would leak the subject line the boundary exists to protect.

## See also

- [AGENTS.md](AGENTS.md) — the skill file, and what to give an agent first.
- [RECEIVING.md](RECEIVING.md) — mailboxes, the Agent switch, the catch-all.
