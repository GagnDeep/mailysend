import { Callout } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { TroubleshootingChecklist } from '~/components/guides/troubleshooting-checklist.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'debug-a-550-rejection'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/debug-a-550-rejection')({
  head: () => guideHead(SLUG),
  component: Page,
})

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
    seen: '550 blocked using Spamhaus / listed / poor reputation',
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The reply code tells you almost nothing.</strong> It has
              exactly one bit of real information in it: 5 means permanent, 4 means temporary. And
              even that is treated with suspicion, because a meaningful number of receivers use a
              550 loosely for conditions that are plainly transient. It is a starting point, not a
              verdict.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The enhanced status code is the field that matters.
              </strong>{' '}
              Three dotted numbers — class, subject, detail. The subject is the useful one:{' '}
              <Mono>1</Mono> is addressing, <Mono>2</Mono> is the mailbox, <Mono>3</Mono> is the
              mail system, <Mono>7</Mono> is security and policy. Because it is a structured field
              with a specification behind it, the classifier checks it before it ever looks at the
              prose, and its answer wins.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The free text is a fallback, and it is one on purpose.
              </strong>{' '}
              Plenty of MTAs emit no enhanced code at all, so the classifier falls back to matching
              phrases — <em>mailbox full</em>, <em>over quota</em>, <em>greylist</em>,{' '}
              <em>user unknown</em>, <em>no such user</em>, <em>domain not found</em>,{' '}
              <em>blacklist</em>, <em>reputation</em>. It works, and it is guessing at somebody’s
              English prose, which is why it never overrides a code that was actually specified.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              There is a fourth source above all three: the provider’s own classification, when it
              sends one. SES and Resend both pre-classify, and they are trusted when present because
              they can see things this system cannot — their own suppression lists, feedback loops,
              and the outcome of previous attempts to the same address from other senders.
              Everything from the SMTP text is checked against it rather than instead of it.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The output of all this is one of eight classes — <Mono>hard_invalid</Mono>,{' '}
              <Mono>hard_domain</Mono>, <Mono>hard_blocked</Mono>, <Mono>soft_mailbox_full</Mono>,{' '}
              <Mono>soft_throttled</Mono>, <Mono>soft_content</Mono>, <Mono>soft_temporary</Mono>,{' '}
              <Mono>unknown</Mono> — and that class, not the number, is what everything downstream
              acts on.
            </p>
          </>
        ),
        'about-you-or-them': (
          <>
            <Lede>
              One question splits the whole problem in half, and the two halves have nothing in
              common. Is this rejection about <em>the recipient</em> — this address, at this domain
              — or about <em>you</em>: your domain, your IP, your content, your sending pattern? The
              first is list hygiene and takes a minute. The second is deliverability work and takes
              weeks.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The heuristic that gets you there fastest is the subject digit of the enhanced code.{' '}
              <Mono>5.1.x</Mono> is addressing: they are telling you this recipient is wrong.{' '}
              <Mono>5.7.x</Mono> is policy: they are telling you <em>you</em> are wrong, and the
              recipient may be entirely real and entirely willing. Everything else — mailbox state,
              message size, temporary failure — sits in the middle and is usually about the message
              rather than either party.
            </p>
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
            <Callout variant="warn" title="A 5.7.x IS NOT A LIST PROBLEM">
              The reflex to suppress and move on is right for <Mono>hard_invalid</Mono> and{' '}
              <Mono>hard_domain</Mono> and wrong for <Mono>hard_blocked</Mono>. A policy rejection
              suppresses the address here — because continuing to hammer a receiver that has said no
              is itself the behaviour being punished — but the address is probably fine, and
              treating a wave of them as list hygiene means you shrink a good list while the real
              problem compounds. Suppress, then investigate: the two are not alternatives.
            </Callout>
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
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="px-4 py-2.5 text-[12px] font-semibold">What you see</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Class</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">What it means</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">First thing to change</th>
                  </tr>
                </thead>
                <tbody>
                  {DIAGNOSTICS.map((row) => (
                    <tr key={row.seen} className="border-line border-t align-top">
                      <td className="px-4 py-2.5 font-mono text-[12.5px] text-ink">{row.seen}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={
                            row.permanent
                              ? 'font-mono text-[12px] text-warning'
                              : 'font-mono text-[12px] text-muted'
                          }
                        >
                          {row.klass}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted">{row.means}</td>
                      <td className="px-4 py-2.5 text-muted-2">{row.fix}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Soft classes carry a suppression window rather than a permanent entry, and the windows
              are different because the underlying conditions clear at different speeds: a full
              mailbox holds for 7 days, a throttle for 1, a content rejection for 3, a generic
              temporary failure for 2. Hard classes carry no window because there is nothing to wait
              for.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              And then there is the ninth outcome, which is the most important one to understand:{' '}
              <Mono>unknown</Mono>. When a diagnostic matches no code and no phrase, the classifier
              says so and{' '}
              <strong className="text-ink">deliberately does not suppress the address</strong>. That
              is not a gap in the product’s ambition, it is the correct trade. An unrecognised
              diagnostic is a gap in <em>the classifier</em>, and the cost of guessing wrong is a
              real subscriber removed permanently on the strength of a sentence nobody wrote a rule
              for. If you see <Mono>unknown</Mono> at any volume, the diagnostic text is on the
              event and it is worth reading — it is the raw material for the pattern that should
              exist.
            </p>
          </>
        ),
        'do-not-retry': (
          <>
            <Lede>
              Retrying a permanent rejection is not a neutral act that wastes a little bandwidth. It
              is a signal, it is recorded, and it is one of the specific behaviours large receivers
              use to distinguish a legitimate sender from a list that is being sprayed.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The logic from their side is simple and hard to argue with. A well-run mail system
              that is told <em>this mailbox does not exist</em> removes the address. A system that
              keeps delivering to it either is not processing bounces at all or does not care what
              it is told — and both of those describe a sender whose list was not built from
              consent. The rejection rate against non-existent addresses is a cheap, high-signal
              proxy for list quality, which is exactly why it is measured. Some receivers seed
              known-dead addresses specifically to see what you do.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              This is why a hard class suppresses immediately and without a window. Not to protect
              you from wasted sends — the send itself costs nothing — but to stop your instance
              producing the one behavioural signal that is hardest to recover from. Reputation
              recovers slowly, over weeks of clean sending, and it degrades in an afternoon.
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The one case where retrying is not just acceptable but expected is greylisting. A
              4.7.x deferral on first contact is the receiver checking whether you behave like a
              real MTA, and the correct response is to wait and try again — which the queue does for
              you, backing off rather than hammering. That is the entire difference between a retry
              and a retry loop: one respects the interval the receiver implied, the other ignores
              it.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              If you are looking at a wall of <Mono>hard_blocked</Mono> rather than scattered
              invalid addresses, stop sending before you do anything else, then work through{' '}
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
          </>
        ),
      }}
    </GuideLayout>
  )
}
