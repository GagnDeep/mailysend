import { Callout } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { WarmupPlanner } from '~/components/guides/warmup-planner.tsx'
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              This is why domain warming matters more than IP warming now. Domain reputation
              attaches to the name in your From header and to the DKIM <Mono>d=</Mono> domain, which
              means it follows you across transports and cannot be shed by moving hosts — that
              permanence is exactly why receivers weigh it. An IP can be rented for an afternoon; a
              domain with two years of clean sending behind it cannot.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The failure mode you are avoiding has a specific shape. A brand-new domain that sends
              nothing, nothing, nothing, and then 80,000 messages on a Tuesday has produced the
              exact signature of a compromised account or a throwaway spam domain, because that is
              the signature those things have. No receiver can tell the difference from the outside,
              and none of them will give you the benefit of the doubt to find out. The response is
              deferrals first, then spam placement, then outright rejections — and the placement
              damage outlives the send by weeks.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Two consequences follow that people find counter-intuitive. The first is that
              consistency matters as much as growth: a ramp that sends 5,000 a day for six days and
              then nothing for four is worse than a flat 3,000 every day, because the pattern itself
              is what is being read. The second is that you cannot warm with mail nobody wants. Ten
              thousand messages a day to a purchased list does not build a reputation, it builds a
              bad one faster than sending nothing at all would have.
            </p>
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
            <WarmupPlanner />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              A few notes on reading it. The volumes are <em>per receiving provider</em> in spirit
              rather than in total — a receiver forms an opinion of you from the mail it sees, so
              20,000 messages split across five providers is four thousand-ish opinions each, not
              one impression of 20,000. In practice most consumer lists are dominated by two or
              three providers, so the total is a reasonable proxy; if your list is unusually
              concentrated at one provider, treat the ramp as applying to that provider and be more
              patient.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Send at the same time each day, every day, including the days where the number feels
              too small to bother with. The gap is the signal you are trying not to send. And keep
              transactional mail on the ramp too if it shares the domain — it counts toward the
              volume the receiver observes whether or not you counted it in your plan.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Four to six weeks is the realistic figure for reaching a steady six-figure monthly
              volume with engaged recipients. If the arithmetic in the planner says you cannot get
              from your day-one number to your target inside thirty days, that is real information
              and the answer is not to steepen the curve. Start higher — if you genuinely have
              enough recently-engaged recipients to justify it — or accept a longer ramp.
            </p>
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
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="px-4 py-2.5 text-[12px] font-semibold">When</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Who</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Why them</th>
                  </tr>
                </thead>
                <tbody>
                  {TIERS.map(([when, who, why]) => (
                    <tr key={when} className="border-line border-t">
                      <td className="px-4 py-2 font-semibold text-ink">{when}</td>
                      <td className="px-4 py-2 text-muted">{who}</td>
                      <td className="px-4 py-2 text-muted-2">{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Two refinements worth the effort. First, if you have a mixed list, put the people who
              signed up most recently at the front regardless of open history — recency of consent
              predicts a positive reaction better than almost anything else, and a subscriber from
              last week remembers asking. Second, hold your hardest audience for last: the free-tier
              signups from three years ago who have never opened anything belong at the end of the
              ramp or, more honestly, not on it at all.
            </p>
            <Callout variant="warn" title="NEVER WARM WITH YOUR WORST SEGMENT">
              The temptation is real and it is always framed as prudence: send to the dormant people
              first, because it matters less if it goes badly. It does not matter less. A ramp
              opened by an audience that does not open produces a low engagement rate, a high
              unknown-user rate from addresses that died years ago, and a complaint rate from people
              who forgot you — on a domain with no history to absorb any of it. That is not a
              cautious start, that is a bad first impression bought deliberately.
            </Callout>
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The rule is two lines, and it is deliberately asymmetric. On a rejection — a deferral,
              a rate-limit response, a 4.x.x anything — the send path{' '}
              <strong className="text-ink">halves</strong> its rate for that destination. After a
              clean day, it grows by <strong className="text-ink">at most 2×</strong>. Nothing
              anywhere in the system ever needs to know what the real number was.
            </p>
            <Code>
              {'on rejection:  rate = rate / 2        '}
              <Com>{'← immediate, per destination'}</Com>
              {'\nafter a clean day: rate = min(rate * 2, target)   '}
              <Com>{'← at most'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Why that converges: the doubling walks upward until it crosses the invisible ceiling,
              the crossing produces exactly one rejection, the halving puts you back underneath it,
              and the next doubling brings you back to the boundary. The rate oscillates in a
              narrowing band around a number nobody ever told you. It is the same shape as TCP’s
              congestion control, for the same reason — the capacity is unknown, unstable, and only
              observable by occasionally exceeding it.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The asymmetry is the important part. Halving is instant and doubling is capped, which
              means the cost of an overshoot is one rejection and a quick recovery, while the cost
              of being too aggressive compounds. If the response to a rejection were a small linear
              decrease, a receiver that had genuinely tightened would see you keep pushing for
              hours, and pushing after a deferral is the specific behaviour receivers read as abuse.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                This is the same curve the planner above draws, and that is not a coincidence.
              </strong>{' '}
              A warm-up schedule that grows by a factor under two per clean day is the
              human-readable form of the rule the rate limiter is already following. So the plan on
              your wall and the behaviour of the software agree with each other rather than being
              two unrelated pieces of advice that quietly fight — which is what happens when a
              product’s pacing is a fixed table and its documentation recommends a curve. The
              learned quota is also persisted per domain, so a ramp that is interrupted resumes from
              what was learned rather than from the beginning.
            </p>
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">1. Deferrals rising.</strong> A 4.x.x response is the
              receiver saying “not now, try later”, and one or two is normal background noise. A
              deferral rate that climbs as your volume climbs is the receiver telling you the ramp
              is ahead of what it will accept, in the politest terms available in the protocol. The
              send path is already backing off; the mistake is to add volume on top of that backoff
              because the schedule said today was a bigger day. Notably, a soft throttle suppresses
              the address for one day, so the system’s own recovery window is already a day long.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">2. Unknown-user rate moving.</strong> Hard bounces for
              addresses that do not exist — the <Mono>hard_invalid</Mono> and{' '}
              <Mono>hard_domain</Mono> classes, from enhanced codes <Mono>5.1.1</Mono>,{' '}
              <Mono>5.1.3</Mono>, <Mono>5.1.6</Mono> and <Mono>5.1.2</Mono>. During a ramp this rate
              rising means you have reached a tier of the list that has decayed, and continuing to
              mail it tells every receiver you do not know who your subscribers are. Stop, clean
              that tier, and resume.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">3. Complaint rate moving at all.</strong> Not exceeding a
              threshold — moving. During a warm-up you are sending to your most engaged people, so
              the complaint rate should be near zero and any movement means the audience is less
              willing than you assumed. The published ceiling of 0.3% is where you are already in
              trouble; the number that should make you hold is any visible change from your
              baseline.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              A fourth signal that is harder to see but worth watching: open rate falling while
              delivery stays flat. That is the signature of spam-folder placement, because an
              accepted message counts as delivered regardless of the folder it landed in. Read that
              number carefully, though — opens are classified into five audience classes and only
              human opens count toward the headline rate, and in production today the classifier
              receives only the user agent, IP, method and country, so the timing- and ASN-based
              rules do not fire. Treat a falling open rate as directional evidence, then confirm it
              in{' '}
              <a
                href="/guides/inbox-placement-vs-delivery"
                className="text-accent underline underline-offset-4"
              >
                placement terms
              </a>{' '}
              rather than acting on the percentage alone.
            </p>
            <Callout variant="warn" title="DO NOT RETRY THE BATCH YOURSELF">
              When a send is deferred, the send path holds it and retries on its own schedule. What
              you must not do is re-queue the batch from your side, or increase concurrency to
              “catch up”. Manual retries after a deferral turn a receiver’s polite backpressure into
              a pattern indistinguishable from an attack, and that is a much harder reputation to
              recover from than a ramp that took an extra week. Warming faster than receivers will
              accept does not compress the timeline; it restarts it.
            </Callout>
          </>
        ),
      }}
    </GuideLayout>
  )
}
