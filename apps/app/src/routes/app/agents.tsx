import { Button, Callout, MonoChip, toast } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { BadgeCheck, Copy, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '~/components/app/page.tsx'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/agents')({
  head: () => appHead('MCP & agents'),
  component: Agents,
})

/**
 * The agent surface, made findable.
 *
 * `packages/mcp` has been complete and tested for a long time — nine tools, a
 * cryptographic confirmation gate, protocol version negotiation — and had no
 * screen anywhere in the product. An MCP server nobody can find the URL of is
 * an MCP server nobody has.
 *
 * There is deliberately no "create an agent" button here. An agent
 * authenticates with an ordinary API key, which is what makes revoking an agent
 * the same operation as revoking anything else rather than a second permission
 * system nobody remembers to check. So this page explains and links; the key
 * comes from API keys, where every other credential comes from.
 */

interface ToolRow {
  name: string
  what: string
  /** `full_access` tools are refused outright to a sending-only key. */
  permission: 'any' | 'full_access'
  confirms?: boolean
}

/**
 * The nine, as `packages/mcp/src/tools.ts` actually defines them. Kept here in
 * the same order the server lists them so the page and `tools/list` read the
 * same — if a tool is added there and not here, the discrepancy is visible
 * rather than silent.
 */
const TOOLS: ToolRow[] = [
  {
    name: 'send_email',
    what: 'Send a message. Never sends on the first call — returns a confirmation instead.',
    permission: 'any',
    confirms: true,
  },
  {
    name: 'reply_to_thread',
    what: 'Reply to an inbound conversation, in thread. Also gated by a confirmation.',
    permission: 'any',
    confirms: true,
  },
  {
    name: 'list_emails',
    what: 'Sent messages, newest first, with delivery status. Cursor-paginated.',
    permission: 'full_access',
  },
  {
    name: 'get_email',
    what: 'One message and its full event timeline.',
    permission: 'full_access',
  },
  {
    name: 'search_threads',
    what: 'Full-text search across received mail.',
    permission: 'full_access',
  },
  {
    name: 'get_thread',
    what: 'One conversation, with its messages and participants.',
    permission: 'full_access',
  },
  {
    name: 'list_domains',
    what: 'Sending domains and their verification status — check before composing a `from`.',
    permission: 'full_access',
  },
  {
    name: 'get_analytics',
    what: 'Delivery, open, click, bounce and complaint figures over a range.',
    permission: 'full_access',
  },
  {
    name: 'create_contact',
    what: 'Add a contact to an audience. Sends nothing, so it needs no confirmation.',
    permission: 'full_access',
  },
]

