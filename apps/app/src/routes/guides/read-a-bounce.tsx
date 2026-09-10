import { Callout, StepCard } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { BounceClassifier } from '~/components/guides/bounce-classifier.tsx'
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

const SLUG = 'read-a-bounce'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/read-a-bounce')({
  head: () => guideHead(SLUG),
  component: Page,
})

const CLASSES: Array<{
  name: string
  verdict: string
  hold: string
  meaning: string
  why: string
}> = [
  {
    name: 'hard_invalid',
    verdict: 'Permanent · suppress',
    hold: 'null — never released',
    meaning: 'The mailbox does not exist at that domain.',
    why: 'This is the only class that is unambiguously about the address itself. There is no future in which sending again works, and every repeat attempt is a documented invalid-recipient hit against your reputation at that receiver.',
  },
  {
    name: 'hard_domain',
    verdict: 'Permanent · suppress',
    hold: 'null — never released',
    meaning: 'The receiving domain does not resolve or has no route for mail.',
    why: 'Separated from invalid because the failure is one level up: a typo in the domain part, an expired registration, a company that no longer exists. Nothing about the local part is being asserted, and if the domain ever comes back the address may be fine.',
  },
  {
    name: 'hard_blocked',
    verdict: 'Permanent · suppress',
    hold: 'null — never released',
    meaning: 'You were refused by policy. The address is probably real.',
    why: 'The most important distinction in the taxonomy. It suppresses, because continuing to send is the worst thing you can do — but it is evidence about you, not about the recipient. A hundred of these to one provider is a reputation incident, not a hundred bad addresses, and a UI that files them next to typos will let you miss that.',
  },
  {
    name: 'soft_mailbox_full',
    verdict: 'Temporary · suppress',
    hold: '7 days',
    meaning: 'A real person with a full mailbox.',
    why: 'The single most expensive class to get wrong. Whoever this is opted in, still exists, and will empty their mailbox eventually — or will not, in which case they stop opening and your engagement segments will retire them for you. Suppressing permanently here throws away a subscriber on the strength of a temporary condition.',
  },
  {
    name: 'soft_throttled',
    verdict: 'Temporary · suppress',
    hold: '1 day',
    meaning: 'The receiver is rate-limiting you, or greylisting.',
    why: 'Not a failure at all in the usual sense: it is the receiver telling you the pace is wrong. The correct response is to slow down, which is why the send path halves its learned quota on rejection rather than retrying harder into the same wall.',
  },
  {
    name: 'soft_content',
    verdict: 'Temporary · suppress',
    hold: '3 days',
    meaning: 'Refused on content or authentication grounds.',
    why: 'Classified soft on purpose. The message is the problem, not the address — fix the authentication or the content and the same recipient accepts your next send. Treating it as a hard bounce would permanently suppress people because of a broken DKIM key.',
  },
  {
    name: 'soft_temporary',
    verdict: 'Temporary · suppress',
    hold: '2 days',
    meaning: 'A generic 4.x.x failure with nothing more specific to say.',
    why: 'The honest catch-all for a temporary code the classifier can read but cannot narrow. Two days is short enough that a real outage resolves inside the window and long enough that you are not hammering a struggling server.',
  },
  {
    name: 'unknown',
    verdict: 'No suppression at all',
    hold: 'null — nothing to release',
    meaning: 'Nothing in the diagnostic was recognised.',
    why: 'Deliberately does nothing. An unrecognised diagnostic is a gap in the classifier, not evidence about the recipient, and the cost of guessing wrong is a real subscriber lost permanently. The address stays sendable and the raw diagnostic stays stored so the gap can be closed.',
  },
]

