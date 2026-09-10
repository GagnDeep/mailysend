import { Callout, CodeTabs, StepCard, Terminal } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { Contrast, FactTable, Gotcha, Takeaway } from '~/components/marketing/guide-blocks.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Com, Key, Lede, Mono, Str } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'send-your-first-email'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/send-your-first-email')({
  head: () => guideHead(SLUG),
  component: Page,
})

/* The copy-button payloads. The highlighted `children` below render the same text. */
const CURL_CODE = `curl https://your-worker.workers.dev/v1/emails \\
  -H "Authorization: Bearer ms_test_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "Acme <hello@yourdomain.com>",
    "to": ["someone@example.com"],
    "subject": "It works",
    "html": "<p>First one.</p>"
  }'`

const NODE_CODE = `// npm i mailysend   — or keep the resend SDK and repoint it
import { MailySend } from 'mailysend'

const ms = new MailySend({ apiKey: process.env.MS_API_KEY, baseUrl: process.env.MS_BASE_URL })

const { id } = await ms.emails.send({
  from: 'Acme <hello@yourdomain.com>',
  to: ['someone@example.com'],
  subject: 'It works',
  html: '<p>First one.</p>',
})`

const PYTHON_CODE = `# python
import httpx

r = httpx.post(
  f"{BASE}/v1/emails",
  headers={"Authorization": f"Bearer {KEY}"},
  json={
    "from": "Acme <hello@yourdomain.com>",
    "to": ["someone@example.com"],
    "subject": "It works",
    "html": "<p>First one.</p>",
  },
)
print(r.json()["id"])`

const SEND_SAMPLES = [
  {
    value: 'curl',
    label: 'curl',
    code: CURL_CODE,
    children: (
      <>
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
      </>
    ),
  },
  {
    value: 'node',
    label: 'node',
    code: NODE_CODE,
    children: (
      <>
        <Com>{'// npm i mailysend   — or keep the resend SDK and repoint it'}</Com>
        {'\n'}
        <Key>import</Key>
        {' { MailySend } '}
        <Key>from</Key> <Str>{"'mailysend'"}</Str>
        {'\n\n'}
        <Key>const</Key>
        {' ms = '}
        <Key>new</Key>
        {' MailySend({ apiKey: process.env.MS_API_KEY, baseUrl: process.env.MS_BASE_URL })\n\n'}
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
      </>
    ),
  },
  {
    value: 'python',
    label: 'python',
    code: PYTHON_CODE,
    children: (
      <>
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
      </>
    ),
  },
]