function Agents() {
  const [copied, setCopied] = useState<string | null>(null)
  // Client-side: these pages prerender, and a build-time origin would be the
  // origin of the machine that built the artefact rather than this deployment.
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const endpoint = `${origin}/mcp`

  const copy = (label: string, text: string) => {
    void navigator.clipboard?.writeText(text)
    setCopied(label)
    toast.success('Copied.')
  }

  const clientConfig = JSON.stringify(
    {
      mcpServers: {
        mailysend: {
          type: 'http',
          url: endpoint,
          headers: { Authorization: 'Bearer ms_live_…' },
        },
      },
    },
    null,
    2,
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="MCP & agents"
        description="Let an agent read your mail and — with your approval — send it."
        actions={
          <Button asChild variant="outline">
            <a href="/app/approvals">
              <BadgeCheck aria-hidden="true" className="size-[15px]" />
              Approvals
            </a>
          </Button>
        }
      />

      <section className="flex flex-col gap-3 rounded-card border border-line bg-card p-5">
        <h2 className="ms-display-3 m-0 text-[19px]">Endpoint</h2>
        <p className="m-0 text-[14px] leading-[1.65] text-muted">
          One streamable HTTP endpoint, authenticated with an ordinary API key in an{' '}
          <code className="font-mono text-[13px]">Authorization: Bearer</code> header. There is no
          separate agent credential: revoking an agent is revoking its key.
        </p>
        <CopyRow label="endpoint" value={endpoint} copied={copied} onCopy={copy} />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink">Client configuration</span>
          <pre className="m-0 overflow-x-auto rounded-code border border-line bg-paper p-3 font-mono text-[12.5px] leading-[1.6] text-ink">
            {clientConfig}
          </pre>
          <span className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => copy('config', clientConfig)}>
              <Copy aria-hidden="true" className="size-[14px]" />
              {copied === 'config' ? 'Copied' : 'Copy config'}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href="/app/api-keys">
                <KeyRound aria-hidden="true" className="size-[14px]" />
                Create a key
              </a>
            </Button>
          </span>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-line bg-card p-5">
        <h2 className="ms-display-3 m-0 text-[19px]">Tools</h2>
        <p className="m-0 text-[14px] leading-[1.65] text-muted">
          Nine, and the list is the same nine for every key — a key that may not call one is told
          so, rather than shown a shorter list. A tool that quietly disappears reads to a model as a
          tool that never existed.
        </p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {TOOLS.map((tool) => (
            <li
              key={tool.name}
              className="flex flex-wrap items-start justify-between gap-3 rounded-code border border-line bg-paper p-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[13px] text-ink">{tool.name}</span>
                <span className="mt-0.5 block text-[12.5px] leading-[1.6] text-muted-2">
                  {tool.what}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {tool.confirms ? <MonoChip size="sm">NEEDS APPROVAL</MonoChip> : null}
                <MonoChip size="sm" tone={tool.permission === 'any' ? 'ink' : 'accent'}>
                  {tool.permission === 'any' ? 'ANY KEY' : 'FULL ACCESS'}
                </MonoChip>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-line bg-card p-5">
        <h2 className="ms-display-3 m-0 text-[19px]">What a key can do</h2>
        <p className="m-0 text-[14px] leading-[1.65] text-muted">
          The key's own scope is the agent's scope, which is why there is nothing extra to configure
          here.
        </p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13.5px] leading-[1.65]">
          <li className="rounded-code border border-line bg-paper p-3">
            <strong>sending_access</strong> — may call{' '}
            <code className="font-mono text-[12.5px]">send_email</code> and{' '}
            <code className="font-mono text-[12.5px]">reply_to_thread</code> and nothing else. The
            narrowest useful agent, and the one to start with.
          </li>
          <li className="rounded-code border border-line bg-paper p-3">
            <strong>full_access</strong> — everything above, plus reading mail, logs, domains and
            analytics.
          </li>
          <li className="rounded-code border border-line bg-paper p-3">
            <strong>Bound to a domain</strong> — a key with a domain set can only send from that
            domain, whatever the agent asks for.
          </li>
          <li className="rounded-code border border-line bg-paper p-3">
            <strong>Live or test</strong> — a test key's sends are recorded and never leave the
            building, which is the right thing to hand a new agent first.
          </li>
          <li className="rounded-code border border-line bg-paper p-3">
            <strong>Mailboxes marked Agent</strong> — a key that is not{' '}
            <code className="font-mono text-[12.5px]">full_access</code> reads only the mailboxes
            you have switched <strong>Agent</strong> on for, under a domain's Receiving tab.
          </li>
        </ul>
      </section>

      <Callout variant="info" title="Sending always waits for you">
        The two tools that send mail return a confirmation on their first call — a token bound to
        that exact message — and send only when a second call carries the token back with an
        identical payload. There is no MCP method, alias or argument that approves one: an agent
        holding a valid key still cannot approve its own send. You do it on{' '}
        <a href="/app/approvals" className="text-accent underline-offset-2 hover:underline">
          Approvals
        </a>
        .
      </Callout>

      <section className="flex flex-col gap-3 rounded-card border border-line bg-card p-5">
        <h2 className="ms-display-3 m-0 text-[19px]">Agent skill</h2>
        <p className="m-0 text-[14px] leading-[1.65] text-muted">
          A short instruction file describing the tools and the confirmation protocol, for an agent
          harness that takes one. Drop it in beside the MCP configuration above.
        </p>
        <span className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy('skill', skillMarkdown(endpoint))}
          >
            <Copy aria-hidden="true" className="size-[14px]" />
            {copied === 'skill' ? 'Copied' : 'Copy skill'}
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href="/docs#mcp">Read the MCP docs</a>
          </Button>
        </span>
        <pre className="m-0 max-h-[280px] overflow-auto rounded-code border border-line bg-paper p-3 font-mono text-[12.5px] leading-[1.6] text-ink">
          {skillMarkdown(endpoint)}
        </pre>
      </section>
    </div>
  )
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string
  value: string
  copied: string | null
  onCopy: (label: string, value: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-code border border-line bg-paper p-3">
      <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink">{value}</code>
      <Button variant="outline" size="sm" onClick={() => onCopy(label, value)}>
        <Copy aria-hidden="true" className="size-[14px]" />
        {copied === label ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

/**
 * The skill, generated against this instance.
 *
 * The homepage has claimed an "MCP server & agent skill" for a long time and
 * only half of that was true. It is written here rather than shipped as a
 * static file because the endpoint in it has to be *this* deployment's — a
 * skill quoting mailysend.com is the same bug as the approval channel that
 * pointed at a 404.
 */
const skillMarkdown = (endpoint: string): string => `---
name: mailysend
description: Send, read and analyse email through a MailySend instance over MCP.
---

# MailySend

MCP endpoint: ${endpoint}
Auth: \`Authorization: Bearer <api key>\`

## Sending is gated

\`send_email\` and \`reply_to_thread\` NEVER send on the first call. They return a
confirmation request describing exactly what would be sent, and a person must
approve it out of band. Then call the same tool again with the identical
payload plus the \`confirmation_token\` you were given.

There is no tool, method or argument that approves a confirmation. Do not look
for one and do not retry in a loop. Report the pending confirmation to the user,
point them at the approval channel in the response, and wait.

## Reading

- \`list_emails\` / \`get_email\` — sent messages and their event timelines.
- \`search_threads\` / \`get_thread\` — received mail.
- \`list_domains\` — check verification before composing a \`from\` address; a
  message from an unverified domain is refused.
- \`get_analytics\` — open and click figures default to the \`human\` audience
  class, which excludes Apple MPP and scanner traffic. Say so when you quote them.

## Contacts

\`create_contact\` adds a contact to an audience. It sends nothing, so it needs
no confirmation.
`
