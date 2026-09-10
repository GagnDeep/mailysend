import { Callout } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
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
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                <Mono>List-Unsubscribe</Mono> offers the routes.
              </strong>{' '}
              It carries two: an HTTPS URL and a <Mono>mailto:</Mono>. Both are there because they
              fail differently. The URL is what modern clients use and what the one-click flow posts
              to. The mailto is the fallback that has worked since the 1990s, needs no web
              infrastructure, and is the one a corporate mail gateway with no outbound HTTP will
              use. Offering both costs nothing and removes a class of “the unsubscribe link does not
              work” report you would otherwise never be able to reproduce.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                <Mono>List-Unsubscribe-Post</Mono> is the part that makes the button appear.
              </strong>{' '}
              Its value is fixed — <Mono>List-Unsubscribe=One-Click</Mono>, exactly that string,
              from RFC 8058 — and it is a promise: it tells the receiving client that the URL above
              will accept a POST and act on it without any further interaction. Gmail and Yahoo both
              require the pair for bulk senders, and it is the presence of this second header that
              earns a native, prominent unsubscribe control instead of nothing.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The token in the URL is a signed, self-validating tracking token — it carries the
              message id and the workspace id in its payload with an HMAC prefix — which is why the
              endpoint can decide whether a request is genuine before it touches a database, and why
              you cannot construct a link that unsubscribes someone else. It is scoped to one
              message, which means it identifies not just who is leaving but what they were reading
              when they decided to.
            </p>
            <Callout variant="warn" title="THE HEADER IS NOT A SUBSTITUTE FOR THE LINK">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                Keep a visible unsubscribe link in the body as well. The header serves the mail
                client; the link serves the reader who is actively looking for a way out and does
                not know their client has a button. A reader who wants to leave and cannot find how
                does not give up — they press the spam button, and a complaint costs you far more
                than an unsubscribe does.
              </p>
            </Callout>
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              When someone presses the unsubscribe button in Gmail, Gmail does not open a browser.
              Its infrastructure sends an HTTP POST to your URL, from its own network, with no
              cookies, no session, no browser, and — this is the part that matters — no human
              present to look at whatever you return. The reader has already been shown a
              confirmation by their own mail client. Your job is to record the decision and say so.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              So the POST path is deliberately austere:
            </p>
            <Code>
              <Com>{`# what a receiver sees\n`}</Com>
              {`POST /u/eyJlbWFpbElkIjoi…  HTTP/1.1

`}
              <Key>200</Key>
              {` OK
content-type: text/plain

Unsubscribed.`}
            </Code>
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">No form.</strong> A form is a request for a second action
              from someone who is not there. The unsubscribe would never be recorded, the client
              would report success because it got a 200, and the reader would keep receiving mail
              they have already told two systems they do not want. A one-click endpoint that shows a
              form fails the exact requirement it exists to satisfy.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">No redirect.</strong> There is nothing to redirect to and
              nobody to follow it. A 302 is at best ignored and at worst treated as a failure to
              honour the request.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">No confirmation screen, and no “are you sure”.</strong>{' '}
              The reader already confirmed, in their client, before the POST was sent. Asking again
              would be asking the wrong party.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The GET path is the human one and does render a page — a small confirmation that says
              you are unsubscribed and warns that anything already queued can take a few minutes to
              stop. Note that <em>both</em> verbs act. A GET does not show a “click here to confirm”
              button either: by the time someone has clicked an unsubscribe link in a message, they
              have expressed the intent, and adding a step is the same error as adding a form, only
              aimed at a person instead of a machine.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              An invalid or forged token gets a 400 and a plain sentence saying the link is not
              valid. That is safe to be specific about, unlike the tracking pixel, because there is
              no information to leak: a token either verifies against the signing secret or it does
              not, and telling the caller so does not reveal anything about which message ids exist.
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The case for preferences is real. Most people who unsubscribe are not rejecting you,
              they are rejecting the frequency or the category. Someone who wants the monthly
              product note but not three campaign sends a week will take that option if it is in
              front of them, and you keep a subscriber instead of losing one. That is worth
              building.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              What turns it into a dark pattern is making the exit conditional on navigating it. The
              recognisable failures: an unsubscribe that requires signing in; a page that offers six
              frequency options and no “none”; a “manage preferences” link that is the only route
              out of the message; unticking twelve categories individually to leave; or a
              confirmation step after the confirmation step. Each of these converts a person who
              would have unsubscribed into a person who marks you as spam — and the receiver does
              not record that you offered them choices, only that a reader called your mail junk.
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The other half of the rule is structural. Whatever your preference page offers, the{' '}
              <Mono>List-Unsubscribe</Mono> URL must go on doing the simple thing: record the
              unsubscribe, immediately, with no interaction. Those are two different surfaces with
              two different callers, and the header path is not permitted to route through the page.
              If a reader can leave from the mail client, they will — that is the whole reason the
              header works — and they must never land on a screen there.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Worth being straightforward about what this product does today: the built-in{' '}
              <Mono>/u/</Mono> endpoint is a full unsubscribe, not a preference selector. If you
              want category-level preferences you build that page yourself against the contacts API
              and link it from your template alongside — not instead of — the unsubscribe link. The
              headers are added by the send path regardless, so the contract with Gmail and Yahoo
              holds whether or not you ever build one.
            </p>
          </>
        ),
        transactional: (
          <>
            <Lede>
              Every message gets the headers. Receipts, password resets, invoices, shipping
              notifications, the lot. This surprises people, and the reasoning is worth stating
              because the alternative sounds sensible right up until you look at what it requires.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The argument for stripping them on transactional mail goes: this message is not
              marketing, the reader needs it, and offering an exit invites them to break their own
              account. Every clause of that is a decision made on the reader’s behalf about what
              they are allowed to leave — and you are not the one who gets to make it. “You need
              this” from the sender’s side is exactly what the person clicking the spam button
              disagrees with.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              There is a mechanical argument as well, and it is the one that settles it in practice.
              The category boundary is not real. A receipt with a “you might also like” block is a
              campaign. A shipping notification with a referral offer is a campaign. A password
              reset from a dormant account is a message the recipient did not expect. Every system
              that tries to classify mail into “transactional” and “marketing” at send time ends up
              with a flag someone sets by hand, and that flag is wrong in the direction of the
              sender’s interests, every time. Adding the headers unconditionally removes the flag
              and the argument it causes.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              And the fear is misplaced. Readers do not casually unsubscribe from mail they want. A
              person who unsubscribes from your receipts is telling you something real — usually
              that they have stopped using the product, occasionally that your receipts have been
              carrying marketing. Either way you would rather know than have them press the spam
              button, which is the only other tool they have and the one that damages every message
              you send to everyone else on that domain.
            </p>
            <Callout variant="warn" title="WHAT THIS DOES NOT MEAN">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                Carrying the headers is not the same as promising the message is optional. A
                suppression stops mail this system sends; it does not and cannot decide whether your
                application is legally obliged to deliver a particular notice by some other channel.
                If a class of message must reach a user, the answer is a route that is not bulk
                email — in-app, SMS, or post — not an email with its exit removed.
              </p>
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              A practical consequence: separate your sending domains. Marketing volume on one,
              transactional on another. It does not change the headers, but it does mean a
              campaign’s complaint rate cannot decide whether password resets arrive — and it lets
              you look at two unsubscribe rates that mean different things instead of one that means
              nothing. See{' '}
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The suppression is the authority.</strong> It is stored
              per workspace, keyed on the address after normalisation, with a reason of{' '}
              <Mono>unsubscribe</Mono> and a source recording that it came from the one-click path.
              It is written for every recipient of the message the token identified, and it is also
              mirrored into a fast lookup the send path consults before it does anything else. That
              is the point of having it: suppression has to be checkable without loading a contact,
              because plenty of mail goes to addresses that are not contacts at all.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The contact flag is the reporting view.</strong> If the
              message was tied to a contact, that contact is marked unsubscribed with a timestamp.
              This is what removes them from broadcasts — a broadcast page query filters on{' '}
              <Mono>unsubscribed = 0</Mono> as it walks — and what makes <Mono>subscribed</Mono>{' '}
              mean something in{' '}
              <a
                href="/guides/segments-query-language"
                className="text-accent underline underline-offset-4"
              >
                a segment expression
              </a>
              . The write is idempotent: unsubscribing twice does not create a second suppression,
              and a repeated POST from a client that retried is harmless.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Normalisation matters here. Suppressions are keyed on a normalised form of the address
              while the original is kept alongside it, so a reader who unsubscribes as{' '}
              <Mono>Ada@Example.com</Mono> is not resurrected by a list containing{' '}
              <Mono>ada@example.com</Mono>. The original is retained because when someone asks why
              they are still not receiving mail, the address they typed is the one they will quote
              at you.
            </p>
            <Callout variant="warn" title="AN IMPORT NEVER CLEARS A SUPPRESSION">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                A suppression is cleared only by an explicit re-subscribe — a deliberate action
                taken because that person asked to come back. Uploading a CSV that happens to
                contain the address does not clear it, and must not. An import that silently
                resurrects unsubscribed addresses is precisely how senders reach blocklists: the
                people it revives are, by definition, the people most likely to complain, and they
                complain immediately because they remember leaving.
              </p>
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              This is the rule that will feel wrong at some point, usually when a colleague has a
              spreadsheet from a conference and three hundred of the addresses on it are suppressed.
              The suppression list is the record of people who told you to stop, and a CSV is not
              consent — it is a list of addresses. If someone genuinely opted back in, re-subscribe
              them individually and deliberately, from a signal you could point to if you were asked
              about it a year later.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              One last piece of timing, since it produces the most common support question. The
              suppression is written the instant the request lands, but messages already accepted
              into the send queue are past that check. Someone who unsubscribes and then receives
              one more message a few minutes later has not found a bug — they have found the queue
              depth. It is why the confirmation page says so in as many words, and it is worth
              having the same sentence in your own preference page if you build one.
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
