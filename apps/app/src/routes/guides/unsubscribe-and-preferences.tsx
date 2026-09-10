import { Callout, ComparisonTable } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import {
  Contrast,
  Diagram,
  FactTable,
  Gotcha,
  Takeaway,
} from '~/components/marketing/guide-blocks.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono, Str } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'unsubscribe-and-preferences'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/unsubscribe-and-preferences')({
  head: () => guideHead(SLUG),
  component: Page,
})

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          Every message your instance sends carries both headers, the one-click endpoint answers a
          machine in plain text and a human in HTML, and an unsubscribe writes a suppression that
          the send path checks before it checks anything else. The thing most likely to bite you
          later is an import: a suppression is cleared only by an explicit re-subscribe, never as a
          side effect of uploading a CSV, and if you ever find yourself writing code to “merge” a
          spreadsheet over the suppression list, stop — that is the exact mechanism by which senders
          reach blocklists.
        </p>
      }
    >
      {{
        'the-headers': (
          <>
            <Lede>
              Two headers, added by the send path to every outgoing message. They are what turns
              “find the tiny grey link at the bottom” into a button in the mail client’s own
              interface, and that difference is the single largest lever you have on complaint rate.
            </Lede>
            <Takeaway>
              <Mono>List-Unsubscribe</Mono> offers the routes; <Mono>List-Unsubscribe-Post</Mono> is
              the promise that makes the client show a native button. Gmail and Yahoo require the
              pair from bulk senders, and one without the other is decorative.
            </Takeaway>
            <Code>
              <Key>List-Unsubscribe</Key>
              {`: <`}
              <Str>https://…/u/&lt;token&gt;</Str>
              {`>, <`}
              <Str>mailto:unsubscribe@yourdomain.com?subject=unsubscribe</Str>
              {`>
`}
              <Key>List-Unsubscribe-Post</Key>
              {`: `}
              <Str>List-Unsubscribe=One-Click</Str>
            </Code>
            <FactTable
              columns={['Header', 'Value your instance sends', 'What it does']}
              rows={[
                [
                  'List-Unsubscribe',
                  <>
                    <Mono>&lt;https://…/u/&lt;token&gt;&gt;</Mono>, then{' '}
                    <Mono>
                      &lt;mailto:unsubscribe@&lt;your sending domain&gt;?subject=unsubscribe&gt;
                    </Mono>
                  </>,
                  'Offers two routes out, an HTTPS one and a mail one, because they fail differently.',
                ],
                [
                  'List-Unsubscribe-Post',
                  <Mono key="lup-value">List-Unsubscribe=One-Click</Mono>,
                  'Promises the URL above will accept a POST and act on it with no further interaction. Exactly that string, from RFC 8058.',
                ],
                [
                  'The token',
                  <>
                    signed tracking token: <Mono>emailId</Mono> + <Mono>workspaceId</Mono>, HMAC
                    prefix
                  </>,
                  'Self-validating, so the endpoint knows a request is genuine before it touches a database — and you cannot construct a link that unsubscribes someone else.',
                ],
              ]}
              caption="Scoped to one message, so it identifies not just who is leaving but what they were reading when they decided to."
            />
            <ComparisonTable
              caption="Three routes out of a message"
              minWidth={720}
              columns={[
                { key: 'oneclick', label: 'One-click POST', emphasis: true },
                { key: 'mailto', label: 'mailto: fallback' },
                { key: 'link', label: 'Link in the body' },
              ]}
              rows={[
                {
                  label: 'Carried by',
                  values: {
                    oneclick: 'List-Unsubscribe + List-Unsubscribe-Post',
                    mailto: 'List-Unsubscribe',
                    link: 'Your template',
                  },
                },
                {
                  label: 'Who performs the action',
                  values: {
                    oneclick: 'The mail client, on its own network',
                    mailto: 'The mail client, by sending a message',
                    link: 'The reader, in a browser',
                  },
                },
                {
                  label: 'Needs a human present',
                  values: { oneclick: false, mailto: false, link: true },
                },
                {
                  label: 'Works with no outbound HTTP',
                  values: { oneclick: false, mailto: true, link: false },
                },
                {
                  label: 'Earns a native control in Gmail and Yahoo',
                  values: { oneclick: true, mailto: false, link: false },
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Both routes are there because they fail differently.
              </strong>{' '}
              The URL is what modern clients use and what the one-click flow posts to. The mailto is
              the fallback that has worked since the 1990s and is the one a corporate mail gateway
              with no outbound HTTP will use. Offering both costs nothing and removes a class of
              “the unsubscribe link does not work” report you would otherwise never reproduce.
            </p>
            <Gotcha title="The header is not a substitute for the link">
              Keep a visible unsubscribe link in the body as well. The header serves the mail
              client; the link serves the reader who is actively looking for a way out and does not
              know their client has a button. A reader who wants to leave and cannot find how does
              not give up — they press the spam button, and a complaint costs you far more than an
              unsubscribe does.
            </Gotcha>
          </>
        ),
        'one-click': (
          <>
            <Lede>
              The <Mono>/u/</Mono> endpoint answers two different callers. A POST is a machine
              acting on a reader’s behalf, and gets plain text. A GET is a person who clicked a
              link, and gets a page. Everything odd-looking about the POST response follows from who
              is on the other end of it.
            </Lede>
            <Takeaway>
              Nobody is looking at the POST response, so it contains nothing to look at: a{' '}
              <Mono>200</Mono>, <Mono>content-type: text/plain</Mono>, and the word{' '}
              <Mono>Unsubscribed.</Mono>
            </Takeaway>
            <Diagram
              steps={[
                { kicker: 'READER', title: 'Presses unsubscribe', meta: 'in their mail client' },
                {
                  kicker: 'CLIENT',
                  title: <>POST /u/&lt;token&gt;</>,
                  meta: 'no cookies, no session, no browser',
                },
                {
                  kicker: 'ENDPOINT',
                  title: 'Token verified',
                  tone: 'accent',
                  meta: 'HMAC, before any database read',
                },
                { kicker: '200', title: 'Unsubscribed.', meta: 'text/plain' },
              ]}
            />
            <Code>
              <Com>{`# what a receiver sees\n`}</Com>
              {`POST /u/eyJlbWFpbElkIjoi…  HTTP/1.1

`}
              <Key>200</Key>
              {` OK
content-type: text/plain

Unsubscribed.`}
            </Code>
            <Gotcha title="The austerity is the feature">
              When someone presses the unsubscribe button in Gmail, Gmail does not open a browser:
              its infrastructure posts to your URL from its own network, with no human present to
              read whatever comes back. The reader has already been shown a confirmation by their
              own client. A one-click endpoint that renders anything richer than a sentence is
              answering a caller that does not exist.
            </Gotcha>
            <FactTable
              columns={['What the POST path does not do', 'Why not']}
              monoFirst={false}
              rows={[
                [
                  'No form',
                  'A form is a request for a second action from someone who is not there. The unsubscribe would never be recorded, the client would report success because it got a 200, and the reader would keep receiving mail they have already told two systems they do not want.',
                ],
                [
                  'No redirect',
                  'There is nothing to redirect to and nobody to follow it. A 302 is at best ignored and at worst treated as a failure to honour the request.',
                ],
                [
                  'No confirmation screen, no “are you sure”',
                  'The reader already confirmed, in their client, before the POST was sent. Asking again would be asking the wrong party.',
                ],
              ]}
            />
            <Contrast
              sides={[
                {
                  label: 'POST — the machine',
                  tone: 'neutral',
                  points: [
                    <>
                      <Mono>200</Mono> with <Mono>content-type: text/plain</Mono>
                    </>,
                    <>
                      The body is the word <Mono>Unsubscribed.</Mono> and nothing else
                    </>,
                    'Acts immediately; the reader confirmed in their client',
                  ],
                },
                {
                  label: 'GET — the person',
                  tone: 'neutral',
                  points: [
                    'Renders a small confirmation page',
                    'Warns that anything already queued can take a few minutes to stop',
                    'Also acts — no “click here to confirm” button, because clicking the link was the intent',
                  ],
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">An invalid or forged token gets a 400</strong> and a
              plain sentence: <Mono>This unsubscribe link is not valid.</Mono> That is safe to be
              specific about, unlike the tracking pixel, because there is nothing to leak — a token
              either verifies against the signing secret or it does not, and saying so reveals
              nothing about which message ids exist.
            </p>
          </>
        ),
        'preference-centre': (
          <>
            <Lede>
              A preference centre is a genuinely good idea and a very common way to break the
              contract you just made. The rule that keeps it honest is short: unsubscribing must be
              one action on the page, and the header path has to keep working whatever the page
              does.
            </Lede>
            <Takeaway>
              Build the preference page if you like — but the <Mono>List-Unsubscribe</Mono> URL must
              never route through it. Two surfaces, two callers, and only one of them has a person
              on the other end.
            </Takeaway>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The case for preferences is real.</strong> Most people
              who unsubscribe are not rejecting you, they are rejecting the frequency or the
              category. Someone who wants the monthly product note but not three campaign sends a
              week will take that option if it is in front of them, and you keep a subscriber
              instead of losing one.
            </p>
            <Contrast
              sides={[
                {
                  label: 'A preference centre',
                  tone: 'good',
                  points: [
                    'Offers frequency and category choices, and “none of it” among them',
                    'Is linked alongside the unsubscribe link, not instead of it',
                    'Leaves the header path untouched',
                    'Costs one action to leave from',
                  ],
                },
                {
                  label: 'A maze',
                  tone: 'bad',
                  points: [
                    'Requires signing in before you can leave',
                    'Offers six frequency options and no “none”',
                    'Is the only route out of the message',
                    'Wants twelve categories unticked individually',
                    'Adds a confirmation step after the confirmation step',
                  ],
                },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Every item in the right-hand column converts a person who would have unsubscribed into
              a person who marks you as spam. The receiver does not record that you offered them
              choices, only that a reader called your mail junk.
            </p>
            <Callout title="THE TEST">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                Open your own message, find the unsubscribe, and count the actions between the click
                and being off the list. One is correct. Two is defensible if the second is a single
                confirm button. Anything requiring a login, a category-by-category pass, or a reason
                you must supply is not a preference centre, it is a maze — and the complaint rate
                will say so before the legal team does.
              </p>
            </Callout>
            <Gotcha title="This product ships an exit, not a preference selector">
              The built-in <Mono>/u/</Mono> endpoint is a full unsubscribe. If you want
              category-level preferences you build that page yourself against the contacts API and
              link it from your template alongside — not instead of — the unsubscribe link. The
              headers are added by the send path regardless, so the contract with Gmail and Yahoo
              holds whether or not you ever build one.
            </Gotcha>
          </>
        ),
        transactional: (
          <>
            <Lede>
              Every message gets the headers. Receipts, password resets, invoices, shipping
              notifications, the lot. This surprises people, and the reasoning is worth stating
              because the alternative sounds sensible right up until you look at what it requires.
            </Lede>
            <Takeaway>
              A header that is sometimes present is worse than one that always is, because the flag
              deciding “sometimes” is set by hand and is wrong in the sender’s favour every time.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'The argument for stripping them',
                  tone: 'bad',
                  points: [
                    'This message is not marketing',
                    'The reader needs it',
                    'An exit invites them to break their own account',
                    <>
                      Every clause is a decision made <em>on the reader’s behalf</em> about what
                      they are allowed to leave
                    </>,
                  ],
                },
                {
                  label: 'Why it does not survive contact',
                  tone: 'good',
                  points: [
                    'The category boundary is not real, and the examples below are ordinary',
                    'Classification at send time ends up as a hand-set flag',
                    'Readers do not casually unsubscribe from mail they want',
                    'The only other tool they have is the spam button, which damages every message to everyone else on that domain',
                  ],
                },
              ]}
            />
            <FactTable
              columns={['The message', 'What it actually is']}
              monoFirst={false}
              rows={[
                [
                  'A receipt with a “you might also like” block',
                  'A campaign, sent under a transactional label.',
                ],
                [
                  'A shipping notification with a referral offer',
                  'A campaign, sent under a transactional label.',
                ],
                [
                  'A password reset from a dormant account',
                  'A message the recipient did not expect, whatever you call it.',
                ],
                [
                  'An unsubscribe from your receipts',
                  'A real signal — usually that they have stopped using the product, occasionally that your receipts have been carrying marketing.',
                ],
              ]}
              caption="Adding the headers unconditionally removes the flag and the argument it causes."
            />
            <Gotcha title="What this does not mean">
              Carrying the headers is not the same as promising the message is optional. A
              suppression stops mail this system sends; it does not and cannot decide whether your
              application is legally obliged to deliver a particular notice by some other channel.
              If a class of message must reach a user, the answer is a route that is not bulk email
              — in-app, SMS, or post — not an email with its exit removed.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                A practical consequence: separate your sending domains.
              </strong>{' '}
              Marketing volume on one, transactional on another. It does not change the headers, but
              it does mean a campaign’s complaint rate cannot decide whether password resets arrive
              — and it lets you look at two unsubscribe rates that mean different things instead of
              one that means nothing. See{' '}
              <a
                href="/guides/why-email-goes-to-spam"
                className="text-accent underline underline-offset-4"
              >
                why email goes to spam
              </a>{' '}
              for the rest of that argument.
            </p>
          </>
        ),
        suppression: (
          <>
            <Lede>
              An unsubscribe writes two things: a suppression keyed on the normalised address, and a
              flag on the contact. They are separate on purpose, and knowing which is which is what
              makes the import question answerable.
            </Lede>
            <Takeaway>
              The suppression is the authority and the contact flag is the reporting view — which is
              why suppression works for addresses that were never contacts at all.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'The suppression — the authority',
                  tone: 'neutral',
                  points: [
                    'Stored per workspace, keyed on the address after normalisation',
                    <>
                      Reason <Mono>unsubscribe</Mono>, with a source recording that it came from the
                      one-click path
                    </>,
                    'Written for every recipient of the message the token identified',
                    'Mirrored into a fast lookup the send path consults before it does anything else',
                    'Checkable without loading a contact — plenty of mail goes to addresses that are not contacts',
                  ],
                },
                {
                  label: 'The contact flag — the reporting view',
                  tone: 'neutral',
                  points: [
                    'Set only if the message was tied to a contact, with a timestamp',
                    <>
                      Removes them from broadcasts: a page query filters on{' '}
                      <Mono>unsubscribed = 0</Mono> as it walks
                    </>,
                    <>
                      Is what makes <Mono>subscribed</Mono> mean something in{' '}
                      <a
                        href="/guides/segments-query-language"
                        className="text-accent underline underline-offset-4"
                      >
                        a segment expression
                      </a>
                    </>,
                    'Idempotent: unsubscribing twice does not create a second suppression, and a retried POST is harmless',
                  ],
                },
              ]}
            />
            <FactTable
              columns={['Address', 'What happens']}
              rows={[
                [
                  'Ada@Example.com',
                  'Unsubscribes. The suppression is keyed on the normalised form, and the original is kept alongside it.',
                ],
                [
                  'ada@example.com',
                  'Arrives on a later list and is still suppressed — the normalised key is the same one.',
                ],
              ]}
              caption="The original is retained because when someone asks why they are still not receiving mail, the address they typed is the one they will quote at you."
            />
            <Gotcha title="An import never clears a suppression">
              A suppression is cleared only by an explicit re-subscribe — a deliberate action taken
              because that person asked to come back. Uploading a CSV that happens to contain the
              address does not clear it, and must not. An import that silently resurrects
              unsubscribed addresses is precisely how senders reach blocklists: the people it
              revives are, by definition, the people most likely to complain, and they complain
              immediately because they remember leaving.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              This is the rule that will feel wrong at some point, usually when a colleague has a
              spreadsheet from a conference and three hundred of the addresses on it are suppressed.
              The suppression list is the record of people who told you to stop, and a CSV is not
              consent — it is a list of addresses. If someone genuinely opted back in, re-subscribe
              them individually, from a signal you could point to a year later.
            </p>
            <Callout title="ONE MORE MESSAGE AFTER LEAVING IS NOT A BUG">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                The suppression is written the instant the request lands, but messages already
                accepted into the send queue are past that check. Someone who unsubscribes and then
                receives one more message a few minutes later has found the queue depth, not a
                defect. It is why the confirmation page says so in as many words, and it is worth
                having the same sentence in your own preference page if you build one.
              </p>
            </Callout>
          </>
        ),
      }}
    </GuideLayout>
  )
}
