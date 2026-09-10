import { Callout } from '@mailysend/ui'
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

const SLUG = 'dmarc-from-none-to-reject'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/dmarc-from-none-to-reject')({
  head: () => guideHead(SLUG),
  component: Page,
})

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You have a rollout that ends at <Mono>p=reject</Mono> and a way of knowing, before each
          step, what that step will bounce: read the reports, authenticate what you recognise, and
          only then tighten. The thing most likely to bite you is not the parent policy at all — it
          is <Mono>sp=</Mono>. A domain at reject with a permissive subdomain policy is a domain
          where every forger simply moves to <Mono>billing.yourdomain.com</Mono>, and the gap is
          closed by one tag on the same day.
        </p>
      }
    >
      {{
        'why-move': (
          <>
            <Lede>
              <Mono>p=none</Mono> asks receivers to evaluate your mail, report what they saw, and
              then do exactly what they would have done anyway. It is a measurement instrument, and
              a good one. What it is not is a protection: a domain sitting at none has published a
              policy that instructs the world to take no action, which protects it from precisely
              nobody.
            </Lede>
            <Takeaway>
              Until you enforce, anyone can put your domain in a From header and the receiver has
              been told, by you, not to mind.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'What p=none gets you',
                  tone: 'neutral',
                  points: [
                    'Receivers evaluate your mail and report what they saw',
                    'A measurement instrument, and a good one',
                  ],
                },
                {
                  label: 'What it does not get you',
                  tone: 'bad',
                  points: [
                    'Any protection at all — receivers were instructed to take no action',
                    'Bulk-sender eligibility: a published, enforced policy is now a requirement at the large consumer mailbox providers rather than a nice-to-have',
                    'BIMI, which will not consider a domain below quarantine',
                  ],
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The reason people stay at none for years is not laziness.
              </strong>{' '}
              It is that the first time you enforce, you find out which of your own systems were
              never authenticated, and you find out by way of them not arriving. The whole
              discipline below exists to move that discovery from “customers did not get their
              invoices” to “a row in a report last Tuesday”.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Before any of this, the records have to be right.
              </strong>{' '}
              SPF authorises the envelope sender, DKIM signs the message, DMARC checks that one of
              those passed <em>for the domain in the From header</em>. If that last clause is not
              yet familiar, start at{' '}
              <a href="/guides/spf-dkim-dmarc" className="text-accent underline underline-offset-4">
                SPF, DKIM and DMARC
              </a>
              , which has a builder that generates the exact rows for your transport.
            </p>
            <Callout title="WHAT YOU ARE ACTUALLY BUYING">
              Not deliverability, directly. You are buying the ability to make a statement receivers
              can act on, and the reporting stream that tells you who is making that statement on
              your behalf. The deliverability benefit is a second-order effect of receivers being
              able to stop guessing about you.
            </Callout>
          </>
        ),
        'read-reports': (
          <>
            <Lede>
              An aggregate report is an XML file, usually gzipped, that arrives daily from each
              receiver that saw mail claiming to be you. It contains no message content and no
              recipient addresses — it is counts, grouped by sending IP, with the SPF and DKIM
              results and the DMARC disposition for each group. Three columns matter: source,
              volume, pass rate.
            </Lede>
            <Code>
              {'<record>\n  <row>\n    <source_ip>'}
              <Com>203.0.113.9</Com>
              {'</source_ip>\n    <count>'}
              <Com>1842</Com>
              {
                '</count>\n    <policy_evaluated>\n      <disposition>none</disposition>\n      <dkim>pass</dkim>\n      <spf>fail</spf>   '
              }
              <Com>{'← aligned DKIM carried it'}</Com>
              {'\n    </policy_evaluated>\n  </row>\n</record>'}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Sort by volume, descending, and work down.</strong> Each{' '}
              <Mono>{'<record>'}</Mono> is one sending source over one day, and reading one by hand
              once is worth doing so that the aggregators stop feeling like magic. Your transport
              should be at the top with a pass rate at or near 100%; if it is not, stop the rollout
              and fix that first, because nothing below matters while your main sending path is
              failing. Then you are looking at a long tail, and every entry in it is one of five
              things.
            </p>
            <FactTable
              columns={['Source', 'Volume', 'Result', 'What it is']}
              rows={[
                ['Your transport', 'High', '~100%', 'The boring one. Leave it alone.'],
                [
                  'A corporate gateway',
                  'Low, steady',
                  'SPF fails, DKIM passes',
                  'A forwarder. Harmless — DKIM survived the hop, so DMARC still passes.',
                ],
                [
                  'A mailing list',
                  'Low, bursty',
                  'Both fail',
                  'The list rewrote the body or the headers and broke the signature. Real mail, genuinely unauthenticated.',
                ],
                [
                  'Your billing vendor',
                  'Low, monthly',
                  'Both fail',
                  'A sending path nobody documented. This is the one that hurts at reject.',
                ],
                [
                  'Hosts you have never heard of',
                  'Anything',
                  'Both fail',
                  'Forgery, or a scanner replaying your mail. Nothing to authorise.',
                ],
              ]}
            />
            <Contrast
              sides={[
                {
                  label: 'The forwarder signature',
                  tone: 'good',
                  points: [
                    'SPF fails, DKIM passes, volume low and steady, source is a university, a corporate gateway or a mail-hosting provider',
                    'Somebody subscribed with a work address that forwards elsewhere',
                    'SPF breaks on forwarding by construction — the forwarder is not on your list and never will be — while the signature travels with the message, so DMARC passes on DKIM alignment alone',
                    'Costs you nothing at reject, and is the single best argument for publishing DKIM even when SPF already passes',
                  ],
                },
                {
                  label: 'The forger signature',
                  tone: 'bad',
                  points: [
                    'Both fail, from a residential or hosting range you do not recognise',
                    'Volume is either very small (a targeted attempt) or very large and spiky (a campaign)',
                    'There is nothing to authorise here and nothing to fix. These rows are the reason you are doing this',
                  ],
                },
              ]}
            />
            <Gotcha title="Low volume is not low importance">
              The dangerous row is not the loud one. It is the source sending forty messages a
              month, failing both checks, from a hostname that could plausibly be a vendor — because
              at reject those forty messages are password resets, or invoices, or the annual renewal
              notice. Read the tail, not just the head.
            </Gotcha>
          </>
        ),
        'the-ladder': (
          <>
            <Lede>
              Four rungs, roughly two weeks each. The point of the intermediate rungs is not caution
              for its own sake — it is that each one exposes a different set of failures at a
              survivable cost.
            </Lede>
            <Diagram
              steps={[
                { kicker: '2 WEEKS MIN', title: 'p=none', meta: 'measure' },
                { kicker: '2 WEEKS', title: 'p=quarantine; pct=25', meta: 'take a dose' },
                { kicker: '2 WEEKS', title: 'p=quarantine', meta: 'full dose' },
                { kicker: 'END STATE', title: 'p=reject', meta: 'enforce', tone: 'accent' },
              ]}
            />
            <FactTable
              columns={['Rung', 'Dwell', 'What it costs you, and what it buys']}
              rows={[
                [
                  'p=none',
                  'Two weeks minimum',
                  'Stay here until you can name every source in the report. The exit condition is not a date, it is an inventory: a list of sending systems, each either authenticated or knowingly abandoned.',
                ],
                [
                  'p=quarantine; pct=25',
                  'Two weeks',
                  'The first rung with consequences, deliberately applied to a quarter of failures. Watch your support queue as closely as the reports — a quarantined message is in a spam folder, so it will be reported to you by a human before it shows up in an aggregate feed.',
                ],
                [
                  'p=quarantine',
                  'Two weeks',
                  <>
                    Drop the <Mono>pct</Mono> tag entirely rather than writing <Mono>pct=100</Mono>.
                    This is the last rung where a mistake is recoverable by the recipient —
                    everything failing is retrievable from a spam folder.
                  </>,
                ],
                [
                  'p=reject',
                  'Permanent',
                  'Failing mail is refused at SMTP time. The sender gets a bounce; the recipient gets nothing and never knows. This is the correct end state and it is also the first rung with no undo, which is why the three below it exist.',
                ],
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                <Mono>pct=</Mono> is a fractional dose of a policy.
              </strong>{' '}
              It tells receivers to apply your policy to that percentage of failing messages and to
              fall back to the next-weaker policy for the rest. At <Mono>p=quarantine; pct=25</Mono>
              , three quarters of failing mail is treated as if the policy were none, and one
              quarter goes to spam — so a sending path you forgot about surfaces as a support ticket
              from one user in four rather than from everyone at once, which is the difference
              between a discovery and an outage. Note the tag is ignored at <Mono>p=none</Mono>:
              none has nothing weaker to fall back to.
            </p>
            <Code>
              {
                'v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com\nv=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc@yourdomain.com\nv=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com\nv=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=mailto:dmarc@yourdomain.com'
              }
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Why two weeks and not two days.</strong> Because you are
              not waiting for data volume, you are waiting for a full business cycle. Daily
              transactional mail shows up in a day. Monthly invoicing shows up once a month, and a
              quarterly newsletter shows up once a quarter — and those are precisely the senders
              that surprise you, because they were configured years ago by someone who has left and
              they only fail on the day they run. Two weeks per rung with a monthly cycle in view is
              a compromise; if you know you have quarterly senders, hold at quarantine until one of
              them has fired.
            </p>
            <Gotcha title="Tighten alignment last, not first">
              <Mono>adkim=s</Mono> and <Mono>aspf=s</Mono> demand exact domain alignment instead of
              organisational alignment, so <Mono>mail.yourdomain.com</Mono> stops counting as{' '}
              <Mono>yourdomain.com</Mono>. That is a real hardening and it is also a second
              variable. Change it on its own rung, after reject is stable, so that when something
              breaks you know which change broke it.
            </Gotcha>
          </>
        ),
        'what-breaks': (
          <>
            <Lede>
              Two things break, every time, on every domain with any history. Neither is a surprise
              and both are cheaper to handle in advance than to diagnose at reject.
            </Lede>
            <Contrast
              sides={[
                {
                  label: '1. Mailing lists that do not rewrite the sender',
                  tone: 'bad',
                  points: [
                    'A traditional discussion list takes your message, appends a footer, sometimes prefixes the subject, and forwards it to hundreds of subscribers with your From address intact',
                    'The footer changes the body, which breaks the DKIM signature; the forwarding breaks SPF; the From header still says you',
                    'At reject, that message is refused by every subscriber whose mailbox provider honours DMARC — and the list, seeing bounces, may unsubscribe them',
                    <>
                      Well-maintained list software solved this years ago by rewriting the From
                      header to the list’s own domain and putting you in <Mono>Reply-To</Mono>.
                      Mailman 2, an unattended Google Group, and a home-grown forwarder written in
                      2014 do not
                    </>,
                    'You cannot fix them from your DNS: get the list to enable From-rewriting, move that conversation off the enforced domain, or accept it — and accepting it is a real option, because a handful of people on an internal list is a different cost from customer invoices',
                  ],
                },
                {
                  label: '2. The tool somebody set up in 2019 and nobody remembers',
                  tone: 'bad',
                  points: [
                    'This is the one that actually causes incidents',
                    'Every organisation past a few years old has a system sending as its domain that is on no inventory: an applicant tracking system, a survey tool, an e-signature service, a CRM, a status page, a legacy ticketing system, the invoicing platform finance chose without asking anyone',
                    'They were configured by people who have since moved on, they authenticate as their vendor rather than as you, and they work perfectly right up until you enforce',
                  ],
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The report is the inventory.</strong> That is the entire
              reason you sat at <Mono>p=none</Mono> for two weeks. Take each unrecognised source
              with real volume through the same three moves:
            </p>
            <Diagram
              steps={[
                {
                  kicker: 'IDENTIFY',
                  title: 'reverse DNS of the sending IP',
                  meta: 'the report gives you the address, not the name',
                },
                {
                  kicker: 'OWNER',
                  title: 'find who owns it internally',
                  meta: 'somebody signed up for it',
                },
                {
                  kicker: 'DECIDE',
                  title: 'key it, move it, or kill it',
                  meta: 'a DKIM key on a selector of yours, a subdomain with its own policy, or off',
                  tone: 'accent',
                },
              ]}
            />
            <Gotcha title="Do not add its SPF include reflexively">
              SPF permits ten DNS lookups in total and exceeding that is a permanent error that
              receivers treat as no SPF at all, so a record with eleven vendor includes has silently
              disabled itself. Giving the vendor a DKIM key costs you no lookups; adding a twelfth
              include costs you the whole record.
            </Gotcha>
            <Gotcha title="The CEO’s personal mail client">
              The third thing, which is not universal but is common enough to check: an executive
              whose desktop client sends through their home ISP’s relay, or a departmental printer,
              or a monitoring script on a box in a cupboard. They send at very low volume, they
              always fail alignment, and they will be discovered at reject by somebody senior. Look
              for single-digit-volume sources from consumer ranges before you enforce.
            </Gotcha>
          </>
        ),
        subdomains: (
          <>
            <Lede>
              <Mono>sp=</Mono> sets the policy for subdomains, and if you omit it subdomains inherit
              the parent policy. That inheritance sounds like it makes the tag unnecessary. It is
              exactly why the tag is dangerous: people set <Mono>sp=none</Mono> during a rollout to
              protect a subdomain they were unsure about, and then never take it off.
            </Lede>
            <Takeaway>
              A domain publishing <Mono>p=reject; sp=none</Mono> is not protected. Your DMARC record
              is public, it is one TXT lookup, and it is the first thing any phishing kit checks.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'v=DMARC1; p=reject; sp=reject; rua=…',
                  tone: 'good',
                  points: [
                    'The end state',
                    'Covers every subdomain you own, including the ones that do not exist yet',
                  ],
                },
                {
                  label: 'v=DMARC1; p=reject; sp=none; rua=…',
                  tone: 'bad',
                  points: [
                    'A rollout artefact, left on',
                    <>
                      An attacker sees the parent enforced and the children not, and sends from{' '}
                      <Mono>billing.yourdomain.com</Mono> instead
                    </>,
                    'That subdomain is yours, it has no record of its own, it inherits none from the tag you left behind — and to a recipient it reads as more official than the bare domain rather than less',
                  ],
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Close the subdomain gap on the same day you tighten the parent.
              </strong>{' '}
              If a specific subdomain genuinely needs to stay permissive — a vendor you have not
              migrated yet, a marketing platform mid-move — scope the exception to that one name
              rather than weakening <Mono>sp</Mono> for everything you own.
            </p>
            <FactTable
              columns={['Case', 'What to publish', 'Why that and not sp=']}
              rows={[
                [
                  'A subdomain that must stay permissive',
                  <>
                    Its own DMARC record at <Mono>_dmarc.that-subdomain.yourdomain.com</Mono>
                  </>,
                  <>
                    A published record at the subdomain wins over the parent’s <Mono>sp</Mono>, so
                    the exception is scoped to one name and expires when you delete it.
                  </>,
                ],
                [
                  'A parked domain or subdomain you never send from',
                  <>
                    <Mono>v=DMARC1; p=reject; sp=reject;</Mono> plus an empty SPF record,{' '}
                    <Mono>v=spf1 -all</Mono>
                  </>,
                  'No rollout needed and no risk to weigh, because there is no legitimate mail to break. It is the cheapest DMARC work available and almost nobody does it.',
                ],
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Once the whole tree is at reject, the remaining deliverability questions are no longer
              about authentication at all — they are about reputation and list quality, which is the
              subject of{' '}
              <a
                href="/guides/why-email-goes-to-spam"
                className="text-accent underline underline-offset-4"
              >
                why email goes to spam
              </a>
              .
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
