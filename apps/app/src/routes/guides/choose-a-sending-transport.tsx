import { Callout, ComparisonTable, Metric, MetricGrid } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { TransportChooser } from '~/components/guides/transport-chooser.tsx'
import { VolumeCostPanel } from '~/components/guides/volume-cost-panel.tsx'
import { Contrast, FactTable, Gotcha, Takeaway } from '~/components/marketing/guide-blocks.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Lede, Mono } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'choose-a-sending-transport'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/choose-a-sending-transport')({
  head: () => guideHead(SLUG),
  component: Page,
})

const QUESTIONS: Array<[string, string]> = [
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
]

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
            <Takeaway>
              Fifty recipients everywhere; the message ceiling is the number that differs, and it is
              measured on the rendered message rather than on your attachment.
            </Takeaway>
            <TransportChooser />
            <ComparisonTable
              caption="The four transports, side by side"
              columns={[
                { key: 'cf', label: 'Cloudflare' },
                { key: 'ses', label: 'SES' },
                { key: 'resend', label: 'Resend' },
                { key: 'smtp', label: 'Raw SMTP' },
              ]}
              rows={[
                {
                  label: 'Message ceiling',
                  values: {
                    cf: { kind: 'text', label: '5 MiB', tone: 'negative' },
                    ses: '40 MB',
                    resend: '40 MB',
                    smtp: '25 MiB',
                  },
                },
                {
                  label: 'Header budget',
                  values: {
                    cf: { kind: 'text', label: '16 KiB', tone: 'negative' },
                    ses: '100 KiB',
                    resend: '100 KiB',
                    smtp: '100 KiB',
                  },
                },
                {
                  label: 'Recipients per send',
                  values: { cf: '50', ses: '50', resend: '50', smtp: '50' },
                },
                {
                  label: 'Subject characters',
                  values: { cf: '998', ses: '998', resend: '998', smtp: '998' },
                },
                {
                  label: 'Measured before it leaves',
                  values: { cf: true, ses: true, resend: false, smtp: true },
                },
                {
                  label: 'Delivery events',
                  values: {
                    cf: true,
                    ses: { kind: 'partial', label: 'With an SNS configuration set' },
                    resend: true,
                    smtp: false,
                  },
                },
                {
                  label: 'Published daily quota',
                  values: { cf: false, ses: false, resend: false, smtp: false },
                },
              ]}
            />
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
            <Gotcha title="Crossing the ceiling is permanent, not a failover">
              The send throws a <Mono>permanent</Mono> error naming the measured size and the
              ceiling — for instance,{' '}
              <em>
                message is 6.41 MiB; the Cloudflare transport accepts at most 5 MiB to unverified
                destinations
              </em>
              . Permanent is a classification with teeth: it is not retried, and it does not fail
              over, because only <Mono>transient</Mono> and <Mono>throttled</Mono> errors are
              allowed to reach a second transport. A message too large for this transport does not
              shrink on the way to the next one — so it is dead at the first attempt, with a reason,
              rather than sitting in a queue.
            </Gotcha>
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
              every transport — consistency is worth more here than squeezing a relay. The header
              budget is the one place the four diverge quietly, and it only matters if you are
              stuffing metadata into custom headers.
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
            <Takeaway>
              Two of the four report events with nothing to configure, one reports only if you
              configured it, and one cannot report at all.
            </Takeaway>
            <FactTable
              columns={['Transport', 'What comes back', 'What you have to do']}
              rows={[
                [
                  'Cloudflare Email Service',
                  'Delivery events by default, over a Queues subscription scoped per sending domain.',
                  'Nothing.',
                ],
                ['Resend', 'Delivery events by default, over its webhooks.', 'Nothing.'],
                [
                  'Amazon SES',
                  'Delivery, bounce and complaint notifications — but only with an SNS configuration set. Without one, SES accepts your mail and tells you nothing.',
                  <>
                    Set <Mono>configuration_set</Mono> in the provider form, with a subscription
                    pointed back at this instance.
                  </>,
                ],
                [
                  'Raw SMTP relay',
                  'Nothing. A 250 says the relay accepted responsibility for the message, and the protocol offers no further callback.',
                  'Wire up DSNs to your return path, and publish its MX record.',
                ],
              ]}
              monoFirst={false}
              caption="A missing SNS configuration set is the single most common reason a migration to SES appears to “lose” deliverability data."
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">What a DSN gets you, and what it does not.</strong> A DSN
              is a <Mono>multipart/report; report-type=delivery-status</Mono> message delivered to
              your return path, and its machine-readable part carries the original recipient, an
              action, a status code and a diagnostic string. That is enough to classify a bounce
              properly and suppress the address. It is not enough to tell you a message was
              delivered, because a successful delivery generates no report at all — which is why{' '}
              <Mono>sent</Mono> is the last thing an SMTP transport can say for certain, and why the
              return-path <Mono>MX</Mono> record stops being optional on this transport. No MX, no
              DSN, no bounce data of any kind, and only some DSNs arrive at all.
            </p>
            <Callout variant="warn" title="THE SETTINGS CARD IS OPTIMISTIC ABOUT SES">
              The line under each transport in Settings — <em>reports delivery events</em> or{' '}
              <em>no delivery events</em> — comes from the static provider catalog, which lists SES
              as reporting events. The adapter’s live value is conditional on the configuration set:
              its own <Mono>reportsEvents</Mono> is computed from whether that name is set, and is
              false until it is. So an SES transport with no configuration set will describe itself
              as reporting events on that card while reporting none. The honest answer is in the
              response from testing the provider, which returns the constructed adapter’s{' '}
              <Mono>reports_events</Mono> rather than the catalog’s.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Opens and clicks are the exception.</strong> MailySend
              tracks those itself either way, since they are your own pixel and your own redirect,
              so those two charts look the same on all four transports and the delivery-side charts
              do not. But{' '}
              <a
                href="/guides/open-rates-and-apple-mpp"
                className="text-accent underline underline-offset-4"
              >
                what an open actually means
              </a>{' '}
              is its own conversation.
            </p>
            <Callout title="ONE THING SURVIVES EVERY TRANSPORT: YOUR OWN ID">
              The email id is minted before any provider is called and is stamped into the message
              as both <Mono>Message-ID</Mono> and an <Mono>X-MailySend-Id</Mono> header. The
              provider’s own id is recorded next to it for correlation, never as the identity. That
              is what lets a DSN arriving three days later — through a transport you have since
              stopped using — still be matched back to the send it belongs to.
            </Callout>
          </>
        ),
        'pick-one': (
          <>
            <Lede>Four questions, in the order that eliminates the most options soonest.</Lede>
            <Takeaway>
              Every answer is written out below rather than hidden behind the one you pick.
            </Takeaway>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {QUESTIONS.map(([question, answer], index) => (
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
            <h3 className="mt-7 mb-2 text-[15px] font-semibold text-ink">
              A million messages a month, four ways
            </h3>
            <MetricGrid className="my-5" min={140}>
              <Metric value="$114" label="SES as the transport" size="sm" />
              <Metric value="$363" label="Self-hosted on Workers" size="sm" />
              <Metric value="$600" label="SendGrid" size="sm" />
              <Metric value="$650" label="Resend" size="sm" />
            </MetricGrid>
            <FactTable
              columns={['Path', 'How the price is shaped']}
              rows={[
                [
                  'Self-hosted on Workers',
                  'Workers Paid at $5 a month, the first 3,000 messages included, then $0.35 per further thousand, plus storage, queues and analytics — cents below 20,000 messages, around $1.20 at 100,000, around $9 at a million.',
                ],
                [
                  'A domain pointed at SES',
                  'Swaps the metered send rate for $0.10 per thousand with no included allowance, and keeps the same $5 floor.',
                ],
                [
                  'Resend',
                  'A plan ladder rather than a rate: free to 3,000, $20 to 50,000, $90 to 100,000, then roughly $0.65 per thousand.',
                ],
                ['SendGrid', 'Flattens to $0.60 per thousand over a floor just under $20.'],
              ]}
              monoFirst={false}
              caption="Which is why the fourth question decides nothing at 5,000 and decides everything at 500,000."
            />
            <h3 className="mt-7 mb-2 text-[15px] font-semibold text-ink">
              What a migration actually breaks
            </h3>
            <FactTable
              columns={['What moves', 'What happens']}
              rows={[
                [
                  'The size ceiling',
                  'A message that has been sending fine for a year starts failing permanently the day you move from SES to Cloudflare.',
                ],
                [
                  'The DNS record set',
                  <>
                    A domain bound to a transport gets that transport’s rows and nothing else, and
                    rewriting them resets the domain to <Mono>not_started</Mono> and clears its
                    last-verified timestamp — so there is a publish-and-verify step in the middle of
                    the migration whether you planned one or not.
                  </>,
                ],
                [
                  'The return path',
                  <>
                    From <Mono>cf-bounce.yourdomain.com</Mono> to an SES MAIL FROM subdomain to
                    Resend’s <Mono>send.yourdomain.com</Mono>. Bounce collection has to be
                    re-established rather than inherited.
                  </>,
                ],
                [
                  'The signature',
                  <>
                    Cloudflare and Resend sign with their own keys under their own selectors, SES
                    signs with the key MailySend generated, and a raw relay signs with nothing at
                    all — so MailySend’s own <Mono>ms1</Mono> record has to be published and correct
                    before an SMTP cutover, not after.
                  </>,
                ],
              ]}
              monoFirst={false}
              caption="In roughly the order they surprise people."
            />
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
              Failover is genuinely useful and is routinely expected to do something it cannot.
            </Lede>
            <Takeaway>
              It covers a transport being unreachable. It does not cover a transport refusing you.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'SES is returning 5xx because of an outage',
                  tone: 'good',
                  points: ['Moving to a second transport is exactly right', 'The messages go out'],
                },
                {
                  label: 'SES is deferring you because your complaint rate rose',
                  tone: 'bad',
                  points: [
                    'Moving to a second transport introduces a reputation problem to a sending identity that had nothing wrong with it',
                    'You now have two damaged reputations and the same underlying list',
                  ],
                },
              ]}
            />
            <Callout variant="warn" title="THE RULE">
              Fail over on transport errors. Do not fail over on rejections. A 4xx or 5xx that names
              policy, reputation, or content is a message about you, and the correct response is to
              stop sending, not to send from somewhere else.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The router enforces that rule rather than trusting it.
              </strong>{' '}
              Every send error is classified into one of six kinds, and only two of them are allowed
              to reach a second transport.
            </p>
            <FactTable
              columns={['Classification', 'What the router does', 'Why']}
              rows={[
                [
                  'permanent',
                  'Stop. No retry, no failover.',
                  'A message that will never be accepted as written is not accepted anywhere else either.',
                ],
                [
                  'transient',
                  'Retry here, then a second transport.',
                  'One of the two kinds that may fail over.',
                ],
                ['throttled', 'Wait the indicated delay, then failover is fine.', 'The other one.'],
                ['auth', 'Stop and alert.', 'Credentials do not improve with a retry.'],
                ['suppressed', 'Stop.', 'Mirrored inward as a suppression of our own.'],
                [
                  'unknown',
                  'Retry here at most. Never a second transport.',
                  'The message may already be on the wire.',
                ],
              ]}
            />
            <Gotcha title="Unknown is the case that most feels like it should fail over">
              An <Mono>unknown</Mono> outcome is a send whose result we never learned: a network
              failure mid-request, a connection that died after <Mono>DATA</Mono>, a timeout.
              Failing over would deliver it twice. The same reasoning makes provider selection
              deterministic — <Mono>hash(email_id)</Mono> over the weight space rather than a random
              pick — so a retry of the same message always lands on the same transport it may
              already have reached.
            </Gotcha>
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
