import { Callout } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Lede, Mono } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'automations-instance-vs-cohort'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/automations-instance-vs-cohort')({
  head: () => guideHead(SLUG),
  component: Page,
})

const OUTCOMES: Array<[string, string]> = [
  [
    'A 30-day drip to 5,000 people, no per-person timing',
    'Cohort. Five thousand is comfortably inside the 25,000 cohort ceiling, and one pass per step moves the whole group in two UPDATEs rather than five thousand round trips.',
  ],
  [
    'The same drip, but to 500,000 people',
    'Cohort, and it is not close. Instance mode would need 500,000 concurrent instances against a platform cap of 50,000. Cohort mode turns the same month into roughly 720 instances — one per hourly cohort, split whenever a cohort passes 25,000.',
  ],
  [
    'Onboarding with “wait until they click, or 3 days”',
    'Instance. A cohort has one clock for everyone and cannot express a per-person event wait at all — the cohort plan type excludes wait_until, so this is refused at compile time rather than quietly quantised to the nearest hour.',
  ],
  [
    'That onboarding flow, but you expect 60,000 enrollments',
    'Neither, as configured. Instance mode refuses past 40,000 and cohort mode cannot express the event wait. The honest answer is to change the automation: replace the event wait with a fixed wait plus a branch on “has clicked”, and run it as a cohort.',
  ],
  [
    'A short 3-step welcome series, a few hundred people a day',
    'Either works. Take cohort — it is the default, it costs fewer instances, and you keep the headroom for the automation that genuinely needs per-person timing later.',
  ],
  [
    'A win-back flow whose branch depends on behaviour during the flow',
    'Cohort, unless the branch has to fire the instant the behaviour happens. A cohort branch is evaluated when the group reaches that step, which for a win-back is exactly the right granularity.',
  ],
  [
    'You genuinely do not know how many will enroll',
    'Cohort. It is the only one of the two whose cost does not scale with enrollments, so it is the choice that cannot be wrong by an order of magnitude.',
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Instance mode</strong> is one durable workflow instance
              per enrolled contact. That instance holds a real position in the program, sleeps
              through waits, and can block on an event — “wait until this person clicks, or three
              days, whichever comes first”. Every step decision is made for that one person at the
              moment they reach it. It is the model you would design on a whiteboard, and it is the
              only one that can express per-person timing.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Cohort mode</strong> inverts the relationship. A cohort
              is a set of people who share a clock — everyone who enrolled in the same hour — and
              the instance belongs to the cohort, not to the person. When the cohort reaches a send
              step, one fan-out enqueues the whole group. When it reaches a branch, the condition is
              evaluated as a set operation: the segment expression is compiled and applied to the
              cohort, and twenty-five thousand people cross the branch in two <Mono>UPDATE</Mono>s
              rather than twenty-five thousand round trips.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              This is why the two modes have such different costs. An instance-mode automation’s
              cost is proportional to enrolled contacts and to how long the flow runs, because a
              thirty-day drip holds an instance open for thirty days. A cohort-mode automation’s
              cost is proportional to the number of cohorts and the number of fan-out pages — the
              member count barely enters into it. A cohort walks its program once per ordinal
              regardless of whether it contains four hundred people or twenty-four thousand.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Both modes run the same steps through the same interpreter, against the same compiled
              plan structure, with a driver on either side. That is deliberate: the step semantics
              do not fork by mode, so a send is a send and a branch is a branch, and the execution
              trace is the regression surface that keeps the two drivers honest with each other.
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
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="px-4 py-2.5 font-mono text-[12px] font-semibold">constant</th>
                    <th className="px-4 py-2.5 font-mono text-[12px] font-semibold">value</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">what it bounds</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['COHORT_MAX', '25,000', 'The largest cohort a single instance walks.'],
                    [
                      'INSTANCE_MODE_MAX_ENROLLMENTS',
                      '40,000',
                      'Active enrollments one instance-mode automation may hold open.',
                    ],
                    [
                      'WORKFLOWS_V2_MAX_CONCURRENT_INSTANCES',
                      '50,000',
                      'The engine’s own cap on concurrent instances, account-wide.',
                    ],
                  ].map(([name, value, bounds]) => (
                    <tr key={name} className="border-line border-t">
                      <td className="px-4 py-2 font-mono text-[12.5px] text-ink">{name}</td>
                      <td className="px-4 py-2 font-mono text-[13px] text-ink">{value}</td>
                      <td className="px-4 py-2 text-muted">{bounds}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Why 40,000 and not 50,000.</strong> The engine’s cap is
              account-wide, not per-automation. If one drip were allowed to enroll right up to it,
              that single automation could consume the entire account’s instance budget and stop
              every other automation in the deployment from starting — including the ones a
              colleague built and is not watching. Forty thousand leaves ten thousand instances of
              headroom for everything else. The gap is not caution about the platform number; it is
              a refusal to let one automation externalise its cost onto every other automation you
              run.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Why 25,000 for a cohort.</strong> A cohort’s cost is the
              fan-out page count rather than the member count, so the ceiling is not about
              throughput. It is about the enrollment set being walkable inside one instance’s
              lifetime. Twenty-five thousand is what that buys. Past it, a cohort splits: the
              estimate is one instance per hourly cohort, times the number of 25,000-member slices
              that hour needs. Half a million contacts spread over a month is roughly 720 instances
              — comfortably inside a cap that instance mode would have blown through on day one.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Both checks throw the same error, <Mono>automation_scale_exceeded</Mono>, and both
              name the number and the way out in the message rather than in a documentation link.
              The API and the engine check the same constants, so you cannot get into a state one of
              them considers valid and the other does not.
            </p>
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
              an awkward moment: it is not about your automation being too big, it is about the
              account being full. Someone else’s automation can cause it. That is the situation the
              40,000 ceiling exists to make rare.
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
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {OUTCOMES.map(([shape, verdict], index) => (
                <li key={shape} className="rounded-tile border border-line bg-card p-4">
                  <div className="flex items-baseline gap-2.5">
                    <span className="font-mono text-[11.5px] text-muted-2">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[15px] font-semibold text-ink">{shape}</span>
                  </div>
                  <p className="mt-1.5 mb-0 text-[14.5px] leading-[1.6] text-muted">{verdict}</p>
                </li>
              ))}
            </ol>
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              When you do not choose a mode, the default is cohort — unless the steps contain a
              per-person event wait anywhere, including inside a branch arm three levels down, in
              which case the recommendation becomes instance because the automation either runs that
              way or does not run. The fourth row above is the case where those two forces collide,
              and it is worth being explicit about why nothing is downgraded automatically:
              quantising “wait until they click” to the nearest hour is a different product from the
              one you configured, and shipping it silently would be worse than refusing.
            </p>
            <Callout variant="warn" title="THE CONVERSION YOU CANNOT DO IN PLACE">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                You cannot flip a running automation from one mode to the other and keep the people
                in it. The execution state has a different shape — a per-contact position versus a
                per-cohort ordinal — so an in-place switch would strand contacts mid-flow. Create
                the other mode and migrate enrollments deliberately. The API will also refuse to
                switch an automation to instance mode while its enrolled count is already past
                40,000, which is the same refusal arriving one step earlier.
              </p>
            </Callout>
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              In instance mode the condition is evaluated for one contact at the instant that
              instance arrives at the step, and the instance jumps to the matching arm. In cohort
              mode the same condition is compiled to a parameterised <Mono>WHERE</Mono> fragment and
              applied to the cohort as a set: the people who match are moved to the “then” ordinal
              and the rest to the “otherwise” ordinal, in two statements. Same semantics, radically
              different cost — see{' '}
              <a
                href="/guides/segments-query-language"
                className="text-accent underline underline-offset-4"
              >
                the segment query language
              </a>{' '}
              for what you can write in that condition and why it is safe to compile.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Waits come in two kinds.</strong> A plain wait is a
              duration and both modes handle it: the instance sleeps, and in cohort mode the whole
              group sleeps together, which is exactly why a cohort is defined as “people who share a
              clock”. An event wait — wait for this specific person to do something, with a timeout
              — needs a runtime that can block on an event, so it exists only in instance mode.
              Cohort plans exclude it in the type system rather than rejecting it at run time, which
              means a cohort plan containing one is a compile error and not a 3am surprise.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              An event wait that times out <em>continues</em> rather than exits. That is a
              deliberate choice about failure modes: a missed event silently dropping people out of
              an automation is the kind of bug nobody notices, because the symptom is an absence. If
              you want people who did not do the thing to leave, put an explicit exit after the
              branch — then the behaviour is written down in the flow where a colleague can read it.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">An exit condition is not an entry filter.</strong> An
              entry filter decides who gets in and is evaluated once. An exit is a step: when the
              flow reaches it, the people who reached it leave. In cohort mode the cohort walks past
              an exit — only some of its people left there — which is why a cohort run reports
              “exited” only when the whole selected set has gone. If what you want is “stop sending
              to anyone who buys”, that is a branch to an exit at the top of each stage, not a
              filter you set once at the beginning.
            </p>
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Editing steps writes a new version.</strong> It does not
              mutate the existing one. A row goes into <Mono>automation_versions</Mono> with the
              next version number, and the automation’s current version pointer moves to it. New
              enrollments start on the new version. Everyone already in flight stays pinned to the
              version they enrolled on — their enrollment row carries the version number, and the
              runner loads that version’s steps, not the current ones.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">And a mismatch is fatal on purpose.</strong> A compiled
              plan carries a fingerprint of the steps it was built from. An instance records the
              fingerprint it started against, and if the plan it loads later does not match, it
              throws rather than continuing:
            </p>
            <Code>
              {`PlanFingerprintMismatch: this instance was started against plan
a3f1… but the loaded plan is 91c0…. Publish a new automation version
instead of editing one that has instances in flight.`}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              That failure looks unfriendly and is the kindest available behaviour. Step positions
              are ordinals and durable execution replays by step id, so an instance resuming against
              edited steps would continue at a position that means something different from what it
              meant when it paused — sending step five of the new flow to someone who has already
              had steps one through four of the old one. Refusing produces one loud error you can
              act on. Continuing produces mail nobody designed, to real people, silently.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Deleting has the same shape. An automation is archived rather than deleted, because
              in-flight enrollments still reference the version they started on and dropping the
              steps would strand them mid-flow. The trigger is removed so nothing new enrolls; the
              people already inside finish.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">So how should you version them?</strong> Treat a
              published automation as immutable and let versions accumulate. Concretely:
            </p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15.5px] leading-[1.7] text-muted">
              {[
                'Remember that a copy fix is a structural edit too. Subject lines and bodies live inside the steps, so correcting a typo writes a new version like anything else — and the people already in flight keep the old wording all the way to the end of their flow. If a mistake genuinely must not go out again, stopping the automation is the only thing that stops it.',
                'Change structure — adding, removing or reordering steps, or changing a branch condition — knowing that it applies to new enrollments only. If you need it to apply to people already inside, the honest move is to stop the automation, let them drain or exit them deliberately, and start the new version.',
                'Do not renumber. Adding a step in the middle changes what every later ordinal means for anyone who enrolls afterwards. That is fine for them and invisible to everyone already in flight, but it makes the two populations genuinely different flows, so name your versions in a way that says which is which.',
                'Watch the enrollment counts across versions after a change. Two versions both accumulating enrollments means the trigger is still pointing somewhere you did not expect.',
              ].map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-accent" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </>
        ),
      }}
    </GuideLayout>
  )
}
