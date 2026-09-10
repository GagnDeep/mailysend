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

const SLUG = 'verify-a-sending-domain'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/verify-a-sending-domain')({
  head: () => guideHead(SLUG),
  component: Page,
})

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You can now read the verification screen as evidence rather than as a verdict: each row is
          one DNS-over-HTTPS lookup, matched by one of three rules, reported in one of four states,
          and the response tells you how many of the rows were actually resolved. The thing most
          likely to bite you later is not a wrong value — it is a cached one. Nothing in this
          product can make a resolver forget an answer it is still entitled to serve, so the honest
          response to <Mono>pending</Mono> is usually to wait out the TTL you set before you edited.
        </p>
      }
    >
      {{
        'how-it-checks': (
          <>
            <Lede>
              Verification is not a scan, a crawl, or a queue. It is one DNS-over-HTTPS query per
              required record, made against Cloudflare’s public resolver at the moment you press the
              button, and then a comparison. That is the whole mechanism, and knowing it is the
              whole mechanism is what lets you reason about a result instead of retrying it.
            </Lede>
            <Diagram
              steps={[
                {
                  kicker: 'ROW',
                  title: 'name + type',
                  meta: 'one record your transport asked for',
                },
                {
                  kicker: 'DoH',
                  title: 'Cloudflare public resolver',
                  meta: 'one live query, at the moment you pressed the button',
                  tone: 'accent',
                },
                {
                  kicker: 'NORMALISE',
                  title: 'join, unquote, strip',
                  meta: 'TXT chunks rejoined; MX exchange taken off the raw answer',
                },
                { kicker: 'MATCH', title: 'exact · include · prefix', meta: 'per-row match mode' },
                { kicker: 'STATE', title: 'verified · pending · failed · error' },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The wire format is why normalising comes first.</strong>{' '}
              TXT answers come back quoted and chunked at 255 bytes, because that is the wire format
              and a 2048-bit DKIM key does not fit in one string; the checker joins the chunks and
              unquotes them before comparing anything, which is why a key that looks split across
              three quoted pieces in your zone file still matches. MX answers arrive as{' '}
              <Mono>{'<priority> <exchange>'}</Mono>, so the exchange is taken off the end of the
              raw answer rather than out of the normalised form, where the space it was split on no
              longer exists.
            </p>
            <FactTable
              columns={['Match mode', 'Used for', 'What it demands']}
              rows={[
                [
                  'exact',
                  'Everything not listed below',
                  'The published value must equal the expected value. Whitespace is stripped, a trailing dot is stripped, and the comparison is case-insensitive — so a zone file that qualifies a name with a final dot still matches. Everything else has to be identical.',
                ],
                [
                  'include',
                  'SPF, where merging is the correct answer',
                  <>
                    A domain may publish exactly one SPF record, so a reader who already has one is
                    right to add our include to it rather than publish a second. The check pulls
                    every <Mono>include:</Mono> token out of the expected value and requires all of
                    them to appear in what resolved.
                  </>,
                ],
                [
                  'prefix',
                  'A value only the transport knows',
                  <>
                    A DKIM key the provider mints, or a DMARC policy you are free to tighten. The
                    expected value is truncated at the first semicolon and the answer only has to
                    start with it — <Mono>v=DKIM1</Mono> matches whatever key follows.
                  </>,
                ],
              ]}
              caption="One more filter: when the expected value starts with v=spf1, only published records that also start with v=spf1 are counted as relevant, so the found field shows that filtered set joined rather than your whole apex TXT collection."
            />
            <Gotcha title="One lookup, one answer">
              Because it is a single live query per record, verification is exactly as up to date as
              the resolver it asked and no more. It is not watching your zone. Pressing the button
              twice in ten seconds asks the same resolver the same question and will usually get the
              same cached answer back.
            </Gotcha>
          </>
        ),
        'four-states': (
          <>
            <Lede>
              A record check returns one of four values, not a boolean. That is a deliberate cost —
              four states is more UI, more copy and more branching than a checkmark — and it is paid
              because “we could not reach a resolver” and “the record says the wrong thing” are
              different problems with different fixes, and collapsing them into{' '}
              <em>not verified</em> sends you to your DNS panel to fix something that is not broken.
            </Lede>
            <Takeaway>
              <Mono>pending</Mono> means nothing is published at that name; <Mono>failed</Mono>{' '}
              means something is published and disagrees; <Mono>error</Mono> means nobody managed to
              look. Only one of the three is worth opening your DNS panel for.
            </Takeaway>
            <FactTable
              columns={['State', 'What happened', 'What follows from it']}
              rows={[
                [
                  'verified',
                  'The lookup succeeded and the answer matched.',
                  'Nothing to do. The domain row records when this last happened, and the send path drops its cached copy of the domain immediately, so a domain that just became verified is sendable now rather than in five minutes.',
                ],
                [
                  'pending',
                  'The lookup succeeded and there was nothing there.',
                  'An empty answer set — or NXDOMAIN, which is a real answer meaning the name does not exist. Either you have not published it yet, or you published it and a resolver is still serving the old cached negative. Wait, or check from a second resolver.',
                ],
                [
                  'failed',
                  'The lookup succeeded and the answer disagreed.',
                  'The only actionable state, and the response carries what actually resolved so you can diff it against what was asked for. Nine times out of ten the difference is smaller than you expect.',
                ],
                [
                  'error',
                  'The lookup did not complete.',
                  'SERVFAIL, REFUSED, a resolver returning a non-200, a query type it will not answer. This says nothing whatsoever about your zone. It is a separate state because folding it into pending makes a resolver outage look like a customer who never published anything.',
                ],
              ]}
            />
            <Contrast
              sides={[
                {
                  label: 'pending — the name resolved to nothing',
                  tone: 'neutral',
                  points: [
                    'Propagation, a typo in the name, or a record you have not added',
                    'Not worth staring at a value for: there is no value',
                  ],
                },
                {
                  label: 'failed — something is published and disagrees',
                  tone: 'bad',
                  points: [
                    'A truncated key, a merged SPF record missing our include, a value your registrar helpfully wrapped in extra quotes',
                    'The screen shows a found-against-expected diff. Read it before you retype the record',
                  ],
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Failed rows carry what resolved.</strong> It is usually a
              trailing dot, a doubled zone suffix, or a smart-quote your DNS panel substituted while
              you were pasting — which is why the diff is worth a second of reading before it is
              worth a retype.
            </p>
            <Gotcha title="Error is not a soft no">
              An errored row used to be allowed to keep its previous status, which laundered a
              resolver failure into a pass — a domain whose every row errored could roll up to
              verified. It does not any more. An errored row is a row nobody looked at, the response
              tells you how many of your rows were actually resolved, and a verify that could only
              reach two of six records is now distinguishable from one that reached all six.
            </Gotcha>
          </>
        ),
        rollup: (
          <>
            <Lede>
              The domain-level status is not a vote and not an average. It is three lines, and the
              thing to read off them is what happens to a row nobody could check.
            </Lede>
            <Code>
              {'if (statuses.every((s) => s === '}
              <Com>{"'verified'"}</Com>
              {')) return '}
              <Com>{"'verified'"}</Com>
              {'\nif (statuses.includes('}
              <Com>{"'failed'"}</Com>
              {')) return '}
              <Com>{"'failed'"}</Com>
              {'\nreturn '}
              <Com>{"'pending'"}</Com>
            </Code>
            <FactTable
              columns={['When the rows are', 'The domain is', 'Which means']}
              rows={[
                [
                  'all verified',
                  'verified',
                  'Every record was actually looked up and actually agreed.',
                ],
                ['any one failed', 'failed', 'One published record disagrees. Go and read it.'],
                [
                  'anything else',
                  'pending',
                  'Including every errored row: a row we could not check is not a row that passed. Pending is the state that keeps you checking rather than the state that tells you to stop.',
                ],
                [
                  'there are none',
                  'not_started',
                  'A different statement from pending, and kept separate for that reason.',
                ],
              ]}
            />
            <Contrast
              sides={[
                {
                  label: 'origin: copy',
                  tone: 'neutral',
                  points: ['A row that is yours to publish', 'It is in the zone file you export'],
                },
                {
                  label: 'origin: observe',
                  tone: 'good',
                  points: [
                    'A row the transport publishes for itself — there is nothing for you to paste anywhere',
                    'The check exists only so the screen can confirm the provider has done its half',
                    <>
                      Every Cloudflare Email Service row is one: the SPF include, the{' '}
                      <Mono>cf-bounce._domainkey</Mono> DKIM shape, the <Mono>cf-bounce</Mono> MX
                      pointing at <Mono>mx.cloudflare.net</Mono>, and the DMARC row
                    </>,
                  ],
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                So a Cloudflare domain at pending is not a domain where you forgot something.
              </strong>{' '}
              It is a domain where the transport has not finished writing its own records yet, and
              the fix is on that side. That is why the “write these records to my zone for me”
              action on a Cloudflare domain answers <em>there is nothing here to write</em> rather
              than reporting a success it did not perform, and why the exported zone file emits
              those rows as comments saying who publishes them. To make the distinction visible, the
              verify call also asks the transport directly what it thinks the identity’s state is,
              best-effort — a transport that will not answer must not be allowed to fail a verify,
              so its silence is logged and ignored rather than surfaced as your problem.
            </p>
            <FactTable
              columns={['Readiness flag', 'How it is computed']}
              rows={[
                [
                  'dkim_ready',
                  <>
                    <em>every</em> rather than <em>some</em> over the matching rows. A domain with
                    two DKIM records where one passes and one fails is not a domain with working
                    DKIM, and reporting it ready is precisely how a half-published key reaches
                    production.
                  </>,
                ],
                [
                  'spf_ready',
                  <>
                    The same <em>every</em>, for the same reason.
                  </>,
                ],
                [
                  'dmarc_policy',
                  <>
                    Distinguishes <Mono>null</Mono> (nobody has looked) from <Mono>missing</Mono>{' '}
                    (we looked and it is not there) — the same honest-about-ignorance move as the
                    error state.
                  </>,
                ],
              ]}
              caption="These three ride alongside the roll-up rather than inside it, because a single word cannot say which half is missing."
            />
          </>
        ),
        stuck: (
          <>
            <Lede>
              Four things account for nearly every domain that will not verify, and none of them are
              a bug in the checker. In rough order of how often they are the answer:
            </Lede>
            <FactTable
              columns={['Cause', 'Why it reads as pending', 'What to do']}
              rows={[
                [
                  '1. The TTL you set',
                  'If a name never existed, a public resolver will find it within seconds. If you changed a record that had a 24-hour TTL, every resolver that already asked is entitled to serve the old answer for up to 24 hours, and no button in this product or anyone else’s revokes that. Negative answers cache too: the SOA minimum controls how long “this name does not exist” is remembered, so a name you just created can read as pending for the length of that timer.',
                  'Drop the TTL to 300 seconds before the change you know is coming, not after. Otherwise, wait it out.',
                ],
                [
                  '2. Split-horizon DNS',
                  'Your laptop resolves through your company’s internal resolver, which serves an internal view of the zone; verification resolves through a public one, which serves the external view. When those two views disagree, dig on your machine and the verification screen contradict each other indefinitely and both are telling the truth.',
                  'Check with a public resolver explicitly, before you conclude anything.',
                ],
                [
                  '3. The registrar that appends',
                  <>
                    Most DNS panels append the zone to the name you type, whether or not you already
                    appended it yourself. Typing <Mono>cf-bounce._domainkey.yourdomain.com</Mono>{' '}
                    into one produces{' '}
                    <Mono>cf-bounce._domainkey.yourdomain.com.yourdomain.com</Mono>, which resolves
                    to nothing, reads as pending forever, and looks completely correct in the
                    interface that created it.
                  </>,
                  <>
                    Some panels want a bare label and some want a fully qualified name with the
                    trailing dot; the only way to know which yours is is to look at what came out.
                    If <Mono>dig</Mono> disagrees with your DNS panel, believe <Mono>dig</Mono>.
                  </>,
                ],
                [
                  '4. CNAME at the apex',
                  'A name that has a CNAME may have no other records at all — that is the rule, not a limitation of any particular provider — so if your apex is CNAMEd at a host or a site builder, your apex SPF and DMARC records either cannot be created or are being quietly ignored. This is the failure mode that most looks like the checker is broken, because the record is visibly there in the panel.',
                  'Providers offering ALIAS, ANAME or CNAME flattening synthesise an answer at query time and usually handle it fine. Providers who do not will let you create the TXT record in their UI and then never serve it — move the zone, or move the apex.',
                ],
              ]}
            />
            <Code>
              {'dig @1.1.1.1 +short TXT yourdomain.com            '}
              <Com>{'← the view verification sees'}</Com>
              {'\ndig +short TXT yourdomain.com                     '}
              <Com>{'← the view your machine sees'}</Com>
              {'\ndig @1.1.1.1 +short MX cf-bounce.yourdomain.com'}
            </Code>
            <Gotcha title="The two-SPF-records trap">
              A domain may publish exactly one SPF record. Two is a permanent error and receivers
              treat it as no SPF at all, so adding a second record for a new sender silently
              disables the first — and both of them look right in your panel. This is why the SPF
              row is matched with <Mono>include</Mono> rather than exact: merging our include into
              the record you already have is the correct action, and the check is written to pass
              when you do it.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">If rows keep coming back error, look upstream.</strong>{' '}
              With all four ruled out and rows still erroring rather than pending or failed, your
              nameservers are returning SERVFAIL to a public resolver, which usually means a DNSSEC
              signature that no longer validates. That is a zone-level fault, it breaks far more
              than mail, and it is worth treating as an incident rather than as a verification
              problem. When you have a verified domain, the next thing worth doing is{' '}
              <a
                href="/guides/dmarc-from-none-to-reject"
                className="text-accent underline underline-offset-4"
              >
                moving DMARC off p=none
              </a>
              .
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
