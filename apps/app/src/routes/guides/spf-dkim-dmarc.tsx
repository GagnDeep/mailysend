import { Callout } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { DnsRecordBuilder } from '~/components/guides/dns-record-builder.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Lede, Mono } from '~/components/marketing/prose.tsx'
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
            <div className="flex flex-col gap-3">
              {[
                [
                  'SPF',
                  'A list of servers allowed to send for this domain.',
                  'It is checked against the envelope sender — the bounce address — not against the From header a reader sees. It also breaks on forwarding, because the forwarder is not on your list.',
                ],
                [
                  'DKIM',
                  'A cryptographic signature over the message itself.',
                  'The receiver fetches your public key from DNS and verifies it. Unlike SPF, it survives forwarding, because the signature travels with the message.',
                ],
                [
                  'DMARC',
                  'A policy saying what to do when neither of the above aligns with the From domain.',
                  'This is the only one of the three that is about the address a human reads. It is also the only one that lets you ask receivers to reject forgeries, and the only one that sends you reports.',
                ],
              ].map(([name, one, two]) => (
                <div key={name} className="rounded-tile border border-line bg-card p-4">
                  <div className="font-mono text-[13px] font-bold text-accent">{name}</div>
                  <p className="mt-1 mb-1.5 text-[15.5px] font-semibold text-ink">{one}</p>
                  <p className="m-0 text-[14.5px] leading-[1.6] text-muted">{two}</p>
                </div>
              ))}
            </div>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">This is why one status is not enough.</strong> A verify
              returns three separate signals alongside the roll-up — <Mono>dkim_ready</Mono>,{' '}
              <Mono>spf_ready</Mono> and <Mono>dmarc_policy</Mono> — because collapsing them hides
              the two states that matter. DKIM without SPF is a domain that delivers and then fails
              alignment; SPF without DMARC is a domain nobody is watching, including you.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Two DKIM rows where one passes is not working DKIM.
              </strong>{' '}
              The readiness check uses <Mono>every</Mono> over the matching rows rather than{' '}
              <Mono>some</Mono>: a half-published key reported as ready is a half-published key in
              production, signing mail nobody can verify.
            </p>
            <Callout title="THE ONE-LINE VERSION">
              SPF and DKIM prove something about the delivery. DMARC is the only one that connects
              that proof to the name in the From line — which is the only part a recipient ever
              sees.
            </Callout>
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The four sets are genuinely different shapes.</strong>{' '}
              Cloudflare Email Service asks for <Mono>include:_spf.mx.cloudflare.net</Mono> at the
              apex, DKIM at <Mono>cf-bounce._domainkey</Mono>, an <Mono>MX</Mono> on{' '}
              <Mono>cf-bounce.yourdomain.com</Mono> pointed at <Mono>mx.cloudflare.net</Mono>, and
              DMARC. SES asks for <Mono>include:amazonses.com</Mono> at the apex plus a second SPF
              record and an <Mono>MX</Mono> on the return-path subdomain — a custom MAIL FROM
              domain, which is the thing that makes SPF align. Resend puts both of those on{' '}
              <Mono>send.yourdomain.com</Mono> and issues no DKIM row here at all, because the key
              is theirs and is fetched live from their API. An SMTP relay gets{' '}
              <Mono>v=spf1 a mx include:&lt;your relay host&gt; ~all</Mono> and, uniquely, a DKIM
              row holding <em>our</em> key.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Bounce collection is a record, not a setting.</strong>{' '}
              The <Mono>MX</Mono> row on the return-path subdomain is where DSNs land. Skip it and
              the mail still sends; what disappears is the reply, so a bounce that would have become
              a suppression becomes silence and the address stays on your list. That is the single
              most-skipped row on the list, because it is the one nothing complains about.
            </p>
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
            <Callout variant="warn" title="CHANGING TRANSPORT REWRITES THE ROW SET">
              Rewriting a domain’s records resets that domain to <Mono>not_started</Mono> and clears{' '}
              <Mono>last_verified_at</Mono>. It has to: every row is re-inserted unverified, so a
              domain still claiming <Mono>verified</Mono> would be making a claim about records that
              no longer exist. Expect to publish and re-verify, and expect the old transport’s rows
              to keep resolving until you remove them.
            </Callout>
          </>
        ),
        alignment: (
          <>
            <Lede>
              A message can pass SPF, pass DKIM, and still fail DMARC. This surprises people every
              time, and it is not a bug in anything.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              DMARC does not ask “did SPF pass?”. It asks “did SPF pass{' '}
              <em>for a domain that matches the From header</em>?”. If your From address is{' '}
              <Mono>hello@yourdomain.com</Mono> but your bounce address is{' '}
              <Mono>bounces@sendingvendor.net</Mono>, then SPF passed for the vendor’s domain, and
              from DMARC’s point of view it proved nothing about yours.
            </p>
            <Code>
              {'From:        hello@yourdomain.com      '}
              <Com>{'← what the reader sees'}</Com>
              {'\nReturn-Path: bounces@vendor.net        '}
              <Com>{'← what SPF checked'}</Com>
              {'\nDKIM d=      yourdomain.com           '}
              <Com>{'← aligned: DMARC passes on this'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Relaxed alignment is why a subdomain works.</strong>{' '}
              DMARC’s default alignment mode is relaxed for both checks: the two domains have to
              share an organisational domain rather than match exactly. That is the licence under
              which <Mono>cf-bounce.yourdomain.com</Mono> or <Mono>send.yourdomain.com</Mono> can
              carry the envelope sender and still align with a <Mono>From</Mono> at the apex. Strict
              alignment removes it, which is a deliberate late step rather than a default.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Forwarding is where the two checks diverge.</strong> A
              mailing list or a university address that forwards to Gmail re-sends your message from
              its own server. The connecting IP is now the forwarder’s and the forwarder is not in
              your SPF record, so SPF fails — correctly, by its own rules, on a message that is
              genuinely yours. The DKIM signature travels inside the message and keeps verifying,
              and DMARC needs only one of the two to pass and align. That is the whole argument for
              publishing DKIM when SPF already passes: SPF is the check that fails exactly when a
              message reaches a mailbox that is judging you.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">What breaks a surviving signature.</strong> The signature
              covers the body hash and a fixed list of headers, so a list server that appends a
              footer or rewrites <Mono>Subject</Mono> with a <Mono>[list-name]</Mono> tag
              invalidates it. Nothing on your side prevents that — which is why DKIM failures from
              one mailing list are a fact about the list, and a rise across many receivers is a fact
              about you.
            </p>
            <Callout variant="warn" title="THE SILENT ONE: A MAIL FROM DOMAIN THAT FELL BACK">
              When SES creates the identity, MailySend sets the MAIL FROM domain to your return-path
              subdomain with <Mono>BehaviorOnMxFailure = USE_DEFAULT_VALUE</Mono> — so that sends
              are not rejected while the MX and SPF rows for that subdomain are still propagating.
              The cost is that if those rows never appear, SES quietly keeps using its own domain as
              the envelope sender. Mail flows, SPF passes for <Mono>amazonses.com</Mono>, and SPF
              alignment is silently gone, leaving DKIM as the only thing holding DMARC up. The
              record set is the fix; the symptom is a DMARC report showing SPF pass and SPF align
              fail on every single message.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              This is why the record sets above put the bounce path on a subdomain of <em>your</em>{' '}
              domain rather than the transport’s, and why the SMTP adapter uses the return path as
              the envelope sender rather than the <Mono>From</Mono> address. It is also why DKIM is
              worth publishing even when SPF already passes: DKIM alignment is the one that survives
              a mailing list forwarding your message to somebody’s Gmail.
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">RSA-2048, not Ed25519.</strong> Ed25519 signatures are
              smaller and better, and a meaningful share of receivers still do not verify them. A
              signature nobody checks is not an improvement, so the default is the one that works
              everywhere. The keypair is generated per domain when the domain is added — 2048-bit{' '}
              <Mono>RSASSA-PKCS1-v1_5</Mono> over SHA-256 — and the private half never leaves its
              row: there is no read path for it anywhere in the API.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">What actually goes on the wire.</strong> The signer emits{' '}
              <Mono>a=rsa-sha256</Mono> with <Mono>c=relaxed/relaxed</Mono> canonicalisation, which
              collapses whitespace runs and drops trailing whitespace before hashing. That tolerance
              is what lets a message survive an MTA reformatting a header; simple canonicalisation
              would fail on transformations nobody can see.
            </p>
            <Code>
              {
                'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=yourdomain.com;\n s=ms1; t=1757548800; bh=<base64 body hash>;\n h=from:to:subject:date:message-id:mime-version:content-type;\n b=<base64 signature>'
              }
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The h= list only ever names headers that exist.</strong>{' '}
              The default set is <Mono>from</Mono>, <Mono>to</Mono>, <Mono>cc</Mono>,{' '}
              <Mono>subject</Mono>, <Mono>date</Mono>, <Mono>message-id</Mono>,{' '}
              <Mono>mime-version</Mono>, <Mono>content-type</Mono>,{' '}
              <Mono>content-transfer-encoding</Mono>, <Mono>reply-to</Mono>,{' '}
              <Mono>list-unsubscribe</Mono> and <Mono>list-unsubscribe-post</Mono> — filtered down
              to the ones actually present, because listing a header that is not there is how a
              signature ends up covering a header an attacker can then add. The signature is
              prepended, so the <Mono>Received</Mono> lines each hop adds land above it and disturb
              nothing, and the base64 is folded at 72 columns because an unfolded 400-character
              header is the thing some MTAs truncate.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">A signing failure is not a send failure.</strong> If the
              key will not import, the failure is logged and the unsigned message goes out anyway:
              an unsigned message may land in spam, while a message that does not go out is a bug
              the sender never asked for. The cost is that a broken key looks like a deliverability
              slide rather than an error, so a sudden DKIM-fail rate in your DMARC reports is worth
              reading as a key problem before a content problem.
            </p>
            <Callout variant="warn" title="WHY SOME DKIM ROWS ARE JUST v=DKIM1">
              Several transports mint their own key under their own selector, and neither the key
              nor the selector is knowable before the domain exists there. The builder above shows a
              shape rather than a value, and verification checks that something of the right shape
              resolves. Printing a plausible-looking key you would then publish would produce a
              record promising a signature that never arrives — worse than no record.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Who signs depends on the transport, and it matters.
              </strong>{' '}
              On Cloudflare Email Service the structured payload is what gets sent, not the MIME
              MailySend builds, so Cloudflare signs with its own key at{' '}
              <Mono>cf-bounce._domainkey</Mono>. Resend likewise issues its own key under its own
              selector. SES is handed the same private key MailySend generated, as a BYODKIM signing
              attribute, so the published <Mono>ms1</Mono> record, the selector in the signature and
              the key doing the signing describe one key rather than three unrelated ones. A raw
              relay signs nothing, which is why <Mono>ms1</Mono> is not optional there.
            </p>
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">What the product does is the same lookup.</strong>{' '}
              Verification resolves each row over DNS-over-HTTPS against{' '}
              <Mono>cloudflare-dns.com/dns-query</Mono> and reports one of four words.{' '}
              <Mono>verified</Mono> resolved and agreed. <Mono>pending</Mono> means nothing is
              published at that name yet. <Mono>failed</Mono> is reserved for a record that exists
              and disagrees — the actionable case. <Mono>error</Mono> means the lookup itself did
              not complete, which is no evidence about your zone at all; without that fourth word a
              domain whose every row errored used to roll up to verified.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">How a row is compared depends on the row.</strong> SPF is
              matched on its includes rather than on equality, because merging our include into your
              existing record is the correct thing to do and an exact match would punish it. A DKIM
              or DMARC row whose value only the provider knows is matched on its prefix, so{' '}
              <Mono>v=DKIM1</Mono> passes against a full key and tightening <Mono>p=none</Mono> to{' '}
              <Mono>p=quarantine</Mono> does not turn a verified row red. Everything else is
              compared exactly, after whitespace, a trailing dot and case are normalised away.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The domain rolls up conservatively.</strong> A domain is{' '}
              <Mono>verified</Mono> only when every row is; any <Mono>failed</Mono> row makes it
              failed; everything else is <Mono>pending</Mono>. Note what is not in that rule: rows
              the provider publishes for itself are not excluded, so a Cloudflare domain you have
              not yet onboarded sits at <Mono>pending</Mono> with nothing for you to copy. The
              response’s <Mono>checked</Mono> block — total, resolved, errored — is how you tell
              “still propagating” from “the resolver would not answer”.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The first mistake: two SPF records.</strong> A domain may
              publish exactly one. Two is a permanent error and receivers treat it as no SPF at all
              — so adding a second record for a new sender silently disables the first. Merge the
              includes into one record instead. This is common enough that the setup screen merges
              them for you when two transports both want the apex, keeping the first record’s{' '}
              <Mono>~all</Mono> or <Mono>-all</Mono> qualifier; what it cannot merge is a record
              some other tool added to your zone last year.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The second: more than ten DNS lookups.</strong> SPF
              evaluation is capped at ten mechanisms that require a lookup — <Mono>include</Mono>,{' '}
              <Mono>a</Mono>, <Mono>mx</Mono>, <Mono>ptr</Mono>, <Mono>exists</Mono>,{' '}
              <Mono>redirect</Mono> — counted recursively, so one include that itself includes three
              more spends four of your ten. Exceeding it is a permerror, which most receivers treat
              as no SPF, and it fails in the worst possible way: it works until a vendor adds an
              include inside their own record and your SPF stops passing with nothing having changed
              on your side. Nothing in the verifier counts these for you — it checks that your
              includes are present, not that the tree beneath them is small enough — so count them
              by hand once the apex record passes three or four includes.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The third: a DKIM key your DNS provider split.</strong> A
              TXT record is a sequence of strings of at most 255 bytes each, and a 2048-bit key does
              not fit in one. Well-behaved panels split the value into several quoted strings that a
              resolver concatenates back, and verification does the same, joining the chunks a DoH
              answer arrives in before comparing. Badly behaved panels truncate at 255 characters or
              insert whitespace at the split. The signature then fails at every receiver while the
              DNS panel shows a record that looks right — and because the row is prefix-matched on{' '}
              <Mono>v=DKIM1</Mono>, a truncated key can still verify here. If DKIM alignment fails
              in DMARC reports on a domain whose rows are all green, compare the <Mono>p=</Mono>{' '}
              value from <Mono>dig</Mono>, byte for byte, against the key you published.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The fourth: p=quarantine with no rua.</strong> A policy
              with no reporting address is an instruction to receivers with no feedback to you: you
              have asked mailbox providers to start quarantining mail that fails alignment, and
              arranged to hear nothing about which mail that is — including the invoicing system,
              the helpdesk and the CRM you forgot about. Publish <Mono>p=none</Mono> with a working{' '}
              <Mono>rua</Mono> first, read the reports until you recognise every source in them, and
              tighten after. That is why the default row for every transport is{' '}
              <Mono>v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com</Mono>, and the mailbox it
              names has to be one that can actually receive mail.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The fifth: a registrar that appends your domain.</strong>{' '}
              Many panels take the name you type and append the zone. Entering{' '}
              <Mono>_dmarc.yourdomain.com</Mono> then produces{' '}
              <Mono>_dmarc.yourdomain.com.yourdomain.com</Mono>, which resolves to nothing and looks
              correct in the interface. If <Mono>dig</Mono> disagrees with your DNS panel, believe{' '}
              <Mono>dig</Mono>.
            </p>
            <Callout title="WHEN A ROW SAYS FAILED, READ THE FOUND VALUE">
              A failed row carries the value that actually resolved, verbatim, next to the value
              that was expected. It is a trailing dot more often than not, or a smart-quoted value a
              panel rewrote. Comparing the two strings takes a second and answers the question
              faster than re-reading the record you meant to publish.
            </Callout>
          </>
        ),
      }}
    </GuideLayout>
  )
}