/** The order is the substance: each check is cheaper than the one after it. */
const NOTHING_ARRIVED: Array<{ title: string; body: string }> = [
  {
    title: 'The sending domain is not actually verified',
    body: 'A domain can exist, look right in the dashboard, and still be pending because one DNS record has not propagated or was pasted with the domain appended twice. Re-run verification and read which record failed; a send from an unverified domain is refused, so if you got an id this is not it — but a domain that verified and later broke is the single most common cause of a silent stop.',
  },
  {
    title: 'The transport credentials are wrong or missing',
    body: 'The API accepts and queues before any provider is contacted, so a bad SES key or a Cloudflare account without Email Sending enabled produces a perfectly healthy 200 and a failure on the consumer minutes later. Check the message status: queued that never becomes sent means the send worker could not authenticate.',
  },
  {
    title: 'The recipient is on the suppression list',
    body: 'If some recipients were dropped the response carried a suppressed array; if all of them were, the request was refused outright. A previous hard bounce or a complaint suppresses an address permanently and deliberately — check the suppressions screen before assuming a delivery problem, and remove the entry only if you know why it was added.',
  },
  {
    title: 'The event stream says it was delivered',
    body: 'Now open the message timeline. A delivered event means the receiving server accepted it and the message is in a spam folder, a filtered tab, or a corporate quarantine — that is a deliverability question, not a sending one. A bounced event names the class and carries the SMTP text, which is a different guide again.',
  },
]

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
            <Takeaway>
              One POST, a bearer token, and a <Mono>from</Mono> address on a{' '}
              <a
                href="/guides/verify-a-sending-domain"
                className="text-accent underline underline-offset-4"
              >
                verified
              </a>{' '}
              domain — anything else is refused with a 403 <Mono>invalid_from_address</Mono> before
              a single byte reaches a transport.
            </Takeaway>
            <CodeTabs items={SEND_SAMPLES} caption="POST /v1/emails" />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Start with curl.</strong> It has no SDK version to be
              wrong about and its failure modes are visible. Use a <Mono>ms_test_</Mono> key: the
              prefix scheme mirrors Stripe’s precisely so that the environment is legible in a log
              line or a screenshot, which is the whole point of having one — you should never have
              to open a dashboard to find out whether the key in a paste is live.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Go, PHP and Ruby need no package.</strong> The endpoint
              is a JSON POST with a bearer token; the Resend clients for those languages accept a
              base URL override, and any HTTP client in any language is four lines. If your language
              has a Resend SDK, point it here. If it does not, do not wait for one.
            </p>
            <Gotcha title="Fifty recipients, counted across to plus cc plus bcc">
              The ceiling is fifty addresses total for one message on every current transport —
              Cloudflare Email Service, Amazon SES, Resend and raw SMTP all cap at the same number,
              so the limit is enforced at acceptance rather than surprising you at the provider. It
              is <em>not</em> fifty in <Mono>to</Mono> plus fifty in <Mono>bcc</Mono>. Over that you
              get a 422 and you want a{' '}
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
            </Gotcha>
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
            <Takeaway>
              A 200 means accepted and spooled. Delivery, bounce and complaint all arrive later as
              events, so the field worth storing next to your order number is the <Mono>id</Mono>.
            </Takeaway>
            <Terminal
              caption="POST /v1/emails · 200"
              lines={[
                { kind: 'command', text: 'curl -s … /v1/emails | jq' },
                { kind: 'success', text: '{' },
                { kind: 'success', text: '  "id": "email_2Nq8x…",' },
                { kind: 'success', text: '  "created_at": "2026-09-11T09:31:04.118Z",' },
                { kind: 'success', text: '  "suppressed": ["bounced@example.com"]' },
                { kind: 'success', text: '}' },
                { kind: 'comment', text: '# suppressed is present only if something was dropped' },
              ]}
            />
            <FactTable
              columns={['Field', 'Always there?', 'What it is for']}
              rows={[
                [
                  'id',
                  'Yes',
                  'The primary key of this message, minted before a provider is chosen. Store it.',
                ],
                [
                  'created_at',
                  'Yes',
                  <>The moment of acceptance, not of delivery. ISO 8601, UTC.</>,
                ],
                [
                  'suppressed',
                  'Only when non-empty',
                  <>
                    The recipients that were dropped. Its presence is itself the signal that this
                    send went to fewer people than you asked for.
                  </>,
                ],
                [
                  'provider_message_id',
                  'Not in this response',
                  <>
                    Recorded separately and queryable later, for when you open a support ticket with
                    the provider. It is never the primary key of your mail.
                  </>,
                ],
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The id is yours, not the provider’s.</strong> It is
              minted in the synchronous half of the send path — before anything touches a network —
              which is the decision the entire multi-transport design rests on. Because the id
              exists before a provider is chosen, it survives a failover mid-send, a migration from
              SES to Cloudflare next year, and a provider that loses its own identifier.
            </p>
            <Contrast
              sides={[
                {
                  label: 'What the 200 already did',
                  tone: 'good',
                  points: [
                    'Authenticated you and reserved your idempotency key',
                    <>
                      Resolved and checked the sending domain, then filtered the suppression list
                    </>,
                    'Resolved any schedule and minted the id',
                    'Spooled the envelope and put it on a queue',
                  ],
                },
                {
                  label: 'What the 200 did not do',
                  tone: 'bad',
                  points: [
                    'It has not opened an SMTP connection',
                    <>
                      Delivery happens on the consumer, asynchronously, and reaches you as a{' '}
                      <Mono>delivered</Mono>, <Mono>bounced</Mono> or <Mono>complained</Mono> event
                      rather than as an HTTP status
                    </>,
                    'Any dashboard showing a green tick at this moment is showing you the wrong thing',
                  ],
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">An empty inbox is not always a delivery problem.</strong>{' '}
              If <em>every</em> recipient is suppressed the request is refused outright with a 403{' '}
              <Mono>recipient_suppressed</Mono> rather than accepted — silently accepting a message
              with nobody to deliver it to would appear in your dashboard as a delivered email that
              nobody received, which is the worst of both worlds. Six weeks later, when a customer
              says they never got the receipt, the <Mono>id</Mono> stored beside your order number
              is the only key that answers “what happened to <em>that</em> message” quickly.
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
            <Takeaway>
              Send an <Mono>Idempotency-Key</Mono> header and a retry inside 24 hours returns the
              original response instead of doing the work again.
            </Takeaway>
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
              <strong className="text-ink">
                Derive the key from the thing that must happen once
              </strong>{' '}
              — an order id, a signup id, a reset-token id — never from a random value generated at
              retry time, which would be a new key and therefore a new send. The reservation itself
              is a single <Mono>INSERT … ON CONFLICT DO NOTHING</Mono>, not a cache write: an
              eventually-consistent store lets two simultaneous retries both read “absent” and both
              proceed, which is exactly the race an idempotency key exists to close.
            </p>
            <FactTable
              columns={['Answer', 'What happened', 'What to do']}
              rows={[
                [
                  '200 (replayed)',
                  'The key was seen before with this exact body, and the stored response is returned.',
                  'Nothing. The work was not repeated.',
                ],
                [
                  '409 concurrent_idempotent_requests',
                  'Another request with the same key is still in flight.',
                  'Wait, then retry. Hammering makes more of these, not fewer.',
                ],
                [
                  '400 invalid_idempotent_request',
                  <>
                    The key was used before with a <em>different</em> body — the request is hashed
                    and compared, so a reused key is reported rather than quietly returning the
                    wrong id.
                  </>,
                  'Fix how the key is derived. This is almost always a bug on your side.',
                ],
              ]}
              caption="The reservation row expires 24 hours after it is created."
            />
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
              common first-hour experience and it is almost never mysterious.
            </Lede>
            <Takeaway>
              Work these four in order. Each is cheaper than the one after it, and checking the
              event stream first is how an afternoon disappears into logs when the actual problem
              was a domain sitting in <Mono>pending</Mono>.
            </Takeaway>
            <div className="my-5 grid gap-3 md:grid-cols-2">
              {NOTHING_ARRIVED.map((check, index) => (
                <StepCard
                  key={check.title}
                  step={index + 1}
                  title={check.title}
                  description={check.body}
                />
              ))}
            </div>
            <Gotcha title="Testing against yourself proves nothing">
              A message from a brand-new domain to your own Google Workspace account, where you are
              also the postmaster, is the single least representative test available. Send to a
              personal Gmail, a personal Outlook and one corporate address, and you will learn more
              in three minutes than the logs will tell you in an hour. It costs nothing, so rule it
              out early.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Then follow the timeline.</strong> If it shows a bounce,
              the SMTP response is preserved verbatim on the event and{' '}
              <a
                href="/guides/debug-a-550-rejection"
                className="text-accent underline underline-offset-4"
              >
                reading a 550
              </a>{' '}
              covers how to turn that text into a decision. If it shows a delivery and the recipient
              still cannot find it,{' '}
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
