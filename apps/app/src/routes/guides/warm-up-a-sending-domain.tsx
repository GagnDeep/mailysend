import { Callout, Metric, MetricGrid } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { WarmupPlanner } from '~/components/guides/warmup-planner.tsx'
import {
  Contrast,
  Diagram,
  FactTable,
  Gotcha,
  Takeaway,
} from '~/components/marketing/guide-blocks.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Lede, Mono } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'warm-up-a-sending-domain'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/warm-up-a-sending-domain')({
  head: () => guideHead(SLUG),
  component: Page,
})

const TIERS: Array<[string, string, string]> = [
  [
    'Days 1–3',
    'Opened in the last 30 days',
    'Your best possible audience. These are the people who will open within an hour, which is the fastest positive signal available to you.',
  ],
  [
    'Days 4–8',
    'Opened in the last 90 days',
    'Still clearly engaged, and now large enough to carry a meaningful volume step.',
  ],
  [
    'Days 9–15',
    'Opened in the last 180 days',
    'Weaker but real. By now you have a short history at each receiver to spend.',
  ],
  [
    'Day 16 onward',
    'Everyone still engaged',
    'Never dormant. A subscriber who has not opened in a year does not become worth mailing because you have a schedule to fill.',
  ],
]

/** A worked run of the rule in `SendingDomainActor`, one row per rollover. */
const LEARNED: Array<[string, string, string, string]> = [
  [
    'Day 1',
    'none stored — 5,000 default',
    '4,100 sent, no rejection',
    'Nothing is learned. The ceiling is still unstored, so the rollover does not grow it.',
  ],
  [
    'Day 2',
    'none stored — 5,000 default',
    'provider rejects on quota after 3,000',
    'ceiling = max(100, floor(3,000 × 0.5)) = 1,500, written; the provider is held for 5 minutes.',
  ],
  [
    'Day 3',
    '1,500',
    '1,200 sent — under 90% (1,350)',
    'A clean day under the threshold, so tomorrow’s rollover doubles it.',
  ],
  [
    'Day 4',
    '3,000',
    '2,900 sent — over 90% (2,700)',
    'You used the headroom, so no growth. The ceiling stays where it is.',
  ],
  [
    'Day 5',
    '3,000',
    '2,000 sent — under 90%',
    'Under the threshold again, so the rollover doubles.',
  ],
  ['Day 6', '6,000', '—', 'Two rejections away from the real number, without ever being told it.'],
]

