// biome-ignore-all lint/complexity/noUselessFragments: a single-element FactTable cell must stay
// wrapped. Unwrapped, the row literal trips useJsxKeyInIterable — an error rather than an info,
// and a false one, since FactTable keys its own cells from the row key and the column name.
import { createFileRoute } from '@tanstack/react-router'
import { DnsRecordBuilder } from '~/components/guides/dns-record-builder.tsx'
import {
  Contrast,
  Diagram,
  FactTable,
  Gotcha,
  Takeaway,
} from '~/components/marketing/guide-blocks.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Lede, Mono } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'spf-dkim-dmarc'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/spf-dkim-dmarc')({
  head: () => guideHead(SLUG),
  component: Page,
})

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          Three records are published and you can say what each one proves: SPF authorises a server,
          DKIM signs the message, DMARC checks that one of those two passed{' '}
          <em>for the domain the reader sees</em>. That last clause is alignment, and it is the part
          that turns two passing checks into a failing DMARC verdict.
        </p>
      }
    >
      {{
        'what-each-proves': (
          <>
            <Lede>
              These are three different claims and they are constantly conflated, including by tools
              that should know better. Getting the distinction straight takes two minutes and saves
              an afternoon.
            </Lede>
            <Takeaway>
              SPF and DKIM prove something about the delivery. DMARC is the only one that connects
              that proof to the name in the From line — which is the only part a recipient ever
              sees, the only one that lets you ask receivers to reject forgeries, and the only one
              that sends you reports.
            </Takeaway>
            <FactTable
              columns={['Record', 'What it proves', 'Checked against', 'Under forwarding']}
              rows={[
                [
                  'SPF',
                  'A list of servers allowed to send for this domain.',
                  'The envelope sender — the bounce address — not the From header a reader sees.',
                  'Breaks. The forwarder is not on your list.',
                ],
                [
                  'DKIM',
                  'A cryptographic signature over the message itself, verified against a public key the receiver fetches from your DNS.',
                  'The body hash and a fixed list of headers.',
                  'Survives. The signature travels with the message.',
                ],
                [
                  'DMARC',
                  'A policy saying what to do when neither of the above aligns with the From domain.',
                  'The address a human reads. It is the only one of the three that is.',
                  'Passes on whichever of the two still aligns.',
                ],
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">This is why one status is not enough.</strong> A verify
              returns three separate signals alongside the roll-up — <Mono>dkim_ready</Mono>,{' '}
              <Mono>spf_ready</Mono> and <Mono>dmarc_policy</Mono> — because collapsing them hides
              the two states that matter.
            </p>
            <Contrast
              sides={[
                {
                  label: 'DKIM without SPF',
                  tone: 'bad',
                  points: ['A domain that delivers, and then fails alignment.'],
                },
                {
                  label: 'SPF without DMARC',
                  tone: 'bad',
                  points: ['A domain nobody is watching, including you.'],
                },
              ]}
            />
            <Gotcha title="Two DKIM rows where one passes is not working DKIM">
              The readiness check uses <Mono>every</Mono> over the matching rows rather than{' '}
              <Mono>some</Mono>: a half-published key reported as ready is a half-published key in
              production, signing mail nobody can verify.
            </Gotcha>
          </>
        ),
        'your-records': (
          <>
            <Lede>
              Enter your domain and pick your transport. These rows come from the transport
              adapter’s own <Mono>dnsRecords()</Mono> function — the same code that produces your
              setup screen and then verifies what you published.
            </Lede>
            <DnsRecordBuilder />
            <FactTable
              columns={['Transport', 'SPF', 'DKIM row', 'Return-path MX']}
              rows={[
                [
                  'Cloudflare Email Service',
                  <>
                    <Mono>include:_spf.mx.cloudflare.net</Mono> at the apex
                  </>,
                  <>
                    <Mono>cf-bounce._domainkey</Mono>, holding Cloudflare’s own key
                  </>,
                  <>
                    <Mono>cf-bounce.yourdomain.com</Mono> → <Mono>mx.cloudflare.net</Mono>
                  </>,
                ],
                [
                  'SES',
                  <>
                    <Mono>include:amazonses.com</Mono> at the apex, plus a second SPF record on the
                    return-path subdomain
                  </>,
                  <>
                    <Mono>ms1._domainkey</Mono>, holding the key MailySend generated and handed to
                    SES as a BYODKIM signing attribute
                  </>,
                  <>
                    On the return-path subdomain — a custom MAIL FROM domain, which is the thing
                    that makes SPF align
                  </>,
                ],
                [
                  'Resend',
                  <>
                    On <Mono>send.yourdomain.com</Mono>
                  </>,
                  <>None issued here: the key is theirs and is fetched live from their API</>,
                  <>
                    On <Mono>send.yourdomain.com</Mono>
                  </>,
                ],
                [
                  'SMTP relay',
                  <>
                    <Mono>v=spf1 a mx include:&lt;your relay host&gt; ~all</Mono>
                  </>,
                  <>
                    <Mono>ms1._domainkey</Mono>, holding <em>our</em> key — a raw relay signs
                    nothing, so this row is not optional
                  </>,
                  <>The return path is used as the envelope sender</>,
                ],
              ]}
              caption="All four also get a DMARC row, and it is the same row in every case: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com."
            />
            <Gotcha title="Bounce collection is a record, not a setting">
              The <Mono>MX</Mono> row on the return-path subdomain is where DSNs land. Skip it and
              the mail still sends; what disappears is the reply, so a bounce that would have become
              a suppression becomes silence and the address stays on your list. That is the single
              most-skipped row on the list, because it is the one nothing complains about.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                A domain bound to a transport gets that transport’s rows and nothing else.
              </strong>{' '}
              A domain that names no transport shows the union across every provider the router
              could yield, because a workspace that fails over mid-incident needs the second
              transport’s records already in place. Where that union would produce two apex{' '}
              <Mono>v=spf1</Mono> records, the includes are merged into one legal record — two SPF
              records at one name is a permanent error, not belt-and-braces.
            </p>
            <Gotcha title="Changing transport rewrites the row set">
              Rewriting a domain’s records resets that domain to <Mono>not_started</Mono> and clears{' '}
              <Mono>last_verified_at</Mono>. It has to: every row is re-inserted unverified, so a
              domain still claiming <Mono>verified</Mono> would be making a claim about records that
              no longer exist. Expect to publish and re-verify, and expect the old transport’s rows
              to keep resolving until you remove them.
            </Gotcha>
          </>
        ),
        alignment: (
          <>
            <Lede>
              A message can pass SPF, pass DKIM, and still fail DMARC. This surprises people every
              time, and it is not a bug in anything.
            </Lede>
            <Takeaway>
              DMARC does not ask “did SPF pass?”. It asks “did SPF pass{' '}
              <em>for a domain that matches the From header</em>?” — and a check that passed for
              somebody else’s domain proved nothing about yours.
            </Takeaway>
            <Diagram
              steps={[
                {
                  kicker: 'FROM',
                  title: 'hello@yourdomain.com',
                  meta: 'what the reader sees — the only field DMARC is about',
                  tone: 'accent',
                },
                {
                  kicker: 'RETURN-PATH',
                  title: 'bounces@vendor.net',
                  meta: 'what SPF checked: the vendor’s domain, not yours',
                },
                {
                  kicker: 'DKIM d=',
                  title: 'yourdomain.com',
                  meta: 'aligned — DMARC passes on this one alone',
                },
              ]}
            />
            <Contrast
              sides={[
                {
                  label: 'Relaxed alignment — the default for both checks',
                  tone: 'good',
                  points: [
                    'The two domains have to share an organisational domain rather than match exactly',
                    <>
                      That is the licence under which <Mono>cf-bounce.yourdomain.com</Mono> or{' '}
                      <Mono>send.yourdomain.com</Mono> can carry the envelope sender and still align
                      with a <Mono>From</Mono> at the apex
                    </>,
                  ],
                },
                {
                  label: 'Strict alignment',
                  tone: 'neutral',
                  points: [
                    'Removes that licence: the domains must match exactly',
                    'A deliberate late step rather than a default',
                  ],
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Forwarding is where the two checks diverge.</strong> A
              mailing list or a university address that forwards to Gmail re-sends your message from
              its own server, so the connecting IP is the forwarder’s and SPF fails — correctly, by
              its own rules, on a message that is genuinely yours. The DKIM signature travels inside
              the message and keeps verifying, and DMARC needs only one of the two to pass and
              align. SPF is the check that fails exactly when a message reaches a mailbox that is
              judging you, which is the whole argument for publishing DKIM when SPF already passes.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">What breaks a surviving signature.</strong> The signature
              covers the body hash and a fixed list of headers, so a list server that appends a
              footer or rewrites <Mono>Subject</Mono> with a <Mono>[list-name]</Mono> tag
              invalidates it. Nothing on your side prevents that — which is why DKIM failures from
              one mailing list are a fact about the list, and a rise across many receivers is a fact
              about you.
            </p>
            <Gotcha title="The silent one: a MAIL FROM domain that fell back">
              When SES creates the identity, MailySend sets the MAIL FROM domain to your return-path
              subdomain with <Mono>BehaviorOnMxFailure = USE_DEFAULT_VALUE</Mono> — so that sends
              are not rejected while the MX and SPF rows for that subdomain are still propagating.
              The cost is that if those rows never appear, SES quietly keeps using its own domain as
              the envelope sender. Mail flows, SPF passes for <Mono>amazonses.com</Mono>, and SPF
              alignment is silently gone, leaving DKIM as the only thing holding DMARC up. The
              record set is the fix; the symptom is a DMARC report showing SPF pass and SPF align
              fail on every single message.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              This is why the record sets above put the bounce path on a subdomain of <em>your</em>{' '}
              domain rather than the transport’s, and why the SMTP adapter uses the return path as
              the envelope sender rather than the <Mono>From</Mono> address.
            </p>
          </>
        ),
        'dkim-key': (
          <>
            <Lede>
              A selector is just a label that says which key to fetch — <Mono>ms1</Mono> means the
              receiver looks up <Mono>ms1._domainkey.yourdomain.com</Mono>. Having a selector name
              at all is what lets you rotate a key without a gap.
            </Lede>
            <Takeaway>
              The keypair is generated per domain when the domain is added, the private half has no
              read path anywhere in the API — and on two of the four transports it is not the key
              doing the signing at all.
            </Takeaway>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">RSA-2048, not Ed25519.</strong> Ed25519 signatures are
              smaller and better, and a meaningful share of receivers still do not verify them. A
              signature nobody checks is not an improvement, so the default is the one that works
              everywhere: 2048-bit <Mono>RSASSA-PKCS1-v1_5</Mono> over SHA-256.
            </p>
            <Code>
              {
                'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=yourdomain.com;\n s=ms1; t=1757548800; bh=<base64 body hash>;\n h=from:to:subject:date:message-id:mime-version:content-type;\n b=<base64 signature>'
              }
            </Code>
            <FactTable
              columns={['Tag', 'What the signer emits', 'Why']}
              rows={[
                [
                  'a=',
                  <>
                    <Mono>rsa-sha256</Mono>
                  </>,
                  'The algorithm every receiver verifies.',
                ],
                [
                  'c=',
                  <>
                    <Mono>relaxed/relaxed</Mono>
                  </>,
                  'Collapses whitespace runs and drops trailing whitespace before hashing, so a message survives an MTA reformatting a header. Simple canonicalisation would fail on transformations nobody can see.',
                ],
                [
                  'h=',
                  <>
                    <Mono>from</Mono>, <Mono>to</Mono>, <Mono>cc</Mono>, <Mono>subject</Mono>,{' '}
                    <Mono>date</Mono>, <Mono>message-id</Mono>, <Mono>mime-version</Mono>,{' '}
                    <Mono>content-type</Mono>, <Mono>content-transfer-encoding</Mono>,{' '}
                    <Mono>reply-to</Mono>, <Mono>list-unsubscribe</Mono>,{' '}
                    <Mono>list-unsubscribe-post</Mono>
                  </>,
                  'Filtered down to the ones actually present. Listing a header that is not there is how a signature ends up covering a header an attacker can then add.',
                ],
                [
                  'b=',
                  'Folded at 72 columns',
                  'An unfolded 400-character header is the thing some MTAs truncate.',
                ],
              ]}
              caption="The signature is prepended, so the Received lines each hop adds land above it and disturb nothing."
            />
            <FactTable
              columns={['Transport', 'Who actually signs', 'Under which selector']}
              rows={[
                [
                  'Cloudflare Email Service',
                  'Cloudflare, with its own key — the structured payload is what gets sent, not the MIME MailySend builds',
                  <>
                    <Mono>cf-bounce._domainkey</Mono>
                  </>,
                ],
                ['Resend', 'Resend, with its own key', 'Its own'],
                [
                  'SES',
                  'SES, using the private key MailySend generated and handed over as a BYODKIM signing attribute',
                  <>
                    <Mono>ms1</Mono>
                  </>,
                ],
                [
                  'SMTP relay',
                  'MailySend. A raw relay signs nothing, which is why this row is not optional there',
                  <>
                    <Mono>ms1</Mono>
                  </>,
                ],
              ]}
              caption="On SES the published record, the selector in the signature and the key doing the signing describe one key rather than three unrelated ones."
            />
            <Gotcha title="Why some DKIM rows are just v=DKIM1">
              Several transports mint their own key under their own selector, and neither the key
              nor the selector is knowable before the domain exists there. The builder above shows a
              shape rather than a value, and verification checks that something of the right shape
              resolves. Printing a plausible-looking key you would then publish would produce a
              record promising a signature that never arrives — worse than no record.
            </Gotcha>
            <Gotcha title="A signing failure is not a send failure">
              If the key will not import, the failure is logged and the unsigned message goes out
              anyway: an unsigned message may land in spam, while a message that does not go out is
              a bug the sender never asked for. The cost is that a broken key looks like a
              deliverability slide rather than an error, so a sudden DKIM-fail rate in your DMARC
              reports is worth reading as a key problem before a content problem.
            </Gotcha>
          </>
        ),
        'check-it': (
          <>
            <Lede>
              Two lookups and you are done. Do them from a resolver rather than from your DNS
              provider’s own interface, which will happily show you a record it has not published
              yet.
            </Lede>
            <Code>
              {
                'dig +short TXT yourdomain.com\ndig +short TXT ms1._domainkey.yourdomain.com\ndig +short TXT _dmarc.yourdomain.com'
              }
            </Code>
            <Takeaway>
              Verification does the same lookup you just did: one DNS-over-HTTPS query per row
              against <Mono>cloudflare-dns.com/dns-query</Mono>, reported as one of four words.
            </Takeaway>
            <FactTable
              columns={['Word', 'What it means', 'What it is worth doing about it']}
              rows={[
                ['verified', 'It resolved and it agreed.', 'Nothing.'],
                [
                  'pending',
                  'Nothing is published at that name yet.',
                  'Publish it, or wait for it to propagate.',
                ],
                [
                  'failed',
                  'A record exists and disagrees.',
                  'The actionable case — read the value that resolved.',
                ],
                [
                  'error',
                  'The lookup itself did not complete.',
                  'No evidence about your zone at all. Without this fourth word a domain whose every row errored used to roll up to verified.',
                ],
              ]}
            />
            <FactTable
              columns={['Row', 'Compared how', 'Because']}
              rows={[
                [
                  'apex SPF',
                  'On its includes',
                  'Merging our include into your existing record is the correct thing to do, and an exact match would punish it.',
                ],
                [
                  'DKIM / DMARC',
                  'On its prefix',
                  <>
                    The value is one only the provider knows, so <Mono>v=DKIM1</Mono> passes against
                    a full key and tightening <Mono>p=none</Mono> to <Mono>p=quarantine</Mono> does
                    not turn a verified row red.
                  </>,
                ],
                [
                  'everything else',
                  'Exactly',
                  'After whitespace, a trailing dot and case are normalised away.',
                ],
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The domain rolls up conservatively.</strong> A domain is{' '}
              <Mono>verified</Mono> only when every row is; any <Mono>failed</Mono> row makes it
              failed; everything else is <Mono>pending</Mono>. Note what is not in that rule: rows
              the provider publishes for itself are not excluded, so a Cloudflare domain you have
              not yet onboarded sits at <Mono>pending</Mono> with nothing for you to copy. The
              response’s <Mono>checked</Mono> block — total, resolved, errored — is how you tell
              “still propagating” from “the resolver would not answer”.
            </p>
            <FactTable
              columns={['The mistake', 'What it actually does', 'The fix']}
              rows={[
                [
                  'Two SPF records',
                  'A domain may publish exactly one. Two is a permanent error and receivers treat it as no SPF at all, so adding a second record for a new sender silently disables the first.',
                  <>
                    Merge the includes into one record. The setup screen does this for you when two
                    transports both want the apex, keeping the first record’s <Mono>~all</Mono> or{' '}
                    <Mono>-all</Mono> qualifier; what it cannot merge is a record some other tool
                    added to your zone last year.
                  </>,
                ],
                [
                  'More than ten lookups',
                  <>
                    SPF evaluation is capped at ten mechanisms that require a lookup —{' '}
                    <Mono>include</Mono>, <Mono>a</Mono>, <Mono>mx</Mono>, <Mono>ptr</Mono>,{' '}
                    <Mono>exists</Mono>, <Mono>redirect</Mono> — counted recursively, so one include
                    that itself includes three more spends four of your ten. Exceeding it is a
                    permerror, which most receivers treat as no SPF.
                  </>,
                  'Count them by hand once the apex record passes three or four includes. Nothing in the verifier counts them for you: it checks that your includes are present, not that the tree beneath them is small enough.',
                ],
                [
                  'A key your panel split',
                  'A TXT record is a sequence of strings of at most 255 bytes each, and a 2048-bit key does not fit in one. Well-behaved panels split the value into quoted strings a resolver concatenates back, and verification joins the chunks a DoH answer arrives in before comparing. Badly behaved panels truncate at 255 characters or insert whitespace at the split.',
                  <>
                    Compare the <Mono>p=</Mono> value from <Mono>dig</Mono>, byte for byte, against
                    the key you published. Because the row is prefix-matched on <Mono>v=DKIM1</Mono>
                    , a truncated key can still verify here while the signature fails at every
                    receiver.
                  </>,
                ],
                [
                  'p=quarantine with no rua',
                  'An instruction to receivers with no feedback to you: you have asked mailbox providers to start quarantining mail that fails alignment, and arranged to hear nothing about which mail that is — including the invoicing system, the helpdesk and the CRM you forgot about.',
                  <>
                    Publish <Mono>p=none</Mono> with a working <Mono>rua</Mono> first, read the
                    reports until you recognise every source in them, and tighten after. That is why
                    the default row for every transport is{' '}
                    <Mono>v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com</Mono>, and the mailbox
                    it names has to be one that can actually receive mail.
                  </>,
                ],
                [
                  'A registrar that appends',
                  <>
                    Many panels take the name you type and append the zone. Entering{' '}
                    <Mono>_dmarc.yourdomain.com</Mono> then produces{' '}
                    <Mono>_dmarc.yourdomain.com.yourdomain.com</Mono>, which resolves to nothing and
                    looks correct in the interface.
                  </>,
                  <>
                    If <Mono>dig</Mono> disagrees with your DNS panel, believe <Mono>dig</Mono>.
                  </>,
                ],
              ]}
              caption="The ten-lookup one fails in the worst possible way: it works until a vendor adds an include inside their own record, and your SPF stops passing with nothing having changed on your side."
            />
            <Gotcha title="When a row says failed, read the found value">
              A failed row carries the value that actually resolved, verbatim, next to the value
              that was expected. It is a trailing dot more often than not, or a smart-quoted value a
              panel rewrote. Comparing the two strings takes a second and answers the question
              faster than re-reading the record you meant to publish. If DKIM alignment fails in
              DMARC reports on a domain whose rows are <em>all</em> green, the split key above is
              the first thing to rule out.
            </Gotcha>
          </>
        ),
      }}
    </GuideLayout>
  )
}
