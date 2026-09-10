import { Callout, StepCard } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The constraint that forces this shape is unglamorous. A Durable Object handles roughly
              a thousand requests a second. A 500,000-contact broadcast running at 50,000 an hour
              cannot route every individual send through one object, so something has to fan out.
              The usual answer is to shard the coordinator, which trades a simple problem for a hard
              one: who owns which contact, and what happens when a shard dies halfway through a
              page.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Instead the coordinator holds{' '}
              <strong className="text-ink">32 cursors and nothing else</strong>. It never enumerates
              recipients. Each tick it mints a tick’s worth of tokens and hands out at most one page
              job per unfinished range — a range index, a cursor to start after, and a limit. A page
              worker takes that job, runs a keyset query bounded to its own range, sends what it
              finds, and makes one RPC back to advance its cursor.
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
              The number that matters is the coordinator’s write rate: roughly six writes a second,
              whether the audience is a thousand contacts or half a million. Nothing in that loop
              grows with your list. The expensive work happens in page workers, which are
              horizontally cheap and individually disposable.
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">A count is a full scan.</strong> Counting the members of
              an audience or a segment means visiting every matching row. There is no index that
              stores the answer, because the answer changes on every insert, unsubscribe and segment
              recomputation. So the cost of knowing the total scales linearly with the total — which
              is to say, the number gets slower to compute exactly as it gets more expensive to be
              wrong about.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">And it is stale on arrival.</strong> By the time a count
              of 480,000 has been computed and rendered, someone has unsubscribed, an import has
              finished, and a segment’s hourly sweep has moved a few thousand people across the
              boundary. The number was true at a moment that has already passed. A progress bar
              built on it will drift, and the drift will be blamed on the sending rather than on the
              denominator.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              So preparation does no counting pass over the audience. It asks one indexed aggregate
              for the lowest and highest contact id — the two values it actually needs in order to
              split the id space — and a total is recorded alongside them as a{' '}
              <em>snapshot at acceptance</em>, for display. Nothing in the send loop consults it.
              The ranges are boundaries in ULID space, not row counts, so they can be computed
              without knowing how many rows fall inside each one.
            </p>
            <Callout variant="warn" title="WHAT THIS MEANS FOR YOU">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                The recipient total you see when a broadcast is accepted is a snapshot from that
                instant, and it will not match the number of messages that go out. Unsubscribes
                between acceptance and delivery are excluded at page time, not at acceptance time.
                That gap is correct behaviour: the alternative is honouring a consent decision that
                was reverted an hour before you sent. Do not reconcile the two numbers; the sent
                count is the true one.
              </p>
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              A useful way to hold this: the system knows where it is, not how far it has to go.
              That is a weaker guarantee than a percentage and a much stronger one than a percentage
              that is quietly wrong — and it is what makes every other property in this guide
              possible, because a design that has to maintain an accurate total has to serialise
              something somewhere.
            </p>
          </>
        ),
        ranges: (
          <>
            <Lede>
              Thirty-two ranges, fixed at preparation, never rebalanced. The obvious alternative —
              hand out work dynamically so fast workers pick up more — is better on paper and worse
              in every failure mode that actually happens.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Dynamic work-stealing needs a shared claim: some record of which unit of work is
              currently owned by whom, so two workers do not take the same one. That record is
              global, it is written on every hand-out, and it has to be correct under contention.
              Now consider a worker that dies mid-page. Its claim has to expire, which means a lease
              with a timeout, which means picking a timeout that is longer than the slowest
              legitimate page and shorter than your patience — and being wrong in either direction
              is a duplicate send or a stall.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Fixed ranges delete the whole category. A range is owned by its index, permanently.
              There is no claim to expire, because there is nothing to claim: a page job is a
              statement about where a range’s cursor is, and any worker can execute it. If a page
              worker dies, the cursor simply did not advance, and the next tick dispatches the same
              page again. There is no global bookkeeping, no lease, no reconciliation between what
              was handed out and what came back.
            </p>
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Two safeguards make re-execution harmless. The cursor is monotonic — an advance to an
              id lower than the current one is ignored — so a duplicated or delayed report cannot
              rewind a range. And a page worker claims each contact’s row in{' '}
              <Mono>broadcast_sends</Mono> before it accepts the send, so a range that genuinely is
              re-enumerated finds the claims already there and sends nothing twice. A crash between
              the claim and the acceptance leaves an unsent claim, which is what the reconciler
              looks for.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The cost of fixed ranges is skew: if your contact ids are unevenly distributed, some
              ranges finish long before others and the tail is served by fewer workers than the
              start. In practice ULIDs are time-ordered and a real audience accumulates steadily, so
              the distribution is close enough to uniform that the tail is short. It is a real
              trade-off, and it is the right one — a slightly ragged tail costs minutes, while a
              lease you got wrong costs duplicate mail to real people.
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              One actor per sending domain owns three things that have to be serialised somewhere: a
              send-rate governor, a learned daily ceiling, and a per-provider circuit breaker. A
              broadcast consults it before releasing tokens, which turns “first big send generates
              ten thousand errors and a reputation hit” into “first big send throttles itself into
              the ramp”.
            </p>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Signal</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {[
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
                  ].map(([signal, effect]) => (
                    <tr key={signal} className="border-line border-t">
                      <td className="px-4 py-2 text-ink">{signal}</td>
                      <td className="px-4 py-2 text-muted">{effect}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              The asymmetry is the point. Halving on a rejection is deliberately aggressive and
              doubling on a clean day is deliberately the fastest growth allowed, because
              overshooting a ramp costs reputation and reputation is far more expensive to recover
              than throughput. Losing an hour of sending is an inconvenience; getting a domain’s
              reputation knocked down is weeks of careful behaviour.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Underneath the daily ceiling sits an ordinary token bucket for instantaneous rate,
              defaulting to fourteen a second with a burst of sixty. The broadcast coordinator has
              its own bucket sized from the throttle you set on the broadcast, and both have to
              grant before a page goes out. If you set a broadcast throttle higher than the domain
              can sustain, the domain governor is what you will actually observe.
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The coordinator’s status returns the broadcast state, all 32 range cursors and the sum
              of what each range has dispatched. From that you can read three things directly. How
              many ranges are <Mono>done</Mono> — that is your coarse position, in thirty-seconds.
              How far each unfinished cursor has moved between its start and its end — that is your
              fine position, and because ids are time-ordered it is a reasonable proxy for
              proportion. And the dispatched total, which is the only number here that is a count of
              real messages.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              A broadcast is complete when the last range is marked done, which happens when a page
              worker walks a range and finds nothing left in it. Not when a total is reached — there
              is no total to reach.
            </p>
            <Callout variant="warn" title="THE TWO NUMBERS THAT SAY STOP">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                <strong>Complaint rate</strong> and <strong>hard-bounce rate</strong>, both measured
                against delivered, both watched in the first few thousand messages rather than at
                the end. A complaint rate above roughly 0.1% is the threshold every major receiver
                treats as a signal, and it is reached long before a broadcast finishes. A
                hard-bounce rate climbing past a couple of percent means the list is stale and the
                rest of the send will make it worse. Both are reasons to pause — which costs you
                nothing, because pausing is the same operation the system performs after a crash.
              </p>
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              What is <em>not</em> a reason to stop: the open rate looking low in the first hour.
              Opens arrive over days, are heavily distorted by machine fetches, and the first hour’s
              figure is dominated by whoever happens to be at their desk. If you are making a
              decision on opens at all, read{' '}
              <a
                href="/guides/open-rates-and-apple-mpp"
                className="text-accent underline underline-offset-4"
              >
                what an open actually means
              </a>{' '}
              first — the headline number and the number you can act on are not the same number.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Nor is a broadcast sitting at the same position for several minutes. That is usually
              the domain governor refusing capacity because the learned daily ceiling has been
              reached, in which case the retry points at the next UTC midnight and the broadcast
              will simply continue tomorrow. It is working; it is just declining to do the thing
              that would hurt you.
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
