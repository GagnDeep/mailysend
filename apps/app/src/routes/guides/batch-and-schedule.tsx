import { Callout, StepCard, Terminal } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono, Str } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'batch-and-schedule'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/batch-and-schedule')({
  head: () => guideHead(SLUG),
  component: Page,
})

const SCHEDULE_INPUTS: Array<[string, string, string]> = [
  ['2026-10-02T14:30:00Z', 'iso', 'Exact, unambiguous, and what you should send from code.'],
  ['in 90m', 'relative', 'Offset from the moment the request is accepted.'],
  ['in 2h30m', 'relative', 'Units compose: s, m, h, d, w.'],
  ['30m', 'relative', 'A bare duration is accepted as relative — enough SDK users send it.'],
  ['tomorrow 9am', 'natural', 'Clock applied in UTC, not in your browser’s zone.'],
  ['tomorrow', 'natural', 'No clock given, so 09:00 UTC. The interpretation is returned to you.'],
  ['now', 'natural', 'Equivalent to omitting scheduled_at entirely.'],
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
              and accepts them as a hundred separate messages. This is the point most people get
              wrong on the first read, so it is worth stating flatly: a batch of a hundred is a
              hundred different emails to a hundred different people, not one email with a hundred
              recipients.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Those two things have different limits, different privacy properties and different
              failure modes. One message with a hundred recipients is not even possible here — the
              ceiling is fifty addresses across <Mono>to</Mono>, <Mono>cc</Mono> and{' '}
              <Mono>bcc</Mono> — and where it <em>is</em> possible it is usually a mistake, because
              every recipient shares one message id, one open pixel, one unsubscribe token and one
              delivery outcome. A batch gives each recipient their own id, their own events and
              their own body, which is what you actually want the moment the content differs by so
              much as a first name.
            </p>
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
              The hundred is not a tier and there is no plan that raises it. A batch is one atomic
              unit of work with one request timeout, and an unbounded array cannot be given a
              sensible one — the honest choices are a fixed ceiling or a request that sometimes dies
              half-processed with no way to find out what happened. Above a hundred, split into
              multiple requests; the endpoint is cheap and the messages are independent anyway.
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
              you sent them. An accepted item carries an <Mono>id</Mono>. A rejected one carries its{' '}
              <Mono>index</Mono> and a typed <Mono>error</Mono>. Nothing about a bad item at
              position seven touches the other ninety-nine.
            </Lede>
            <Code>
              {'{\n  '}
              <Key>{'"data"'}</Key>
              {': [\n    { '}
              <Key>{'"id"'}</Key>
              {': '}
              <Str>{'"email_2Nq8x…"'}</Str>
              {' },\n    { '}
              <Key>{'"id"'}</Key>
              {': '}
              <Str>{'"email_2Nq8y…"'}</Str>
              {' },\n    { '}
              <Key>{'"index"'}</Key>
              {': 2, '}
              <Key>{'"error"'}</Key>
              {': { '}
              <Key>{'"name"'}</Key>
              {': '}
              <Str>{'"invalid_to_address"'}</Str>
              {',\n                      '}
              <Key>{'"message"'}</Key>
              {': '}
              <Str>{'"`bob@@example.com` is not a valid address."'}</Str>
              {' } },\n    { '}
              <Key>{'"id"'}</Key>
              {': '}
              <Str>{'"email_2Nq8z…"'}</Str>
              {' }\n  ]\n}'}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The alternative design — reject the whole batch on the first bad item — sounds safer
              and is worse in practice. It forces the caller to diff two arrays to work out what
              happened, it turns one typo in a CSV import into ninety-nine messages that never went,
              and it produces a retry loop that resends the ninety-nine good ones every time while
              never fixing the one that is broken. Per-item results mean the correct recovery is
              obvious: fix the items that reported an error, resend only those.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Read the results by <Mono>index</Mono>, not by position in a filtered list. The array
              is positional, so <Mono>data[2]</Mono> always corresponds to the third item you sent;
              the <Mono>index</Mono> field is there so that an error entry still identifies itself
              after you have pulled the failures out into their own collection.
            </p>
            <Callout variant="warn" title="THE HTTP STATUS IS ABOUT THE REQUEST, NOT THE MESSAGES">
              A batch where every single item failed still returns a 200 with a body full of errors,
              because the request itself was well-formed and was processed. Code that branches on{' '}
              <Mono>response.ok</Mono> and never reads <Mono>data</Mono> will report a hundred
              successful sends that never happened. Your success number is the count of entries
              carrying an <Mono>id</Mono>.
            </Callout>
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The field accepts more than an ISO timestamp, and the parser tells you how it read
              what you sent rather than making you guess. That echoed interpretation is the whole
              defence against the classic off-by-an-hour: you can assert on it in a test.
            </p>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="px-4 py-2.5 text-[12px] font-semibold">You send</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Read as</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {SCHEDULE_INPUTS.map(([input, kind, meaning]) => (
                    <tr key={input} className="border-line border-t">
                      <td className="px-4 py-2 font-mono text-[13px] text-ink">{input}</td>
                      <td className="px-4 py-2 font-mono text-[13px] text-muted">{kind}</td>
                      <td className="px-4 py-2 text-muted-2">{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Everything without an explicit offset is UTC.</strong>{' '}
              Not your server’s zone, not the recipient’s, not the browser’s. This is deliberate and
              it is the rule that stops the off-by-an-hour: a Worker’s clock is always UTC while a
              self-hosted Node box is whatever the operator set, and “the same job rendered a
              different date depending on which runtime picked it up” is a bug that only appears
              near midnight, in production, at the worst possible time. If you mean a local time,
              compute it in your own code and send an ISO timestamp with the offset in it. Sending{' '}
              <Mono>tomorrow 9am</Mono> and expecting Berlin is the mistake.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Thirty days is the ceiling.</strong> Beyond that you get{' '}
              <Mono>scheduling_too_far</Mono>. A send scheduled further out than a month is nearly
              always a units bug — milliseconds where seconds were meant, or a year typo — and on
              the rare occasion it is intentional, the content is going to be stale by the time it
              goes anyway. Scheduling into the past gives you <Mono>scheduling_in_past</Mono>, with
              a minute of slack so that clock skew between your machine and the edge is not an
              error.
            </p>
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
              The cancel is two steps and both of them matter. The database row is moved to{' '}
              <Mono>canceled</Mono> under a condition that only matches a still-scheduled row — so
              two concurrent cancels cannot both succeed, and a cancel racing the scheduler loses
              cleanly rather than half-applying — and then the timer holding that message is told to
              drop it. Doing only the first would leave a fired timer looking for a message that is
              no longer sendable; doing only the second would leave a row claiming it is still going
              out.
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
              The rule of thumb: a batch is for distinct messages you already have in hand; a
              broadcast is for one message to an audience you have not enumerated. They are not two
              sizes of the same feature, and the difference shows up in how each one behaves when it
              gets big.
            </Lede>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="px-4 py-2.5 text-[12px] font-semibold" />
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Batch</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Broadcast</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-line border-t">
                    <td className="px-4 py-2 font-semibold text-ink">Unit of work</td>
                    <td className="px-4 py-2 text-muted">One HTTP request</td>
                    <td className="px-4 py-2 text-muted">A long-running job you can leave</td>
                  </tr>
                  <tr className="border-line border-t">
                    <td className="px-4 py-2 font-semibold text-ink">Size</td>
                    <td className="px-4 py-2 text-muted">100 messages, hard</td>
                    <td className="px-4 py-2 text-muted">The audience, whatever it is</td>
                  </tr>
                  <tr className="border-line border-t">
                    <td className="px-4 py-2 font-semibold text-ink">You supply</td>
                    <td className="px-4 py-2 text-muted">Every message body</td>
                    <td className="px-4 py-2 text-muted">One template and a segment</td>
                  </tr>
                  <tr className="border-line border-t">
                    <td className="px-4 py-2 font-semibold text-ink">Progress</td>
                    <td className="px-4 py-2 text-muted">The response, once</td>
                    <td className="px-4 py-2 text-muted">A cursor you can watch</td>
                  </tr>
                  <tr className="border-line border-t">
                    <td className="px-4 py-2 font-semibold text-ink">Pause and resume</td>
                    <td className="px-4 py-2 text-muted">No such concept</td>
                    <td className="px-4 py-2 text-muted">The same operation as crash recovery</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              A broadcast is split into thirty-two fixed ranges, each with its own coordinator and a
              monotonic cursor, and there is deliberately no counting pass anywhere in it. A count
              is a full scan that returns a number which is stale the instant it is computed, and it
              gets slower in exact proportion to how expensive it already was. Because progress is a
              cursor rather than a count, pausing and resuming a broadcast is the same operation the
              system already performs after a crash — which is why it is trustworthy, rather than a
              feature bolted on beside the happy path.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              So: transactional mail that happens to arrive in clumps — a nightly run of invoices, a
              queue of receipts, fifty password resets from an incident — is batch work. Anything
              where the recipient list is a query rather than a list, and where you would want to
              stop it halfway and look, is a{' '}
              <a
                href="/guides/broadcasts-at-scale"
                className="text-accent underline underline-offset-4"
              >
                broadcast
              </a>
              . If you find yourself writing a loop that pages through contacts and posts batches,
              you have reimplemented broadcasts without the pacing, the cursor or the resume — the
              send path learns each receiver’s unpublished quota by halving on rejection and growing
              by at most double after a clean day, and your loop will not.
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
