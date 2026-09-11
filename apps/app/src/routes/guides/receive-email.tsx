import { Callout, StepCard } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import type { DiagramStep } from '~/components/marketing/guide-blocks.tsx'
import {
  Contrast,
  Diagram,
  FactTable,
  Gotcha,
  Takeaway,
} from '~/components/marketing/guide-blocks.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono, Str } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'receive-email'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/receive-email')({
  head: () => guideHead(SLUG),
  component: Page,
})

/** The five hops, short enough to sit in a row of boxes. Detail is in the table under it. */
const HOPS: DiagramStep[] = [
  { kicker: 'DNS', title: '1. MX record', meta: 'Published by Cloudflare' },
  { kicker: 'CLOUDFLARE', title: '2. Email Routing', meta: 'A rule matches the recipient' },
  {
    kicker: 'WORKERS',
    title: '3. email() handler',
    meta: 'Check, stream, enqueue',
    tone: 'accent',
  },
  { kicker: 'QUEUES', title: '4. ms-inbound', meta: 'Parse, thread, score' },
  { kicker: 'STORAGE', title: '5. R2, D1, /app/mail', meta: 'Your bucket, your database' },
]

/** The one-time check that proves all five hops at once. */
const MANUAL_CHECK: Array<[string, string]> = [
  [
    'Open Email Routing',
    'In the Cloudflare dashboard for this zone. This is the one piece of state the product cannot read for you.',
  ],
  [
    'Confirm the catch-all rule',
    'Its action must be Send to a Worker, and the script must be this instance.',
  ],
  [
    'Send yourself a message',
    'Then watch it appear in the mail screen. About thirty seconds, and it is the only test that covers every hop.',
  ],
]

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          Mail addressed to your domain now lands in a mailbox you can read, with the raw bytes and
          any attachments in your own R2 bucket and the edge’s SPF, DKIM and DMARC verdicts recorded
          against each message. There is exactly <em>one</em> thing to configure, and it is not
          here: a Cloudflare Email Routing catch-all rule whose action is <em>Send to a Worker</em>,
          pointed at this deployment. Nothing inside the instance has to be set up to match it —
          every address at a domain this workspace has added is accepted, and the mailbox that holds
          the mail is created by the first message that arrives.
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
            <Takeaway>
              Everything cheap happens at hop three, inside an open SMTP conversation. Everything
              expensive happens at hop four, where the CPU budget is 60 seconds.
            </Takeaway>
            <Diagram steps={HOPS} />
            <FactTable
              columns={['Hop', 'What happens there']}
              rows={[
                [
                  'MX record',
                  'Published by Cloudflare itself when you enable Email Routing on the zone. Nothing to copy.',
                ],
                [
                  'Email Routing',
                  'A rule matches the recipient and sends the message to a Worker. SPF, DKIM and DMARC are already evaluated here.',
                ],
                [
                  'email() handler',
                  'Three things only: does the recipient exist, stream the raw bytes to R2, enqueue. A slow handler defers real mail.',
                ],
                [
                  'ms-inbound queue',
                  'Parsing, attachments, threading, spam scoring — where the CPU budget is 60 seconds instead of a few milliseconds of goodwill.',
                ],
                [
                  'R2, D1 and /app/mail',
                  'Raw message and attachments in your bucket, headers and threads in your database, the thread list on screen.',
                ],
              ]}
            />
            <Gotcha title="Hop three is holding an SMTP conversation open">
              The <Mono>email()</Mono> handler runs inside Cloudflare’s mail pipeline, where a slow
              handler means a deferred message and eventually a bounce. So it does the three
              cheapest possible things and gets out of the way: check that the recipient resolves to
              something, stream the raw bytes into R2 without ever buffering them in memory, and put
              a small job on a queue.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                One thing has to be captured at hop three and cannot be recovered later:
              </strong>{' '}
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
            <Takeaway>
              In the Cloudflare dashboard:{' '}
              <strong className="text-ink">Email → Email Routing</strong>, enable it, then add a
              rule whose action is <strong className="text-ink">Send to a Worker</strong> and whose
              script is this instance.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'Cloudflare’s catch-all rule',
                  tone: 'neutral',
                  points: [
                    'Lives in the zone, configured in the Cloudflare dashboard',
                    'Decides whether a message for an arbitrary address is handed to your Worker at all',
                    'For most deployments this is the rule you want, because the alternative is maintaining the same address list in two systems and discovering the drift when a message vanishes',
                  ],
                },
                {
                  label: 'A mailbox’s catch-all flag',
                  tone: 'neutral',
                  points: [
                    'Lives in this instance, on one mailbox',
                    'Decides whether an address with no exact mailbox is accepted once it gets here',
                    <>
                      Only one mailbox per domain may hold it, enforced by a partial unique index in
                      the database rather than by the UI — two catch-alls would make delivery depend
                      on row order
                    </>,
                  ],
                },
              ]}
            />
            <FactTable
              columns={['Inside the instance', 'Routed to the Worker?', 'What the sender gets']}
              rows={[
                [
                  'An exact-address mailbox exists',
                  'Yes',
                  'Delivered to that mailbox. Exact address always wins.',
                ],
                [
                  'No exact match, one mailbox holds the catch-all flag',
                  'Yes',
                  'Delivered to the catch-all mailbox.',
                ],
                [
                  'No mailbox at all, but the workspace owns the domain',
                  'Yes',
                  <>
                    Accepted. The handler creates a catch-all mailbox for the domain as the message
                    lands, so a freshly routed domain does not bounce its own first test message.
                  </>,
                ],
                [
                  'Nobody here has added the domain',
                  'Yes',
                  <>
                    <Mono>550 5.1.1 No such mailbox</Mono>. Owning the domain in this instance is
                    the whole of the boundary — without it, a routing rule would file a stranger’s
                    mail into your workspace.
                  </>,
                ],
                [
                  'Irrelevant — no routing rule',
                  'No',
                  'The message never reaches the Worker at all.',
                ],
              ]}
              caption="Exact address first, then the domain’s catch-all, then the domain itself. That order is not arbitrary: a mailbox with its own forwarding webhook, its own agent flag and its own threads must keep receiving its own mail even when a catch-all exists beside it — and a domain with neither must still accept, because the routing rule its operator already bound says the mail belongs here."
            />
            <Gotcha title="Receiving is separate from sending">
              A verified sending domain does not receive mail. Verification proves you control the
              domain well enough to send as it; it says nothing about where its inbound mail goes,
              and the two are configured in different places. If you added the domain, published SPF
              and DKIM, watched it go green and then sent yourself a test reply, the message never
              reached this Worker at all — there is no routing rule until you make one, and that is
              the single step this page is about.
            </Gotcha>
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
            <Takeaway>
              “Which mail can a model see” is a question about which mailboxes have the agent flag,
              answered once, in a place you can audit, rather than in a prompt. The flag defaults to
              off.
            </Takeaway>
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
              <strong className="text-ink">
                The agent flag is a scope boundary, not a preference.
              </strong>{' '}
              The{' '}
              <a
                href="/guides/mcp-agent-inbox"
                className="text-accent underline underline-offset-4"
              >
                MCP server
              </a>{' '}
              reads mail through the same mailboxes you do. An agent inbox on its own address is
              inspectable, revocable and separable in the logs; an agent given read access to your
              whole support queue is none of those things.
            </p>
            <FactTable
              columns={['On every inbound row', 'What it holds']}
              rows={[
                ['from_address, to_addresses', 'The envelope as it arrived.'],
                ['subject, snippet', 'What the thread list shows without opening anything.'],
                ['parse_status', 'Whether the MIME parse on the queue consumer succeeded.'],
                ['matched_by', 'Which rule matched — the exact address, or the catch-all.'],
                ['spf, dkim, dmarc', 'The three edge verdicts, captured at hop three.'],
                ['spam_score', 'Scored on the queue consumer, where there is CPU budget for it.'],
                [
                  'raw_key, body_key',
                  'Two R2 keys: the raw RFC 5322 bytes exactly as they arrived, and the extracted body. Both in your own bucket.',
                ],
              ]}
            />
            <Gotcha title="Blob keys are validated before use">
              A key derived from message content is attacker-influenced input, and path traversal
              into an object store is a real class of bug rather than a theoretical one — so keys
              reject <Mono>..</Mono>, a leading slash and NUL bytes. Separately, messages are
              deduplicated on the raw key with a unique index, so a redelivery from the queue —
              which is a normal, expected event in an at-least-once system — files one message
              rather than two.
            </Gotcha>
          </>
        ),
        threading: (
          <>
            <Lede>
              When MailySend sends a message that expects a reply, the reply-to address carries a
              signed token: <Mono>reply+&lt;token&gt;@inbound.yourdomain.com</Mono>. When the reply
              comes back, that token names the thread it belongs to, with no heuristics involved.
            </Lede>
            <Takeaway>
              The token is the workspace id and the thread id, base64url encoded, with a truncated
              HMAC over that payload appended — so verification is a hash and a timing-safe
              comparison, with no database lookup.
            </Takeaway>
            <Code>
              {
                'To:       support@yourdomain.com\nFrom:     customer@example.com\nIn-Reply-To: <a1b2@yourdomain.com>\n'
              }
              <Key>{'Reply-To: reply+eyJ3cyI…~9f2c1a4e7b0d@inbound.yourdomain.com'}</Key>
              {'   '}
              <Com>{'← the signal'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                This is a higher-confidence signal than <Mono>References</Mono>,
              </strong>{' '}
              and the reason is behavioural rather than theoretical. Mail clients mangle{' '}
              <Mono>References</Mono>: they truncate it, drop it on a forward, rebuild it wrongly
              after an edit, and rewrite subjects with localised <Mono>Re:</Mono> prefixes that a
              naive normaliser will not match. What clients reliably preserve is the address they
              were told to reply to — that is the one field the entire user interface is built
              around. There is also no way to point a reply at somebody else’s thread by editing the
              address, because a forged token fails the signature check.
            </p>
            <Diagram
              steps={[
                { kicker: 'FIRST', title: 'The signed token', tone: 'accent' },
                { kicker: 'THEN', title: 'In-Reply-To' },
                { kicker: 'THEN', title: 'Normalised subject + participants' },
                { kicker: 'ELSE', title: 'A new thread' },
              ]}
            />
            <Gotcha title="A misthreaded message is a privacy incident">
              An invalid or absent token never drops mail — threading falls through the order above.
              The last fallback is the one that matters for correctness: a message that cannot be
              attributed to an existing conversation starts its own rather than being filed into a
              plausible-looking neighbour. In a shared support inbox that is not a cosmetic problem,
              so the tie-break goes toward a new thread every time.
            </Gotcha>
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
            <Takeaway>
              So the receiving panel says what it measured, says what it did not, and puts a button
              straight to the Email Routing page for the one thing you have to confirm with your own
              eyes.
            </Takeaway>
            <FactTable
              columns={['Fact', 'Can the dashboard know?']}
              monoFirst={false}
              rows={[
                ['MX points at Cloudflare', 'Yes — a DNS lookup'],
                ['A mailbox exists on this domain', 'Yes — its own database'],
                ['A mailbox holds the catch-all flag', 'Yes — its own database'],
                [
                  'Email Routing’s catch-all rule sends to this Worker',
                  <span key="catch-all-rule" className="text-warning">
                    No — not exposed by the API
                  </span>,
                ],
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The tempting design is a green tick that means “MX verified”
              </strong>{' '}
              and lets the reader infer the rest. That is the version this product refuses to ship.
              A verified MX is not a working setup, and an indicator that reads like one converts a
              five-minute configuration check into an afternoon of debugging a system that was
              telling you it was fine.
            </p>
            <Callout title="A MIRROR YOU CANNOT REFRESH IS WORSE THAN NO MIRROR">
              Storing the setting locally when the operator ticks a box here would produce a value
              that is right on the day it is written and silently wrong forever after — somebody
              changes the rule in Cloudflare, the copy here keeps saying what it said last year, and
              now the dashboard is actively lying rather than merely quiet. The general principle
              runs through the whole product: state that lives in someone else’s system and cannot
              be read back is not mirrored, it is linked.
            </Callout>
            <div className="my-5 grid gap-3 md:grid-cols-3">
              {MANUAL_CHECK.map(([title, body], index) => (
                <StepCard key={title} step={index + 1} title={title} description={body} />
              ))}
            </div>
          </>
        ),
      }}
    </GuideLayout>
  )
}
