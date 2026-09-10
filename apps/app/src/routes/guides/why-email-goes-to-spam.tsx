// biome-ignore-all lint/complexity/noUselessFragments: a single-element FactTable cell must stay
// wrapped. Unwrapped, the row literal trips useJsxKeyInIterable — an error rather than an info,
// and a false one, since FactTable keys its own cells from the row key and the column name.
import { Metric, MetricGrid } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { HeadersInspector } from '~/components/guides/headers-inspector.tsx'
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

const SLUG = 'why-email-goes-to-spam'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/why-email-goes-to-spam')({
  head: () => guideHead(SLUG),
  component: Page,
})

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You have an order to work in rather than a list of tips: settle authentication from the
          header, then look at your complaint and unknown-user rates, and only then argue about the
          subject line. The thing most likely to waste your week is skipping to the last step,
          because content is the only layer where you cannot measure whether a change helped —
          rewriting an email until it feels less spammy is unfalsifiable work, and the rate that
          actually moved your placement was the handful of recipients per thousand who pressed the
          spam button.
        </p>
      }
    >
      {{
        'read-the-headers': (
          <>
            <Lede>
              Start here, always. The receiver already told you what it concluded about your
              authentication, in a header, in plain text, on the message that went to spam. Reading
              it takes thirty seconds and it eliminates or confirms the entire first layer of the
              diagnosis before you have formed a single theory.
            </Lede>
            <Takeaway>
              Find the <Mono>Authentication-Results</Mono> block. It was added by the receiving
              server, which makes it the only part of the message your sending infrastructure could
              not have written.
            </Takeaway>
            <FactTable
              columns={['Client', 'How to see the source']}
              rows={[
                ['Gmail', 'Open the message, then Show original'],
                ['Outlook', 'View message source'],
                ['Apple Mail', 'View → Message → All Headers'],
              ]}
              caption="The block will be near the top."
            />
            <HeadersInspector />
            <FactTable
              columns={['What you read', 'What it means']}
              rows={[
                [
                  'spf=pass',
                  'The connecting server was authorised by the envelope sender’s domain — which is not necessarily yours.',
                ],
                [
                  'dkim=pass',
                  'The signature verified against a key published in the signing domain’s DNS.',
                ],
                [
                  'dmarc=pass',
                  'One of those two passed and aligned with the From domain. Three passes mean your authentication is not the reason.',
                ],
                [
                  'none',
                  'Not a failure. No record was published, so nothing was checked — which is a different problem from failing, and a worse one at DMARC.',
                ],
                [
                  'permerror',
                  'A syntax problem in your own DNS, most often two SPF records on one name or an SPF record that exceeds the ten-lookup limit. Receivers treat both as no SPF at all.',
                ],
              ]}
              caption="none and permerror are the two results people consistently misread."
            />
            <Gotcha title="The header settles one question and only one">
              Three passes do not mean your mail is fine — an aligned, signed, perfectly
              authenticated message from a sender with a 2% complaint rate goes to spam every time.
              If everything says pass, skip to reputation and list quality, and do not spend another
              minute on DNS.
            </Gotcha>
          </>
        ),
        authentication: (
          <>
            <Lede>
              The reason authentication goes first is not that it is the most common cause. It is
              that it is the cheapest and most certain: the answer is binary, it comes from the
              receiver rather than from your inference, and the fix is fully within your control and
              finishable this afternoon. Everything below this layer is probabilistic and slow.
              Never start with the slow, fuzzy layer while a fast, certain one is unresolved.
            </Lede>
            <FactTable
              columns={['Layer', 'Kind of answer', 'Time to fix', 'Why it sits here']}
              rows={[
                [
                  'Authentication',
                  'Binary',
                  'An afternoon',
                  'Either the header says pass or it does not. No judgement, no negotiation, and the fix is entirely in your DNS.',
                ],
                [
                  'Reputation',
                  'Continuous',
                  'Weeks',
                  'A rolling history of how recipients reacted to you. Cannot be argued with, only outlived.',
                ],
                [
                  'List quality',
                  'Measurable',
                  'One send',
                  'Complaint rate, unknown-user rate, engagement. You control the inputs directly and the effect is immediate.',
                ],
                [
                  'Content',
                  'Fuzzy',
                  'Unknowable',
                  'The only layer where you cannot tell whether a change helped. Which is why it goes last.',
                ],
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The failure that catches most people is not a missing record. It is alignment.
              </strong>{' '}
              DMARC does not ask whether SPF passed; it asks whether SPF passed{' '}
              <em>for a domain that matches the From header</em>. A message with{' '}
              <Mono>From: hello@yourdomain.com</Mono> and{' '}
              <Mono>Return-Path: bounces@vendor.net</Mono> shows <Mono>spf=pass</Mono> in the header
              and still fails DMARC, because what passed was the vendor’s domain and it proved
              nothing about yours.
            </p>
            <Code>
              {'From:        hello@yourdomain.com      '}
              <Com>{'← what the reader sees'}</Com>
              {'\nReturn-Path: bounces@vendor.net        '}
              <Com>{'← what SPF checked: not you'}</Com>
              {'\nDKIM d=      yourdomain.com           '}
              <Com>{'← aligned: DMARC passes on this alone'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              This is why the bounce path belongs on a subdomain of your own domain rather than the
              transport’s, and why DKIM is worth publishing even when SPF already passes — DKIM
              alignment is the one that survives a forward. If any of that is unfamiliar, the{' '}
              <a href="/guides/spf-dkim-dmarc" className="text-accent underline underline-offset-4">
                authentication guide
              </a>{' '}
              builds the records, and{' '}
              <a
                href="/guides/verify-a-sending-domain"
                className="text-accent underline underline-offset-4"
              >
                verification
              </a>{' '}
              tells you whether what you published is what resolvers see.
            </p>
            <FactTable
              columns={['Header', 'What MailySend sends on every message']}
              rows={[
                ['List-Unsubscribe', 'Both an HTTPS and a mailto option'],
                [
                  'List-Unsubscribe-Post',
                  <>
                    <Mono>List-Unsubscribe=One-Click</Mono>
                  </>,
                ],
              ]}
              caption="Transactional mail included. The large consumer providers require this from bulk senders, and it is checkable in the same header dump you already have open."
            />
          </>
        ),
        reputation: (
          <>
            <Lede>
              Reputation is a rolling summary of how recipients behaved towards your mail, kept
              per-domain and per-IP by each receiver, and never shown to you. There is no score to
              look up, no appeal, and no lever. There is only the behaviour that produces it, which
              means the only way to change a reputation is to send different mail for long enough
              that the old mail falls out of the window.
            </Lede>
            <Takeaway>
              Domain reputation is the one that matters most now, and it travels with you: changing
              transports does not reset it, because it is attached to the name in the From header
              and the DKIM <Mono>d=</Mono> domain, not to the machine that connected.
            </Takeaway>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              That is the point of DMARC alignment from the receiver’s side — it makes reputation
              attributable to a party that cannot walk away from it.
            </p>
            <Gotcha title="A volume step change is what moves it fastest downward">
              A domain that sends 2,000 messages a day for a month and then sends 200,000 in one
              afternoon has produced exactly the signal a compromised account produces, and
              receivers respond to it the way they respond to a compromised account: deferrals, then
              spam placement, then rejections. Nothing about the content matters here, and the fact
              that all 200,000 recipients opted in is not visible to anyone. If you are about to do
              this, don’t —{' '}
              <a
                href="/guides/warm-up-a-sending-domain"
                className="text-accent underline underline-offset-4"
              >
                ramp instead
              </a>
              .
            </Gotcha>
            <Contrast
              sides={[
                {
                  label: 'A dedicated IP, above ~100,000 a month',
                  tone: 'good',
                  points: [
                    'Worth it above roughly 100,000 messages a month, sent on a steady schedule',
                    'The threshold is about consistency as much as total — 100,000 a month in one monthly blast does not qualify',
                  ],
                },
                {
                  label: 'A dedicated IP, below that',
                  tone: 'bad',
                  points: [
                    'Actively worse than a well-run shared pool',
                    'Reputation is built from volume observed over time, and an IP that sends 4,000 messages one week and nothing the next never accumulates enough history for any receiver to form an opinion',
                    'An IP with no reputation is treated with suspicion, not neutrality',
                  ],
                },
              ]}
            />
            <Gotcha title="Accepted is not inboxed">
              Your delivery rate is the percentage of messages the receiving server accepted at SMTP
              time. It says nothing about which folder the message landed in, and a spam-foldered
              message counts as delivered. A 99.7% delivery rate alongside a collapsing open rate is
              the classic signature of a placement problem, and no bounce log will ever show it to
              you.
            </Gotcha>
          </>
        ),
        'list-quality': (
          <>
            <Lede>
              This is where most spam problems actually live, and it is three numbers. None of them
              is about your writing. Receivers weigh complaint rate, unknown-user rate, and
              engagement, in roughly that order of severity, and they weigh them per sending domain
              over a rolling window.
            </Lede>
            <MetricGrid className="my-5">
              <Metric
                value="0.3%"
                label="The complaint rate the large providers name — a ceiling, not a target"
              />
              <Metric value="0.1%" label="Healthy is under this" />
              <Metric
                value="3 in 1,000"
                label="People reporting you: enough to change your placement everywhere"
              />
            </MetricGrid>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Complaint rate</strong> is the proportion of delivered
              messages where a recipient pressed the spam button, and at the number above you are
              already in trouble. That is why a hard-to-find unsubscribe link is such a bad trade:
              the alternative to unsubscribing is not staying subscribed, it is complaining.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Unknown-user rate</strong> is the proportion of messages
              rejected because the address does not exist. A sender who repeatedly mails addresses
              that never existed is a sender who bought, scraped or typo-collected a list, and
              receivers read it exactly that way — which is why hard bounces must suppress
              immediately and permanently.
            </p>
            <FactTable
              columns={['Bounce', 'Class', 'Suppressed for']}
              rows={[
                [
                  '5.1.1, 5.1.3, 5.1.6',
                  <>
                    <Mono>hard_invalid</Mono>
                  </>,
                  'Permanently',
                ],
                [
                  '5.1.2',
                  <>
                    <Mono>hard_domain</Mono>
                  </>,
                  'Permanently',
                ],
                ['Mailbox full', 'Soft', '7 days'],
                ['Throttled', 'Soft', '1 day'],
                ['Content', 'Soft', '3 days'],
                ['Temporary', 'Soft', '2 days'],
                [
                  'An unrecognised diagnostic',
                  <>
                    <Mono>unknown</Mono>
                  </>,
                  <>
                    <strong className="text-ink">Not at all, deliberately</strong>
                  </>,
                ],
              ]}
              caption="Eight classes in total, mapped from the enhanced status codes rather than guessed from the text. Not suppressing on unknown is the right trade in one direction only: an unrecognised bounce is a gap in the classifier, and guessing costs a real subscriber permanently — so a rising unknown count is a signal about the classifier, not about your list."
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Engagement</strong> is opens, clicks, replies, moves out
              of spam, and — most strongly — the absence of any of these over a long window. A
              segment that has not opened in a year is not neutral weight; it is negative weight,
              and continuing to mail it drags the placement of the mail your engaged recipients do
              want. Suppressing your dormant third is the single highest-leverage deliverability
              action available to most senders, and it feels like giving up revenue right until
              placement recovers.
            </p>
            <Contrast
              sides={[
                {
                  label: 'Open classification: what runs in production today',
                  tone: 'good',
                  points: [
                    'HEAD-request detection',
                    'The security-vendor user-agent list',
                    'Apple MPP user-agent matching',
                    'The bot list, and empty user agents',
                  ],
                },
                {
                  label: 'What never runs',
                  tone: 'bad',
                  points: [
                    'The timing-window rule',
                    'The ASN rule',
                    'The multiple-links-in-two-seconds rule',
                    'Because the tracking endpoint passes only user agent, IP, method and country to the classifier',
                  ],
                },
              ]}
            />
            <Gotcha title="Your open rate is not a clean signal">
              Opens are classified into five audience classes — <Mono>human</Mono>, <Mono>mpp</Mono>
              , <Mono>proxy_prefetch</Mono>, <Mono>scanner</Mono> and <Mono>bot</Mono> — and only{' '}
              <Mono>human</Mono> counts toward headline rates, with the privacy-adjusted rate
              removing Apple MPP opens from both the numerator and the denominator. Given how much
              of the classifier never fires, use engagement as a directional signal, not as a
              measured one.
            </Gotcha>
          </>
        ),
        content: (
          <>
            <Lede>
              Content is last because it is the layer with the worst ratio of effort to certainty.
              Per-word scoring — the “spam words” lists, the idea that writing <em>free</em> or{' '}
              <em>guarantee</em> in a subject line trips a filter — has not been the dominant signal
              for many years. Filters are trained on sender behaviour and recipient reaction, and a
              sender with a clean complaint rate can write <em>free</em> as often as they like.
            </Lede>
            <Takeaway>
              The content factors that still matter are structural rather than lexical: whether the
              message is shaped like ordinary mail, and whether the domains it points at are
              trustworthy.
            </Takeaway>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The folklore persists because it is actionable and the real causes are not.
              </strong>{' '}
              Rewriting a subject line takes five minutes and feels like progress; suppressing 40%
              of your list takes an argument with whoever owns the revenue number. The five minutes
              is the reason people spend a week on the wrong layer.
            </p>
            <FactTable
              columns={['Still matters', 'Why']}
              rows={[
                [
                  'A plain-text alternative',
                  'A multipart message with a real text part is normal mail. HTML-only is a weak negative on its own and a strong one in combination.',
                ],
                [
                  'Link domains',
                  'Links to a domain with a bad reputation, or through a public URL shortener shared with every phishing campaign on earth, are judged separately from your sending domain.',
                ],
                [
                  'The tracking domain',
                  'Open and click tracking rewrite links through a domain. If that domain is shared and unbranded, its reputation is not yours to control.',
                ],
                [
                  'One giant image',
                  'A message that is a single image with no text is unreadable to a filter, to a screen reader, and to anyone with images off. All three read it the same way.',
                ],
                [
                  'A visible unsubscribe',
                  'Not for the filter — for the complaint rate. Every hidden unsubscribe link converts a would-be unsubscribe into a spam report.',
                ],
              ]}
              caption="MailySend generates the text alternative from your HTML on render, inlines the CSS and enforces a table layout for the same reason: those are the properties of ordinary mail, and looking ordinary is the whole content strategy."
            />
            <Diagram
              steps={[
                { kicker: '1', title: 'Header', meta: 'the receiver already answered it' },
                {
                  kicker: '2',
                  title: 'Reputation',
                  meta: 'a volume step change explains more sudden spam placement than everything else combined',
                },
                {
                  kicker: '3',
                  title: 'List quality',
                  meta: 'the three numbers are the actual inputs to the filter',
                },
                {
                  kicker: '4',
                  title: 'Content',
                  meta: 'last, because you will never know whether the change worked',
                  tone: 'accent',
                },
              ]}
            />
          </>
        ),
      }}
    </GuideLayout>
  )
}
