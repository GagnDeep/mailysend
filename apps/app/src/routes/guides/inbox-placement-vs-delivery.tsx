import { Callout, StepCard, Terminal } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Lede, Mono } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'inbox-placement-vs-delivery'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/inbox-placement-vs-delivery')({
  head: () => guideHead(SLUG),
  component: Page,
})

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You can now say precisely what your delivery numbers are evidence of — acceptance by the
          receiving MTA — and what they are silent about, which is everything that happens to the
          message afterwards. Real placement has two sources, seed sends and provider postmaster
          feeds, and neither of them is your event stream. The thing most likely to catch you out is
          the shape of the failure: placement problems arrive with the delivery chart at 99% and
          nothing on any dashboard turning red.
        </p>
      }
    >
      {{
        'what-250-means': (
          <>
            <Lede>
              A <Mono>250</Mono> is a receipt for a handover. The receiving MTA has read your
              message off the wire and accepted responsibility for what happens to it next. That is
              a real and useful fact — it means authentication passed the connection-time checks,
              the recipient was not rejected outright, and you are not being blocked at the door —
              but it is a statement about a transfer, not about an inbox.
            </Lede>
            <Terminal
              caption="SMTP, the last thing you get to see"
              lines={[
                { kind: 'command', text: 'MAIL FROM:<bounces@yourdomain.com>' },
                { kind: 'success', text: '250 2.1.0 Ok' },
                { kind: 'command', text: 'RCPT TO:<reader@gmail.com>' },
                { kind: 'success', text: '250 2.1.5 Ok' },
                { kind: 'command', text: 'DATA' },
                { kind: 'output', text: '354 End data with <CR><LF>.<CR><LF>' },
                { kind: 'command', text: '. ' },
                { kind: 'success', text: '250 2.0.0 Ok: queued as 4Xk9m2' },
                { kind: 'comment', text: '# connection closes. nothing further is ever reported.' },
              ]}
            />
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              Read that last line carefully: <em>queued</em>. The receiver has taken the message
              into its own queue, and its own filtering runs after that, on its own schedule, with
              information you do not have — the recipient's history with your domain, how the rest
              of your traffic behaved this hour, what other people did with your last campaign. The
              connection is already closed by then. There is no second callback in the protocol.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                [
                  'Inbox',
                  'The message is in the primary folder, or in a tab. This is the outcome you wanted and the one you cannot observe.',
                ],
                [
                  'Spam',
                  'Delivered, filed, and effectively invisible. Your delivery event for this is indistinguishable from the inbox case.',
                ],
                [
                  'Silently discarded',
                  'Accepted and then dropped with no DSN. Large receivers do this to mail they are confident about. You get a 250 and nothing arrives anywhere.',
                ],
              ].map(([label, body]) => (
                <div key={label} className="rounded-tile border border-line bg-card p-4">
                  <div className="font-mono text-[13px] font-bold text-accent">{label}</div>
                  <p className="mt-1.5 m-0 text-[14.5px] leading-[1.6] text-muted">{body}</p>
                </div>
              ))}
            </div>
            <Callout variant="warn" title="ALL THREE OF THOSE PRODUCE THE SAME DELIVERY EVENT">
              This is not a limitation of this product's instrumentation. It is a property of SMTP.
              Any tool showing you an “inbox rate” computed from a delivery stream is showing you a
              number derived from data that does not contain the answer — which is worse than
              showing nothing, because you will act on it.
            </Callout>
          </>
        ),
        'where-placement-comes-from': (
          <>
            <Lede>
              There are exactly two ways to learn where your mail landed, and both of them involve
              somebody on the receiving side telling you. Nothing on the sending side can work it
              out, no matter how much event data it collects, because the fact is not present in
              that data at any resolution.
            </Lede>
            <div className="flex flex-col gap-5">
              <StepCard
                step={1}
                title="Seed sends"
                variant="rule"
                description="Mailboxes you control, at the providers your audience actually uses, included in the real campaign. Somebody or something then looks at each one and records the folder. That observation is direct evidence: it is where this message landed for this account."
              />
              <StepCard
                step={2}
                title="Provider postmaster feeds"
                variant="rule"
                description="Google Postmaster Tools and Microsoft SNDS. The receiver aggregates across your whole volume to them and reports back — spam rate, domain and IP reputation, authentication results, delivery errors. This is the only view you get that covers your actual recipients rather than a sample."
              />
            </div>
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              The two have opposite weaknesses, which is why serious senders run both. A seed list
              is a direct observation of a handful of accounts that are unlike your real recipients
              in the way that matters most: nobody ever opens them, replies to them, or files them,
              so they have no engagement history to be judged on. Postmaster feeds cover your real
              traffic and are aggregated, delayed, thresholded — Google shows you nothing until your
              volume to Gmail is large enough — and never resolve to an individual message.
            </p>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="p-3 font-mono text-[12px] font-bold">SOURCE</th>
                    <th className="p-3 font-mono text-[12px] font-bold">
                      WHAT IT ACTUALLY TELLS YOU
                    </th>
                    <th className="p-3 font-mono text-[12px] font-bold">WHAT IT CANNOT</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [
                      'Seed sends',
                      'The folder this exact message landed in, for these accounts, on this send.',
                      'Anything about recipients with real engagement history — which is all of them.',
                    ],
                    [
                      'Google Postmaster Tools',
                      'Spam-complaint rate, domain and IP reputation, authentication pass rates, delivery errors, across your Gmail volume.',
                      'Per-message or per-recipient placement. And nothing at all below its volume threshold.',
                    ],
                    [
                      'Microsoft SNDS',
                      'Complaint and trap-hit data for IPs you send from, plus a filter verdict summary.',
                      'Anything about Outlook.com consumer placement for a specific campaign.',
                    ],
                    [
                      'Your delivery events',
                      'That the receiving MTA accepted the message.',
                      'Folder. Filtering. Whether it was silently discarded. Any of it, ever.',
                    ],
                  ].map(([source, tells, cannot]) => (
                    <tr key={source} className="border-line border-t">
                      <td className="p-3 align-top font-mono text-[12.5px] text-ink">{source}</td>
                      <td className="p-3 align-top text-muted">{tells}</td>
                      <td className="p-3 align-top text-muted">{cannot}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout title="SET UP POSTMASTER TOOLS BEFORE YOU NEED IT">
              Both feeds are historical: they show you the last N days, so registering the day a
              problem starts gives you a chart with no context. If any meaningful share of your list
              is on Gmail, verify the domain in Postmaster Tools now, while everything is fine, so
              that the day something changes you can see what it changed <em>from</em>.
            </Callout>
          </>
        ),
        estimates: (
          <>
            <Lede>
              Between “accepted” and “inboxed” there is a gap, and it is legitimate to model it —
              provided the model is labelled as a model everywhere it appears, and never hardens
              into a number people quote as a measurement. That labelling rule is not decoration; it
              is the entire difference between a useful estimate and a lie with a percentage sign.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              An estimate is built from the signals you do have, all of which correlate with
              placement without determining it: authentication results and DMARC alignment, your
              complaint rate where a feedback loop reports one, bounce mix by class, engagement
              trends per receiving domain, and the shape of your sending — sudden volume changes,
              new domains, new content patterns. A model over those inputs can be genuinely
              informative. It still is not an observation.
            </p>
            <Code>
              {'delivered           = 49,812     '}
              <Com>{'← measured: the MTA said 250'}</Com>
              {'\nestimated placement ≈ 91%        '}
              <Com>{'← modelled: never call this "inbox rate"'}</Com>
              {'\nseed observation    = 8 / 10     '}
              <Com>{'← measured, tiny sample, direct evidence'}</Com>
              {'\ngmail spam rate     = 0.08%      '}
              <Com>{'← measured by the receiver, aggregated'}</Com>
            </Code>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              Three rules keep an estimate honest, and they are worth applying to any vendor's
              placement chart as a test of whether theirs is:
            </p>
            <div className="mt-4 flex flex-col gap-5">
              <StepCard
                step={1}
                title="It says what it is, at the point of use"
                variant="rule"
                description="Not in a tooltip, not in a footnote in the docs — on the number itself, every time it renders. A figure labelled once and then referenced bare in an export becomes a measurement by the time it reaches a slide."
              />
              <StepCard
                step={2}
                title="It carries its uncertainty"
                variant="rule"
                description="A single percentage implies a precision the inputs cannot support. A range, or a direction plus a confidence, is honest about a model built on correlates. If a tool cannot state its error bars, it has not measured its own accuracy either."
              />
              <StepCard
                step={3}
                title="It is never the input to a decision that a real source could inform"
                variant="rule"
                description="Use the estimate to notice something and to prioritise. Use seeds and postmaster feeds to confirm it before you change your sending, your list, or your content on the strength of it."
              />
            </div>
            <Callout variant="warn" title="THE FAILURE MODE IS SOCIAL, NOT TECHNICAL">
              Estimates do not mislead because the maths is bad. They mislead because a number on a
              dashboard gets screenshotted, pasted into a report, and repeated by somebody who never
              saw the label — and by the third retelling “our estimated placement model suggests
              around 91%” has become “we inbox at 91%”. That is why the label lives on the number
              rather than near it.
            </Callout>
          </>
        ),
        'what-to-do': (
          <>
            <Lede>
              The case worth preparing for is the one where delivery stays at 99%, no chart turns
              red, no bounce class spikes — and clicks are down forty percent. Nothing is broken;
              you are being filtered. Here is the order to investigate in, cheapest and most likely
              first.
            </Lede>
            <div className="mt-4 flex flex-col gap-5">
              <StepCard
                step={1}
                title="Confirm it is placement and not measurement"
                variant="rule"
                description="Opens are a bad witness here — MPP and scanners move them for reasons unrelated to placement. Look at clicks, replies and downstream conversion, and check whether the drop is uniform or concentrated in one receiving domain. A drop confined to Gmail is a placement story; a drop across every provider at once is usually a link, a template, or a tracking change."
              />
              <StepCard
                step={2}
                title="Check authentication, at the message level"
                variant="rule"
                description="Send yourself the real campaign and read the received headers: SPF, DKIM and DMARC results, and whether the passing one aligns with the From domain. An expired DKIM key, a rotated selector, or a new subdomain sending without alignment produces exactly this signature — accepted everywhere, filed as spam everywhere."
              />
              <StepCard
                step={3}
                title="Read the postmaster feeds"
                variant="rule"
                description="Google Postmaster Tools and SNDS are the only sources that can tell you the receiver’s own verdict. Look at complaint rate first: it is the single number most likely to have moved, and the threshold at which filtering changes is far lower than people expect."
              />
              <StepCard
                step={4}
                title="Look at what changed on your side"
                variant="rule"
                description="Placement rarely degrades on its own. Something shipped: a new sending domain or subdomain, a volume step change, a list import, a new link-shortening domain, a template with a different image-to-text ratio, a re-engagement campaign to addresses that have ignored you for two years. Line the drop up against your own changelog before theorising about the receiver."
              />
              <StepCard
                step={5}
                title="Seed the next send"
                variant="rule"
                description="Add controlled mailboxes at the affected provider to the actual campaign and observe the folder directly. This is the only step that converts a hypothesis into an observation, which is why it comes after the cheap checks and before any change of strategy."
              />
              <StepCard
                step={6}
                title="Change one thing"
                variant="rule"
                description="Reputation moves slowly and every remedy takes days to show. Changing content, volume and list hygiene in the same week means whatever happens next teaches you nothing. Pick the most likely single cause, change it, and let the next two sends answer."
              />
            </div>
            <p className="mt-6 text-[15.5px] leading-[1.7] text-muted">
              Two things this product can help with directly along that path. Bounce mix is a
              genuine leading indicator — a rise in <Mono>hard_blocked</Mono> is the receiver
              telling you something before filtering gets quieter about it, and{' '}
              <a href="/guides/read-a-bounce" className="text-accent underline underline-offset-4">
                read a bounce
              </a>{' '}
              covers how to tell that apart from ordinary list decay. And the segment DSL is how you
              stop sending to the addresses that are causing the problem, which is usually the
              fastest real fix available:{' '}
              <a
                href="/guides/segments-query-language"
                className="text-accent underline underline-offset-4"
              >
                the segments query language
              </a>{' '}
              can express “subscribed and opened in the last 90 days” in one line.
            </p>
            <Callout title="THE HONEST VERSION OF THE BAD NEWS">
              You may do all six steps correctly and still not learn definitively where your mail
              landed for most recipients, because that fact is only ever held by the receiver. What
              you can do is make the inputs they judge you on unambiguously good — aligned
              authentication, a clean list, a complaint rate near zero, engagement that trends up —
              and then read their own verdict in the postmaster feed. That is the whole available
              loop, and any product claiming a tighter one is selling you a model.
            </Callout>
          </>
        ),
      }}
    </GuideLayout>
  )
}
