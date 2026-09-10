import { Callout, StepCard } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { BounceClassifier } from '~/components/guides/bounce-classifier.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Lede, Mono } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'read-a-bounce'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/read-a-bounce')({
  head: () => guideHead(SLUG),
  component: Page,
})

const CLASSES: Array<{
  name: string
  verdict: string
  meaning: string
  why: string
}> = [
  {
    name: 'hard_invalid',
    verdict: 'Permanent · suppress',
    meaning: 'The mailbox does not exist at that domain.',
    why: 'This is the only class that is unambiguously about the address itself. There is no future in which sending again works, and every repeat attempt is a documented invalid-recipient hit against your reputation at that receiver.',
  },
  {
    name: 'hard_domain',
    verdict: 'Permanent · suppress',
    meaning: 'The receiving domain does not resolve or has no route for mail.',
    why: 'Separated from invalid because the failure is one level up: a typo in the domain part, an expired registration, a company that no longer exists. Nothing about the local part is being asserted, and if the domain ever comes back the address may be fine.',
  },
  {
    name: 'hard_blocked',
    verdict: 'Permanent · suppress',
    meaning: 'You were refused by policy. The address is probably real.',
    why: 'The most important distinction in the taxonomy. It suppresses, because continuing to send is the worst thing you can do — but it is evidence about you, not about the recipient. A hundred of these to one provider is a reputation incident, not a hundred bad addresses, and a UI that files them next to typos will let you miss that.',
  },
  {
    name: 'soft_mailbox_full',
    verdict: 'Temporary · 7 days',
    meaning: 'A real person with a full mailbox.',
    why: 'The single most expensive class to get wrong. Whoever this is opted in, still exists, and will empty their mailbox eventually — or will not, in which case they stop opening and your engagement segments will retire them for you. Suppressing permanently here throws away a subscriber on the strength of a temporary condition.',
  },
  {
    name: 'soft_throttled',
    verdict: 'Temporary · 1 day',
    meaning: 'The receiver is rate-limiting you, or greylisting.',
    why: 'Not a failure at all in the usual sense: it is the receiver telling you the pace is wrong. The correct response is to slow down, which is why the send path halves its learned quota on rejection rather than retrying harder into the same wall.',
  },
  {
    name: 'soft_content',
    verdict: 'Temporary · 3 days',
    meaning: 'Refused on content or authentication grounds.',
    why: 'Classified soft on purpose. The message is the problem, not the address — fix the authentication or the content and the same recipient accepts your next send. Treating it as a hard bounce would permanently suppress people because of a broken DKIM key.',
  },
  {
    name: 'soft_temporary',
    verdict: 'Temporary · 2 days',
    meaning: 'A generic 4.x.x failure with nothing more specific to say.',
    why: 'The honest catch-all for a temporary code the classifier can read but cannot narrow. Two days is short enough that a real outage resolves inside the window and long enough that you are not hammering a struggling server.',
  },
  {
    name: 'unknown',
    verdict: 'No suppression at all',
    meaning: 'Nothing in the diagnostic was recognised.',
    why: 'Deliberately does nothing. An unrecognised diagnostic is a gap in the classifier, not evidence about the recipient, and the cost of guessing wrong is a real subscriber lost permanently. The address stays sendable and the raw diagnostic stays stored so the gap can be closed.',
  },
]

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You can now look at a diagnostic string and say which of the eight classes it lands in,
          whether it suppresses, and for how long. The two things most likely to bite you later are
          both misreadings of a class rather than a bug: a run of <Mono>hard_blocked</Mono> is a
          reputation incident being filed as a list-hygiene problem, and an <Mono>unknown</Mono>{' '}
          bounce is an unanswered question rather than a clean delivery. Watch the volume of both,
          not just the totals.
        </p>
      }
    >
      {{
        classifier: (
          <>
            <Lede>
              This widget imports <Mono>classifyBounce</Mono> and <Mono>softSuppressionDays</Mono>{' '}
              from <Mono>@mailysend/events/bounce</Mono> — the same two functions the event consumer
              calls. Paste a diagnostic you actually received and the answer here is the answer your
              instance would record.
            </Lede>
            <BounceClassifier />
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              Give it the full line where you have it, including the SMTP code and the enhanced
              status code. The classifier reads the diagnostic text, the SMTP code and any
              pre-classification your provider supplied, in that order of preference — and the
              enhanced code inside the text is worth more than everything else combined, for reasons
              the last section goes into.
            </p>
            <Callout title="WHY THIS RUNS IN YOUR BROWSER">
              The widget imports the classifier from its subpath export rather than the package
              barrel, because the barrel re-exports the queue consumer, which reaches into platform
              and database code. Classifying a string should not drag a database client into a
              marketing page — and running the real function is the only way this page can promise
              that what you read is what you get.
            </Callout>
          </>
        ),
        'hard-vs-soft': (
          <>
            <Lede>
              Eight classes exist so you can reason about causes, but only one distinction changes
              what happens to the address: hard suppresses permanently, soft holds for a window and
              then releases. Everything expensive about bounce handling comes from getting that
              binary wrong, and it is expensive in both directions.
            </Lede>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-tile border border-line bg-card p-4">
                <div className="font-mono text-[13px] font-bold text-accent">
                  SUPPRESSING TOO EAGERLY
                </div>
                <p className="mt-1 mb-1.5 text-[15.5px] font-semibold text-ink">
                  You lose a real subscriber, forever, silently.
                </p>
                <p className="m-0 text-[14.5px] leading-[1.6] text-muted">
                  Suppress on a full mailbox and you have permanently removed somebody who opted in,
                  reads your mail, and whose only offence was being over quota for a week. Nothing
                  ever tells you: there is no error, no complaint, and no event. The address simply
                  stops appearing in sends, and your list quietly shrinks by however many people
                  were behind on their inbox that Tuesday.
                </p>
              </div>
              <div className="rounded-tile border border-line bg-card p-4">
                <div className="font-mono text-[13px] font-bold text-accent">
                  NOT SUPPRESSING AT ALL
                </div>
                <p className="mt-1 mb-1.5 text-[15.5px] font-semibold text-ink">
                  You keep hammering a receiver that is grading you on it.
                </p>
                <p className="m-0 text-[14.5px] leading-[1.6] text-muted">
                  Send again to an address that does not exist and the receiver records another
                  invalid-recipient attempt. That rate is one of the clearest signals a large
                  receiver has for telling a maintained list from a scraped one, and it is exactly
                  the behaviour they use to decide how much of your mail to accept next month. You
                  are not just failing to reach one person; you are paying for it with the
                  deliverability of everyone else on the list.
                </p>
              </div>
            </div>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              These two costs are not symmetrical in shape. The first is a slow leak you cannot
              observe; the second is a compounding penalty applied to your entire audience. That is
              why the taxonomy is conservative in one specific place — an unrecognised diagnostic
              does not suppress — and aggressive everywhere it is certain. Certainty is the thing
              being paid for, and it is why enhanced status codes matter so much.
            </p>
            <Callout variant="warn" title="A BLOCK IS NOT A BAD ADDRESS">
              <Mono>hard_blocked</Mono> suppresses like an invalid address and means something
              entirely different. <Mono>5.7.1</Mono> is a policy refusal: the mailbox may be
              perfectly real and in daily use. If your bounce chart shows these climbing, cleaning
              the list will not help, because the list is not the problem — go and read{' '}
              <a
                href="/guides/debug-a-550-rejection"
                className="text-accent underline underline-offset-4"
              >
                debug a 550 rejection
              </a>{' '}
              instead.
            </Callout>
          </>
        ),
        'eight-classes': (
          <>
            <Lede>
              Each class exists because there is an action attached to it that the others do not
              share. Where two classes would lead to the same decision every time, they were not
              split. Where a single label would hide a decision, it was.
            </Lede>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="p-3 font-mono text-[12px] font-bold">CLASS</th>
                    <th className="p-3 font-mono text-[12px] font-bold">EFFECT</th>
                    <th className="p-3 font-mono text-[12px] font-bold">MEANS</th>
                  </tr>
                </thead>
                <tbody>
                  {CLASSES.map((row) => (
                    <tr key={row.name} className="border-line border-t">
                      <td className="p-3 align-top font-mono text-[12.5px] text-ink">{row.name}</td>
                      <td className="p-3 align-top text-muted">{row.verdict}</td>
                      <td className="p-3 align-top text-muted">{row.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-6 flex flex-col gap-5">
              {CLASSES.map((row) => (
                <StepCard
                  key={row.name}
                  step={CLASSES.indexOf(row) + 1}
                  title={row.name}
                  description={row.why}
                  variant="rule"
                />
              ))}
            </div>
            <p className="mt-6 text-[15.5px] leading-[1.7] text-muted">
              One more input sits above all of this: some providers pre-classify a bounce for you,
              and that classification is trusted where present. They can see things this side cannot
              — their own suppression list, their feedback loops, the history of that address across
              every sender they carry. The diagnostic text is still read alongside it, so a provider
              saying “permanent” with a subtype mentioning a domain failure lands in{' '}
              <Mono>hard_domain</Mono> rather than the generic invalid bucket.
            </p>
          </>
        ),
        suppression: (
          <>
            <Lede>
              A soft bounce does not suppress an address. It parks it. The window is chosen per
              class from how long the underlying condition plausibly lasts — long enough that
              retrying is not futile, short enough that a recovered mailbox rejoins the next send.
            </Lede>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="p-3 font-mono text-[12px] font-bold">CLASS</th>
                    <th className="p-3 font-mono text-[12px] font-bold">HOLD</th>
                    <th className="p-3 font-mono text-[12px] font-bold">WHY THAT LONG</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [
                      'soft_throttled',
                      '1 day',
                      'Rate limits and greylisting resolve in minutes to hours. A day is already generous; anything longer punishes you for the receiver’s pacing.',
                    ],
                    [
                      'soft_temporary',
                      '2 days',
                      'A generic 4.x.x failure is usually an outage or a queue problem. Two days clears almost all of them without a week of silence.',
                    ],
                    [
                      'soft_content',
                      '3 days',
                      'Long enough that you have to notice and actually fix something — a DKIM key, a link domain, a subject line — before the address is retried.',
                    ],
                    [
                      'soft_mailbox_full',
                      '7 days',
                      'The longest window, because a full mailbox is the slowest human condition here and the most costly to give up on. A week is roughly the gap to your next send.',
                    ],
                    [
                      'everything else',
                      'null',
                      'Hard classes are already permanent, and unknown is deliberately not suppressed at all — there is no window to compute.',
                    ],
                  ].map(([cls, hold, why]) => (
                    <tr key={cls} className="border-line border-t">
                      <td className="p-3 align-top font-mono text-[12.5px] text-ink">{cls}</td>
                      <td className="p-3 align-top font-mono text-[12.5px] text-muted">{hold}</td>
                      <td className="p-3 align-top text-muted">{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              The function is small enough to read in full, which is the point of publishing the
              numbers rather than describing them:
            </p>
            <Code>
              {
                'softSuppressionDays(bounceClass)\n\n  soft_mailbox_full  → 7\n  soft_throttled     → 1\n  soft_content       → 3\n  soft_temporary     → 2\n  default            → null   '
              }
              <Com>{'← hard classes and unknown'}</Com>
            </Code>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              A <Mono>null</Mono> here means two opposite things depending on the class, and the
              difference is the whole taxonomy: for a hard class there is no window because the
              suppression never ends, and for <Mono>unknown</Mono> there is no window because there
              is no suppression. If you build reporting on top of this, do not collapse those two
              into “not suppressed for a while”.
            </p>
            <Callout title="REPEATED SOFT BOUNCES ARE A LIST SIGNAL">
              One full mailbox is noise. The same address bouncing full on six consecutive sends is
              an abandoned mailbox, and the honest way to retire it is engagement rather than bounce
              handling — nobody has opened in a year, so segment them out. That is a decision about
              your audience, made deliberately, rather than a classifier quietly guessing on your
              behalf.
            </Callout>
          </>
        ),
        'enhanced-codes': (
          <>
            <Lede>
              RFC 3463 defines a three-part status code — <Mono>class.subject.detail</Mono> — that
              sits alongside the three-digit SMTP reply. Where it is present it is the single best
              signal available, because it is a machine-readable claim by the receiver about what
              went wrong, rather than a sentence written for a human by whoever configured the MTA.
            </Lede>
            <Code>
              {'550 5.1.1 <ada@example.com>: Recipient address rejected\n'}
              {' │   │ │ │\n'}
              {' │   │ │ └── detail   '}
              <Com>{'the specific condition'}</Com>
              {'\n │   │ └──── subject  '}
              <Com>{'what the code is about (addressing, mailbox, policy…)'}</Com>
              {'\n │   └────── class    '}
              <Com>{'2 success · 4 temporary · 5 permanent'}</Com>
              {'\n └────────── SMTP reply code, much coarser'}
            </Code>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              The <em>class</em> digit alone decides permanence, which is why the same subject and
              detail can land in different buckets: <Mono>5.7.1</Mono> is a permanent policy refusal
              and becomes <Mono>hard_blocked</Mono>, while <Mono>4.7.1</Mono> is the same subject
              temporarily and becomes <Mono>soft_throttled</Mono>. The mapping is short enough to
              state completely:
            </p>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="p-3 font-mono text-[12px] font-bold">CODE</th>
                    <th className="p-3 font-mono text-[12px] font-bold">CLASS</th>
                    <th className="p-3 font-mono text-[12px] font-bold">READING</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['5.1.1 · 5.1.3 · 5.1.6', 'hard_invalid', 'Bad destination mailbox address.'],
                    ['5.1.2', 'hard_domain', 'Bad destination system address.'],
                    [
                      'x.2.2',
                      'soft_mailbox_full',
                      'Mailbox full — never permanent, whatever the class digit says.',
                    ],
                    ['5.7.x', 'hard_blocked', 'Security or policy refusal, permanent.'],
                    [
                      '4.7.x',
                      'soft_throttled',
                      'The same refusal, temporarily — usually pacing or greylisting.',
                    ],
                    [
                      '5.3.4 · x.2.3',
                      'soft_content',
                      'Message too big for the system, or over the mailbox’s message limit.',
                    ],
                    ['4.x.x', 'soft_temporary', 'Anything else temporary.'],
                  ].map(([code, cls, reading]) => (
                    <tr key={code} className="border-line border-t">
                      <td className="p-3 align-top font-mono text-[12.5px] text-ink">{code}</td>
                      <td className="p-3 align-top font-mono text-[12.5px] text-muted">{cls}</td>
                      <td className="p-3 align-top text-muted">{reading}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              Plenty of MTAs never emit one. Older Exim and Postfix configurations, appliances in
              front of corporate mail, and anything hand-rolled will hand you{' '}
              <Mono>550 No such user here</Mono> and nothing else. For those, the classifier falls
              back to matching phrases in the diagnostic — over quota, greylist, user unknown, no
              MX, blacklist — and only then, if nothing matches, to the leading digit of the SMTP
              code.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Treat that fallback as what it is. Phrase matching is a list of things people have
              actually seen, in English, with no guarantee that the next MTA phrases it the same
              way. It is good enough to be useful and not good enough to be trusted over a code the
              receiver deliberately published — so when both are present, the code wins, every time.
            </p>
            <Callout
              variant="warn"
              title="A TEXT MATCH CAN BE THE ONLY SIGNAL — AND IT CAN BE WRONG"
            >
              Because the fallback searches the whole diagnostic, a message quoted back inside a
              bounce can contribute words to the match. If a classification looks wrong to you,
              paste the raw diagnostic into the widget above and check: <Mono>unknown</Mono> is the
              answer you want in the ambiguous case, and if you are getting a confident answer you
              disagree with, that is worth reporting rather than working around.
            </Callout>
          </>
        ),
      }}
    </GuideLayout>
  )
}