/** The phrase lists `classifyBounce` falls back to, in the order it tries them. */
const PHRASES: Array<[string, string]> = [
  [
    'soft_mailbox_full',
    'mailbox full · mailbox is full · over quota · quota exceeded · insufficient storage',
  ],
  ['soft_throttled', 'rate limit · too many · throttl · try again later · deferred · greylist'],
  ['soft_content', 'spam · content rejected · message rejected for policy · dmarc · spf · dkim'],
  [
    'hard_invalid',
    'no such user · no such mailbox · user unknown · recipient rejected · recipient address rejected · does not exist · invalid recipient · unknown user',
  ],
  ['hard_domain', 'domain not found · no mx · host unknown · nxdomain · unrouteable'],
  ['hard_blocked', 'blocked · blacklist · blocklist · denied · reputation · spamhaus'],
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
            <Takeaway>
              The classifier reads four inputs in a fixed order of preference, and the enhanced
              status code inside the diagnostic is worth more than everything after it combined.
            </Takeaway>
            <BounceClassifier />
            <Diagram
              steps={[
                { kicker: '1', title: 'Provider verdict', meta: 'providerType / providerSubType' },
                {
                  kicker: '2',
                  title: 'Enhanced code',
                  tone: 'accent',
                  meta: 'RFC 3463, from the diagnostic text',
                },
                { kicker: '3', title: 'Phrase match', meta: 'six lists, in order' },
                {
                  kicker: '4',
                  title: 'SMTP leading digit',
                  meta: '5 → hard_invalid, 4 → soft_temporary',
                },
                { kicker: '5', title: 'unknown', meta: 'no suppression' },
              ]}
            />
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Give it the full line where you have it</strong>,
              including the SMTP code and the enhanced status code. Each rung is only reached
              because the one above it found nothing, so a diagnostic that carries a code never
              touches the phrase lists at all.
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
            <Takeaway>
              Hard suppresses forever, soft parks the address for a bounded number of days — and the
              two ways of being wrong about that cost you completely different things.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'Suppressing too eagerly',
                  tone: 'bad',
                  points: [
                    <strong key="eager" className="text-ink">
                      You lose a real subscriber, forever, silently.
                    </strong>,
                    'Suppress on a full mailbox and you have permanently removed somebody who opted in, reads your mail, and whose only offence was being over quota for a week',
                    'Nothing ever tells you: no error, no complaint, no event — the address simply stops appearing in sends',
                    'Your list quietly shrinks by however many people were behind on their inbox that Tuesday',
                  ],
                },
                {
                  label: 'Not suppressing at all',
                  tone: 'bad',
                  points: [
                    <strong key="lax" className="text-ink">
                      You keep hammering a receiver that is grading you on it.
                    </strong>,
                    'Send again to an address that does not exist and the receiver records another invalid-recipient attempt',
                    'That rate is one of the clearest signals a large receiver has for telling a maintained list from a scraped one',
                    'You are not just failing to reach one person — you are paying for it with the deliverability of everyone else on the list',
                  ],
                },
              ]}
            />
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">These two costs are not symmetrical in shape.</strong>{' '}
              The first is a slow leak you cannot observe; the second is a compounding penalty
              applied to your entire audience. That is why the taxonomy is conservative in one
              specific place — an unrecognised diagnostic does not suppress — and aggressive
              everywhere it is certain. Certainty is the thing being paid for, and it is why
              enhanced status codes matter so much.
            </p>
            <Gotcha title="A block is not a bad address">
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
            </Gotcha>
          </>
        ),
        'eight-classes': (
          <>
            <Lede>
              Each class exists because there is an action attached to it that the others do not
              share. Where two classes would lead to the same decision every time, they were not
              split. Where a single label would hide a decision, it was.
            </Lede>
            <Takeaway>
              Three hard classes that never release, four soft classes with windows of one to seven
              days, and one deliberate <Mono>unknown</Mono> that does nothing at all.
            </Takeaway>
            <FactTable
              columns={['Class', 'Effect', 'Holds for', 'Means']}
              rows={CLASSES.map((row) => [row.name, row.verdict, row.hold, row.meaning])}
              caption="The Holds for column is softSuppressionDays(class) verbatim — a null means the suppression never ends for a hard class, and that there is no suppression at all for unknown."
            />
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
              <strong className="text-ink">One input sits above all of this.</strong> Some providers
              pre-classify a bounce for you, and that classification is trusted where present — they
              can see things this side cannot: their own suppression list, their feedback loops, the
              history of that address across every sender they carry. The subtype is still read
              alongside it, so a permanent verdict whose subtype mentions a domain failure lands in{' '}
              <Mono>hard_domain</Mono>, one mentioning suppression lands in{' '}
              <Mono>hard_blocked</Mono>, and a transient one mentioning a full mailbox lands in{' '}
              <Mono>soft_mailbox_full</Mono> rather than the generic buckets.
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
            <Takeaway>
              One day for throttling, two for a generic temporary failure, three for content, seven
              for a full mailbox — and no window at all for anything else.
            </Takeaway>
            <FactTable
              columns={['Class', 'Hold', 'Why that long']}
              rows={[
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
              ]}
            />
            <Code>
              {
                'softSuppressionDays(bounceClass)\n\n  soft_mailbox_full  → 7\n  soft_throttled     → 1\n  soft_content       → 3\n  soft_temporary     → 2\n  default            → null   '
              }
              <Com>{'← hard classes and unknown'}</Com>
            </Code>
            <Contrast
              sides={[
                {
                  label: 'null on a hard class',
                  tone: 'bad',
                  points: [
                    'There is no window because the suppression never ends',
                    'The address is out of every future send until you act on it deliberately',
                  ],
                },
                {
                  label: 'null on unknown',
                  tone: 'neutral',
                  points: [
                    'There is no window because there is no suppression',
                    'The address stays sendable and the raw diagnostic stays stored',
                    'If you build reporting on this, do not collapse the two into “not suppressed for a while”',
                  ],
                },
              ]}
            />
            <Gotcha title="Repeated soft bounces are a list signal">
              One full mailbox is noise. The same address bouncing full on six consecutive sends is
              an abandoned mailbox, and the honest way to retire it is engagement rather than bounce
              handling — nobody has opened in a year, so segment them out. That is a decision about
              your audience, made deliberately, rather than a classifier quietly guessing on your
              behalf.
            </Gotcha>
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
            <Takeaway>
              The class digit decides permanence and the subject.detail pair decides the class, so
              the same subject can land hard or soft depending only on whether it starts with a 5 or
              a 4.
            </Takeaway>
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
            <FactTable
              columns={['Code', 'Class', 'Reading']}
              rows={[
                ['5.1.1 · 5.1.3 · 5.1.6', 'hard_invalid', 'Bad destination mailbox address.'],
                [
                  '4.1.1 · 4.1.3 · 4.1.6',
                  'soft_temporary',
                  'The same subjects with a temporary class digit — the addressing claim is not trusted as permanent.',
                ],
                [
                  'x.1.2',
                  'hard_domain',
                  'Bad destination system address. Permanent whichever class digit carries it.',
                ],
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
                [
                  'x.4.x',
                  'soft_temporary',
                  'Network and routing status, always read as temporary.',
                ],
                [
                  'anything else',
                  'hard_invalid / soft_temporary',
                  'An unmatched code still tells you its class digit: 5 is read as invalid, 4 as temporary.',
                ],
              ]}
              caption="Read straight off the enhanced-code branch of classifyBounce. Only the diagnostic text is searched for a code — the SMTP reply field alone never produces one."
            />
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Plenty of MTAs never emit one.</strong> Older Exim and
              Postfix configurations, appliances in front of corporate mail, and anything
              hand-rolled will hand you <Mono>550 No such user here</Mono> and nothing else. For
              those, the classifier falls back to six phrase lists, tried in this order against the
              diagnostic, the provider type and the provider subtype joined together and lowercased:
            </p>
            <FactTable
              columns={['Falls back to', 'If the text contains any of']}
              rows={PHRASES.map(([cls, phrases]) => [cls, phrases])}
              caption="Order matters: a diagnostic saying “message deferred, mailbox full” matches the first list and is classified soft_mailbox_full, not soft_throttled."
            />
            <Contrast
              sides={[
                {
                  label: 'An enhanced code',
                  tone: 'good',
                  points: [
                    'A machine-readable claim the receiver deliberately published',
                    'Stable across MTAs and independent of language',
                    'Wins over the phrase lists every time both are present',
                  ],
                },
                {
                  label: 'A phrase match',
                  tone: 'neutral',
                  points: [
                    'A list of things people have actually seen, in English',
                    'No guarantee the next MTA phrases it the same way',
                    'Good enough to be useful, not good enough to be trusted over a code',
                  ],
                },
              ]}
            />
            <Gotcha title="A text match can be the only signal — and it can be wrong">
              Because the fallback searches the whole diagnostic, a message quoted back inside a
              bounce can contribute words to the match. If a classification looks wrong to you,
              paste the raw diagnostic into the widget above and check: <Mono>unknown</Mono> is the
              answer you want in the ambiguous case, and if you are getting a confident answer you
              disagree with, that is worth reporting rather than working around.
            </Gotcha>
          </>
        ),
      }}
    </GuideLayout>
  )
}
