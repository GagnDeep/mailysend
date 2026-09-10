import { Callout, FlowConnector, FlowNode } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono, Str } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'receive-email'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/receive-email')({
  head: () => guideHead(SLUG),
  component: Page,
})

const HOPS: Array<{ kicker: string; title: string; meta: string }> = [
  {
    kicker: 'DNS',
    title: 'MX record',
    meta: 'Published by Cloudflare itself when you enable Email Routing on the zone. Nothing to copy.',
  },
  {
    kicker: 'CLOUDFLARE',
    title: 'Email Routing',
    meta: 'A rule matches the recipient and sends the message to a Worker. SPF, DKIM and DMARC are already evaluated here.',
  },
  {
    kicker: 'WORKERS',
    title: 'The email() handler',
    meta: 'Three things only: does the recipient exist, stream the raw bytes to R2, enqueue. A slow handler defers real mail.',
  },
  {
    kicker: 'QUEUES',
    title: 'ms-inbound',
    meta: 'Parsing, attachments, threading, spam scoring — where the CPU budget is 60 seconds instead of a few milliseconds of goodwill.',
  },
  {
    kicker: 'STORAGE',
    title: 'R2, D1 and /app/mail',
    meta: 'Raw message and attachments in your bucket, headers and threads in your database, the thread list on screen.',
  },
]

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          Mail addressed to your domain now lands in a mailbox you can read, with the raw bytes and
          any attachments in your own R2 bucket and the edge’s SPF, DKIM and DMARC verdicts recorded
          against each message. The thing most likely to bite you is that receiving needs{' '}
          <em>two</em> things to be true in two different places — a Cloudflare routing rule
          pointing at this Worker, and an address that exists inside the instance. Get one without
          the other and the first test message bounces with a 550, which looks like a broken
          deployment and is not one.
        </p>
      }
    >
      {{
        'the-path': (
          <>
            <Lede>
              Five hops from the sending server to the screen. Each one is observable, each one can
              be the thing that is wrong, and knowing which is which turns “inbound is broken” into
              a question with an answer.
            </Lede>
            <div className="flex flex-col">
              {HOPS.map((hop, index) => (
                <div key={hop.title}>
                  <FlowNode
                    kicker={hop.kicker}
                    title={`${index + 1}. ${hop.title}`}
                    meta={hop.meta}
                    tone={index === 2 ? 'accent' : 'paper'}
                  />
                  {index < HOPS.length - 1 ? <FlowConnector arrow className="py-1.5" /> : null}
                </div>
              ))}
            </div>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The split between hop three and hop four is the design decision worth understanding.
              The <Mono>email()</Mono> handler runs inside Cloudflare’s mail pipeline, where a slow
              handler means a deferred message and eventually a bounce — you are holding an SMTP
              conversation open. So it does the three cheapest possible things and gets out of the
              way: check that the recipient resolves to something, stream the raw bytes into R2
              without ever buffering them in memory, and put a small job on a queue. Everything
              expensive — MIME parsing, attachment extraction, threading, spam scoring — happens on
              the queue consumer, where the CPU limit is measured in seconds.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              One thing has to be captured at hop three and cannot be recovered later:{' '}
              <Mono>Authentication-Results</Mono>. Cloudflare has already run SPF, DKIM and DMARC by
              the time your handler is called, and it records the verdicts in that header. The
              connecting IP is gone by hop four, so re-deriving the SPF result there is not merely
              expensive, it is impossible. The three verdicts are read at the door and carried on
              the queue message, and they end up as three columns on every inbound row — which is
              what lets you filter a support inbox by “DMARC failed” rather than guessing from the
              display name.
            </p>
          </>
        ),
        'mx-and-routing': (
          <>
            <Lede>
              You do not publish MX records by hand. Enabling Email Routing on a Cloudflare zone
              makes Cloudflare publish its own MX records into the zone it already controls — three
              of them, at the apex. What you configure is the rule that decides what happens to a
              message once it has arrived.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              In the Cloudflare dashboard:{' '}
              <strong className="text-ink">Email → Email Routing</strong>, enable it, then add a
              rule with the action <strong className="text-ink">Send to a Worker</strong> and pick
              this instance’s script. For most deployments the rule you want is the catch-all,
              because the alternative is maintaining the same address list in two systems and
              discovering the drift when a message vanishes.
            </p>
            <Callout variant="warn" title="RECEIVING IS SEPARATE FROM SENDING">
              A verified sending domain does not receive mail. Verification proves you control the
              domain well enough to send as it; it says nothing about where its inbound mail goes,
              and the two are configured in different places. If you added the domain, published SPF
              and DKIM, watched it go green and then sent yourself a test reply, the bounce you got
              is correct behaviour.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              There are two different things called a catch-all here and confusing them is the
              commonest inbound support question, so name them separately.{' '}
              <strong className="text-ink">Cloudflare’s catch-all rule</strong> lives in the zone
              and decides whether a message for an arbitrary address is handed to your Worker at
              all. <strong className="text-ink">A mailbox’s catch-all flag</strong> lives in this
              instance and decides whether an address with no exact mailbox is accepted once it gets
              here. Both must be on for “anything@yourdomain arrives” to be true. Routing alone is
              not enough: an address with nowhere to land is answered with{' '}
              <Mono>550 5.1.1 No such mailbox</Mono>, which is why the first message anybody sends
              to a freshly routed domain bounces if there is no mailbox behind it.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The precedence rule inside the instance is exact address first, then the domain’s
              catch-all. That order is not arbitrary: a mailbox with its own forwarding webhook, its
              own agent flag and its own threads must keep receiving its own mail even when a
              catch-all exists beside it. Only one mailbox per domain may hold the flag, enforced by
              a partial unique index in the database rather than by the UI — two catch-alls would
              make delivery depend on row order, which is the kind of bug that reproduces once a
              month.
            </p>
          </>
        ),
        mailboxes: (
          <>
            <Lede>
              A mailbox is an address plus a small amount of policy. It is the unit that owns
              threads, the unit a webhook is attached to, and the unit an agent is or is not allowed
              to touch — which is why <Mono>support@</Mono> and <Mono>agent@</Mono> should be two
              mailboxes rather than one with a filter.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Create them in the receiving panel or over the API. Each carries a display name, an
              optional forwarding webhook, the catch-all flag described above, and an{' '}
              <Mono>agent_enabled</Mono> switch. That last one is the interesting one, because it is
              a scope boundary rather than a preference.
            </p>
            <Code>
              {'POST /v1/inbound/mailboxes\n{\n  '}
              <Key>{'"address"'}</Key>
              {': '}
              <Str>{'"support@yourdomain.com"'}</Str>
              {',\n  '}
              <Key>{'"name"'}</Key>
              {': '}
              <Str>{'"Support"'}</Str>
              {',\n  '}
              <Key>{'"is_catch_all"'}</Key>
              {': '}
              <Key>true</Key>
              {',\n  '}
              <Key>{'"agent_enabled"'}</Key>
              {': '}
              <Key>false</Key>
              {'   '}
              <Com>{'// an MCP agent cannot see this mailbox'}</Com>
              {'\n}'}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The{' '}
              <a
                href="/guides/mcp-agent-inbox"
                className="text-accent underline underline-offset-4"
              >
                MCP server
              </a>{' '}
              reads mail through the same mailboxes you do, so “which mail can a model see” is a
              question about which mailboxes have the agent flag, and it is answered once, in a
              place you can audit, rather than in a prompt. An agent inbox on its own address is
              inspectable, revocable and separable in the logs; an agent given read access to your
              whole support queue is none of those things. The flag defaults to off.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              What lands in a mailbox: a row per message carrying the from address, the recipients,
              the subject, a snippet, the parse status, which rule matched — exact address or
              catch-all — the three authentication verdicts, a spam score, and two R2 keys. One key
              points at the raw RFC 5322 bytes exactly as they arrived, the other at the extracted
              body. Both are in your own bucket. Blob keys are validated before use and reject{' '}
              <Mono>..</Mono>, a leading slash and NUL bytes, because a key derived from message
              content is attacker-influenced input and path traversal into an object store is a real
              class of bug rather than a theoretical one.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Messages are deduplicated on the raw key with a unique index, so a redelivery from the
              queue — which is a normal, expected event in an at-least-once system — files one
              message rather than two.
            </p>
          </>
        ),
        threading: (
          <>
            <Lede>
              When MailySend sends a message that expects a reply, the reply-to address carries a
              signed token: <Mono>reply+&lt;token&gt;@inbound.yourdomain.com</Mono>. When the reply
              comes back, that token names the thread it belongs to, with no heuristics involved.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The token is the workspace id and the thread id, base64url encoded, with a truncated
              HMAC over that payload appended. Verification is a hash and a timing-safe comparison —
              no database lookup, and no way to point a reply at somebody else’s thread by editing
              the address, because a forged token fails the signature check.
            </p>
            <Code>
              {
                'To:       support@yourdomain.com\nFrom:     customer@example.com\nIn-Reply-To: <a1b2@yourdomain.com>\n'
              }
              <Key>{'Reply-To: reply+eyJ3cyI…~9f2c1a4e7b0d@inbound.yourdomain.com'}</Key>
              {'   '}
              <Com>{'← the signal'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              This is a higher-confidence signal than <Mono>References</Mono>, which is the
              traditional answer, and the reason is behavioural rather than theoretical. Mail
              clients mangle <Mono>References</Mono>: they truncate it, drop it on a forward,
              rebuild it wrongly after an edit, and rewrite subjects with localised <Mono>Re:</Mono>{' '}
              prefixes that a naive normaliser will not match. What clients reliably preserve is the
              address they were told to reply to — that is the one field the entire user interface
              is built around.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              An invalid or absent token never drops mail. Threading falls through in order: the
              signed token, then <Mono>In-Reply-To</Mono>, then normalised subject plus
              participants, then a new thread. The last fallback is the one that matters for
              correctness — a message that cannot be attributed to an existing conversation starts
              its own rather than being filed into a plausible-looking neighbour. A misthreaded
              message in a shared support inbox is a privacy incident, not a cosmetic problem, so
              the tie-break goes toward a new thread every time.
            </p>
          </>
        ),
        'the-honest-gap': (
          <>
            <Lede>
              There is one piece of this setup the dashboard cannot show you, and rather than
              inventing a plausible indicator it links you to the place where the real value lives.
              Cloudflare’s Email Routing catch-all rule is not readable over its API. Not
              rate-limited, not awkward — not exposed.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              So the receiving panel can honestly report exactly two things. It can resolve your MX
              records and tell you whether mail for this domain reaches Cloudflare at all. And it
              can count the mailboxes on this instance and say whether one of them holds the
              catch-all flag. What it cannot do is tell you whether the rule zone-side actually
              points at this Worker, because there is no API call that answers that question.
            </p>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Fact</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">
                      Can the dashboard know?
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-line border-t">
                    <td className="px-4 py-2 text-ink">MX points at Cloudflare</td>
                    <td className="px-4 py-2 text-muted">Yes — a DNS lookup</td>
                  </tr>
                  <tr className="border-line border-t">
                    <td className="px-4 py-2 text-ink">A mailbox exists on this domain</td>
                    <td className="px-4 py-2 text-muted">Yes — its own database</td>
                  </tr>
                  <tr className="border-line border-t">
                    <td className="px-4 py-2 text-ink">A mailbox holds the catch-all flag</td>
                    <td className="px-4 py-2 text-muted">Yes — its own database</td>
                  </tr>
                  <tr className="border-line border-t">
                    <td className="px-4 py-2 text-ink">
                      Email Routing’s catch-all rule sends to this Worker
                    </td>
                    <td className="px-4 py-2 text-warning">No — not exposed by the API</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The tempting design is a green tick that means “MX verified” and lets the reader infer
              the rest. That is the version this product refuses to ship. A verified MX is not a
              working setup, and an indicator that reads like one converts a five-minute
              configuration check into an afternoon of debugging a system that was telling you it
              was fine. So the panel says what it measured, says what it did not, and puts a button
              straight to the Email Routing page for the one thing you have to confirm with your own
              eyes.
            </p>
            <Callout title="A MIRROR YOU CANNOT REFRESH IS WORSE THAN NO MIRROR">
              Storing the setting locally when the operator ticks a box here would produce a value
              that is right on the day it is written and silently wrong forever after — somebody
              changes the rule in Cloudflare, the copy here keeps saying what it said last year, and
              now the dashboard is actively lying rather than merely quiet. The general principle
              runs through the whole product: state that lives in someone else’s system and cannot
              be read back is not mirrored, it is linked.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The practical consequence is a one-time manual check. Open Email Routing, confirm the
              catch-all rule’s action is <em>Send to a Worker</em> and the script is this instance,
              then send yourself a message and watch it appear in the mail screen. That end-to-end
              test is the only thing that proves all five hops at once, and it takes about thirty
              seconds.
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
