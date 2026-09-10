import { Callout } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { VolumeCostPanel } from '~/components/guides/volume-cost-panel.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Lede, Mono } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'what-100k-emails-costs'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/what-100k-emails-costs')({
  head: () => guideHead(SLUG),
  component: Page,
})

/** Product, what it is doing for you, the rate, and whether it matters at 100k. */
const LINES: Array<[string, string, string, string]> = [
  [
    'Workers',
    'The API, the dashboard, template rendering, webhook fan-out',
    '$5/mo, 10M requests included',
    'The floor',
  ],
  [
    'Email Service',
    'Outbound delivery, DKIM signing',
    '3,000/mo included, then $0.35/1k',
    'The bill',
  ],
  ['Email Routing', 'Inbound mail into the Worker', 'Free', 'Free'],
  ['Queues', 'Retries, throttling, dead letters', '$0.40 per million operations', 'Cents'],
  [
    'Durable Objects',
    'Per-domain sender state, broadcast progress',
    'Included in Workers Paid',
    'Cents',
  ],
  ['D1', 'Contacts, messages, templates, keys', '25B reads included, $0.75/M writes over', 'Cents'],
  ['KV', 'Suppression list and key cache, read on every send', 'Included', 'Cents'],
  ['R2', 'Attachments and raw inbound mail', '$0.015 per GB-month, no egress fees', 'Cents'],
  ['Workflows', 'Automations and drips', 'Billed as Workers requests and CPU', 'Cents'],
  ['Analytics Engine', 'The event stream behind every chart', 'Included with Workers Paid', 'Free'],
]

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          At a hundred thousand messages a month you are looking at roughly forty dollars of
          infrastructure, of which thirty-four is the messages themselves and five is a floor you
          pay whether you send anything or not. The number that should change your decision is not
          the total but the shape: that floor is what makes a vendor's free tier genuinely cheaper
          below a few thousand messages, and no amount of arithmetic about the marginal rate changes
          it.
        </p>
      }
    >
      {{
        calculator: (
          <>
            <Lede>
              Put your own volume in. These are the same functions the pricing page runs — imported
              rather than restated, because a guide quoting its own hard-coded "$X at 100k" is a
              second, unversioned copy of the pricing model, and the first time the real one moves
              the guide starts lying.
            </Lede>
            <VolumeCostPanel />
            <p className="mt-6 text-[15.5px] leading-[1.7] text-muted">
              Two things the panel deliberately does not do. It does not price your time — that is a
              real cost and it gets its own treatment in the last section rather than a made-up
              hourly rate here. And it does not pretend to be a quote: the Cloudflare rates it uses
              are published rates, your bill is between you and your provider, and if the numbers
              have moved since this page was written then your invoice is right and this page is
              stale.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The self-hosted figure is an infrastructure bill, not a plan price. There is no
              upgrade tier here to buy, no seat count, and no feature held back for a higher band —
              the software is MIT licensed and the whole of it is what you deployed. That is why the
              comparison below is against infrastructure rather than against plans.
            </p>
          </>
        ),
        'line-items': (
          <>
            <Lede>
              Ten products, and at a hundred thousand messages only two of them are worth thinking
              about. Knowing which eight are rounding errors is more useful than knowing the exact
              total, because it tells you which optimisations are real and which are hobbies.
            </Lede>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Product</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">What it does</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Rate</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">At 100k</th>
                  </tr>
                </thead>
                <tbody>
                  {LINES.map(([product, role, rate, weight]) => (
                    <tr key={product} className="border-line border-t">
                      <td className="px-4 py-2 font-semibold text-ink">{product}</td>
                      <td className="px-4 py-2 text-muted">{role}</td>
                      <td className="px-4 py-2 font-mono text-[12px] text-muted">{rate}</td>
                      <td className="px-4 py-2 text-muted-2">{weight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              Worked out at a hundred thousand messages a month, it is three lines and one of them
              is the answer:
            </p>
            <Code>
              {
                'Workers Paid                       $5.00\n97,000 messages @ $0.35/1k        $33.95   '
              }
              <Com>{'← 3,000 included'}</Com>
              {'\nD1 writes, R2, Queues, everything  ≈$1.20\n'}
              {'                                  ───────\n'}
              {'                                    ≈$40'}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Eighty-five per cent of that bill is the messages. Which means the only optimisation
              with real money in it is the transport — and that is a{' '}
              <a
                href="/guides/choose-a-sending-transport"
                className="text-accent underline underline-offset-4"
              >
                transport decision
              </a>
              , not a code one. Routing the same deployment through Amazon SES at its published
              $0.10 per thousand takes that $33.95 down to about $10, at the cost of an AWS account,
              an SNS configuration set to get delivery events back at all, and a second bill to
              reconcile. At a hundred thousand messages that trade is roughly twenty-five dollars a
              month, which is not obviously worth the extra moving part; at a million it is more
              than two hundred, and the answer changes.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Why the other eight stay small.</strong> Not by accident:
              the architecture was shaped by these rates. Events land in Analytics Engine, which is
              included, rather than as one D1 row per open — a row per event is the line item that
              gets expensive fastest, and D1 holds only state you actually query. The suppression
              list is read from KV on every send because it must be, and KV reads at this volume are
              cents. R2 has no egress fees, so serving an attachment costs storage and nothing else.
              A broadcast is deliberately never counted before it is sent, which sounds like a
              product decision and is also a billing one: a counting pass is a full scan that gets
              slower exactly as it gets more expensive.
            </p>
            <Callout title="THE LINE ITEM THAT SURPRISES PEOPLE">
              Inbound is free. Email Routing costs nothing, so receiving mail — parsing it,
              threading it, storing it — is Workers requests and R2 storage, both of which are
              already in the cents column. If you are paying a vendor separately for inbound today,
              that whole line disappears rather than shrinking.
            </Callout>
          </>
        ),
        'the-shape': (
          <>
            <Lede>
              The cost is a fixed floor plus a genuinely small marginal rate, and almost everything
              confusing about pricing comparisons comes from people arguing about one of those two
              numbers while standing at different volumes.
            </Lede>
            <Code>
              {'monthly ≈ $5  +  (messages − 3,000) × $0.00035  +  small change\n         '}
              <Com>{'└ floor'}</Com>
              {'          '}
              <Com>{'└ marginal'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Thirty-five hundredths of a cent per message is small enough that the interesting
              quantity is not the marginal rate at all — it is what the floor amortises to. Watch
              the effective price per thousand as volume climbs:
            </p>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Volume / month</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Total</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Effective per 1,000</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">What dominates</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['1,000', '$5.00', '$5.00', 'The floor, entirely'],
                    ['10,000', '$7.45', '$0.75', 'Still mostly the floor'],
                    ['100,000', '≈$40', '≈$0.40', 'The messages'],
                    ['1,000,000', '≈$363', '≈$0.36', 'The messages, overwhelmingly'],
                  ].map(([volume, total, per, what]) => (
                    <tr key={volume} className="border-line border-t">
                      <td className="px-4 py-2 font-mono text-[12.5px] font-semibold text-ink">
                        {volume}
                      </td>
                      <td className="px-4 py-2 font-mono text-[12.5px] text-muted">{total}</td>
                      <td className="px-4 py-2 font-mono text-[12.5px] text-muted">{per}</td>
                      <td className="px-4 py-2 text-muted-2">{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              The curve falls fast and then flattens against $0.35, which it approaches and never
              reaches. That is the whole shape, and it has one consequence that matters more than
              any individual number:{' '}
              <strong className="text-ink">the comparison changes with volume</strong>. Not the
              winner's margin — the winner. Somebody arguing that self-hosting is obviously cheaper
              is standing at a hundred thousand. Somebody arguing that it is obviously more
              expensive is standing at eight hundred, and both of them are reporting their own view
              accurately.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Per-message vendors have the same structure with different constants — a free tier, a
              flat plan that covers a band, and a per-message rate past it — which is why the two
              curves cross rather than one sitting under the other. Plan ladders also step: the
              price does not move at all until you cross a threshold, at which point it jumps.
              Between those steps you are paying for headroom you are not using, and just past one
              you are paying a lot for the last few thousand messages. A self-hosted bill has no
              steps; it is a straight line from the floor.
            </p>
            <Callout variant="warn" title="THE FLOOR IS PAID WHETHER YOU SEND OR NOT">
              Five dollars a month at zero messages. If you are deploying this to send a few hundred
              transactional emails, you are paying five dollars for something a free tier gives you
              for nothing, and no argument about the marginal rate rescues that. Whether it is worth
              it depends entirely on what you are buying instead — which is the next section, and it
              is not a pricing argument.
            </Callout>
          </>
        ),
        versus: (
          <>
            <Lede>
              An honest comparison has to include the costs self-hosting adds, and it has to be
              willing to lose. Here is where each side actually wins, at the volumes where it wins.
            </Lede>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Volume</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Self-hosted</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">A per-message vendor</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Honest verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Under 3,000', '$5.00', '$0 on a free tier', 'The vendor. Not close.'],
                    [
                      '10,000',
                      '$7.45',
                      '≈$20 on a starter plan',
                      'Roughly a wash once you count your time',
                    ],
                    ['100,000', '≈$40', '≈$90', 'Self-hosted, by about half'],
                    [
                      '1,000,000',
                      '≈$363',
                      'Usually "contact us"',
                      'Self-hosted, and the gap widens',
                    ],
                  ].map(([volume, self, vendor, verdict]) => (
                    <tr key={volume} className="border-line border-t">
                      <td className="px-4 py-2 font-mono text-[12.5px] font-semibold text-ink">
                        {volume}
                      </td>
                      <td className="px-4 py-2 font-mono text-[12.5px] text-muted">{self}</td>
                      <td className="px-4 py-2 font-mono text-[12.5px] text-muted">{vendor}</td>
                      <td className="px-4 py-2 text-muted-2">{verdict}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Below a few thousand messages a month, a vendor's free tier is genuinely cheaper.
              </strong>{' '}
              Not cheaper-if-you-ignore-something, not cheaper-on-paper — cheaper. Zero against five
              dollars is not a margin you argue with, and if that is your volume then the honest
              recommendation is to use the free tier and come back when you have outgrown it. A
              pricing page that cannot say that about its own product is a pricing page you should
              not trust about anything else either.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                And self-hosting adds costs the table cannot price.
              </strong>{' '}
              These are real line items even though none of them arrives as an invoice:
            </p>
            <div className="flex flex-col gap-3">
              {[
                [
                  'Your time, up front',
                  'Deploying, verifying DNS for each sending domain, wiring webhooks and reading enough of the operational surface to be useful in an incident. An afternoon if things go well. A day if your registrar is one of the ones that appends the zone to every record you type.',
                ],
                [
                  'Your time, ongoing',
                  'Reading bounce classifications, keeping an eye on a complaint rate, occasionally upgrading. Small, but never zero, and it lands on whoever is on call rather than on someone whose actual job it is.',
                ],
                [
                  'Being your own support',
                  'When a Gmail deliverability problem starts at 2am, nobody is investigating it on your behalf. Every guide on this site exists partly because that is true.',
                ],
                [
                  'Reputation you build yourself',
                  'A vendor sends from pools with years of history. You are starting from nothing and warming up, which is a real, temporary deliverability cost — and the flip side of owning it rather than sharing it with whoever else is on your IP.',
                ],
              ].map(([title, body]) => (
                <div key={title} className="rounded-tile border border-line bg-card p-4">
                  <p className="mt-0 mb-1.5 text-[15.5px] font-semibold text-ink">{title}</p>
                  <p className="m-0 text-[14.5px] leading-[1.6] text-muted">{body}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              Price those honestly and the ten-thousand-message row stops being a win. Twelve
              dollars a month of savings does not pay for an afternoon of anybody's time, and it
              will not pay for it next year either. The crossover where self-hosting is
              unambiguously cheaper — cheap enough that the saved money exceeds the attention spent
              — sits well above the point where the raw arithmetic crosses.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              What does not appear in either column, because it is not a number: your data stays in
              your account, your sending reputation is yours alone, and nobody can change your
              pricing, deprecate an endpoint you depend on, or decide your use case is no longer
              welcome. That is worth something or it is not, depending entirely on what you are
              building — but it is the actual thing being traded for the setup cost, and pretending
              the trade is about dollars per thousand does nobody any favours.
            </p>
            <Callout title="GO CHECK THE RATES">
              Everything above is arithmetic on published Cloudflare prices, per product, and{' '}
              <a href="/stack" className="text-accent underline underline-offset-4">
                /stack
              </a>{' '}
              lists them line by line with what each one is doing in the send path. A comparison you
              cannot check is not worth reading — so check it, including against your own provider's
              current page, before you move anything.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              If the numbers do point your way, the{' '}
              <a
                href="/guides/migrate-from-resend"
                className="text-accent underline underline-offset-4"
              >
                migration guide
              </a>{' '}
              covers the cutover — including the part where you keep both running on a percentage
              split until you are sure. <Mono>/v1/emails</Mono> is Resend-compatible, so the code
              change is a base URL and a key.
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
