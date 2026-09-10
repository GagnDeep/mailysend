import { Callout, Metric, MetricGrid } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
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

const SLUG = 'automations-instance-vs-cohort'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/automations-instance-vs-cohort')({
  head: () => guideHead(SLUG),
  component: Page,
})

const OUTCOMES: Array<[string, string, string]> = [
  [
    'A 30-day drip to 5,000 people, no per-person timing',
    'Cohort',
    'Five thousand is comfortably inside the 25,000 cohort ceiling, and one pass per step moves the whole group in two UPDATEs rather than five thousand round trips.',
  ],
  [
    'The same drip, but to 500,000 people',
    'Cohort, and it is not close',
    'Instance mode would need 500,000 concurrent instances against a platform cap of 50,000. Cohort mode turns the same month into roughly 720 instances — one per hourly cohort, split whenever a cohort passes 25,000.',
  ],
  [
    'Onboarding with “wait until they click, or 3 days”',
    'Instance',
    'A cohort has one clock for everyone and cannot express a per-person event wait at all — the cohort plan type excludes wait_until, so this is refused at compile time rather than quietly quantised to the nearest hour.',
  ],
  [
    'That onboarding flow, but you expect 60,000 enrollments',
    'Neither, as configured',
    'Instance mode refuses past 40,000 and cohort mode cannot express the event wait. The honest answer is to change the automation: replace the event wait with a fixed wait plus a branch on “has clicked”, and run it as a cohort.',
  ],
  [
    'A short 3-step welcome series, a few hundred people a day',
    'Either works — take cohort',
    'It is the default, it costs fewer instances, and you keep the headroom for the automation that genuinely needs per-person timing later.',
  ],
  [
    'A win-back flow whose branch depends on behaviour during the flow',
    'Cohort',
    'Unless the branch has to fire the instant the behaviour happens. A cohort branch is evaluated when the group reaches that step, which for a win-back is exactly the right granularity.',
  ],
  [
    'You genuinely do not know how many will enroll',
    'Cohort',
    'It is the only one of the two whose cost does not scale with enrollments, so it is the choice that cannot be wrong by an order of magnitude.',
  ],
]

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You can now pick a mode from the shape of the automation rather than from a feeling: a
          per-person event wait forces instance mode, and anything above 40,000 enrollments forces
          cohort mode, with the two ceilings meeting in a band where either works and cohort is the
          cheaper default. The thing most likely to bite you later is editing a live automation —
          changing steps writes a new version, in-flight enrollments stay pinned to the version they
          started on, and an instance whose plan no longer matches its fingerprint fails loudly
          rather than executing a flow nobody designed.
        </p>
      }
    >
      {{
        'two-models': (
          <>
            <Lede>
              The same automation — a trigger, a list of steps, some waits and branches — can be
              executed two completely different ways. One gives every contact its own durable
              execution. The other gives a whole group one execution and moves them through it a
              step at a time. Both are correct; they fail in different directions.
            </Lede>
            <Takeaway>
              Instance mode’s cost scales with enrolled contacts and with how long the flow runs.
              Cohort mode’s cost scales with the number of cohorts and fan-out pages, and barely
              notices the member count.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'Instance mode',
                  tone: 'neutral',
                  points: [
                    'One durable workflow instance per enrolled contact',
                    'The instance holds a real position in the program and sleeps through waits',
                    'Can block on an event — “wait until this person clicks, or three days, whichever comes first”',
                    'Every step decision is made for one person at the moment they reach it',
                    'The model you would design on a whiteboard, and the only one that expresses per-person timing',
                    'A thirty-day drip holds an instance open for thirty days',
                  ],
                },
                {
                  label: 'Cohort mode',
                  tone: 'neutral',
                  points: [
                    'A cohort is a set of people who share a clock — everyone who enrolled in the same hour',
                    'The instance belongs to the cohort, not to the person',
                    'A send step is one fan-out that enqueues the whole group',
                    <>
                      A branch is a set operation: the segment expression is compiled and applied to
                      the cohort in two <Mono>UPDATE</Mono>s
                    </>,
                    'Twenty-five thousand people cross a branch without twenty-five thousand round trips',
                    'A cohort walks its program once per ordinal whether it holds four hundred people or twenty-four thousand',
                  ],
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The step semantics do not fork by mode.</strong> Both
              modes run the same steps through the same interpreter, against the same compiled plan
              structure, with a driver on either side. A send is a send and a branch is a branch,
              and the execution trace is the regression surface that keeps the two drivers honest
              with each other.
            </p>
          </>
        ),
        'the-ceilings': (
          <>
            <Lede>
              Three constants govern this, they live in one file that both the API and the workflow
              engine import, and the reason the middle one is not the same as the third is the most
              useful thing on this page.
            </Lede>
            <Takeaway>
              40,000 is not 50,000 on purpose: the engine’s cap is account-wide, so one automation
              allowed to reach it could stop every other automation in the deployment from starting.
            </Takeaway>
            <MetricGrid className="my-5" min={200}>
              <Metric
                value="25,000"
                label="COHORT_MAX — the largest cohort a single instance walks"
              />
              <Metric
                value="40,000"
                label="INSTANCE_MODE_MAX_ENROLLMENTS — active enrollments one instance-mode automation may hold open"
              />
              <Metric
                value="50,000"
                label="WORKFLOWS_V2_MAX_CONCURRENT_INSTANCES — the engine’s own cap on concurrent instances, account-wide"
              />
            </MetricGrid>
            <FactTable
              columns={['Ceiling', 'Why that number', 'What happens past it']}
              rows={[
                [
                  'COHORT_MAX',
                  'A cohort’s cost is the fan-out page count rather than the member count, so this is not about throughput — it is about the enrollment set being walkable inside one instance’s lifetime.',
                  'The cohort splits. The estimate is one instance per hourly cohort, times the number of 25,000-member slices that hour needs — half a million contacts over a month is roughly 720 instances.',
                ],
                [
                  'INSTANCE_MODE_MAX_ENROLLMENTS',
                  'Ten thousand instances of headroom below the engine cap. Not caution about the platform number: a refusal to let one automation externalise its cost onto every other automation you run, including the ones a colleague built and is not watching.',
                  <>
                    The API and the engine both throw <Mono>automation_scale_exceeded</Mono>, naming
                    the number and the way out in the message.
                  </>,
                ],
                [
                  'WORKFLOWS_V2_MAX_CONCURRENT_INSTANCES',
                  'The engine’s own limit, account-wide rather than per-automation.',
                  'The same error, but about the account being full rather than your automation being too big — someone else’s automation can cause it.',
                ],
              ]}
              caption="The API and the engine check the same constants, so you cannot get into a state one of them considers valid and the other does not."
            />
            <Code>
              <Com>{`# what a refusal actually says\n`}</Com>
              {`Instance-mode automations support at most 40,000 active enrollments
and this one would reach 41,300. Switch this automation to cohort mode.

`}
              <Com>{`# and the account-wide one\n`}</Com>
              {`The workflow engine allows 50,000 concurrent instances and 49,850
are already open. Switch this automation to cohort mode, which uses
one instance per hourly cohort.`}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The second message is worth reading twice, because it is the one that will arrive at
              an awkward moment. It is not about your automation being too big, it is about the
              account being full — and that is the situation the 40,000 ceiling exists to make rare.
            </p>
          </>
        ),
        'pick-one': (
          <>
            <Lede>
              Two questions settle almost every case. Does any step wait for a per-person event?
              Then instance mode, because a cohort cannot express it. Will more than forty thousand
              people be enrolled at once? Then cohort mode, because instance mode will refuse.
              Everything below is what happens in the cases those two questions do not immediately
              resolve.
            </Lede>
            <Takeaway>
              When you do not choose, the default is cohort — unless the steps contain a per-person
              event wait anywhere, including inside a branch arm three levels down, in which case
              the recommendation becomes instance because the automation either runs that way or
              does not run.
            </Takeaway>
            <Diagram
              steps={[
                { kicker: 'ASK 1', title: 'Any per-person event wait?', meta: 'yes → instance' },
                {
                  kicker: 'ASK 2',
                  title: 'More than 40,000 enrolled at once?',
                  meta: 'yes → cohort',
                },
                {
                  kicker: 'BOTH YES',
                  title: 'Change the automation',
                  tone: 'accent',
                  meta: 'nothing is downgraded for you',
                },
                {
                  kicker: 'NEITHER',
                  title: 'Cohort, the default',
                  meta: 'cheaper, keeps the headroom',
                },
              ]}
            />
            <FactTable
              columns={['The automation', 'Mode', 'Why']}
              monoFirst={false}
              rows={OUTCOMES.map(([shape, verdict, why]) => [shape, verdict, why])}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Nothing is downgraded automatically.</strong> Row four is
              where the two forces collide, and the reason it refuses rather than adapting is that
              quantising “wait until they click” to the nearest hour is a different product from the
              one you configured. Shipping it silently would be worse than refusing.
            </p>
            <Gotcha title="The conversion you cannot do in place">
              You cannot flip a running automation from one mode to the other and keep the people in
              it. The execution state has a different shape — a per-contact position versus a
              per-cohort ordinal — so an in-place switch would strand contacts mid-flow. Create the
              other mode and migrate enrollments deliberately. The API will also refuse to switch an
              automation to instance mode while its enrolled count is already past 40,000, which is
              the same refusal arriving one step earlier.
            </Gotcha>
          </>
        ),
        branching: (
          <>
            <Lede>
              A branch is a condition written in the same expression language segments use,
              evaluated at the moment the flow reaches it. That last clause is the whole section: a
              branch is not a filter that ran at enrollment and is being replayed, it is a question
              asked now.
            </Lede>
            <Takeaway>
              Same semantics, radically different cost: one contact evaluated at the instant it
              arrives, or the whole cohort partitioned by a compiled <Mono>WHERE</Mono> fragment in
              two statements.
            </Takeaway>
            <FactTable
              columns={['Step', 'Instance mode', 'Cohort mode']}
              rows={[
                [
                  'branch',
                  'Evaluated for one contact at the instant that instance arrives; the instance jumps to the matching arm.',
                  <>
                    Compiled to a parameterised <Mono>WHERE</Mono> fragment and applied to the
                    cohort as a set — matches move to the “then” ordinal, the rest to “otherwise”.
                  </>,
                ],
                [
                  'wait (duration)',
                  'The instance sleeps.',
                  'The whole group sleeps together — which is exactly why a cohort is defined as “people who share a clock”.',
                ],
                [
                  'wait_until (event)',
                  'Supported: the runtime blocks on the event, with a timeout.',
                  'Excluded in the type system, so a cohort plan containing one is a compile error and not a 3am surprise.',
                ],
                [
                  'exit',
                  'The contact leaves when the flow reaches it.',
                  'The cohort walks past it — only some of its people left there — so a cohort run reports “exited” only when the whole selected set has gone.',
                ],
              ]}
              caption="See the segment query language for what you can write in a branch condition and why it is safe to compile."
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                An event wait that times out continues rather than exits.
              </strong>{' '}
              That is a deliberate choice about failure modes: a missed event silently dropping
              people out of an automation is the kind of bug nobody notices, because the symptom is
              an absence. If you want people who did not do the thing to leave, put an explicit exit
              after the branch — then the behaviour is written down in the flow where a colleague
              can read it. What you can write in that condition, and why it is safe to compile, is{' '}
              <a
                href="/guides/segments-query-language"
                className="text-accent underline underline-offset-4"
              >
                the segment query language
              </a>
              .
            </p>
            <Contrast
              sides={[
                {
                  label: 'An entry filter',
                  tone: 'neutral',
                  points: [
                    'Decides who gets in',
                    'Evaluated once, at enrollment',
                    'Cannot stop someone who qualifies later and then stops qualifying',
                  ],
                },
                {
                  label: 'An exit condition',
                  tone: 'neutral',
                  points: [
                    'Is a step: when the flow reaches it, the people who reached it leave',
                    'Evaluated wherever you put it in the flow',
                    '“Stop sending to anyone who buys” is a branch to an exit at the top of each stage, not a filter set once at the beginning',
                  ],
                },
              ]}
            />
            <Callout title="UNSUBSCRIBES">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                An unsubscribe stops the next message, not just future enrollments — the check
                happens at the send step, not at enrollment, so someone who leaves on day two of a
                thirty-day drip gets nothing on day three. The exit takes effect at the next step
                boundary, which means anything already handed to the send queue at that instant may
                still go out. That gap is minutes, not days, and it is the reason the confirmation
                page says it can take a few minutes for queued mail to stop. See{' '}
                <a
                  href="/guides/unsubscribe-and-preferences"
                  className="text-accent underline underline-offset-4"
                >
                  unsubscribe done properly
                </a>
                .
              </p>
            </Callout>
          </>
        ),
        'changing-live': (
          <>
            <Lede>
              Someone will always need to fix a typo in step four while eight thousand people are
              somewhere between step two and step six. The answer to “what happens to them” is what
              determines how you should version automations, so it is worth knowing exactly rather
              than approximately.
            </Lede>
            <Takeaway>
              Editing steps never mutates a version. It writes a new one, moves the pointer, and
              leaves everyone in flight pinned to the version they enrolled on.
            </Takeaway>
            <Diagram
              steps={[
                {
                  kicker: 'EDIT',
                  title: <>New row in automation_versions</>,
                  meta: 'the next version number',
                },
                {
                  kicker: 'POINTER',
                  title: 'Current version moves',
                  meta: 'new enrollments start here',
                },
                {
                  kicker: 'IN FLIGHT',
                  title: 'Stay pinned',
                  meta: 'the enrollment row carries its version; the runner loads that one',
                },
                {
                  kicker: 'MISMATCH',
                  title: 'PlanFingerprintMismatch',
                  tone: 'accent',
                  meta: 'the instance throws instead of continuing',
                },
              ]}
            />
            <Code>
              {`PlanFingerprintMismatch: this instance was started against plan
a3f1… but the loaded plan is 91c0…. Publish a new automation version
instead of editing one that has instances in flight.`}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">A mismatch is fatal on purpose.</strong> A compiled plan
              carries a fingerprint of the steps it was built from, and an instance records the one
              it started against. Step positions are ordinals and durable execution replays by step
              id, so an instance resuming against edited steps would continue at a position that
              means something different from what it meant when it paused — sending step five of the
              new flow to someone who has already had steps one through four of the old one.
              Refusing produces one loud error you can act on; continuing produces mail nobody
              designed, to real people, silently.
            </p>
            <Gotcha title="Deleting is archiving">
              An automation is archived rather than deleted, because in-flight enrollments still
              reference the version they started on and dropping the steps would strand them
              mid-flow. The trigger is removed so nothing new enrolls; the people already inside
              finish.
            </Gotcha>
            <FactTable
              columns={['Change', 'What it does', 'What to do about it']}
              monoFirst={false}
              rows={[
                [
                  'Fixing a typo in a subject line or body',
                  'A structural edit like any other — copy lives inside the steps, so it writes a new version.',
                  'Accept that people already in flight keep the old wording to the end of their flow. If a mistake genuinely must not go out again, stopping the automation is the only thing that stops it.',
                ],
                [
                  'Adding, removing or reordering steps, or changing a branch condition',
                  'Applies to new enrollments only.',
                  'If it has to apply to people already inside, stop the automation, let them drain or exit them deliberately, and start the new version.',
                ],
                [
                  'Adding a step in the middle',
                  'Changes what every later ordinal means for anyone who enrolls afterwards — fine for them, invisible to everyone already in flight.',
                  'Do not renumber. The two populations are genuinely different flows, so name your versions in a way that says which is which.',
                ],
                [
                  'Any change at all',
                  'Two versions can end up accumulating enrollments at once.',
                  'Watch the enrollment counts across versions afterwards. Both climbing means the trigger is still pointing somewhere you did not expect.',
                ],
              ]}
              caption="Treat a published automation as immutable and let versions accumulate."
            />
          </>
        ),
      }}
    </GuideLayout>
  )
}
