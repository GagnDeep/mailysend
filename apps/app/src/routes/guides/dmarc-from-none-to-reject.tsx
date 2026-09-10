import { Callout, StepCard } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Lede, Mono } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'dmarc-from-none-to-reject'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/dmarc-from-none-to-reject')({
  head: () => guideHead(SLUG),
  component: Page,
})

const SOURCES: Array<[string, string, string, string]> = [
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
]

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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              This matters more than it used to. A published, enforced DMARC policy is now a
              requirement for bulk senders at the large consumer mailbox providers rather than a
              nice-to-have, and it is the precondition for anything built on top of it — BIMI will
              not consider a domain below quarantine. But the argument that should actually move you
              is the one about forgery: until you enforce, anyone can put your domain in a From
              header and the receiver has been told, by you, not to mind.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The reason people stay at none for years is not laziness. It is that the first time
              you enforce, you find out which of your own systems were never authenticated, and you
              find out by way of them not arriving. The whole discipline below exists to move that
              discovery from “customers did not get their invoices” to “a row in a report last
              Tuesday”.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Before any of this, the three records need to be right and aligned — SPF authorises
              the envelope sender, DKIM signs the message, DMARC checks that one of those passed{' '}
              <em>for the domain in the From header</em>. If that last clause is not yet familiar,
              start at{' '}
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              You can read one by hand and it is worth doing once, so that the aggregators stop
              feeling like magic. Each <Mono>{'<record>'}</Mono> is one sending source over one day:
            </p>
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
              Sort your sources by volume, descending, and work down. Your transport should be at
              the top with a pass rate at or near 100%; if it is not, stop the rollout and fix that
              first, because nothing below matters while your main sending path is failing. Then you
              are looking at a long tail, and every entry in it is one of five things:
            </p>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Source</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Volume</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Result</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">What it is</th>
                  </tr>
                </thead>
                <tbody>
                  {SOURCES.map(([source, volume, result, meaning]) => (
                    <tr key={source} className="border-line border-t">
                      <td className="px-4 py-2 font-semibold text-ink">{source}</td>
                      <td className="px-4 py-2 text-muted">{volume}</td>
                      <td className="px-4 py-2 font-mono text-[12.5px] text-muted">{result}</td>
                      <td className="px-4 py-2 text-muted-2">{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The forwarder signature.</strong> SPF fails, DKIM passes,
              volume is low and steady, and the source is a university, a corporate gateway or a
              mail-hosting provider. That is somebody who subscribed with a work address that
              forwards elsewhere. SPF breaks on forwarding by construction — the forwarder is not on
              your list and never will be — while the DKIM signature travels with the message, so
              DMARC passes on DKIM alignment alone. This costs you nothing at reject, and it is the
              single best argument for publishing DKIM even when SPF already passes.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The forger signature.</strong> Both fail, the source is a
              residential or hosting range you do not recognise, and the volume is either very small
              (a targeted attempt) or very large and spiky (a campaign). There is nothing to
              authorise here and nothing to fix. These rows are the reason you are doing this.
            </p>
            <Callout variant="warn" title="LOW VOLUME IS NOT LOW IMPORTANCE">
              The dangerous row is not the loud one. It is the source sending forty messages a
              month, failing both checks, from a hostname that could plausibly be a vendor — because
              at reject those forty messages are password resets, or invoices, or the annual renewal
              notice. Read the tail, not just the head.
            </Callout>
          </>
        ),
        'the-ladder': (
          <>
            <Lede>
              Four rungs, roughly two weeks each. The point of the intermediate rungs is not caution
              for its own sake — it is that each one exposes a different set of failures at a
              survivable cost, and that <Mono>pct=</Mono> lets you take a fractional dose of a
              policy before you take the whole thing.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <Mono>pct=</Mono> tells receivers to apply your policy to that percentage of failing
              messages and to fall back to the next-weaker policy for the rest. At{' '}
              <Mono>p=quarantine; pct=25</Mono>, three quarters of failing mail is treated as if the
              policy were none, and one quarter goes to spam. The consequence is that a sending path
              you forgot about surfaces as a support ticket from one user in four rather than from
              everyone at once, which is the difference between a discovery and an outage. Note the
              tag is ignored at <Mono>p=none</Mono> — none has nothing weaker to fall back to.
            </p>
            <div className="flex flex-col gap-3.5">
              <StepCard step={1} title="p=none — measure" variant="rule">
                <p className="mt-1.5 mb-0 text-[15px] leading-[1.65] text-muted">
                  Two weeks minimum, and stay here until you can name every source in the report.
                  The exit condition is not a date, it is an inventory: a list of sending systems,
                  each either authenticated or knowingly abandoned.
                </p>
              </StepCard>
              <StepCard step={2} title="p=quarantine; pct=25 — take a dose" variant="rule">
                <p className="mt-1.5 mb-0 text-[15px] leading-[1.65] text-muted">
                  Two weeks. The first rung with consequences, deliberately applied to a quarter of
                  failures. Watch your support queue as closely as the reports — a quarantined
                  message is in a spam folder, so it will be reported to you by a human before it
                  shows up in an aggregate feed.
                </p>
              </StepCard>
              <StepCard step={3} title="p=quarantine — full dose" variant="rule">
                <p className="mt-1.5 mb-0 text-[15px] leading-[1.65] text-muted">
                  Two weeks. Drop the <Mono>pct</Mono> tag entirely rather than writing{' '}
                  <Mono>pct=100</Mono>. This is the last rung where a mistake is recoverable by the
                  recipient — everything failing is retrievable from a spam folder.
                </p>
              </StepCard>
              <StepCard step={4} title="p=reject — enforce" variant="rule">
                <p className="mt-1.5 mb-0 text-[15px] leading-[1.65] text-muted">
                  Failing mail is refused at SMTP time. The sender gets a bounce; the recipient gets
                  nothing and never knows. This is the correct end state and it is also the first
                  rung with no undo, which is why the three below it exist.
                </p>
              </StepCard>
            </div>
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
            <Callout title="TIGHTEN ALIGNMENT LAST, NOT FIRST">
              <Mono>adkim=s</Mono> and <Mono>aspf=s</Mono> demand exact domain alignment instead of
              organisational alignment, so <Mono>mail.yourdomain.com</Mono> stops counting as{' '}
              <Mono>yourdomain.com</Mono>. That is a real hardening and it is also a second
              variable. Change it on its own rung, after reject is stable, so that when something
              breaks you know which change broke it.
            </Callout>
          </>
        ),
        'what-breaks': (
          <>
            <Lede>
              Two things break, every time, on every domain with any history. Neither is a surprise
              and both are cheaper to handle in advance than to diagnose at reject.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">1. Mailing lists that do not rewrite the sender.</strong>{' '}
              A traditional discussion list takes your message, appends a footer, sometimes prefixes
              the subject, and forwards it to hundreds of subscribers with your From address intact.
              The footer changes the body, which breaks the DKIM signature; the forwarding breaks
              SPF; the From header still says you. At reject, that message is refused by every
              subscriber whose mailbox provider honours DMARC — and the list, seeing bounces, may
              unsubscribe them.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Well-maintained list software solved this years ago by rewriting the From header to
              the list’s own domain and putting you in <Mono>Reply-To</Mono>, so the message is
              authenticated as the list, which is what it is. Mailman 2, an unattended Google Group,
              and a home-grown forwarder written in 2014 do not do this. You cannot fix them from
              your DNS. Your options are to get the list to enable From-rewriting, to move that
              conversation off the enforced domain, or to accept it — and that last one is a real
              option, because a handful of people on an internal list is a different cost from
              customer invoices.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                2. The third-party tool somebody set up in 2019 and nobody remembers.
              </strong>{' '}
              This is the one that actually causes incidents. Every organisation past a few years
              old has a system sending as its domain that is on no inventory: an applicant tracking
              system, a survey tool, an e-signature service, a CRM, a status page, a legacy
              ticketing system, the invoicing platform finance chose without asking anyone. They
              were configured by people who have since moved on, they authenticate as their vendor
              rather than as you, and they work perfectly right up until you enforce.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The report is the inventory. That is the entire reason you sat at <Mono>p=none</Mono>{' '}
              for two weeks. For each unrecognised source with real volume: identify it from the
              reverse DNS of the sending IP, find who owns it internally, and then either give it a
              DKIM key on a selector of yours, put it on a subdomain with its own policy, or turn it
              off. Do not add its SPF include reflexively — SPF permits ten DNS lookups total and
              exceeding that is a permanent error that receivers treat as no SPF at all, so a record
              with eleven vendor includes has silently disabled itself.
            </p>
            <Callout variant="warn" title="THE CEO’S PERSONAL MAIL CLIENT">
              The third thing, which is not universal but is common enough to check: an executive
              whose desktop client sends through their home ISP’s relay, or a departmental printer,
              or a monitoring script on a box in a cupboard. They send at very low volume, they
              always fail alignment, and they will be discovered at reject by somebody senior. Look
              for single-digit-volume sources from consumer ranges before you enforce.
            </Callout>
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              A domain publishing <Mono>p=reject; sp=none</Mono> is not protected. An attacker reads
              your DMARC record — it is public, it is one TXT lookup, and it is the first thing any
              phishing kit checks — sees that the parent is enforced and the children are not, and
              sends from <Mono>billing.yourdomain.com</Mono> instead. That subdomain is yours, it
              has no record of its own, it inherits <Mono>none</Mono> from the tag you left behind,
              and to a recipient it reads as more official than the bare domain rather than less.
            </p>
            <Code>
              {'v=DMARC1; p=reject; sp=reject; rua=mailto:dmarc@yourdomain.com   '}
              <Com>{'← the end state'}</Com>
              {'\nv=DMARC1; p=reject; sp=none;   rua=mailto:dmarc@yourdomain.com   '}
              <Com>{'← a rollout artefact, left on'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The rule to follow: close the subdomain gap on the same day you tighten the parent. If
              a specific subdomain genuinely needs to stay permissive — a vendor you have not
              migrated yet, a marketing platform mid-move — give <em>that subdomain</em> its own
              DMARC record at <Mono>_dmarc.that-subdomain.yourdomain.com</Mono> rather than
              weakening
              <Mono>sp</Mono> for every subdomain you own, including the ones that do not exist yet.
              A published record at the subdomain wins over the parent’s <Mono>sp</Mono>, so the
              exception is scoped to one name and expires when you delete it.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The other subdomain worth an explicit record is a parked one — a domain or subdomain
              you own and never send from. Publish <Mono>v=DMARC1; p=reject; sp=reject;</Mono> plus
              an empty SPF record (<Mono>v=spf1 -all</Mono>) on anything you do not send from at
              all. There is no rollout needed and no risk to weigh, because there is no legitimate
              mail to break. It is the cheapest DMARC work available and almost nobody does it.
            </p>
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
