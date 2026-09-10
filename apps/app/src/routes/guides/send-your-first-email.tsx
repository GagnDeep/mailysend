import { Callout, Terminal } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { TroubleshootingChecklist } from '~/components/guides/troubleshooting-checklist.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono, Str } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'send-your-first-email'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/send-your-first-email')({
  head: () => guideHead(SLUG),
  component: Page,
})

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You have sent one message through your own instance and you have its id, which is the
          handle for every event that message will ever produce. The thing most likely to bite you
          later is the shape of the success response: a 2xx means the message was accepted and
          spooled, not that anybody received it. Delivery, bounce and complaint all arrive
          afterwards, on the{' '}
          <a
            href="/guides/webhooks-end-to-end"
            className="text-accent underline underline-offset-4"
          >
            event stream
          </a>
          , and treating acceptance as delivery is how a broken sending domain goes unnoticed for a
          week.
        </p>
      }
    >
      {{
        'one-request': (
          <>
            <Lede>
              The send endpoint is <Mono>POST /v1/emails</Mono> on your own Worker. The request and
              response shapes are Resend’s exactly, which is not a marketing claim but a
              compatibility contract: if you already have <Mono>resend</Mono> installed, changing
              the base URL and the API key is the entire migration. Everything MailySend adds to the
              payload is additive, and their SDK ignores fields it does not know.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Start with curl, because it has no SDK version to be wrong about and the failure modes
              are visible. The <Mono>from</Mono> address has to be on a domain you have{' '}
              <a
                href="/guides/verify-a-sending-domain"
                className="text-accent underline underline-offset-4"
              >
                verified
              </a>
              ; anything else is refused with <Mono>invalid_from_address</Mono> before a single byte
              reaches a transport.
            </p>
            <Code>
              {'curl https://'}
              <Key>your-worker.workers.dev</Key>
              {'/v1/emails \\\n  -H '}
              <Str>{'"Authorization: Bearer ms_test_…"'}</Str>
              {' \\\n  -H '}
              <Str>{'"Content-Type: application/json"'}</Str>
              {" \\\n  -d '{\n    "}
              <Key>{'"from"'}</Key>
              {': '}
              <Str>{'"Acme <hello@yourdomain.com>"'}</Str>
              {',\n    '}
              <Key>{'"to"'}</Key>
              {': ['}
              <Str>{'"someone@example.com"'}</Str>
              {'],\n    '}
              <Key>{'"subject"'}</Key>
              {': '}
              <Str>{'"It works"'}</Str>
              {',\n    '}
              <Key>{'"html"'}</Key>
              {': '}
              <Str>{'"<p>First one.</p>"'}</Str>
              {"\n  }'"}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Use a <Mono>ms_test_</Mono> key for this. The prefix scheme mirrors Stripe’s precisely
              so that the environment is legible in a log line or a screenshot, which is the whole
              point of having one — you should never have to open a dashboard to find out whether
              the key in a paste is live.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The same call from the SDKs. Node first, because it is the one most people already
              have:
            </p>
            <Code>
              <Com>{'// npm i mailysend   — or keep the resend SDK and repoint it'}</Com>
              {'\n'}
              <Key>import</Key>
              {' { MailySend } '}
              <Key>from</Key> <Str>{"'mailysend'"}</Str>
              {'\n\n'}
              <Key>const</Key>
              {' ms = '}
              <Key>new</Key>
              {
                ' MailySend({ apiKey: process.env.MS_API_KEY, baseUrl: process.env.MS_BASE_URL })\n\n'
              }
              <Key>const</Key>
              {' { id } = '}
              <Key>await</Key>
              {' ms.emails.send({\n  from: '}
              <Str>{"'Acme <hello@yourdomain.com>'"}</Str>
              {',\n  to: ['}
              <Str>{"'someone@example.com'"}</Str>
              {'],\n  subject: '}
              <Str>{"'It works'"}</Str>
              {',\n  html: '}
              <Str>{"'<p>First one.</p>'"}</Str>
              {',\n})'}
            </Code>
            <Code>
              <Com>{'# python'}</Com>
              {'\n'}
              <Key>import</Key>
              {' httpx\n\nr = httpx.post(\n  f'}
              <Str>{'"{BASE}/v1/emails"'}</Str>
              {',\n  headers={'}
              <Str>{'"Authorization"'}</Str>
              {': f'}
              <Str>{'"Bearer {KEY}"'}</Str>
              {'},\n  json={\n    '}
              <Str>{'"from"'}</Str>
              {': '}
              <Str>{'"Acme <hello@yourdomain.com>"'}</Str>
              {',\n    '}
              <Str>{'"to"'}</Str>
              {': ['}
              <Str>{'"someone@example.com"'}</Str>
              {'],\n    '}
              <Str>{'"subject"'}</Str>
              {': '}
              <Str>{'"It works"'}</Str>
              {',\n    '}
              <Str>{'"html"'}</Str>
              {': '}
              <Str>{'"<p>First one.</p>"'}</Str>
              {',\n  },\n)\nprint(r.json()['}
              <Str>{'"id"'}</Str>
              {'])'}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Go, PHP and Ruby have no MailySend-specific package and do not need one. The endpoint
              is a JSON POST with a bearer token; the Resend clients for those languages accept a
              base URL override, and any HTTP client in any language is four lines. If your language
              has a Resend SDK, point it here. If it does not, do not wait for one.
            </p>
            <Callout variant="warn" title="FIFTY RECIPIENTS, COUNTED ACROSS TO PLUS CC PLUS BCC">
              The ceiling is fifty addresses total for one message on every current transport —
              Cloudflare Email Service, Amazon SES, Resend and raw SMTP all cap at the same number,
              so the limit is enforced at acceptance rather than surprising you at the provider. It
              is <em>not</em> fifty in <Mono>to</Mono> plus fifty in <Mono>bcc</Mono>. Over that,
              you want a{' '}
              <a
                href="/guides/batch-and-schedule"
                className="text-accent underline underline-offset-4"
              >
                batch
              </a>{' '}
              (a hundred distinct messages) or a{' '}
              <a
                href="/guides/broadcasts-at-scale"
                className="text-accent underline underline-offset-4"
              >
                broadcast
              </a>{' '}
              (one message to an audience). They are different endpoints because they are different
              jobs, not because of a pricing tier.
            </Callout>
          </>
        ),
        'the-response': (
          <>
            <Lede>
              A successful send returns a small object: an <Mono>id</Mono>, a{' '}
              <Mono>created_at</Mono>, and — only when it applies — a <Mono>suppressed</Mono> array.
              That is the whole payload, and each of the three is worth understanding before you
              build anything on top of it.
            </Lede>
            <Code>
              {'{\n  '}
              <Key>{'"id"'}</Key>
              {': '}
              <Str>{'"email_2Nq8x…"'}</Str>
              {',\n  '}
              <Key>{'"created_at"'}</Key>
              {': '}
              <Str>{'"2026-09-11T09:31:04.118Z"'}</Str>
              {',\n  '}
              <Key>{'"suppressed"'}</Key>
              {': ['}
              <Str>{'"bounced@example.com"'}</Str>
              {']  '}
              <Com>{'← present only if something was dropped'}</Com>
              {'\n}'}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The id is yours, not the provider’s.</strong> It is
              minted in the synchronous half of the send path — before anything touches a network —
              which is the decision the entire multi-transport design rests on. Because the id
              exists before a provider is chosen, it survives a failover mid-send, a migration from
              SES to Cloudflare next year, and a provider that loses its own identifier. The
              provider’s id is recorded separately as <Mono>provider_message_id</Mono> and is
              queryable when you need to open a support ticket with them, but it is never the
              primary key of your mail.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Acceptance is not delivery.</strong> By the time you get
              this response the API has authenticated you, reserved your idempotency key, resolved
              and checked the sending domain, filtered the suppression list, resolved any schedule,
              minted the id, spooled the envelope and put it on a queue. It has not opened an SMTP
              connection. Delivery happens on the consumer, asynchronously, and the outcome reaches
              you as an event — <Mono>delivered</Mono>, <Mono>bounced</Mono>,{' '}
              <Mono>complained</Mono> — not as an HTTP status. Any dashboard that shows a green tick
              at this moment is showing you the wrong thing.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                <Mono>suppressed</Mono> is the difference between “we sent it” and “we sent it to
                the three of five recipients who were not suppressed”.
              </strong>{' '}
              It only appears when at least one address was dropped, so its presence is itself the
              signal. If <em>every</em> recipient is suppressed the request is refused outright with{' '}
              <Mono>recipient_suppressed</Mono> rather than accepted — silently accepting a message
              with nobody to deliver it to would appear in your dashboard as a delivered email that
              nobody received, which is the worst of both worlds.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The field worth logging on your side is the <Mono>id</Mono>, stored next to whatever
              your application calls this thing — the order number, the invite, the password reset.
              Six weeks later, when a customer says they never got the receipt, the only question
              that can be answered quickly is “what happened to <em>that</em> message”, and the id
              is the only key that answers it.
            </p>
          </>
        ),
        idempotency: (
          <>
            <Lede>
              A network timeout is not an answer. Your request may have been fully processed and the
              response lost on the way back, or it may never have arrived. Without an idempotency
              key those two cases are indistinguishable, and the only two strategies available are
              both wrong: retry and risk sending a second password reset, or give up and risk
              sending none.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Send an <Mono>Idempotency-Key</Mono> header and a retry inside 24 hours returns the
              original response instead of doing the work again. The key is yours to choose and
              should be derived from the thing that must happen once — an order id, a signup id, a
              reset-token id — not from a random value generated at retry time, which would be a new
              key and therefore a new send.
            </p>
            <Terminal
              caption="POST /v1/emails"
              lines={[
                {
                  kind: 'command',
                  text: 'curl -H "Idempotency-Key: order-4821-receipt" … /v1/emails',
                },
                { kind: 'success', text: '200  { "id": "email_2Nq8x…", "created_at": "…" }' },
                { kind: 'comment', text: '# connection drops. same key, same body, again:' },
                {
                  kind: 'command',
                  text: 'curl -H "Idempotency-Key: order-4821-receipt" … /v1/emails',
                },
                { kind: 'success', text: '200  { "id": "email_2Nq8x…", "created_at": "…" }' },
                { kind: 'output', text: '# one message. same id. nothing was sent twice.' },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The reservation is a single SQL insert with a conflict clause, not a cache write. That
              matters more than it sounds: an eventually-consistent store lets two simultaneous
              retries both read “absent” and both proceed, which is exactly the race an idempotency
              key exists to close. The atomic insert is the reservation; the cached response is only
              there to make the replay cheap.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Two errors are worth recognising rather than blindly retrying through. A{' '}
              <Mono>409 concurrent_idempotent_requests</Mono> means another request with the same
              key is still in flight — the correct response is to wait, not to hammer. A{' '}
              <Mono>400 invalid_idempotent_request</Mono> means the key was used before with a{' '}
              <em>different</em> body: the request is hashed and compared, so reusing a key for a
              different message is reported rather than quietly returning the wrong id. That is
              almost always a bug in how the key is derived.
            </p>
            <Callout title="THE SDK ALREADY DOES THIS">
              The Node SDK attaches a generated <Mono>Idempotency-Key</Mono> to every POST unless
              you pass one, and only retries a POST when a key is present — an automatic retry
              without one is a duplicate-send generator. Passing <Mono>idempotencyKey: null</Mono>{' '}
              explicitly opts out of both, which is a legitimate choice and is treated as one.
            </Callout>
          </>
        ),
        'nothing-arrived': (
          <>
            <Lede>
              The API accepted the message, you have an id, and the inbox is empty. This is the most
              common first-hour experience and it is almost never mysterious. Work the list in
              order: each step is cheaper than the one after it, and the order is not cosmetic —
              checking the event stream first is how an afternoon disappears into logs when the
              actual problem was a domain sitting in <Mono>pending</Mono>.
            </Lede>
            <TroubleshootingChecklist
              title="ACCEPTED, BUT NOTHING ARRIVED"
              steps={[
                {
                  label: 'The sending domain is not actually verified',
                  detail:
                    'A domain can exist, look right in the dashboard, and still be pending because one DNS record has not propagated or was pasted with the domain appended twice. Re-run verification and read which record failed; a send from an unverified domain is refused, so if you got an id this is not it — but a domain that verified and later broke is the single most common cause of a silent stop.',
                },
                {
                  label: 'The transport credentials are wrong or missing',
                  detail:
                    'The API accepts and queues before any provider is contacted, so a bad SES key or a Cloudflare account without Email Sending enabled produces a perfectly healthy 200 and a failure on the consumer minutes later. Check the message status: queued that never becomes sent means the send worker could not authenticate.',
                },
                {
                  label: 'The recipient is on the suppression list',
                  detail:
                    'If some recipients were dropped the response carried a suppressed array; if all of them were, the request was refused outright. A previous hard bounce or a complaint suppresses an address permanently and deliberately — check the suppressions screen before assuming a delivery problem, and remove the entry only if you know why it was added.',
                },
                {
                  label: 'The event stream says it was delivered',
                  detail:
                    'Now open the message timeline. A delivered event means the receiving server accepted it and the message is in a spam folder, a filtered tab, or a corporate quarantine — that is a deliverability question, not a sending one. A bounced event names the class and carries the SMTP text, which is a different guide again.',
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              One more thing worth ruling out early, because it costs nothing: send to an address on
              a different provider than the one you are testing with. A message from a brand-new
              domain to your own Google Workspace account, where you are also the postmaster, is the
              single least representative test available. Send to a personal Gmail, a personal
              Outlook and one corporate address, and you will learn more in three minutes than the
              logs will tell you in an hour.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              If the timeline shows a bounce, the SMTP response is preserved verbatim on the event.{' '}
              <a
                href="/guides/debug-a-550-rejection"
                className="text-accent underline underline-offset-4"
              >
                Reading a 550
              </a>{' '}
              covers how to turn that text into a decision. If the timeline shows a delivery and the
              recipient still cannot find it,{' '}
              <a
                href="/guides/why-email-goes-to-spam"
                className="text-accent underline underline-offset-4"
              >
                why email goes to spam
              </a>{' '}
              is the right next stop.
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
