import { Callout, StepCard, Terminal } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { Contrast, FactTable, Gotcha, Takeaway } from '~/components/marketing/guide-blocks.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono, Str } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'batch-and-schedule'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/batch-and-schedule')({
  head: () => guideHead(SLUG),
  component: Page,
})

/** Every form `parseScheduledAt` accepts, and how the echoed interpretation reads. */
const SCHEDULE_INPUTS: Array<[string, string, string]> = [
  ['2026-10-02T14:30:00Z', 'iso', 'Exact, unambiguous, and what you should send from code.'],
  ['in 90m', 'relative', 'Offset from the moment the request is accepted.'],
  [
    'in 2h30m',
    'relative',
    'Units compose, and each has spelled-out forms: s/sec/seconds, m/min/minutes, h/hr/hours, d/day/days, w/week/weeks.',
  ],
  ['30m', 'relative', 'A bare duration is accepted as relative — enough SDK users send it.'],
  ['tomorrow 9am', 'natural', 'Clock applied in UTC, not in your browser’s zone.'],
  ['today 14:30', 'natural', '“today” is accepted beside “tomorrow”, and a 24-hour clock parses.'],
  ['tomorrow', 'natural', 'No clock given, so 09:00 UTC. The interpretation is returned to you.'],
  ['now', 'natural', 'Equivalent to omitting scheduled_at entirely.'],
  [
    'next Tuesday-ish',
    'rejected',
    'Anything the parser cannot read confidently is a validation_error naming scheduled_at, never a guess.',
  ],
]

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You can now push a hundred distinct messages in one request and read the per-item results
          rather than a single pass-or-fail, and you can put a message in the future and move or
          cancel it while it is still queued. The boundary to keep in mind is that last clause:
          scheduled is the only state that is still yours. Once a message has been picked up for
          sending, <Mono>PATCH</Mono> and <Mono>DELETE</Mono> both return a not-found error, and no
          amount of API design changes the fact that mail which has left cannot be recalled.
        </p>
      }
    >
      {{
        batching: (
          <>
            <Lede>
              <Mono>POST /v1/emails/batch</Mono> takes an array of up to a hundred message objects —
              each one exactly the same shape you would send to <Mono>/v1/emails</Mono> on its own —
              and accepts them as a hundred separate messages.
            </Lede>
            <Takeaway>
              A batch of a hundred is a hundred different emails to a hundred different people, not
              one email with a hundred recipients. The second thing is not even possible here.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'A batch of 100',
                  tone: 'good',
                  points: [
                    'A hundred distinct messages, each with its own body',
                    <>
                      Each recipient gets their own <Mono>id</Mono>, their own events and their own
                      unsubscribe token
                    </>,
                    'One bad item does not touch the other ninety-nine',
                  ],
                },
                {
                  label: 'One message, many recipients',
                  tone: 'bad',
                  points: [
                    <>
                      Capped at fifty addresses across <Mono>to</Mono>, <Mono>cc</Mono> and{' '}
                      <Mono>bcc</Mono> — a hundred is refused
                    </>,
                    'Everyone shares one message id, one open pixel, one unsubscribe token and one delivery outcome',
                    'Usually a mistake the moment the content differs by so much as a first name',
                  ],
                },
              ]}
            />
            <Code>
              {'POST /v1/emails/batch\n[\n  { '}
              <Key>{'"from"'}</Key>
              {': '}
              <Str>{'"Acme <billing@yourdomain.com>"'}</Str>
              {', '}
              <Key>{'"to"'}</Key>
              {': ['}
              <Str>{'"a@example.com"'}</Str>
              {'],\n    '}
              <Key>{'"subject"'}</Key>
              {': '}
              <Str>{'"Invoice 4821"'}</Str>
              {',   '}
              <Key>{'"html"'}</Key>
              {': '}
              <Str>{'"<p>Due 30 Sep.</p>"'}</Str>
              {' },\n  { '}
              <Key>{'"from"'}</Key>
              {': '}
              <Str>{'"Acme <billing@yourdomain.com>"'}</Str>
              {', '}
              <Key>{'"to"'}</Key>
              {': ['}
              <Str>{'"b@example.com"'}</Str>
              {'],\n    '}
              <Key>{'"subject"'}</Key>
              {': '}
              <Str>{'"Invoice 4822"'}</Str>
              {',   '}
              <Key>{'"html"'}</Key>
              {': '}
              <Str>{'"<p>Due 30 Sep.</p>"'}</Str>
              {' }\n]  '}
              <Com>{'// … up to 100 items'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The hundred is not a tier</strong> and there is no plan
              that raises it. A batch is one atomic unit of work with one request timeout, and an
              unbounded array cannot be given a sensible one — the honest choices are a fixed
              ceiling or a request that sometimes dies half-processed with no way to find out what
              happened. Above a hundred, split into multiple requests; the endpoint is cheap and the
              messages are independent anyway.
            </p>
            <Callout title="ONE IDEMPOTENCY KEY COVERS THE WHOLE BATCH">
              Set <Mono>Idempotency-Key</Mono> once for the request and each item derives its own
              key from it by index — <Mono>your-key:0</Mono>, <Mono>your-key:1</Mono>, and so on. A
              retried batch is therefore idempotent per item, which is the behaviour you expect when
              you set one header for one call. It also means the order of the array is load-bearing
              across a retry: shuffle it and the keys no longer line up with the same messages.
            </Callout>
          </>
        ),
        'partial-success': (
          <>
            <Lede>
              The response is <Mono>{'{ "data": [ … ] }'}</Mono>, one entry per item, in the order
              you sent them. Nothing about a bad item at position seven touches the other
              ninety-nine.
            </Lede>
            <Takeaway>
              An accepted item carries an <Mono>id</Mono>. A rejected one carries its{' '}
              <Mono>index</Mono> and a typed <Mono>error</Mono>. Your success number is the count of
              entries carrying an id — not the HTTP status.
            </Takeaway>
            <Terminal
              caption="POST /v1/emails/batch · 200"
              lines={[
                { kind: 'command', text: 'curl -s -X POST … /v1/emails/batch -d @invoices.json' },
                { kind: 'success', text: '{ "data": [' },
                { kind: 'success', text: '  { "id": "email_2Nq8x…" },' },
                { kind: 'success', text: '  { "id": "email_2Nq8y…" },' },
                {
                  kind: 'output',
                  text: '  { "index": 2, "error": { "name": "invalid_to_address",',
                },
                {
                  kind: 'output',
                  text: '                          "message": "`bob@@example.com` is not a valid address." } },',
                },
                { kind: 'success', text: '  { "id": "email_2Nq8z…" }' },
                { kind: 'success', text: '] }' },
                { kind: 'comment', text: '# 3 accepted, 1 rejected, HTTP 200 for all of it' },
              ]}
            />
            <FactTable
              columns={['Entry shape', 'Means', 'What you do with it']}
              rows={[
                [
                  '{ "id": … }',
                  'That item was accepted and spooled.',
                  'Store the id against whatever your application calls this message.',
                ],
                [
                  '{ "index": …, "error": … }',
                  <>
                    That item was rejected. <Mono>index</Mono> is its position in the array you
                    sent, so an error entry still identifies itself once you have pulled the
                    failures into their own collection.
                  </>,
                  'Fix those items and resend only those.',
                ],
              ]}
              caption="The array is positional: data[2] is always the third item you sent."
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The alternative design — reject the whole batch on the first bad item — sounds safer
                and is worse in practice.
              </strong>{' '}
              It forces the caller to diff two arrays to work out what happened, it turns one typo
              in a CSV import into ninety-nine messages that never went, and it produces a retry
              loop that resends the ninety-nine good ones every time while never fixing the one that
              is broken.
            </p>
            <Gotcha title="The HTTP status is about the request, not the messages">
              A batch where every single item failed still returns a 200 with a body full of errors,
              because the request itself was well-formed and was processed. Code that branches on{' '}
              <Mono>response.ok</Mono> and never reads <Mono>data</Mono> will report a hundred
              successful sends that never happened.
            </Gotcha>
          </>
        ),
        scheduling: (
          <>
            <Lede>
              Add <Mono>scheduled_at</Mono> to any send — single or batched — and the message is
              stored with status <Mono>scheduled</Mono> instead of being queued immediately. You get
              the same response shape and the same id; the only difference is when the send path
              picks it up.
            </Lede>
            <Takeaway>
              The field accepts more than an ISO timestamp, and the parser echoes back how it read
              what you sent — which is the whole defence against the classic off-by-an-hour, because
              you can assert on it in a test.
            </Takeaway>
            <FactTable
              columns={['You send', 'Read as', 'Meaning']}
              rows={SCHEDULE_INPUTS.map(([input, kind, meaning]) => [
                input,
                <span key={input} className="font-mono text-[13px]">
                  {kind}
                </span>,
                meaning,
              ])}
            />
            <FactTable
              columns={['Bound', 'Error', 'Why it is there']}
              rows={[
                [
                  '30 days ahead',
                  'scheduling_too_far',
                  'A send further out than a month is nearly always a units bug — milliseconds where seconds were meant, or a year typo — and on the rare occasion it is intentional, the content is stale by the time it goes.',
                ],
                [
                  '60 seconds in the past',
                  'scheduling_in_past',
                  'A minute of slack, so that clock skew between your machine and the edge is not an error. Earlier than that is refused.',
                ],
              ]}
            />
            <Gotcha title="Everything without an explicit offset is UTC">
              Not your server’s zone, not the recipient’s, not the browser’s. A Worker’s clock is
              always UTC while a self-hosted Node box is whatever the operator set, and “the same
              job rendered a different date depending on which runtime picked it up” is a bug that
              only appears near midnight, in production, at the worst possible time. If you mean a
              local time, compute it in your own code and send an ISO timestamp with the offset in
              it. Sending <Mono>tomorrow 9am</Mono> and expecting Berlin is the mistake.
            </Gotcha>
          </>
        ),
        'change-your-mind': (
          <>
            <Lede>
              Two operations, one precondition. <Mono>PATCH /v1/emails/:id</Mono> with a new{' '}
              <Mono>scheduled_at</Mono> moves a message; <Mono>DELETE /v1/emails/:id</Mono> cancels
              it. Both require the message to still be in the <Mono>scheduled</Mono> state, and both
              return a not-found error otherwise.
            </Lede>
            <Takeaway>
              <Mono>scheduled</Mono> is the only state that is still yours. There is no state after
              it in which either call does anything.
            </Takeaway>
            <div className="flex flex-col gap-3.5">
              <StepCard step={1} title="Move it" variant="rule">
                <Terminal
                  className="mt-1.5"
                  caption="PATCH /v1/emails/:id"
                  lines={[
                    {
                      kind: 'command',
                      text: 'curl -X PATCH … /v1/emails/email_2Nq8x -d \'{"scheduled_at":"in 6h"}\'',
                    },
                    {
                      kind: 'success',
                      text: '{ "object": "email", "id": "email_2Nq8x", "scheduled_at": "2026-09-11T15:31:04.118Z" }',
                    },
                  ]}
                />
                <p className="mt-2 mb-0 text-[14px] leading-[1.6] text-muted-2">
                  The response echoes the resolved absolute time, so a relative input is confirmed
                  as a timestamp rather than left for you to recompute.
                </p>
              </StepCard>
              <StepCard step={2} title="Cancel it" variant="rule">
                <Terminal
                  className="mt-1.5"
                  caption="DELETE /v1/emails/:id"
                  lines={[
                    { kind: 'command', text: 'curl -X DELETE … /v1/emails/email_2Nq8x' },
                    {
                      kind: 'success',
                      text: '{ "object": "email", "id": "email_2Nq8x", "status": "canceled" }',
                    },
                  ]}
                />
              </StepCard>
              <StepCard step={3} title="Or find out you are too late" variant="rule">
                <Terminal
                  className="mt-1.5"
                  lines={[
                    { kind: 'command', text: 'curl -X DELETE … /v1/emails/email_2Nq8x' },
                    { kind: 'output', text: '404 not_found' },
                    {
                      kind: 'output',
                      text: 'Only a scheduled message can be canceled. This one has already been queued or sent.',
                    },
                  ]}
                />
              </StepCard>
            </div>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The cancel is two steps and both of them matter.</strong>{' '}
              The database row is moved to <Mono>canceled</Mono> under a condition that only matches
              a still-scheduled row — so two concurrent cancels cannot both succeed, and a cancel
              racing the scheduler loses cleanly rather than half-applying — and then the timer
              holding that message is told to drop it. Doing only the first would leave a fired
              timer looking for a message that is no longer sendable; doing only the second would
              leave a row claiming it is still going out.
            </p>
            <Callout variant="warn" title="NOBODY CAN RECALL A SENT MESSAGE">
              Once a message has been handed to a transport it is gone. It is on somebody else’s
              server, in somebody else’s spool, possibly already in an inbox, possibly already
              forwarded. No provider can pull it back, including this one, and an API that offered a{' '}
              <Mono>recall</Mono> endpoint would be lying to you at the exact moment you were least
              able to check. What you can have is the honest version: a hard boundary at{' '}
              <Mono>scheduled</Mono>, an error message that tells you which side of it you are on,
              and — if the window matters to you — a deliberate few minutes of{' '}
              <Mono>scheduled_at</Mono> on the sends you might want to take back. That last one is a
              real technique. A five minute delay on outbound mail from a support console has saved
              more apologies than any feature named after undo.
            </Callout>
          </>
        ),
        'batch-vs-broadcast': (
          <>
            <Lede>
              They are not two sizes of the same feature, and the difference shows up in how each
              one behaves when it gets big.
            </Lede>
            <Takeaway>
              A batch is for distinct messages you already have in hand; a broadcast is for one
              message to an audience you have not enumerated.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'Batch',
                  tone: 'neutral',
                  points: [
                    'Unit of work: one HTTP request',
                    'Size: 100 messages, hard',
                    'You supply: every message body',
                    'Progress: the response, once',
                    'Pause and resume: no such concept',
                  ],
                },
                {
                  label: 'Broadcast',
                  tone: 'good',
                  points: [
                    'Unit of work: a long-running job you can leave',
                    'Size: the audience, whatever it is',
                    'You supply: one template and a segment',
                    'Progress: a cursor you can watch',
                    'Pause and resume: the same operation as crash recovery',
                  ],
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                A broadcast is split into thirty-two fixed ranges,
              </strong>{' '}
              each with its own coordinator and a monotonic cursor, and there is deliberately no
              counting pass anywhere in it. A count is a full scan that returns a number which is
              stale the instant it is computed, and it gets slower in exact proportion to how
              expensive it already was. Because progress is a cursor rather than a count, pausing
              and resuming is the same operation the system already performs after a crash — which
              is why it is trustworthy, rather than a feature bolted on beside the happy path.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">So: clumps of transactional mail are batch work</strong>{' '}
              — a nightly run of invoices, a queue of receipts, fifty password resets from an
              incident. Anything where the recipient list is a query rather than a list, and where
              you would want to stop it halfway and look, is a{' '}
              <a
                href="/guides/broadcasts-at-scale"
                className="text-accent underline underline-offset-4"
              >
                broadcast
              </a>
              .
            </p>
            <Gotcha title="A loop that posts batches is a broadcast without the pacing">
              If you find yourself paging through contacts and posting batches, you have
              reimplemented broadcasts without the pacing, the cursor or the resume — the send path
              learns each receiver’s unpublished quota by halving on rejection and growing by at
              most double after a clean day, and your loop will not.
            </Gotcha>
          </>
        ),
      }}
    </GuideLayout>
  )
}
