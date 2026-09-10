import { Callout, StepCard, Terminal } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono, Str } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'migrate-from-resend'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/migrate-from-resend')({
  head: () => guideHead(SLUG),
  component: Page,
})

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          The send call did not change, the DNS was published alongside the old records rather than
          instead of them, and the traffic moved a percentage at a time with a condition written
          down in advance for rolling it back. The one step with no undo is the suppression list: if
          it was not imported before the first send, you have already mailed every address that
          bounced or unsubscribed on the old system, and no amount of care afterwards takes that
          back.
        </p>
      }
    >
      {{
        'the-one-line': (
          <>
            <Lede>
              The request and response shapes of <Mono>/v1/emails</Mono> are Resend's, exactly. Not
              inspired by, not mostly compatible — the same fields in the same places, so the{' '}
              <Mono>resend</Mono> SDK you already have installed works against your instance with a
              base URL and a key.
            </Lede>
            <Code>
              <Key>import</Key>
              {' { Resend } '}
              <Key>from</Key> <Str>{"'resend'"}</Str>
              {'\n\n'}
              <Com>{'// before'}</Com>
              {'\n'}
              <Key>const</Key>
              {' resend = '}
              <Key>new</Key>
              {' Resend(process.env.RESEND_API_KEY)\n\n'}
              <Com>{'// after — same import, same calls, same response handling'}</Com>
              {'\n'}
              <Key>const</Key>
              {' resend = '}
              <Key>new</Key>
              {' Resend(process.env.MAILYSEND_API_KEY, {\n  baseUrl: '}
              <Str>{"'https://your-instance.example.com/v1'"}</Str>
              {',\n})\n\n'}
              <Key>await</Key>
              {' resend.emails.send({\n  from: '}
              <Str>{"'you@yourdomain.com'"}</Str>
              {',\n  to: '}
              <Str>{"'customer@example.com'"}</Str>
              {',\n  subject: '}
              <Str>{"'Your receipt'"}</Str>
              {',\n  html: body,\n})  '}
              <Com>{'// → { id: "…" }, exactly as before'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Everything added on top is additive and ignored by their SDK, which is what makes the
              compatibility survive contact with reality rather than only with a hello-world. One
              field is worth knowing about even so: a send may come back with a{' '}
              <Mono>suppressed</Mono> array, which is the difference between "we sent it" and "we
              sent it to the three of five recipients who were not on your suppression list". If
              your code treats the presence of an <Mono>id</Mono> as proof that everyone received
              it, that was already an assumption; here it is at least visible.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Batch sending is compatible too, up to a hundred distinct messages per call, with
              per-item results — one malformed item does not reject the other ninety-nine, and the
              response says which index failed. Beyond the shared surface there is more: idempotency
              keys on send, <Mono>scheduled_at</Mono> with <Mono>PATCH</Mono> to reschedule and{' '}
              <Mono>DELETE</Mono> to cancel while a message is still queued. None of that is
              required to migrate. Get the identical calls working first and adopt the extras later,
              so that if something goes wrong during the cutover you know it is not your new code.
            </p>
            <Callout title="WHAT IS NOT ONE LINE">
              Sending. That is the compatible surface. Contacts, audiences and broadcasts have their
              own endpoints here and are worth reading before you assume parity — if your
              application only calls <Mono>emails.send</Mono>, you are done after this section; if
              it manages audiences through the API, budget real time for that part.
            </Callout>
          </>
        ),
        domains: (
          <>
            <Lede>
              The rule for the whole DNS step is one sentence: publish the new records alongside the
              old ones and verify them <em>before</em> you move any traffic. Do it in that order and
              there is never a moment where neither system can authenticate your mail.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              This works because most of the records do not collide. Resend authenticates through a{' '}
              <Mono>send.</Mono> subdomain and signs with its own DKIM key under its own selector;
              your new transport uses a different bounce subdomain and a different selector. Two
              DKIM selectors can coexist indefinitely — that is the entire reason selectors exist —
              and two bounce subdomains are simply two different names. A message signed by either
              one verifies against the key it names.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Two records do collide, and they are the two people get wrong:
            </p>
            <div className="flex flex-col gap-3.5">
              <StepCard step={1} title="SPF — merge, never add a second record" variant="rule">
                <p className="mt-1.5 mb-2 text-[15px] leading-[1.65] text-muted">
                  A domain may publish exactly one SPF record. Two is a permanent error and
                  receivers treat it as no SPF at all, so "adding" a record for the new sender
                  silently disables the old one. Put both includes in the single record for the
                  duration of the overlap, and remove the old include only after the old system has
                  stopped sending.
                </p>
                <Code className="mt-1.5">
                  <Com>{'; during the overlap — one record, both includes'}</Com>
                  {'\n@  TXT  "v=spf1 include:_spf.mx.cloudflare.net include:amazonses.com ~all"'}
                </Code>
              </StepCard>
              <StepCard
                step={2}
                title="DMARC — one record, and leave the policy alone"
                variant="rule"
              >
                <p className="mt-1.5 mb-0 text-[15px] leading-[1.65] text-muted">
                  Also exactly one. Whatever policy you are on today, keep it through the migration:
                  a cutover is the worst possible moment to also tighten <Mono>p=none</Mono> to{' '}
                  <Mono>p=reject</Mono>, because you would then have two changes and one symptom. Do
                  the move first, confirm alignment in the aggregate reports, tighten afterwards.
                </p>
              </StepCard>
              <StepCard step={3} title="Verify before you send anything" variant="rule">
                <Terminal
                  className="mt-1.5"
                  lines={[
                    { kind: 'command', text: 'dig +short TXT yourdomain.com' },
                    { kind: 'command', text: 'dig +short TXT ms1._domainkey.yourdomain.com' },
                    { kind: 'command', text: 'dig +short TXT _dmarc.yourdomain.com' },
                  ]}
                />
                <p className="mt-2 mb-0 text-[14px] leading-[1.6] text-muted-2">
                  From a resolver, not from your DNS provider's own interface, which will happily
                  show you a record it has not published yet. If <Mono>dig</Mono> disagrees with the
                  panel, believe <Mono>dig</Mono>. The{' '}
                  <a
                    href="/guides/spf-dkim-dmarc"
                    className="text-accent underline underline-offset-4"
                  >
                    authentication guide
                  </a>{' '}
                  covers what each record is proving and why alignment is the part that bites.
                </p>
              </StepCard>
            </div>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              Then wait out the TTL before you start. Publishing and immediately sending means some
              receivers are still holding the previous answer, and a DKIM failure caused by a cached
              negative lookup is indistinguishable, from the outside, from a DKIM failure caused by
              you doing something wrong.
            </p>
          </>
        ),
        data: (
          <>
            <Lede>
              Three kinds of data, and they are not equally important. One of them must be moved
              before your first send; one is worth moving carefully; one is usually not worth moving
              at all.
            </Lede>
            <Callout variant="warn" title="THE SUPPRESSION LIST. BEFORE THE FIRST SEND.">
              An empty suppression list does not mean "no suppressions". It means every address that
              ever hard-bounced, complained, or unsubscribed on your old system is now, as far as
              the new one knows, a perfectly good recipient. Your first broadcast then mails all of
              them at once. That is a spike of hard bounces and spam complaints delivered to
              receivers in a single burst, from a domain they have no recent history with — the
              single worst first impression it is possible to make, and it is entirely
              self-inflicted.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Export the list from your current provider and import it in bulk. Up to a thousand
              addresses per call, and re-running an import is safe: an address that is already
              suppressed is upserted rather than rejected, so a partial import can simply be run
              again rather than diffed.
            </p>
            <Code>
              <Key>POST</Key>
              {' /v1/suppressions/bulk\n{\n  '}
              <Key>{'"emails"'}</Key>
              {': [\n    { '}
              <Key>{'"email"'}</Key>
              {': '}
              <Str>{'"bounced@example.com"'}</Str>
              {', '}
              <Key>{'"reason"'}</Key>
              {': '}
              <Str>{'"hard_bounce"'}</Str>
              {' },\n    { '}
              <Key>{'"email"'}</Key>
              {': '}
              <Str>{'"gone@example.com"'}</Str>
              {',    '}
              <Key>{'"reason"'}</Key>
              {': '}
              <Str>{'"unsubscribe"'}</Str>
              {' }\n  ]\n}'}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Carry the reason across rather than flattening everything to a generic entry. It costs
              nothing at import time and it is the difference between later being able to say "these
              two thousand are unsubscribes, those four hundred are dead mailboxes" and having one
              undifferentiated blocklist you can never safely prune. Addresses are stored under a
              normalised form, so suppressing <Mono>a.b+news@gmail.com</Mono> also stops mail to{' '}
              <Mono>ab@gmail.com</Mono> — which means an export containing several spellings of the
              same mailbox collapses correctly instead of leaving a gap.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Contacts, second.</strong> Bring across the address, the
              name fields, the unsubscribe flag and any custom fields your templates actually
              reference. Import into an audience, check the count against your source before you
              trust it, and — this is the one worth being fussy about — confirm that the unsubscribe
              flag survived. A contact import that silently drops <Mono>unsubscribed</Mono> produces
              exactly the same catastrophe as skipping the suppression list, with the added
              indignity of having done the work.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">History, mostly not.</strong> Old opens and clicks are
              not worth migrating. They will not line up with the new event stream, engagement
              columns rebuild themselves from real activity within a send cycle or two, and a
              segment defined over imported counts is a segment computed from numbers whose
              provenance you have already forgotten. Keep your old dashboard read-only for as long
              as your provider allows and let the new numbers accumulate honestly. The exception is
              genuine legal retention — export the raw records to your own storage and treat that as
              an archive rather than trying to make it queryable in the new system.
            </p>
          </>
        ),
        webhooks: (
          <>
            <Lede>
              This is the one place where "compatible" stops. The event names are close and the
              signature scheme is not the same, so your receiver needs a real change — and the way
              to make that change safely is to run both verifiers at once.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The two schemes differ in every dimension: different header names, a different signed
              string, and a different encoding of the result. Resend signs with Svix, whose headers
              are <Mono>svix-id</Mono>, <Mono>svix-timestamp</Mono> and <Mono>svix-signature</Mono>,
              and whose signature is base64. Here it is a single{' '}
              <Mono>MailySend-Signature: t=…,v1=…</Mono>, an HMAC-SHA256 over{' '}
              <Mono>{'t + "." + body'}</Mono>, hex-encoded. There is no shim that makes one verify
              as the other, and you should be glad — a compatibility layer over a signature check is
              a place for a bypass to hide.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              So branch on which headers arrived, verify with the matching verifier, and reject
              anything that has neither. During the overlap both are live and both are legitimate;
              after the cutover you delete a branch.
            </p>
            <Code>
              <Key>if</Key>
              {' (req.get('}
              <Str>{"'mailysend-signature'"}</Str>
              {')) {\n  '}
              <Key>if</Key>
              {' (!verifyMailySend(req)) '}
              <Key>return</Key>
              {' res.sendStatus(400)\n} '}
              <Key>else if</Key>
              {' (req.get('}
              <Str>{"'svix-signature'"}</Str>
              {')) {\n  '}
              <Key>if</Key>
              {' (!verifySvix(req)) '}
              <Key>return</Key>
              {' res.sendStatus(400)\n} '}
              <Key>else</Key>
              {' {\n  '}
              <Key>return</Key>
              {' res.sendStatus(400)  '}
              <Com>{'// unsigned is not a third case'}</Com>
              {'\n}'}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Two things carry over from the old integration and are worth re-checking rather than
              assuming. Verify against the <strong className="text-ink">raw request body</strong>,
              before any JSON parsing — that is true of both schemes, and if your existing handler
              got it right for Svix it will already be capturing the bytes. And keep the handler
              idempotent: delivery here is at-least-once, every event carries a stable id in{' '}
              <Mono>MailySend-Event-Id</Mono>, and during a percentage cutover you will briefly have
              two systems reporting on overlapping traffic, which is exactly when a non-idempotent
              handler starts double-counting.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The retry behaviour is different too, and generally in your favour: six queue
              attempts, then a long tail at three, six, twelve and twenty-four hours, then the
              endpoint is disabled after twenty consecutive failures with replay available once you
              have fixed it. The{' '}
              <a
                href="/guides/webhooks-end-to-end"
                className="text-accent underline underline-offset-4"
              >
                webhooks guide
              </a>{' '}
              has verifier code in six languages and the full ladder, which is the page to have open
              while you write this branch.
            </p>
          </>
        ),
        cutover: (
          <>
            <Lede>
              Move a percentage, not a system. The point of a percentage cutover is not caution for
              its own sake — it is that a problem shows up in a slice of your traffic instead of all
              of it, and that going back is a configuration change rather than a project.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Split on a stable hash of something durable — the recipient address, or the user id —
              rather than on a random number per send. A random split means a given customer
              receives one message through each system, so if something is wrong with your new
              templates you get one broken email each to a lot of people rather than a clear signal
              from a contained group. A stable hash keeps each recipient's experience consistent and
              makes the comparison between the two paths meaningful.
            </p>
            <div className="mt-2 flex flex-col gap-3.5">
              <StepCard step={1} title="1% — internal and low-stakes traffic only" variant="rule">
                <p className="mt-1.5 mb-0 text-[15px] leading-[1.65] text-muted">
                  A day. You are not measuring rates at this volume, you are confirming that mail
                  arrives, renders, authenticates, and produces the webhook events your application
                  expects. Send one to a personal address at each of the big receivers and read the
                  headers.
                </p>
              </StepCard>
              <StepCard step={2} title="10% — the first real measurement" variant="rule">
                <p className="mt-1.5 mb-0 text-[15px] leading-[1.65] text-muted">
                  Two or three days. Now you can compare bounce and complaint rates between the two
                  paths on the same kind of traffic in the same period, which is the only comparison
                  that means anything.
                </p>
              </StepCard>
              <StepCard step={3} title="50%, then 100%" variant="rule">
                <p className="mt-1.5 mb-0 text-[15px] leading-[1.65] text-muted">
                  A few days at each. Leave the old path configured and credentialled for a
                  fortnight after you reach a hundred per cent. Deleting the old integration is the
                  last step of the migration, not part of it.
                </p>
              </StepCard>
            </div>
            <Callout variant="warn" title="WRITE THE ROLL-BACK CONDITION DOWN FIRST">
              Before you move a single percent, decide what makes you go back and put it in writing:
              <em>
                {' '}
                the hard-bounce rate on the new path exceeds the old path's rate over the same
                period, or any sampled message fails DKIM alignment, or complaint rate rises at all.
              </em>{' '}
              Any one of those, you set the percentage to zero and diagnose afterwards. Deciding
              this in advance is the whole trick — at the moment the graph moves you will be tired,
              invested in the migration, and extremely good at explaining why this particular number
              does not count.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Watch the two paths side by side, not the new one in isolation. Your bounce rate on
              the new system is meaningless without knowing what it is on the old one this week —
              plenty of "migration problems" turn out to be a bad list segment that was misbehaving
              equally on both, and you only discover that if you were looking at both.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Rolling back is genuinely cheap here, and that is by construction: the DNS for both
              systems is still published and verified, the old credential still works, and the send
              call is identical, so reverting is one configuration value. That property is the
              reason the DNS section insisted on alongside rather than instead of — it is what turns
              a roll back from an incident into a shrug.
            </p>
          </>
        ),
        differences: (
          <>
            <Lede>
              Plainly, then, including the parts that do not favour this project. A comparison a
              reader cannot check is not worth reading, and a comparison that never loses is a
              comparison nobody should believe.
            </Lede>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Dimension</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">Resend</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold">
                      MailySend, self-hosted
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [
                      'Who operates it',
                      'They do. There is a team, and it is their job.',
                      'You do. At 2am, it is your job.',
                    ],
                    [
                      'Sending reputation',
                      'Established pools, warmed over years.',
                      'Yours alone, starting cold and warming up.',
                    ],
                    [
                      'Where the data lives',
                      'Their infrastructure, under their terms.',
                      'Your Cloudflare account. Nobody else can read it.',
                    ],
                    [
                      'Cost under ~3,000/mo',
                      'Free, and genuinely cheaper.',
                      'The Workers Paid floor, whether you send or not.',
                    ],
                    [
                      'Cost at 100k/mo',
                      'A plan price.',
                      'An infrastructure bill, roughly half of it.',
                    ],
                    ['Time to first email', 'Minutes.', 'An afternoon, most of it DNS.'],
                    [
                      'Inbound mail',
                      'Available as a product feature.',
                      'Included; Email Routing is free.',
                    ],
                    [
                      'When something breaks',
                      'A status page and a support queue.',
                      'Your logs, and these guides.',
                    ],
                  ].map(([dimension, them, us]) => (
                    <tr key={dimension} className="border-line border-t">
                      <td className="px-4 py-2 font-semibold text-ink">{dimension}</td>
                      <td className="px-4 py-2 text-muted">{them}</td>
                      <td className="px-4 py-2 text-muted">{us}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Where Resend is the better answer.</strong> It is a
              capable product with real people operating it, and if you do not want to run
              infrastructure, that is a legitimate choice rather than a failure of nerve.
              Concretely: if you send a few thousand messages a month, their free tier is cheaper
              than any deployment of anything. If your team has no one who will own an email problem
              at an inconvenient hour, buying that ownership is the correct engineering decision. If
              you are pre-product-market-fit and every hour spent on DNS is an hour not spent on the
              thing customers pay for, the trade is obvious and it is not in this direction. And if
              you need someone contractually accountable for delivery, that is a thing a vendor
              sells and a thing you cannot sell yourself.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The difference is ownership, not a feature gap.</strong>{' '}
              That framing matters because it tells you when to reconsider. If you migrate expecting
              a capability you did not have before, you will be disappointed — sending an email is a
              well-understood problem and both systems do it. What changes is who holds the account,
              whose reputation the domain is building, who can change the pricing, and who is able
              to read the contents of your mail. If none of that is currently a problem for you,
              this migration is work with no payoff, and you should not do it.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Two more honest notes. The numbers above are checkable and you should check them:{' '}
              <a href="/stack" className="text-accent underline underline-offset-4">
                /stack
              </a>{' '}
              lists the Cloudflare rates per product,{' '}
              <a
                href="/guides/what-100k-emails-costs"
                className="text-accent underline underline-offset-4"
              >
                the cost guide
              </a>{' '}
              does the arithmetic including your own time, and{' '}
              <a href="/compare" className="text-accent underline underline-offset-4">
                /compare
              </a>{' '}
              is the matrix including the rows where this project loses. And the migration is
              reversible in both directions: the compatibility that let you point the SDK here in
              one line points it back just as easily. Keep your old account alive through the
              overlap and the decision stays cheap to unmake — which is the only condition under
              which it is worth making quickly.
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