const SIGNALS: Array<[string, string, string]> = [
  [
    'Deferrals rising',
    'A 4.x.x response is “not now, try later”, and one or two is background noise. A rate that climbs as your volume climbs is the receiver saying the ramp is ahead of what it will accept.',
    'Hold at the current rung. The send path is already backing off; do not add volume on top of that backoff because the schedule said today was a bigger day.',
  ],
  [
    'Unknown-user rate moving',
    'Hard bounces for addresses that do not exist — the hard_invalid and hard_domain classes, from enhanced codes 5.1.1, 5.1.3, 5.1.6 and 5.1.2.',
    'You have reached a tier of the list that has decayed. Stop, clean that tier, resume. Mailing it tells every receiver you do not know who your subscribers are.',
  ],
  [
    'Complaint rate moving at all',
    'Not exceeding a threshold — moving. You are sending to your most engaged people, so it should be near zero.',
    'Hold. The published ceiling of 0.3% is where you are already in trouble; the number that should stop you is any visible change from your baseline.',
  ],
  [
    'Open rate falling, delivery flat',
    'Harder to see, and the signature of spam-folder placement: an accepted message counts as delivered regardless of the folder it landed in.',
    'Treat it as directional only, then confirm in placement terms — opens are classified into five audience classes and only human opens count.',
  ],
]

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You have a ramp ordered by engagement rather than by convenience, and a reason to trust
          it: the send path is running the same shape underneath — halve on rejection, at most
          double after a clean day — so the plan and the software are not two unrelated pieces of
          advice. The thing most likely to bite you is treating the schedule as a commitment. It is
          a ceiling you may not reach, and the correct response to a deferral is to hold at the
          current rung, not to push through it and try again tomorrow from where you meant to be.
        </p>
      }
    >
      {{
        'what-warming-is': (
          <>
            <Lede>
              The phrase is inherited from a time when reputation lived almost entirely on IP
              addresses, and it has stuck around past its accuracy. What you are building is a
              history: a record, held separately by every receiving provider, of mail sent from your
              domain that the people receiving it visibly wanted. Volume is the axis you control.
              Wanted is the thing being measured.
            </Lede>
            <Takeaway>
              You are not warming an IP so much as building a per-receiver history of mail people
              visibly wanted, at a volume that does not look like an incident.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'IP reputation',
                  tone: 'neutral',
                  points: [
                    'Attaches to an address that can be rented for an afternoon',
                    'Shed by moving hosts — which is exactly why receivers weigh it less',
                  ],
                },
                {
                  label: 'Domain reputation',
                  tone: 'good',
                  points: [
                    <>
                      Attaches to the name in your <Mono>From</Mono> header and to the DKIM{' '}
                      <Mono>d=</Mono> domain
                    </>,
                    'Follows you across transports and cannot be shed — the permanence is the point',
                    'Two years of clean sending behind a domain cannot be rented',
                  ],
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The failure mode has a specific shape.</strong> A
              brand-new domain that sends nothing, nothing, nothing, and then 80,000 messages on a
              Tuesday has produced the exact signature of a compromised account or a throwaway spam
              domain, because that is the signature those things have. No receiver can tell the
              difference from the outside, and none will give you the benefit of the doubt to find
              out.
            </p>
            <Diagram
              steps={[
                { kicker: 'WEEKS', title: 'Nothing sent', meta: 'no history at any receiver' },
                {
                  kicker: 'TUESDAY',
                  title: '80,000 messages',
                  tone: 'accent',
                  meta: 'indistinguishable from a compromised account',
                },
                { kicker: 'THEN', title: 'Deferrals' },
                { kicker: 'THEN', title: 'Spam placement' },
                { kicker: 'THEN', title: 'Rejections', meta: 'outlives the send by weeks' },
              ]}
            />
            <FactTable
              columns={['What people assume', 'What actually happens']}
              monoFirst={false}
              rows={[
                [
                  'Growth is the thing being measured',
                  'Consistency matters as much: 5,000 a day for six days and then nothing for four is worse than a flat 3,000 every day, because the pattern itself is what is being read.',
                ],
                [
                  'Any volume warms a domain',
                  'You cannot warm with mail nobody wants. Ten thousand a day to a purchased list does not build a reputation, it builds a bad one faster than sending nothing would have.',
                ],
              ]}
            />
            <Callout title="WHAT WARMING CANNOT DO">
              It cannot repair a domain that already has a poor reputation — the only cure for that
              is time plus different behaviour. It cannot substitute for authentication, and a ramp
              on an unaligned domain is a ramp of mail that fails DMARC at increasing volume.
              Publish and{' '}
              <a
                href="/guides/verify-a-sending-domain"
                className="text-accent underline underline-offset-4"
              >
                verify your records
              </a>{' '}
              before day one, not during week two.
            </Callout>
          </>
        ),
        'the-schedule': (
          <>
            <Lede>
              A ramp is one number and one rule: start small enough that nobody notices you, and
              multiply by somewhere under two each day you get away with it. Enter your day-one
              volume and where you are trying to get to; every row renders, because a plan that
              hides days behind a control is a plan you cannot check against what actually happened.
            </Lede>
            <Takeaway>
              One number and one rule — a day-one volume small enough to go unnoticed, multiplied by
              something under two on every day you get away with it.
            </Takeaway>
            <WarmupPlanner />
            <FactTable
              columns={['Reading the plan', 'Why']}
              monoFirst={false}
              rows={[
                [
                  'The volumes are per receiving provider, in spirit',
                  'A receiver forms an opinion of you from the mail it sees, so 20,000 messages split across five providers is four thousand-ish opinions each, not one impression of 20,000. Most consumer lists are dominated by two or three providers, so the total is a reasonable proxy; if yours is concentrated at one provider, treat the ramp as applying to that provider and be more patient.',
                ],
                [
                  'Send at the same time each day, every day',
                  'Including the days where the number feels too small to bother with. The gap is the signal you are trying not to send.',
                ],
                [
                  'Transactional mail is on the ramp too',
                  'If it shares the domain it counts toward the volume the receiver observes, whether or not you counted it in your plan.',
                ],
                [
                  'Four to six weeks to steady six-figure monthly volume',
                  'With engaged recipients. If the planner’s arithmetic says you cannot reach your target inside thirty days, that is real information — start higher only if you genuinely have enough recently-engaged recipients to justify it, or accept the longer ramp.',
                ],
              ]}
            />
            <Gotcha title="The schedule is a ceiling, not a commitment">
              A row in the plan is the most you may send that day, not an amount you owe. The
              correct response to a deferral is to hold at the current rung and send the same volume
              tomorrow — not to push through it and try again the day after from where you had meant
              to be. Steepening the curve to catch up is how a ramp restarts instead of finishing.
            </Gotcha>
          </>
        ),
        'who-first': (
          <>
            <Lede>
              The order of the ramp is not a detail. Volume is what you are asking for; engagement
              is what pays for it. Every open, click and reply on day three is evidence a receiver
              uses when deciding what to do with day four, so the sequence to send in is strictly
              descending by likelihood of a positive reaction.
            </Lede>
            <Takeaway>
              Order the ramp strictly descending by likelihood of a positive reaction — your best
              segment buys the volume the next one gets to use.
            </Takeaway>
            <FactTable
              columns={['When', 'Who', 'Why them']}
              monoFirst={false}
              rows={TIERS.map(([when, who, why]) => [when, who, why])}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              These tiers are expressible directly as segments, so the ramp does not have to be run
              by hand from exported CSVs:
            </p>
            <Code>
              {'opened_last_30d and not unsubscribed          '}
              <Com>{'← days 1–3'}</Com>
              {'\nopened_last_90d and not unsubscribed          '}
              <Com>{'← days 4–8'}</Com>
              {'\nopened_last_180d and not unsubscribed         '}
              <Com>{'← days 9–15'}</Com>
              {'\nnot never_opened and bounce_count = 0         '}
              <Com>{'← the standing ceiling'}</Com>
            </Code>
            <Contrast
              sides={[
                {
                  label: 'Put newest consent at the front',
                  tone: 'good',
                  points: [
                    'On a mixed list, order by recency of signup regardless of open history',
                    'Recency of consent predicts a positive reaction better than almost anything else',
                    'A subscriber from last week remembers asking',
                  ],
                },
                {
                  label: 'Hold the hardest audience for last',
                  tone: 'neutral',
                  points: [
                    'Free-tier signups from three years ago who have never opened anything',
                    'They belong at the end of the ramp — or, more honestly, not on it at all',
                  ],
                },
              ]}
            />
            <Gotcha title="Never warm with your worst segment">
              The temptation is real and it is always framed as prudence: send to the dormant people
              first, because it matters less if it goes badly. It does not matter less. A ramp
              opened by an audience that does not open produces a low engagement rate, a high
              unknown-user rate from addresses that died years ago, and a complaint rate from people
              who forgot you — on a domain with no history to absorb any of it. That is not a
              cautious start, that is a bad first impression bought deliberately.
            </Gotcha>
          </>
        ),
        'learned-quota': (
          <>
            <Lede>
              Every receiver enforces a limit on how much they will take from you, per hour, per
              connection, per domain. None of them publish it. It moves with your reputation, with
              their load, and with the time of day. This is the part of warming that people try to
              solve with a spreadsheet of guessed numbers, and it is the part the send path solves
              for you by not guessing at all.
            </Lede>
            <Takeaway>
              The send path never learns the receiver’s number — it halves its own ceiling the
              moment it is rejected and doubles it after a day it did not need, which converges on
              the invisible limit from below.
            </Takeaway>
            <MetricGrid min={140}>
              <Metric size="sm" value="5,000" label="Starting ceiling, no history" />
              <Metric size="sm" value="×0.5" label="Applied to what was sent, on rejection" />
              <Metric size="sm" value="5 min" label="Provider held after a quota rejection" />
              <Metric size="sm" value="5,000,000" label="Hard cap on the learned ceiling" />
            </MetricGrid>
            <Diagram
              steps={[
                { kicker: 'REJECT', title: 'Provider refuses on quota' },
                {
                  kicker: 'HALVE',
                  title: 'max(100, floor(sent × 0.5))',
                  tone: 'accent',
                  meta: 'written as the ceiling',
                },
                { kicker: 'HOLD', title: 'Provider paused', meta: '5 minutes' },
                { kicker: 'CLEAN DAY', title: 'sent < 90% of ceiling' },
                { kicker: 'GROW', title: 'ceiling × 2', meta: 'at the next rollover' },
              ]}
            />
            <FactTable
              columns={['Day', 'Ceiling in force', 'What happened', 'What the rule did']}
              monoFirst={false}
              rows={LEARNED.map(([day, ceiling, what, did]) => [day, ceiling, what, did])}
              caption="A worked run of the rule the sending-domain actor actually applies. Growth happens once, at the day rollover, and never above 5,000,000."
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Why that converges.</strong> The doubling walks upward
              until it crosses the invisible ceiling, the crossing produces exactly one rejection,
              the halving puts you back underneath it, and the next doubling brings you back to the
              boundary. The rate oscillates in a narrowing band around a number nobody ever told you
              — the same shape as TCP’s congestion control, for the same reason: the capacity is
              unknown, unstable, and only observable by occasionally exceeding it.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The asymmetry is the important part.</strong> Halving is
              instant and doubling is capped, so an overshoot costs one rejection and a quick
              recovery while over-aggression compounds. This is also the same curve the planner
              above draws, which is not a coincidence: a schedule that grows by a factor under two
              per clean day is the human-readable form of the rule the rate limiter already follows.
              The learned ceiling is persisted per domain, so an interrupted ramp resumes from what
              was learned rather than from the beginning.
            </p>
            <Gotcha title="A domain that has never been rejected does not grow">
              The rollover only doubles a ceiling that has been <em>learned</em> — the growth branch
              is skipped while no ceiling has been stored. Until the first quota rejection writes
              one, the domain sits at the 5,000 default no matter how many clean days it strings
              together, and <Mono>reserve()</Mono> starts refusing with{' '}
              <Mono>reason: daily_ceiling</Mono> and a retry-after that runs to midnight UTC.
            </Gotcha>
            <Callout title="WHY THERE IS NO NUMBER TO CONFIGURE">
              There is no field where you type a receiver’s hourly limit, and adding one would make
              things worse: any number you entered would be a guess, it would be wrong differently
              for every receiver, and it would go stale the week after you set it. Measuring a
              moving quantity beats configuring a static approximation of it, and the measurement
              costs one deferral.
            </Callout>
          </>
        ),
        'when-to-slow': (
          <>
            <Lede>
              Three signals mean stop climbing. Not stop sending — hold at the current rung, send
              the same volume tomorrow, and only resume growing once the signal has gone. Any one of
              them alone is enough.
            </Lede>
            <Takeaway>
              Any one of these on its own means hold at the current rung — not stop sending, and not
              push through to the number the schedule promised.
            </Takeaway>
            <FactTable
              columns={['Signal', 'What it is', 'What to do']}
              monoFirst={false}
              rows={SIGNALS.map(([signal, what, action]) => [signal, what, action])}
              caption="The first three are the stop-climbing signals. The fourth is slower to see and is evidence rather than a verdict."
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Read a falling open rate carefully.</strong> In
              production today the classifier receives only the user agent, IP, method and country,
              so the timing- and ASN-based rules do not fire. Treat the percentage as directional
              evidence, then confirm it in{' '}
              <a
                href="/guides/inbox-placement-vs-delivery"
                className="text-accent underline underline-offset-4"
              >
                placement terms
              </a>{' '}
              rather than acting on it alone. On the deferral side, a soft throttle suppresses the
              address for one day, so the system’s own recovery window is already a day long.
            </p>
            <Gotcha title="Do not retry the batch yourself">
              When a send is deferred, the send path holds it and retries on its own schedule. What
              you must not do is re-queue the batch from your side, or increase concurrency to
              “catch up”. Manual retries after a deferral turn a receiver’s polite backpressure into
              a pattern indistinguishable from an attack, and that is a much harder reputation to
              recover from than a ramp that took an extra week. Warming faster than receivers will
              accept does not compress the timeline; it restarts it.
            </Gotcha>
          </>
        ),
      }}
    </GuideLayout>
  )
}
