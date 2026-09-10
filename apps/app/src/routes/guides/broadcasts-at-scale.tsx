import { Callout, Metric, MetricGrid, StepCard } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import {
  Contrast,
  Diagram,
  FactTable,
  Gotcha,
  Takeaway,
} from '~/components/marketing/guide-blocks.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'broadcasts-at-scale'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/broadcasts-at-scale')({
  head: () => guideHead(SLUG),
  component: Page,
})

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          A broadcast is thirty-two cursors and a token bucket. Nothing in the send loop counts your
          list, nothing grows with your audience, and pausing is the same operation the system
          already performs after a crash — which is why it is instant and why resuming cannot
          re-send. The thing most likely to bite you later is treating the progress bar as a
          deadline: pacing is deliberate, the daily ceiling is learned by being refused, and a
          broadcast that looks stalled at 40% is usually a domain that has hit a quota you cannot
          see and should not fight.
        </p>
      }
    >
      {{
        'the-shape': (
          <>
            <Lede>
              Three ideas do all the work: contiguous ranges over contact-id space, one coordinator
              holding a cursor per range, and page workers that do the actual sending and report
              back. Everything else in this guide follows from those three.
            </Lede>
            <Takeaway>
              The coordinator holds 32 cursors and nothing else. It never enumerates recipients, so
              its write rate — roughly six a second — is the same for a thousand contacts as for
              half a million.
            </Takeaway>
            <Diagram
              steps={[
                {
                  kicker: 'COORDINATOR',
                  title: '32 cursors',
                  meta: 'one per range, plus a token bucket',
                },
                {
                  kicker: 'TICK',
                  title: 'Page jobs',
                  meta: 'at most one per unfinished range, every 5s',
                },
                { kicker: 'QUEUE', title: 'Page worker', meta: '≤ 200 contacts, keyset-bounded' },
                { kicker: 'RPC', title: 'Advance cursor', tone: 'accent', meta: 'forward only' },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The constraint that forces this shape is unglamorous.
              </strong>{' '}
              A Durable Object handles roughly a thousand requests a second, so a 500,000-contact
              broadcast running at 50,000 an hour cannot route every individual send through one
              object. The usual answer is to shard the coordinator, which trades a simple problem
              for a hard one: who owns which contact, and what happens when a shard dies halfway
              through a page.
            </p>
            <div className="flex flex-col gap-3">
              <StepCard step={1} title="Prepare" variant="rule">
                One indexed query returns the minimum and maximum contact id in the audience. The id
                space between them is split into 32 contiguous ranges, each stored as a start, an
                end, a cursor and a done flag. Contact ids are ULIDs — Crockford base32, so they
                sort lexicographically — which is what makes “split the id space” an arithmetic
                problem rather than a data problem.
              </StepCard>
              <StepCard step={2} title="Tick" variant="rule">
                Every five seconds the coordinator refills a token bucket at your configured rate,
                spreads the granted budget across the ranges that still have work, and dispatches
                page jobs onto a queue. Spreading rather than draining means one slow range cannot
                starve the other thirty-one.
              </StepCard>
              <StepCard step={3} title="Page" variant="rule">
                A page worker reads at most 200 contacts with{' '}
                <Mono>WHERE id &gt; cursor AND id &lt;= end AND unsubscribed = 0</Mono>, claims each
                one in <Mono>broadcast_sends</Mono> before accepting the send, and renders from a
                body it fetches once per page rather than once per contact.
              </StepCard>
              <StepCard step={4} title="Advance" variant="rule">
                One RPC per page moves that range’s cursor forward — and only forward. A retried
                page report cannot move a cursor backwards, which is what stops a duplicate report
                from re-sending a block of contacts.
              </StepCard>
            </div>
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              Nothing in that loop grows with your list. The expensive work happens in page workers,
              which are horizontally cheap and individually disposable.
            </p>
            <Callout title="WHY RESUME IS FREE">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                Progress is a cursor, so a crash and a pause are indistinguishable from the
                coordinator’s point of view: in both cases the cursor did not advance, and the next
                dispatch re-issues that exact page. A paused broadcast’s pages get parked and
                retried rather than dropped. Nothing is lost and nothing repeats — and pausing costs
                almost nothing, because the alarm re-arms itself on a thirty-second cycle instead of
                a five-second one.
              </p>
            </Callout>
          </>
        ),
        'no-counting': (
          <>
            <Lede>
              The most common request for a system like this is a progress bar with a denominator.
              The reason there is not one in the send loop is not laziness; it is that the
              denominator is a lie that gets more expensive to tell as your list grows.
            </Lede>
            <Takeaway>
              The system knows where it is, not how far it has to go. That is a weaker guarantee
              than a percentage and a much stronger one than a percentage that is quietly wrong.
            </Takeaway>
            <FactTable
              columns={['The problem with a count', 'What it costs']}
              monoFirst={false}
              rows={[
                [
                  'A count is a full scan',
                  'Counting the members of an audience or a segment means visiting every matching row. No index stores the answer, because the answer changes on every insert, unsubscribe and segment recomputation — so the number gets slower to compute exactly as it gets more expensive to be wrong about.',
                ],
                [
                  'It is stale on arrival',
                  'By the time a count of 480,000 has been computed and rendered, someone has unsubscribed, an import has finished, and a segment’s hourly sweep has moved a few thousand people across the boundary.',
                ],
                [
                  'The drift gets blamed on the wrong thing',
                  'A progress bar built on that number will drift, and the drift will be blamed on the sending rather than on the denominator.',
                ],
                [
                  'It forces serialisation',
                  'A design that has to maintain an accurate total has to serialise something somewhere — which is what makes every other property in this guide impossible.',
                ],
              ]}
            />
            <Contrast
              sides={[
                {
                  label: 'resolveRecipients — at acceptance',
                  tone: 'neutral',
                  points: [
                    <>
                      One indexed query, three numbers: <Mono>COUNT(*)</Mono>, <Mono>MIN(id)</Mono>,{' '}
                      <Mono>MAX(id)</Mono>
                    </>,
                    <>
                      The segment case reads <Mono>segment_members</Mono> rather than re-evaluating
                      the expression — membership is maintained continuously, and re-running the
                      predicate here would make accepting a send O(audience)
                    </>,
                    <>
                      Filters <Mono>unsubscribed = 0</Mono> as of that instant
                    </>,
                    <>
                      The total it returns is a <em>snapshot at acceptance</em>, for display
                    </>,
                  ],
                },
                {
                  label: 'prepare — in the coordinator',
                  tone: 'neutral',
                  points: [
                    'Takes the two ids and splits the space between them into 32 ranges',
                    'Ranges are boundaries in ULID space, not row counts, so it can compute them without knowing how many rows fall inside each one',
                    'Stores the total as state and never consults it again',
                    'Nothing in the send loop reads it: who actually receives a message is decided page by page, against the audience as it is then',
                  ],
                },
              ]}
            />
            <Gotcha title="The two numbers will not match, and should not">
              The recipient total you see when a broadcast is accepted is a snapshot from that
              instant. Unsubscribes between acceptance and delivery are excluded at page time, not
              at acceptance time, so fewer messages go out than the total suggests. That gap is
              correct behaviour: the alternative is honouring a consent decision that was reverted
              an hour before you sent. Do not reconcile the two numbers; the sent count is the true
              one.
            </Gotcha>
          </>
        ),
        ranges: (
          <>
            <Lede>
              Thirty-two ranges, fixed at preparation, never rebalanced. The obvious alternative —
              hand out work dynamically so fast workers pick up more — is better on paper and worse
              in every failure mode that actually happens.
            </Lede>
            <Takeaway>
              A range is owned by its index, permanently, so there is no claim to expire and nothing
              to reconcile between what was handed out and what came back.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'Dynamic work-stealing',
                  tone: 'bad',
                  points: [
                    'Needs a shared claim: a global record of which unit of work is owned by whom',
                    'Written on every hand-out, and has to be correct under contention',
                    'A worker that dies mid-page needs its claim to expire, which means a lease with a timeout',
                    'The timeout must be longer than the slowest legitimate page and shorter than your patience',
                    'Wrong in either direction is a duplicate send or a stall',
                  ],
                },
                {
                  label: 'Fixed ranges',
                  tone: 'good',
                  points: [
                    'A range is owned by its index, permanently',
                    'A page job is a statement about where a range’s cursor is; any worker can execute it',
                    'A dead worker means the cursor simply did not advance',
                    'The next tick dispatches the same page again',
                    'No global bookkeeping, no lease, no reconciliation',
                  ],
                },
              ]}
            />
            <Code>
              <Com>{`# what the coordinator stores, per range\n`}</Com>
              {`{ `}
              <Key>start</Key>
              {`: "01J8Q0000...", `}
              <Key>end</Key>
              {`: "01J8Q3FFF...",
  `}
              <Key>cursor</Key>
              {`: "01J8Q1M2K...", `}
              <Key>done</Key>
              {`: false, `}
              <Key>dispatched</Key>
              {`: 4200 }

`}
              <Com>{`# a page job is derived from it, and carries no identity of its own
{ rangeIndex: 7, after: cursor || start, until: end, limit: 200 }`}</Com>
            </Code>
            <FactTable
              columns={['Safeguard', 'What it prevents']}
              monoFirst={false}
              rows={[
                [
                  'The cursor is monotonic',
                  'An advance to an id lower than the current one is ignored, so a duplicated or delayed report cannot rewind a range.',
                ],
                [
                  <>
                    A claim in <Mono>broadcast_sends</Mono> before the send is accepted
                  </>,
                  'A range that genuinely is re-enumerated finds the claims already there and sends nothing twice.',
                ],
                [
                  'The reconciler',
                  'A crash between the claim and the acceptance leaves an unsent claim, which is exactly what it looks for.',
                ],
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The cost of fixed ranges is skew.</strong> If your
              contact ids are unevenly distributed, some ranges finish long before others and the
              tail is served by fewer workers than the start. In practice ULIDs are time-ordered and
              a real audience accumulates steadily, so the tail is short — a slightly ragged tail
              costs minutes, while a lease you got wrong costs duplicate mail to real people.
            </p>
          </>
        ),
        pace: (
          <>
            <Lede>
              Every receiving provider enforces a quota it does not publish, and ramps it with your
              reputation. The only honest way to learn that number is to observe where sends start
              being refused — so the send path does exactly that, and treats the answer as expensive
              to get wrong in one direction and cheap in the other.
            </Lede>
            <Takeaway>
              One actor per sending domain owns the three things that have to be serialised
              somewhere: a send-rate governor, a learned daily ceiling, and a per-provider circuit
              breaker. A broadcast consults it before releasing tokens.
            </Takeaway>
            <MetricGrid className="my-5" min={170}>
              <Metric
                value="5,000"
                label="Starting daily ceiling for a domain with no history"
                size="sm"
              />
              <Metric value="14/s" label="Default send-rate governor, burst 60" size="sm" />
              <Metric
                value="×2"
                label="Most a clean day may raise the ceiling, capped at 5,000,000"
                size="sm"
              />
              <Metric
                value="5 in 5 min"
                label="Failures that open the circuit breaker, for 30s"
                size="sm"
              />
            </MetricGrid>
            <FactTable
              columns={['Signal', 'What happens']}
              monoFirst={false}
              rows={[
                [
                  'A domain with no history',
                  'Starts at a daily ceiling of 5,000 — low enough not to trip a new ramp.',
                ],
                [
                  'A provider rejects a send for exceeding its quota',
                  'The ceiling is set to half of what was sent today, with a floor of 100, and the provider is held open for five minutes.',
                ],
                [
                  'A day ends without reaching 90% of the ceiling',
                  'The ceiling is allowed to double, capped at 5,000,000. At most double: providers ramp gradually and a sudden jump looks like an attack.',
                ],
                [
                  'Five failures inside five minutes',
                  'The circuit breaker opens for thirty seconds, then lets a single attempt through on a clean counter.',
                ],
                [
                  'The daily ceiling is reached',
                  'Sends are refused with a retry-after that points at the next UTC midnight, rather than being retried into the same wall.',
                ],
                [
                  'Your broadcast throttle exceeds what the domain sustains',
                  'Both buckets have to grant before a page goes out, so the domain governor is what you will actually observe.',
                ],
              ]}
              caption="Underneath the daily ceiling sits an ordinary token bucket for instantaneous rate; the broadcast coordinator has its own, sized from the throttle you set."
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The asymmetry is the point.</strong> Halving on a
              rejection is deliberately aggressive and doubling on a clean day is deliberately the
              fastest growth allowed, because overshooting a ramp costs reputation and reputation is
              far more expensive to recover than throughput. Losing an hour of sending is an
              inconvenience; getting a domain’s reputation knocked down is weeks of careful
              behaviour.
            </p>
            <Callout title="THIS IS ALSO YOUR WARM-UP">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                A warm-up ramp and a learned ceiling are the same mechanism seen from two angles. If
                you are starting on a new domain, the ceiling is already doing the conservative
                thing — see{' '}
                <a
                  href="/guides/warm-up-a-sending-domain"
                  className="text-accent underline underline-offset-4"
                >
                  warming up a sending domain
                </a>{' '}
                for the part the mechanism cannot do for you, which is deciding who to send the
                first few thousand messages to.
              </p>
            </Callout>
          </>
        ),
        observe: (
          <>
            <Lede>
              With no total, “progress” has to mean something else. It means: how much of the id
              space has been walked, and how many messages have actually been dispatched. Both are
              exact, neither is a percentage of anything, and together they tell you more than a
              progress bar would.
            </Lede>
            <Takeaway>
              A broadcast is complete when the last range is marked done — which happens when a page
              worker walks a range and finds nothing left in it. Not when a total is reached; there
              is no total to reach.
            </Takeaway>
            <FactTable
              columns={['What status returns', 'How to read it']}
              monoFirst={false}
              rows={[
                [
                  'The broadcast state',
                  'Running, paused, complete. Pausing and crashing look the same from here.',
                ],
                [
                  <>
                    How many ranges are <Mono>done</Mono>
                  </>,
                  'Your coarse position, in thirty-seconds.',
                ],
                [
                  'How far each unfinished cursor has moved between its start and its end',
                  'Your fine position — and because ids are time-ordered it is a reasonable proxy for proportion.',
                ],
                [
                  'The sum of what each range has dispatched',
                  'The only number here that is a count of real messages.',
                ],
              ]}
            />
            <Gotcha title="The two numbers that say stop">
              <strong>Complaint rate</strong> and <strong>hard-bounce rate</strong>, both measured
              against delivered, both watched in the first few thousand messages rather than at the
              end. A complaint rate above roughly 0.1% is the threshold every major receiver treats
              as a signal, and it is reached long before a broadcast finishes. A hard-bounce rate
              climbing past a couple of percent means the list is stale and the rest of the send
              will make it worse. Both are reasons to pause — which costs you nothing, because
              pausing is the same operation the system performs after a crash.
            </Gotcha>
            <Contrast
              sides={[
                {
                  label: 'Not a reason to stop',
                  tone: 'good',
                  points: [
                    'A low open rate in the first hour — opens arrive over days and are heavily distorted by machine fetches',
                    'The first hour’s figure is dominated by whoever happens to be at their desk',
                    'A broadcast sitting at the same position for several minutes: usually the domain governor refusing capacity because the learned daily ceiling has been reached',
                    'In that case the retry points at the next UTC midnight and the broadcast continues tomorrow — it is working, it is just declining to do the thing that would hurt you',
                  ],
                },
                {
                  label: 'A reason to stop',
                  tone: 'bad',
                  points: [
                    'Complaint rate above roughly 0.1% of delivered',
                    'Hard-bounce rate climbing past a couple of percent',
                    'Both visible in the first few thousand messages',
                    'Pausing is instant and resuming cannot re-send',
                  ],
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              If you are making a decision on opens at all, read{' '}
              <a
                href="/guides/open-rates-and-apple-mpp"
                className="text-accent underline underline-offset-4"
              >
                what an open actually means
              </a>{' '}
              first — the headline number and the number you can act on are not the same number.
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
