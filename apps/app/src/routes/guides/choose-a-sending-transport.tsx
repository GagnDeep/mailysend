import { Callout } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { TransportChooser } from '~/components/guides/transport-chooser.tsx'
import { VolumeCostPanel } from '~/components/guides/volume-cost-panel.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Lede, Mono } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'choose-a-sending-transport'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/choose-a-sending-transport')({
  head: () => guideHead(SLUG),
  component: Page,
})

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You have picked a transport for reasons you can state: a message ceiling that fits what
          you actually send, an event story you can live with, and a price you have seen at your
          volume. The two facts most likely to bite later are that the size ceiling is per transport
          — a message that sends today can fail after a switch — and that SMTP reports no events at
          all.
        </p>
      }
    >
      {{
        'the-numbers': (
          <>
            <Lede>
              These are not marketing numbers. They are the <Mono>*_LIMITS</Mono> constants the send
              path enforces, imported into this page, so what you read here is what your instance
              will refuse.
            </Lede>
            <TransportChooser />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The ceiling is measured on the rendered message.</strong>{' '}
              Not on your attachment, and not on your HTML. Three of the four adapters build the
              complete RFC 5322 message, sign it, and measure the bytes before anything touches the
              network. Attachments are base64 in a MIME part, which costs about a third on top of
              their raw size, and text parts are quoted-printable, which costs a little more again
              on non-ASCII content. A 4 MB PDF is comfortably over Cloudflare Email Service’s 5 MiB
              ceiling by the time it is a message. If you are anywhere near a limit, the number to
              compare against is roughly four-thirds of your attachment bytes, plus the body.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">What crossing it actually does.</strong> The send throws
              a <Mono>permanent</Mono> error naming the measured size and the ceiling — for
              instance,{' '}
              <em>
                message is 6.41 MiB; the Cloudflare transport accepts at most 5 MiB to unverified
                destinations
              </em>
              . Permanent is a classification with teeth: it is not retried, and it does not fail
              over, because only <Mono>transient</Mono> and <Mono>throttled</Mono> errors are
              allowed to reach a second transport. That is the correct behaviour — a message too
              large for this transport does not shrink on the way to the next one — but it means the
              message is dead at the first attempt, with a reason, rather than sitting in a queue.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Resend is the exception, and it is worth knowing.
              </strong>{' '}
              The Resend adapter posts structured JSON rather than raw MIME, so it never renders the
              message locally and never measures it. Its 40 MB entry is what Resend accepts, not
              something checked before the request goes out; an oversized message comes back as an
              HTTP error and is classified from the status code — anything that is not 429, 401, 403
              or a 5xx becomes <Mono>permanent</Mono>. Same outcome, one network round trip later,
              and the error text is Resend’s rather than ours.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Recipients are 50 everywhere, deliberately.</strong> That
              is 50 across <Mono>to</Mono>, <Mono>cc</Mono> and <Mono>bcc</Mono> combined, counted
              before the send. Most relays would accept far more, but a large <Mono>RCPT</Mono> list
              is a spam signal at many receivers and the API contract promises the same number on
              every transport — consistency is worth more here than squeezing a relay. Header
              budgets are the one other place the four diverge quietly: 16 KiB on Cloudflare against
              100 KiB on the rest, which only matters if you are stuffing metadata into custom
              headers.
            </p>
            <Callout title="NOBODY PUBLISHES A DAILY QUOTA">
              All four transports carry <Mono>dailyQuota: null</Mono>, because none of them
              publishes a number worth hard-coding. Cloudflare’s ramps with reputation and is not
              documented; the sending-domain actor learns the real ceiling from rejections instead
              of inventing one. If you need a guaranteed rate on day one, that is a conversation
              with SES about production access, not a setting here.
            </Callout>
          </>
        ),
        events: (
          <>
            <Lede>
              The size ceilings are the difference people notice. Event reporting is the difference
              that costs them a week, three months in, when someone asks why the bounce chart is
              empty.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Raw SMTP reports nothing.</strong> Not by omission —
              there is nothing to report. A <Mono>250</Mono> from a relay says the relay accepted
              responsibility for the message, and the protocol offers no further callback. Bounces
              arrive afterwards as DSNs, which is a separate inbound path you have to actually wire
              up, and only some of them arrive at all.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">What a DSN gets you, and what it does not.</strong> A DSN
              is a <Mono>multipart/report; report-type=delivery-status</Mono> message delivered to
              your return path, and its machine-readable part carries the original recipient, an
              action, a status code and a diagnostic string. That is enough to classify a bounce
              properly and suppress the address. It is not enough to tell you a message was
              delivered, because a successful delivery generates no report at all — which is why{' '}
              <Mono>sent</Mono> is the last thing an SMTP transport can say for certain, and why the
              return-path <Mono>MX</Mono> record stops being optional on this transport. No MX, no
              DSN, no bounce data of any kind.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">SES reports only if you tell it to.</strong> Delivery,
              bounce and complaint notifications need an SNS configuration set. Without one, SES
              accepts your mail and tells you nothing — and this is the single most common reason a
              migration to SES appears to “lose” deliverability data. In the provider form it is the{' '}
              <Mono>configuration_set</Mono> field, marked optional, with a subscription pointed
              back at this instance; the adapter’s own <Mono>reportsEvents</Mono> is computed from
              whether that name is set, and is false until it is.
            </p>
            <Callout variant="warn" title="THE SETTINGS CARD IS OPTIMISTIC ABOUT SES">
              The line under each transport in Settings — <em>reports delivery events</em> or{' '}
              <em>no delivery events</em> — comes from the static provider catalog, which lists SES
              as reporting events. The adapter’s live value is conditional on the configuration set.
              So an SES transport with no configuration set will describe itself as reporting events
              on that card while reporting none. The honest answer is in the response from testing
              the provider, which returns the constructed adapter’s <Mono>reports_events</Mono>{' '}
              rather than the catalog’s.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Cloudflare Email Service and Resend both report events by default — Cloudflare over a
              Queues subscription scoped per sending domain, Resend over its webhooks. Opens and
              clicks are tracked by MailySend itself either way, since those are your own pixel and
              your own redirect, so those two charts look the same on all four transports and the
              delivery-side charts do not. But{' '}
              <a
                href="/guides/open-rates-and-apple-mpp"
                className="text-accent underline underline-offset-4"
              >
                what an open actually means
              </a>{' '}
              is its own conversation.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">One thing survives every transport: your own id.</strong>{' '}
              The email id is minted before any provider is called and is stamped into the message
              as both <Mono>Message-ID</Mono> and an <Mono>X-MailySend-Id</Mono> header. The
              provider’s own id is recorded next to it for correlation, never as the identity. That
              is what lets a DSN arriving three days later — through a transport you have since
              stopped using — still be matched back to the send it belongs to.
            </p>
          </>
        ),
        'pick-one': (
          <>
            <Lede>
              Four questions, in the order that eliminates the most options soonest. Every answer is
              written out below rather than hidden behind the one you pick.
            </Lede>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {[
                [
                  'Are you on Cloudflare at all?',
                  'If not, Cloudflare Email Service is unavailable and the field is SES, Resend, SendGrid, Postmark or your own relay. If yes, it is the default for a reason: no third-party account, no extra credential, and the events come back on a Queues subscription. The domain has to already be on the same Cloudflare account, and onboarding happens in Cloudflare’s dashboard rather than here — it writes every DNS record itself, so there is nothing to copy.',
                ],
                [
                  'Do you send attachments over 5 MiB?',
                  'Then Cloudflare Email Service is out for those messages — it caps at 5 MiB, and 25 MiB only to verified destinations. SES and Resend accept 40 MB; a raw relay is capped at 25 MiB here whatever your relay would take. Route the heavy sending domain elsewhere rather than capping your whole product, and remember the ceiling is measured after base64.',
                ],
                [
                  'Do you need bounce and complaint data?',
                  'Everyone does, eventually. That rules out raw SMTP as a primary transport and means configuring SES properly rather than minimally: an SNS configuration set at setup time, not after the first campaign. On SES it also means asking AWS for production access — a new account is in the sandbox, which delivers only to addresses you have verified, at 200 messages a day, and looks exactly like a broken instance until you know that.',
                ],
                [
                  'What does it cost at your volume?',
                  'Below a few thousand a month this question does not decide anything: the fixed floor dominates and a vendor free tier is genuinely cheaper. Above a hundred thousand it decides everything, and the answer is usually SES by a wide margin. The panel below runs the pricing page’s own functions rather than restating them.',
                ],
              ].map(([question, answer], index) => (
                <li key={question} className="rounded-tile border border-line bg-card p-4">
                  <div className="flex items-baseline gap-2.5">
                    <span className="font-mono text-[11.5px] text-muted-2">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[15px] font-semibold text-ink">{question}</span>
                  </div>
                  <p className="mt-1.5 mb-0 text-[14.5px] leading-[1.6] text-muted">{answer}</p>
                </li>
              ))}
            </ol>
            <VolumeCostPanel />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">What the curve is made of.</strong> A MailySend
              deployment on your own Cloudflare account is the Workers Paid plan at $5 a month, the
              first 3,000 messages included, then $0.35 per further thousand, plus storage, queues
              and analytics — cents below 20,000 messages, around $1.20 at 100,000, around $9 at a
              million. Pointing a domain at SES swaps the metered send rate for $0.10 per thousand
              with no included allowance and keeps the same $5 floor. Resend is a plan ladder rather
              than a rate: free to 3,000, $20 to 50,000, $90 to 100,000, then roughly $0.65 per
              thousand. SendGrid flattens to $0.60 per thousand over a floor just under $20. At a
              million messages a month that is roughly $363 self-hosted, $114 with SES as the
              transport, $650 on Resend and $600 on SendGrid — which is why the fourth question
              decides nothing at 5,000 and decides everything at 500,000.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">What a migration actually breaks.</strong> Four things,
              in roughly the order they surprise people. The size ceiling moves, so a message that
              has been sending fine for a year starts failing permanently the day you move from SES
              to Cloudflare. The DNS record set is rewritten — a domain bound to a transport gets
              that transport’s rows and nothing else — and rewriting the rows resets the domain to{' '}
              <Mono>not_started</Mono> and clears its last-verified timestamp, so there is a
              publish-and-verify step in the middle of the migration whether you planned one or not.
              The return path changes shape, from <Mono>cf-bounce.yourdomain.com</Mono> to an SES
              MAIL FROM subdomain to Resend’s <Mono>send.yourdomain.com</Mono>, so bounce collection
              has to be re-established rather than inherited. And the signature changes hands:
              Cloudflare and Resend sign with their own keys under their own selectors, SES signs
              with the key MailySend generated, and a raw relay signs with nothing at all — so
              MailySend’s own <Mono>ms1</Mono> record has to be published and correct before an SMTP
              cutover, not after.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The way to do it is one domain at a time.</strong>{' '}
              Routing is per sending domain, so a migration does not have to be a cutover: publish
              the new transport’s records, verify them, move one low-volume domain, watch its
              delivery and bounce rates for a few sends, then move the rest. Moving everything at
              once means every failure mode above arrives on the same afternoon, and you will not
              know which one you are looking at.
            </p>
          </>
        ),
        failover: (
          <>
            <Lede>
              Failover is genuinely useful and is routinely expected to do something it cannot. It
              covers a transport being unreachable. It does not cover a transport refusing you.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              If SES is returning 5xx because of an outage, moving to a second transport is exactly
              right and the messages go out. If SES is deferring you because your complaint rate
              rose overnight, moving to a second transport takes a reputation problem and introduces
              it to a second sending identity that had nothing wrong with it. You now have two
              damaged reputations and the same underlying list.
            </p>
            <Callout variant="warn" title="THE RULE">
              Fail over on transport errors. Do not fail over on rejections. A 4xx or 5xx that names
              policy, reputation, or content is a message about you, and the correct response is to
              stop sending, not to send from somewhere else.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The router enforces that rule rather than trusting it.
              </strong>{' '}
              Every send error is classified into one of six kinds, and only two of them —{' '}
              <Mono>transient</Mono> and <Mono>throttled</Mono> — are allowed to reach a second
              transport. <Mono>permanent</Mono> stops immediately, because a message that will never
              be accepted as written is not accepted anywhere else either. <Mono>auth</Mono> stops
              because credentials do not improve with a retry. <Mono>suppressed</Mono> stops and is
              mirrored inward as a suppression of our own.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The sixth kind exists solely to prevent double delivery.
              </strong>{' '}
              An <Mono>unknown</Mono> outcome is a send whose result we never learned: a network
              failure mid-request, a connection that died after <Mono>DATA</Mono>, a timeout. The
              message may already be on the wire. Failing over would deliver it twice, so{' '}
              <Mono>unknown</Mono> never fails over, by design, even though it is the case that most
              feels like it should. The same reasoning makes provider selection deterministic —{' '}
              <Mono>hash(email_id)</Mono> over the weight space rather than a random pick — so a
              retry of the same message always lands on the same transport it may already have
              reached.
            </p>
            <Code>
              {
                'permanent   → stop. No retry, no failover.\ntransient   → retry here, then a second transport.\nthrottled   → wait the indicated delay, then failover is fine.\nauth        → stop and alert. A retry cannot help.\nsuppressed  → stop. Mirror the suppression inward.\nunknown     → retry here at most. NEVER a second transport.'
              }
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Two attempts, not five.</strong> A routed send tries at
              most two transports by default. A third rarely helps, and every additional attempt
              widens the window in which a duplicate could occur. Pinning a transport on the send
              call disables failover entirely, which is the point of pinning — silently using
              another would violate an explicit instruction. Underneath, a per-transport circuit
              breaker opens after five consecutive failures and half-opens after thirty seconds,
              letting one request through to find out whether the transport recovered. Its job is
              not to protect the provider; it is to stop the whole queue’s retry budget being spent
              on a transport that is currently down while the healthy one sits idle.
            </p>
            <Callout title="FAILOVER NEEDS DNS YOU PUBLISHED IN ADVANCE">
              A second transport is only useful if its records are already in your zone. That is why
              a domain with no transport bound to it shows the union of every configured provider’s
              records, with the apex SPF includes merged into one legal record. Discovering at
              failover time that the fallback transport was never authorised for your domain is
              discovering it too late.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The other thing worth knowing: routing is per sending domain. Keeping marketing volume
              on a different domain from transactional mail — and therefore, if you want, on a
              different transport — is the standard way to stop a campaign’s complaint rate from
              affecting whether password resets arrive.
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
