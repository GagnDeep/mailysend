# Agents

What to hand an agent, in the order that keeps the blast radius small.

## Start with a test key

`/app/api-keys` → environment **test**, permission **sending_access**. A test
key's sends are recorded exactly as live ones are and never leave the building,
so the first thing you learn is whether the agent composes a sensible message —
not whether it emailed a customer.

Promote to a live key once you have watched it work. Bind the key to one domain
while you are there: a key with a domain set can only send from that domain,
whatever the agent asks for.

## Give it the skill

`/app/agents` generates a skill file against **this** deployment's endpoint —
copy it from there rather than from here, because the URL in it has to be yours.
Its shape:

```markdown
---
name: mailysend
description: Send, read and analyse email through a MailySend instance over MCP.
---

# MailySend

MCP endpoint: https://your-deployment/mcp
Auth: `Authorization: Bearer <api key>`

## Sending is gated

`send_email` and `reply_to_thread` NEVER send on the first call. They return a
confirmation request describing exactly what would be sent, and a person must
approve it out of band. Then call the same tool again with the identical
payload plus the `confirmation_token` you were given.

There is no tool, method or argument that approves a confirmation. Do not look
for one and do not retry in a loop. Report the pending confirmation to the user,
point them at the approval channel in the response, and wait.
```

The last paragraph earns its place. An agent that does not know approval is out
of band will retry in a loop, and a retry loop against a confirmation gate is
indistinguishable from an attack on it.

## Scope what it reads

Turn on **Agent** for the mailboxes an agent should see, under a domain's
Receiving tab. Until you mark the first one, an agent with `full_access` reads
everything; marking one is what draws the boundary. See [MCP.md](MCP.md).

## Watch the approvals queue

`/app/approvals` is where an agent's sends wait. It shows the tool, the summary
of what would be sent, when it was asked and when it expires — and, for a
decided one, whether the agent ever came back to redeem it. An approval that was
never consumed is an agent that gave up, which is usually a bug in the agent
rather than in the gate.

## See also

- [MCP.md](MCP.md) — the tools, the protocol, the scoping model.
- [WEBHOOKS.md](WEBHOOKS.md) — for an agent that would rather be pushed to.
