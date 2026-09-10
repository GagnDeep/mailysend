import { Callout } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { OpenRateCalculator } from '~/components/guides/open-rate-calculator.tsx'
import { Contrast, FactTable, Takeaway } from '~/components/marketing/guide-blocks.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono, Str } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'open-rates-and-apple-mpp'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/open-rates-and-apple-mpp')({
  head: () => guideHead(SLUG),
  component: Page,
})

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You know why a raw open rate stopped measuring anything, how the privacy-adjusted rate is
          computed, and — the part most pages skip — exactly which classification rules run in
          production today and which are inert because the tracking endpoint does not pass their
          inputs. The consequence to keep hold of: user-agent matching is doing all the work right
          now, so treat the classes as a good filter rather than a precise census, and build your
          segments on clicks and replies, which MPP does not touch.
        </p>
      }
    >
      {{
        'what-mpp-did': (
          <>
            <Lede>
              Apple Mail Privacy Protection routes message content through Apple's proxies and
              pre-fetches every remote image, for every message, whether or not the recipient ever
              looks at it. An open pixel is a remote image. So the pixel fires on delivery, from an
              Apple address, for a person who may never open the mail at all.
            </Lede>
            <Takeaway>
              MPP did not make the open rate noisier — it changed what the number is, from weak
              evidence that somebody rendered your message into a measure of Apple’s cache.
            </Takeaway>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              This did not degrade the open rate — it changed what the number is. Before MPP, an
              open event was weak evidence that somebody rendered your message: undercounted by
              images-off clients, but the events you did get mostly corresponded to a human. After
              MPP, a large share of your open events correspond to a cache being warmed. The metric
              did not get noisier; it started measuring a different thing, and the share of your
              list that thing applies to is set by Apple's adoption among your recipients, not by
              anything you do.
            </p>
            <Callout variant="warn" title="THE MOVEMENT YOU SEE IS OFTEN AUDIENCE MIX">
              An unfiltered open rate rises when more of your audience uses Apple Mail and falls
              when less of it does. Two campaigns to different segments can differ by fifteen points
              on open rate purely because one segment skews to iPhones. Any A/B test scored on raw
              opens is measuring device mix as much as subject line, and the arithmetic is silent
              about which.
            </Callout>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              MPP is the largest of these effects but not the only one. Corporate security
              appliances fetch every image and follow every link in a message before the recipient
              sees it — which produces opens <em>and</em> clicks, for mail nobody has read yet.
              Gmail proxies and caches images through its own infrastructure. The design response is
              the same for all of them: classify the hit at the edge, store everything, and default
              the headline charts to the one class that plausibly means a person.
            </p>
          </>
        ),
        'five-classes': (
          <>
            <Lede>
              Every open and click is stored with an <Mono>AudienceClass</Mono>. Nothing is
              discarded — somebody investigating one specific delivery needs to see the scanner hit
              too — but only <Mono>human</Mono> is in <Mono>COUNTS_AS_ENGAGEMENT</Mono>, so only{' '}
              <Mono>human</Mono> reaches a headline rate.
            </Lede>
            <Takeaway>
              Five classes, everything stored, and exactly one of them — <Mono>human</Mono> —
              counted toward a headline rate.
            </Takeaway>
            <FactTable
              columns={['Class', 'Counts?', 'What it means']}
              rows={[
                [
                  'human',
                  'Yes',
                  'No bot signal matched. The weakest possible claim, stated honestly: this is what is left after every rule that could rule a person out has declined to.',
                ],
                [
                  'mpp',
                  'No',
                  'Apple Mail Privacy Protection. The message reached a privacy-protected mailbox; whether anyone read it is unknowable, in both directions.',
                ],
                [
                  'proxy_prefetch',
                  'No',
                  'An image proxy warming its cache, close enough to delivery that no human was involved. It restates the delivery event and adds nothing.',
                ],
                [
                  'scanner',
                  'No',
                  'A security appliance walking the message — Proofpoint, Mimecast, SafeLinks, Defender and the rest. Usually the most damaging class to count, because it produces clicks too.',
                ],
                [
                  'bot',
                  'No',
                  'Crawlers, monitoring, HTTP libraries, headless browsers, and anything arriving with no user agent at all.',
                ],
              ]}
              caption="COUNTS_AS_ENGAGEMENT holds one entry. Everything else is recorded with the reason string that produced it and left out of the headline."
            />
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Why <Mono>proxy_prefetch</Mono> is excluded rather than counted.
              </strong>{' '}
              It is tempting to treat a proxy fetch as an open, since something did request the
              image. But the fact it establishes — the message arrived — is the one the delivery
              event already gave you. Counting it would double-count delivery and file the duplicate
              under engagement, which is the specific way an engagement metric becomes a
              deliverability metric wearing a hat.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Why <Mono>mpp</Mono> is its own class and not just “bot”.
              </strong>{' '}
              Behind an MPP hit there is a real subscriber with a real mailbox, and the message did
              reach them. Everything about the delivery is fine; only the observation is destroyed.
              Filing that under bot would imply something bad about the address, and the adjusted
              rate in the next section depends on being able to count MPP recipients separately in
              order to remove them cleanly.
            </p>
            <Callout title="EVERY CLASS IS STORED">
              The classification narrows what is charted, not what is recorded. Each hit keeps its
              class and the reason string that produced it, so a specific delivery can always be
              inspected — which is also how you would notice a rule misfiring on your traffic.
            </Callout>
          </>
        ),
        'the-rate': (
          <>
            <Lede>
              There are three arithmetics available for MPP opens and two of them are wrong in
              opposite directions. Count them as opens and the rate inflates. Count them as
              non-opens and it deflates, because those recipients are in the denominator being
              treated as people who did not open. The third option is to remove them from both sides
              and say so.
            </Lede>
            <Takeaway>
              MPP opens come out of the numerator and the denominator, and when that leaves nothing
              the function returns <Mono>null</Mono> with a sentence rather than a number.
            </Takeaway>
            <OpenRateCalculator />
            <p className="mt-6 text-[15.5px] leading-[1.7] text-muted">
              The function is four lines of arithmetic and one refusal:
            </p>
            <Code>
              <Key>{'privacyAdjustedOpenRate'}</Key>
              {
                '({ delivered, humanOpens, mppOpens })\n\n  denominator = delivered - mppOpens\n\n  '
              }
              <Com>{'// nothing observable is left to compute a rate from'}</Com>
              {'\n  if (denominator <= 0) → { rate: '}
              <Key>{'null'}</Key>
              {', excluded: mppOpens, note: '}
              <Str>{'"…"'}</Str>
              {
                ' }\n\n  rate     = humanOpens / denominator\n  excluded = mppOpens\n  note     = "N privacy-protected opens excluded from both sides"'
              }
            </Code>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              The <Mono>null</Mono> matters as much as the division. When every delivery in the
              window went to a privacy-protected mailbox, the denominator is zero or negative and
              there is no honest number to show — so the function returns no rate and a sentence
              explaining why, rather than a zero that reads as catastrophic performance or a
              silently-clamped percentage that reads as fine. A rate of <Mono>null</Mono> is a
              different claim from a rate of <Mono>0</Mono>, and the type says so.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The <Mono>excluded</Mono> count travels with the rate for the same reason. A 22% open
              rate with 400 excluded and a 22% open rate with 40,000 excluded are not comparable
              figures, and the second one deserves much less of your confidence. If you export this
              number into a report, export the exclusion count next to it.
            </p>
            <Callout variant="warn" title="THIS FIXES THE ARITHMETIC, NOT THE MEASUREMENT">
              Removing MPP from both sides makes the remaining ratio internally consistent. It does
              not tell you what those recipients did — that information no longer exists anywhere.
              If two thirds of your list is behind MPP, the adjusted rate is an honest number
              computed over the third you can still see, and it is worth reading as such rather than
              as your audience's behaviour.
            </Callout>
          </>
        ),
        'what-actually-fires': (
          <>
            <Lede>
              Here is the part a vendor would leave out. The classifier contains several rules that
              are better than user-agent matching, and in production today they never fire — because
              the tracking endpoint does not pass them the inputs they need. The heuristics are
              good; the wiring is incomplete. Telling you which is which is the point of this page.
            </Lede>
            <Takeaway>
              Classification in production today is user-agent matching plus a HEAD check. Every
              rule that reads timing or network context is dead code on live traffic.
            </Takeaway>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <Mono>apps/app/src/server/tracking.ts</Mono> calls <Mono>classifyHit</Mono> with
              exactly four things: the user agent, the connecting IP, the HTTP method, and (on the
              open path) the country header. It never populates <Mono>msSinceDelivery</Mono>,{' '}
              <Mono key="recentLinkHits">recentLinkHits</Mono>, <Mono>cfAsn</Mono> or{' '}
              <Mono key="cfVerifiedBot">cfVerifiedBot</Mono>. Every rule that reads one of those
              fields therefore evaluates against an absent value and falls through.
            </p>
            <Code>
              {'const hit = '}
              <Key>{'classifyHit'}</Key>
              {'({\n  userAgent: request.headers.get('}
              <Str>{"'user-agent'"}</Str>
              {") ?? '',\n  ip:        request.headers.get("}
              <Str>{"'cf-connecting-ip'"}</Str>
              {") ?? '',\n  method:    request.method,\n  "}
              <Com>{'// …country, on the open path'}</Com>
              {'\n})\n\n'}
              <Com>{'// not passed: msSinceDelivery · recentLinkHits · cfAsn · cfVerifiedBot'}</Com>
            </Code>
            <Contrast
              sides={[
                {
                  label: 'Inert today',
                  tone: 'bad',
                  points: [
                    'Three links in two seconds → scanner',
                    'Gmail image proxy within 2s of delivery → proxy_prefetch',
                    'Apple Private Relay network → mpp',
                    'Google network within 2s of delivery → proxy_prefetch',
                    'Cloudflare verified bot → bot',
                  ],
                },
                {
                  label: 'Live today',
                  tone: 'good',
                  points: [
                    'HEAD request → scanner',
                    'Security-vendor user agent → scanner',
                    'Apple MPP user agents → mpp',
                    'Bot user agents → bot',
                    'Empty user agent → bot',
                    'Everything else → human',
                  ],
                },
              ]}
            />
            <FactTable
              columns={['Inert rule', 'Input it needs', 'What happens instead']}
              monoFirst={false}
              rows={[
                [
                  'Three or more links hit within two seconds → scanner',
                  <Mono key="recentLinkHits">recentLinkHits</Mono>,
                  'A link checker walking the message is indistinguishable from a reader, so a scanner presenting a browser-like user agent is classified human.',
                ],
                [
                  'Gmail image proxy within 2s of delivery → proxy_prefetch',
                  <Mono key="msSinceDelivery">msSinceDelivery</Mono>,
                  'The comparison runs against positive infinity, so every GoogleImageProxy hit takes the delayed branch and is classified human — “likely a real open”.',
                ],
                [
                  'Apple Private Relay egress (ASNs 714, 6185, 2709) → mpp',
                  <Mono key="cfAsn">cfAsn</Mono>,
                  'Apple traffic is caught only when its user agent matches. Anything from those networks with an unfamiliar user agent is not.',
                ],
                [
                  'Google egress (ASNs 15169, 396982) within 2s → proxy_prefetch',
                  <span key="cfAsn-and-msSinceDelivery">
                    <Mono>cfAsn</Mono> and <Mono>msSinceDelivery</Mono>
                  </span>,
                  'Both routes into proxy_prefetch depend on timing data that is not there, which is why that class is almost certainly an under-count.',
                ],
                [
                  'Cloudflare verified bot → bot',
                  <Mono key="cfVerifiedBot">cfVerifiedBot</Mono>,
                  'A well-behaved crawler is caught only if its user agent happens to match the bot pattern list.',
                ],
              ]}
              caption="These rules exist and are tested. They never trigger on real traffic, because tracking.ts does not populate the field each one reads."
            />
            <FactTable
              columns={['Live rule', 'What it matches']}
              monoFirst={false}
              rows={[
                [
                  'HEAD request → scanner',
                  'No mail client fetches an image or follows a link with HEAD. Method is passed, so this fires.',
                ],
                [
                  'Security-vendor user agents → scanner',
                  'Barracuda, Proofpoint, Mimecast, Symantec, Forcepoint, MessageLabs, TrendMicro, FireEye, Cisco, IronPort, Sophos, McAfee, Fortinet, Zscaler, urlscan, VirusTotal, SafeLinks, ATP, Defender.',
                ],
                [
                  'Apple MPP user agents → mpp',
                  'The Apple Mail, iPhone Mail and MacOutlook preview patterns, plus the exact Private Relay user-agent string. This is what makes the adjusted rate work at all.',
                ],
                [
                  'Bot user agents → bot',
                  'bot, crawler, spider, slurp, curl/, wget, python-requests, okhttp, axios, Go-http-client, Java/, libwww, HeadlessChrome, PhantomJS, Playwright, Puppeteer, monitoring, uptime, pingdom, newrelic.',
                ],
                [
                  'Empty user agent → bot',
                  'A request with no user agent at all is not a mail client, and this is the last check before human.',
                ],
                [
                  'Everything else → human',
                  'The default, reached by falling through every rule above. Read it as “nothing ruled this out”, not as “a person did this”.',
                ],
              ]}
            />
            <p className="mt-6 text-[15.5px] leading-[1.7] text-muted">
              What this means for your numbers, concretely. Classification today is user-agent
              matching plus a HEAD check. That catches the honest actors — Apple identifies itself,
              security vendors identify themselves, most crawlers identify themselves — and misses
              anything that presents a plausible browser string from an interesting network. So{' '}
              <Mono>human</Mono> is an over-count, by an amount nobody here can quantify for your
              traffic, and <Mono>proxy_prefetch</Mono> is almost certainly an under-count, because
              both routes into it depend on timing data that is not there.
            </p>
            <Callout variant="warn" title="NO, THIS IS NOT ABOUT TO BE FIXED">
              There is no timeline attached to this and no “coming soon” to read into it. It is a
              statement of what the code does today, published because a metric whose limits are
              documented is more useful than one whose limits you have to discover. If the wiring
              changes, this page changes with it — and until then, the numbers are what they are and
              you now know what that is.
            </Callout>
          </>
        ),
        'what-to-measure': (
          <>
            <Lede>
              Opens were always the weakest signal in the stack. MPP made that impossible to ignore,
              which is a favour: the metrics that survive intact are the ones that were more
              informative anyway, because each of them requires a decision by a person.
            </Lede>
            <Takeaway>
              Clicks, replies and downstream conversion survive MPP intact, because each of them
              takes a decision by a person that no proxy can manufacture.
            </Takeaway>
            <FactTable
              columns={['Metric', 'What it proves', 'Why it survives MPP']}
              monoFirst={false}
              rows={[
                [
                  'Clicks',
                  'Somebody chose to go somewhere.',
                  'MPP does not follow links — it pre-fetches images. The nearest thing to an intact engagement signal, with one caveat worth taking seriously: security scanners do follow links, which is why scanner classification matters more for clicks than for opens.',
                ],
                [
                  'Replies',
                  'Somebody wrote back.',
                  'The highest-quality signal available and the one no proxy can manufacture. It is also read by receivers as a strong positive on your reputation, which makes it worth optimising for its own sake as well as for what it tells you.',
                ],
                [
                  'Downstream conversion',
                  'Somebody did the thing.',
                  'A signup, a purchase, a login, a renewal. It sits outside the mail system entirely, so nothing in the mail system can fake it — and it is the only one of the three denominated in the outcome you actually wanted.',
                ],
              ]}
            />
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              The practical consequence is in your segments. A re-engagement or sunset rule built on
              opens will now retire people who read every message on an iPhone and keep people whose
              corporate scanner has been opening their mail for a year. Build those rules on clicks
              instead — and where you have it, on conversion. The{' '}
              <a
                href="/guides/segments-query-language"
                className="text-accent underline underline-offset-4"
              >
                segments query language
              </a>{' '}
              has <Mono>click_count</Mono> and <Mono>last_click_at</Mono> as first-class columns,
              plus <Mono>clicked_last_30d</Mono> and <Mono>never_clicked</Mono> sugar, so the honest
              version of the rule is about as short as the dishonest one.
            </p>
            <Callout title="KEEP TRACKING OPENS ANYWAY">
              An open is still a useful per-message diagnostic — it is evidence that a message
              rendered somewhere, which is exactly what you want when investigating one delivery
              that a customer says never arrived. The classification is stored alongside it, so you
              can see whether that render was a person, Apple, or a scanner. Keep collecting it;
              just stop making decisions with the aggregate.
            </Callout>
          </>
        ),
      }}
    </GuideLayout>
  )
}
