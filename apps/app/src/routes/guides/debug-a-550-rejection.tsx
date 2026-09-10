import { Callout } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { TroubleshootingChecklist } from '~/components/guides/troubleshooting-checklist.tsx'
import { Contrast, FactTable, Gotcha, Takeaway } from '~/components/marketing/guide-blocks.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'debug-a-550-rejection'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/debug-a-550-rejection')({
  head: () => guideHead(SLUG),
  component: Page,
})

/** Every class `classifyBounce` can return, with the window `softSuppressionDays` gives it. */
const CLASSES: Array<[string, string, string]> = [
  ['hard_invalid', 'Permanent', 'None — there is nothing to wait for'],
  ['hard_domain', 'Permanent', 'None'],
  ['hard_blocked', 'Permanent', 'None'],
  ['soft_mailbox_full', 'Temporary', '7 days'],
  ['soft_throttled', 'Temporary', '1 day'],
  ['soft_content', 'Temporary', '3 days'],
  ['soft_temporary', 'Temporary', '2 days'],
  ['unknown', 'Neither', 'None — and deliberately not suppressed'],
]

/** Drawn from the patterns `classifyBounce` actually matches, in that order. */
const DIAGNOSTICS: Array<{
  seen: string
  klass: string
  means: string
  fix: string
  permanent: boolean
}> = [
  {
    seen: '550 5.1.1 <a@b.com>: user unknown',
    klass: 'hard_invalid',
    means: 'The mailbox does not exist at that domain. The domain answered, and it answered no.',
    fix: 'Remove it and look at where the address came from — a typo at signup, a scraped list, or a person who left.',
    permanent: true,
  },
  {
    seen: '550 5.1.3 bad destination mailbox address syntax',
    klass: 'hard_invalid',
    means: 'The address is malformed as far as the receiver is concerned, not merely absent.',
    fix: 'Validate at capture. This one almost always means a form that accepts anything with an @ in it.',
    permanent: true,
  },
  {
    seen: '550 5.1.6 recipient no longer on server',
    klass: 'hard_invalid',
    means:
      'The mailbox existed and has been removed. Common on corporate domains after a departure.',
    fix: 'Remove it. If it was a decision-maker, that is a CRM signal as much as a mail one.',
    permanent: true,
  },
  {
    seen: '550 5.1.2 host unknown / domain not found',
    klass: 'hard_domain',
    means:
      'The domain itself does not resolve or has no MX. Nothing at that domain will ever work.',
    fix: 'Remove every address on that domain, not just this one. Usually gmial.com or a dead company.',
    permanent: true,
  },
  {
    seen: '552 5.2.2 mailbox full / over quota',
    klass: 'soft_mailbox_full',
    means: 'A real person with a real mailbox that has run out of room.',
    fix: 'Nothing. Suppressed for 7 days and retried. Removing this address loses a live subscriber.',
    permanent: false,
  },
  {
    seen: '421 4.7.0 too many messages / rate limited / throttled',
    klass: 'soft_throttled',
    means: 'You are sending faster than this receiver will take from you right now.',
    fix: 'Slow down. Suppressed for 1 day. If it is constant, your volume ramp is too steep for a young domain.',
    permanent: false,
  },
  {
    seen: '451 4.7.1 greylisted, try again later',
    klass: 'soft_throttled',
    means:
      'A deliberate first-contact delay. The receiver wants to see whether you retry like a real MTA.',
    fix: 'Nothing. This one resolves itself, and it is the case where retrying is correct.',
    permanent: false,
  },
  {
    seen: '550 5.3.4 message too big for system',
    klass: 'soft_content',
    means: 'Size, not identity. The receiver would have taken a smaller version of this message.',
    fix: 'Link the attachment instead of embedding it. Suppressed 3 days, which is the wrong lever here.',
    permanent: false,
  },
  {
    seen: '552 5.2.3 message length exceeds administrative limit',
    klass: 'soft_content',
    means: 'The same thing said by a stricter administrator, often with a much lower ceiling.',
    fix: 'Shrink the message. Base64 inflates attachments by roughly a third — count that, not the file size.',
    permanent: false,
  },
  {
    seen: '550 5.7.1 message rejected due to policy / spam',
    klass: 'hard_blocked',
    means: 'They believe your message is unwanted. The address is very probably fine.',
    fix: 'Authentication and content, not list hygiene. Resending identical content gets an identical answer.',
    permanent: true,
  },
  {
    seen: '550 5.7.1 blocked using Spamhaus / listed / poor reputation',
    klass: 'hard_blocked',
    means: 'A reputation decision about your sending IP or domain, not about this recipient.',
    fix: 'Stop the campaign. One receiving domain rejecting you wholesale is an incident, not a bounce.',
    permanent: true,
  },
  {
    seen: '451 4.3.0 temporary local problem, try again later',
    klass: 'soft_temporary',
    means: 'Something on their side broke. It says nothing about you at all.',
    fix: 'Nothing. Suppressed 2 days and retried. If it persists for a week, it is not temporary.',
    permanent: false,
  },
]

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You can now read a rejection as three fields of decreasing reliability, place it on the
          you-or-them axis, and act on the class rather than on the number. The thing most likely to
          bite you later is the temptation to treat a 5.7.x the way you treat a 5.1.1 — suppress the
          address and move on. A policy rejection is almost never about that recipient, and quietly
          suppressing your way through one means you delete a good list while the actual problem,
          which is what receivers currently think of your domain, keeps getting worse.
        </p>
      }
    >
      {{
        anatomy: (
          <>
            <Lede>
              A rejection is not a status code. It is three fields with three different levels of
              trustworthiness, delivered in one line, and reading them in the wrong order is how
              people end up deleting perfectly good addresses.
            </Lede>
            <Takeaway>
              Read the enhanced status code first, the reply code for one bit of information, and
              the free text last.
            </Takeaway>
            <Code>
              {'550 5.1.1 <someone@example.com>: Recipient address rejected: User unknown\n'}
              <Key>{'└┬┘'}</Key> <Key>{'└─┬─┘'}</Key>{' '}
              <Key>{'└──────────────────────┬────────────────────────┘'}</Key>
              {'\n '}
              <Com>{'│'}</Com>
              {'    '}
              <Com>{'│'}</Com>
              {'                          '}
              <Com>{'│'}</Com>
              {'\n '}
              <Com>{'│'}</Com>
              {'    '}
              <Com>{'│'}</Com>
              {'                          free text — human-written, no rules'}
              {'\n '}
              <Com>{'│'}</Com>
              {'    enhanced status code (RFC 3463) — the reliable field'}
              {'\n reply code — coarse: 5xx permanent, 4xx temporary'}
            </Code>
            <FactTable
              columns={['Field', 'How much to trust it', 'How the classifier uses it']}
              rows={[
                [
                  'Reply code',
                  'One bit',
                  'It says 5 for permanent and 4 for temporary, and even that is treated with suspicion: a meaningful number of receivers use a 550 loosely for conditions that are plainly transient. A starting point, not a verdict.',
                ],
                [
                  'Enhanced status code',
                  'The reliable field',
                  'Three dotted numbers — class, subject, detail. A structured field with a specification behind it, so it is checked before the prose is ever looked at, and its answer wins.',
                ],
                [
                  'Free text',
                  'A fallback, on purpose',
                  'Plenty of MTAs emit no enhanced code at all, so phrases are matched — mailbox full, over quota, greylist, user unknown, no such user, domain not found, blacklist, reputation. It works, and it is guessing at somebody’s English prose, which is why it never overrides a code that was actually specified.',
                ],
                [
                  'The provider’s own classification',
                  'Above all three',
                  'SES and Resend both pre-classify, and they are trusted when present because they can see things this system cannot — their own suppression lists, feedback loops, and the outcome of previous attempts to the same address from other senders. Everything from the SMTP text is checked against it rather than instead of it.',
                ],
              ]}
            />
            <FactTable
              columns={['Subject digit', 'What that class of problem is']}
              rows={[
                ['x.1.x', 'Addressing — the recipient'],
                ['x.2.x', 'The mailbox'],
                ['x.3.x', 'The mail system'],
                ['x.7.x', 'Security and policy — you'],
              ]}
              caption="The subject is the middle number and the useful one."
            />
            <FactTable
              columns={['Class', 'Permanence', 'Suppression window']}
              rows={CLASSES.map(([name, permanence, window]) => [name, permanence, window])}
              caption="The output of all of the above is one of these, and that class — not the number — is what everything downstream acts on."
            />
          </>
        ),
        'about-you-or-them': (
          <>
            <Lede>
              One question splits the whole problem in half, and the two halves have nothing in
              common. Is this rejection about <em>the recipient</em> — this address, at this domain
              — or about <em>you</em>: your domain, your IP, your content, your sending pattern?
            </Lede>
            <Takeaway>
              The subject digit of the enhanced code gets you there fastest: <Mono>5.1.x</Mono> is
              addressing, <Mono>5.7.x</Mono> is policy.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'About the recipient · 5.1.x',
                  tone: 'neutral',
                  points: [
                    'They are telling you this recipient is wrong',
                    'List hygiene, and it takes a minute',
                    'Remove the address and look at where it came from',
                  ],
                },
                {
                  label: 'About you · 5.7.x',
                  tone: 'bad',
                  points: [
                    <>
                      They are telling you <em>you</em> are wrong, and the recipient may be entirely
                      real and entirely willing
                    </>,
                    'Deliverability work, and it takes weeks',
                    'Everything else — mailbox state, message size, temporary failure — sits in the middle and is usually about the message rather than either party',
                  ],
                },
              ]}
            />
            <TroubleshootingChecklist
              title="WHICH SIDE IS THIS REJECTION ABOUT?"
              steps={[
                {
                  label: 'Read the subject digit of the enhanced code',
                  detail:
                    'x.1.x means addressing and points at the recipient. x.7.x means security or policy and points at you. x.2.x is mailbox state and points at neither. This is one glance and it resolves most cases.',
                },
                {
                  label: 'Count how many recipients got the same answer',
                  detail:
                    'One address failing at a domain is a dead mailbox. Every address at one domain failing within the same hour is a reputation event at that receiver, whatever the code says. The pattern outranks the individual message.',
                },
                {
                  label: 'Check whether that receiver was accepting you yesterday',
                  detail:
                    'A receiver that took your mail all week and stopped at 09:00 is telling you about a change on your side — a new IP, a content change, a volume spike, an expired DKIM record. A domain that never accepted you is a different problem.',
                },
                {
                  label: 'Confirm SPF, DKIM and DMARC still pass',
                  detail:
                    'This is cheap and it is the most common cause of a sudden 5.7.x. A rotated key, a second SPF record added for another vendor, a DMARC policy tightened to reject — any of these turns a working sender into a blocked one overnight.',
                },
                {
                  label: 'Only then read the free text as prose',
                  detail:
                    'Many receivers put a URL in the rejection pointing at their postmaster page, and it usually names the specific thing they object to. It is last on this list because it is the slowest step, not because it is unhelpful.',
                },
              ]}
            />
            <Gotcha title="A 5.7.x is not a list problem">
              The reflex to suppress and move on is right for <Mono>hard_invalid</Mono> and{' '}
              <Mono>hard_domain</Mono> and wrong for <Mono>hard_blocked</Mono>. A policy rejection
              suppresses the address here — because continuing to hammer a receiver that has said no
              is itself the behaviour being punished — but the address is probably fine, and
              treating a wave of them as list hygiene means you shrink a good list while the real
              problem compounds. Suppress, then investigate: the two are not alternatives.
            </Gotcha>
          </>
        ),
        'common-ones': (
          <>
            <Lede>
              These are the diagnostics the classifier actually matches, with the class each one
              produces and the first thing worth changing. Codes come first because they beat text;
              the text examples are the phrases the fallback matcher looks for when no code is
              present.
            </Lede>
            <Takeaway>
              Act on the class in the second column. The number in the first is how you got there,
              not what you do about it.
            </Takeaway>
            <FactTable
              columns={['What you see', 'Class', 'What it means', 'First thing to change']}
              rows={DIAGNOSTICS.map((row) => [
                row.seen,
                <span
                  key={row.seen}
                  className={
                    row.permanent
                      ? 'font-mono text-[12px] text-warning'
                      : 'font-mono text-[12px] text-muted'
                  }
                >
                  {row.klass}
                </span>,
                row.means,
                row.fix,
              ])}
              caption="Soft classes carry a suppression window rather than a permanent entry, because the underlying conditions clear at different speeds. Hard classes carry no window because there is nothing to wait for."
            />
            <Gotcha title="Without an enhanced code, the word spam wins">
              The phrase list is tried in order, and <Mono>/spam|content rejected|…/</Mono> is
              tested before <Mono>/blocked|blacklist|reputation|spamhaus/</Mono>. So a rejection
              that carries <em>no</em> enhanced status code and whose text says
              <Mono>spamhaus</Mono> matches <Mono>spam</Mono> first and lands in{' '}
              <Mono>soft_content</Mono> rather than <Mono>hard_blocked</Mono> — a temporary window
              instead of a permanent entry. In practice a reputation block nearly always arrives
              with <Mono>5.7.1</Mono>, and the enhanced code is read first, which is why the row
              above is written with one. It is worth knowing which of the two paths classified a
              given bounce before you act on the class.
            </Gotcha>
            <Gotcha title="Unknown deliberately does not suppress">
              When a diagnostic matches no code and no phrase, the classifier says so and leaves the
              address alone. That is not a gap in the product’s ambition, it is the correct trade:
              an unrecognised diagnostic is a gap in <em>the classifier</em>, and the cost of
              guessing wrong is a real subscriber removed permanently on the strength of a sentence
              nobody wrote a rule for. If you see <Mono>unknown</Mono> at any volume, the diagnostic
              text is on the event and it is worth reading — it is the raw material for the pattern
              that should exist.
            </Gotcha>
          </>
        ),
        'do-not-retry': (
          <>
            <Lede>
              Retrying a permanent rejection is not a neutral act that wastes a little bandwidth. It
              is a signal, it is recorded, and it is one of the specific behaviours large receivers
              use to distinguish a legitimate sender from a list that is being sprayed.
            </Lede>
            <Takeaway>
              A hard class suppresses immediately and without a window — not to save you the send,
              which costs nothing, but to stop your instance producing the one behavioural signal
              that is hardest to recover from.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'Retrying is correct',
                  tone: 'good',
                  points: [
                    'A 4.7.x deferral on first contact — greylisting — is the receiver checking whether you behave like a real MTA',
                    'The queue does it for you, backing off rather than hammering',
                    'The difference between a retry and a retry loop: one respects the interval the receiver implied, the other ignores it',
                  ],
                },
                {
                  label: 'Retrying makes it worse',
                  tone: 'bad',
                  points: [
                    'A well-run mail system told this mailbox does not exist removes the address',
                    'A system that keeps delivering either is not processing bounces or does not care — both describe a list not built from consent',
                    'The rejection rate against non-existent addresses is a cheap, high-signal proxy for list quality, which is why it is measured. Some receivers seed known-dead addresses specifically to see what you do',
                  ],
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Reputation recovers slowly</strong>, over weeks of clean
              sending, and it degrades in an afternoon. If you are looking at a wall of{' '}
              <Mono>hard_blocked</Mono> rather than scattered invalid addresses, stop sending before
              you do anything else, then work through{' '}
              <a
                href="/guides/why-email-goes-to-spam"
                className="text-accent underline underline-offset-4"
              >
                why email goes to spam
              </a>{' '}
              and re-check your{' '}
              <a href="/guides/spf-dkim-dmarc" className="text-accent underline underline-offset-4">
                authentication records
              </a>
              . Continuing to send while you investigate is the single most expensive thing you can
              do, because every additional rejection is another data point in the case being built
              against your domain.
            </p>
            <Callout variant="warn" title="THE ANTI-PATTERN, NAMED">
              The failure mode is a nightly job that re-imports the same CSV, unaware of the
              suppression list, and re-queues everything in it. Every run, the same two hundred dead
              addresses are attempted again. The dashboard looks fine because the bounce rate is a
              stable small percentage. Six weeks later a major receiver silently starts filing
              everything from the domain into spam, and nothing in the sending history explains it
              because nothing changed — the same wrong thing kept happening. If your import path
              writes directly to the send queue without consulting suppressions, that is the bug.
            </Callout>
          </>
        ),
      }}
    </GuideLayout>
  )
}
