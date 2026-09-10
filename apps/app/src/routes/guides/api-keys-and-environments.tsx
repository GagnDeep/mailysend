import { Callout, StepCard, Terminal } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono, Str } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'api-keys-and-environments'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/api-keys-and-environments')({
  head: () => guideHead(SLUG),
  component: Page,
})

const PERMISSIONS: Array<[string, string, string]> = [
  [
    'full_access',
    'Everything the API can do',
    'Send, read messages and events, manage contacts, domains, templates, webhooks and other keys. This is the default, and it is the one to think twice about.',
  ],
  [
    'sending_access',
    'One scope: send email',
    'No contact reads, no domain changes, no key management, no configuration. The right credential for an application server whose only job is to put messages in the queue.',
  ],
]

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You know what a key looks like, why the environment is baked into the string rather than
          kept in a config file somewhere else, and why nobody can ever read one back to you. The
          thing to internalise now, while nothing is on fire, is the rotation order: overlap, cut
          over, revoke. Doing it in any other order gives you a window where production has no
          working credential, and that window always turns out to be during a deploy.
        </p>
      }
    >
      {{
        'the-prefix': (
          <>
            <Lede>
              A key is a prefix plus twenty-four random bytes in base64url — forty characters in
              total, of which the first eight tell you, and anyone who ever sees it, which world it
              acts on.
            </Lede>
            <Code>
              <Str>{'ms_live_'}</Str>
              {'V2h5IGFyZSB5b3UgcmVhZGluZyB0aA   '}
              <Com>{'← production. Real recipients.'}</Com>
              {'\n'}
              <Str>{'ms_test_'}</Str>
              {'aXMgYmFzZTY0IGluIGEgZG9jcz8g   '}
              <Com>{'← the test environment.'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              This mirrors Stripe's scheme deliberately, and not out of flattery. The useful
              property is that the environment is <em>visible in the string itself</em>. It survives
              being pasted into a Slack thread, screenshotted into a bug report, printed by an
              over-eager logger, or read aloud over a call. Every one of those is a moment where
              somebody could notice — and the alternative design, where the environment lives in a
              separate <Mono>MAILYSEND_ENV</Mono> variable, has no such moment. You find out which
              world you were in when the email arrives.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Twenty-four bytes is 192 bits of entropy, which is not a number chosen to sound
              impressive: it is comfortably past the point where guessing is the attack. Nobody
              brute-forces a key like this. They find it in a repository, in a CI log, or in a
              screenshot — which is why the rest of this guide is about handling rather than about
              key length.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The environment is checked twice.</strong> The prefix
              says one thing and the stored row says another, and both are written at the same
              moment when the key is minted. If they ever disagree, the row has been hand-edited or
              tampered with, and the request is refused rather than resolved in favour of the
              friendlier answer. In the same spirit, a key inherits the environment of whoever
              minted it: a session operating in test mode cannot hand out a live-sending credential
              by accident, because there is no code path where it could.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The shape is also checked before anything else happens. A token that does not match{' '}
              <Mono>ms_(live|test)_</Mono> followed by at least twenty URL-safe characters is
              rejected on the spot — no hash, no cache read, no database round trip. That is a
              performance decision as much as a security one: a scanner spraying random bearer
              tokens at <Mono>/v1</Mono> should cost you a regular expression, not a query.
            </p>
          </>
        ),
        permissions: (
          <>
            <Lede>
              There are exactly two permission levels. Not a scope matrix, not a role builder, not a
              policy language — two values, and you can hold both of them in your head while looking
              at a form.
            </Lede>
            <div className="flex flex-col gap-3">
              {PERMISSIONS.map(([name, one, two]) => (
                <div key={name} className="rounded-tile border border-line bg-card p-4">
                  <div className="font-mono text-[13px] font-bold text-accent">{name}</div>
                  <p className="mt-1 mb-1.5 text-[15.5px] font-semibold text-ink">{one}</p>
                  <p className="m-0 text-[14.5px] leading-[1.6] text-muted">{two}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              The argument for two rather than twenty is that a permission model people do not
              understand is a permission model everybody sets to admin. A twelve-checkbox scope
              matrix looks more rigorous and produces worse outcomes, because the person creating
              the key at four in the afternoon does not know which six of the twelve their
              integration needs, and the safe-feeling move — tick them all — is the unsafe one. One
              narrow role that is obviously correct for the common case beats a flexible one that is
              quietly wrong in practice.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              And <Mono>sending_access</Mono> genuinely is the common case. Most integrations are an
              application server that renders a receipt and posts it to <Mono>/v1/emails</Mono>.
              That server has no business listing your contacts, and if it is ever compromised the
              difference between the two levels is the difference between "somebody sent mail from
              our domain" and "somebody has our mailing list".
            </p>
            <Callout title="TWO MORE NARROWING TOOLS, EASY TO MISS">
              A key can be pinned to a single <Mono>domain_id</Mono>, so a credential handed to one
              product cannot send as another. And a key can carry an <Mono>expires_at</Mono>, which
              is the honest way to hand a contractor access: a credential that stops working on its
              own is one you cannot forget to revoke. Both are set at creation.
            </Callout>
            <Code>
              <Key>POST</Key>
              {' /v1/api-keys\n{\n  '}
              <Key>{'"name"'}</Key>
              {': '}
              <Str>{'"checkout-service"'}</Str>
              {',\n  '}
              <Key>{'"permission"'}</Key>
              {': '}
              <Str>{'"sending_access"'}</Str>
              {',\n  '}
              <Key>{'"domain_id"'}</Key>
              {': '}
              <Str>{'"dom_4Rk"'}</Str>
              {',\n  '}
              <Key>{'"expires_at"'}</Key>
              {': '}
              <Str>{'"2027-01-01T00:00:00Z"'}</Str>
              {'\n}'}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Creating a key is itself a privileged action: it needs a developer role and a key that
              can manage keys. A <Mono>sending_access</Mono> credential cannot mint itself a better
              one, which is the property that makes the narrow scope worth anything at all.
            </p>
          </>
        ),
        storage: (
          <>
            <Lede>
              The token is generated, returned in exactly one API response, and then it is gone.
              What stays behind is a SHA-256 hash and a twelve-character preview. There is no
              endpoint that returns a token, and no query in the codebase that reads the hash into a
              response body.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              This is the property worth being unfriendly about. If a key could be read back, then
              the database would contain a set of working credentials, and every backup, every
              replica, every debugging export and every support engineer with read access would be
              holding them too. Storing only the hash means a database dump yields nothing usable:
              you cannot present a SHA-256 digest to <Mono>/v1/emails</Mono> and have it send
              anything. Authentication works by hashing what the caller presented and looking for
              that digest — the same direction, never the reverse.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The unavoidable cost is the one people complain about: losing a key means creating a
              new one. That is not an oversight to be worked around, it is the same property viewed
              from your side rather than an attacker's, and any feature that softened it would
              soften it for both of you.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">So what is the preview for?</strong> Telling two keys
              apart. It is the first twelve characters, an ellipsis, and the last four —{' '}
              <Mono>ms_live_V2h5…dGhp</Mono>. Twelve is not arbitrary: the prefix is eight
              characters, so the preview shows the environment plus four characters of the secret,
              which is enough to match against what is in your secrets manager and nowhere near
              enough to be a credential. It is what lets a colleague say "the one ending{' '}
              <Mono>dGhp</Mono>" in an incident channel without saying anything dangerous.
            </p>
            <Terminal
              lines={[
                {
                  kind: 'command',
                  text: 'curl -s $BASE/v1/api-keys -H "Authorization: Bearer $KEY"',
                },
                { kind: 'output', text: '{ "data": [' },
                {
                  kind: 'output',
                  text: '  { "id": "key_9Fb", "name": "checkout-service", "token_preview": "ms_live_V2h5…dGhp",',
                },
                {
                  kind: 'output',
                  text: '    "permission": "sending_access", "environment": "live", "revoked_at": null }',
                },
                { kind: 'output', text: '] }' },
              ]}
            />
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              One operational detail that matters later: resolving a key hits the database once and
              is then cached for five minutes, because the send path cannot afford a lookup per
              request. Revocation does not wait out that cache — it deletes the cached entry in the
              same request, and does so before responding, so a 200 from the revoke call means the
              key is dead now rather than dead soon.
            </p>
          </>
        ),
        rotation: (
          <>
            <Lede>
              Rotation is three steps in one specific order. The order is the whole content of this
              section, because two of the six possible orderings work and the other four contain a
              window where production is holding a credential that no longer authenticates.
            </Lede>
            <div className="flex flex-col gap-3.5">
              <StepCard
                step={1}
                title="Overlap — create the new key while the old one still works"
                variant="rule"
              >
                <p className="mt-1.5 mb-0 text-[15px] leading-[1.65] text-muted">
                  Mint the replacement with the same permission, the same domain pin, and a name
                  that says when and why. Nothing is using it yet. Both keys are now valid, which is
                  the entire point: there is no instant at which zero keys work.
                </p>
              </StepCard>
              <StepCard step={2} title="Cut over — deploy the new value" variant="rule">
                <p className="mt-1.5 mb-0 text-[15px] leading-[1.65] text-muted">
                  Update the secret in your secrets manager and roll your services. Then wait for
                  every long-lived process to actually pick it up — a worker that read its
                  environment at boot three weeks ago is still using the old key no matter what your
                  configuration says, and a cron job that runs monthly has not run yet.
                </p>
              </StepCard>
              <StepCard step={3} title="Revoke — retire the old key" variant="rule">
                <p className="mt-1.5 mb-0 text-[15px] leading-[1.65] text-muted">
                  Only once nothing is using it. Revoking marks the row rather than deleting it, so
                  the key that a future investigation cares about is still there to be named.
                </p>
              </StepCard>
            </div>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              Reverse steps two and three — revoke first, then deploy — and you have deliberately
              created an outage whose length is however long your deploy takes, plus however long it
              takes someone to notice. Skip step one and deploy a key that does not exist yet, and
              you get the same outage with a more confusing error message. The overlap is what turns
              rotation from an operation into a non-event, and a non-event is something you will
              actually do quarterly instead of never.
            </p>
            <Callout title="ROTATE ON A CALENDAR, NOT ON AN INCIDENT">
              A team that has rotated a key on a quiet Tuesday knows how long step two really takes
              in their environment. A team that has never rotated one is discovering that during an
              incident, under time pressure, while also trying to work out what leaked. The
              rehearsal is most of the value.
            </Callout>
          </>
        ),
        leaked: (
          <>
            <Lede>
              A key is in a public repository, a CI log, a screenshot in a ticket, or a client-side
              bundle. The order here is not the same as rotation, and getting it right matters more,
              because every minute you spend understanding the leak is a minute the key still works.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Revoke first. Investigate second.</strong> The instinct
              is to first work out whether it was really exposed, whether the repository was
              private, whether anyone could have seen it. Resist it. Revocation is cheap, reversible
              in the only sense that matters — you can always mint a replacement — and it is the
              only action that stops the bleeding. The investigation will still be there in ten
              minutes; the window will not.
            </p>
            <Terminal
              lines={[
                {
                  kind: 'command',
                  text: 'curl -X DELETE $BASE/v1/api-keys/key_9Fb -H "Authorization: Bearer $ADMIN_KEY"',
                },
                {
                  kind: 'success',
                  text: '{ "object": "api_key", "id": "key_9Fb", "revoked_at": "…", "deleted": true }',
                },
              ]}
            />
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              That response is the confirmation, not an acknowledgement: the cached entry is dropped
              before it returns. Then, in this order — mint a replacement, deploy it, purge the
              value from wherever it leaked (rewriting the git history if that is what it takes; a
              revoked key in a commit is still a signal about your naming and your habits), and only
              then start reconstructing what happened.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Now the honest part: what the trail can and cannot tell you.
              </strong>
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              What you <em>can</em> establish is what was sent. Every message is a row, with its
              sender, its recipients, its subject, its environment and its timestamp, and every
              delivery event is queryable. If the leaked key was used to send, that mail is in your
              message list and you can read it. A sudden run of sends you cannot account for, or
              sends from a domain that service never uses, is the strongest evidence available and
              it is usually enough to answer the question that actually matters — was it used, and
              for what.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              What you <em>cannot</em> do today is attribute a specific send to a specific key. A
              message row records the workspace, not the credential that created it, so with two
              live keys in one workspace the message log will not tell you which one sent a given
              message. If that distinction matters to you, the practical answer is to give each
              integration its own domain pin or its own sending domain, so the message itself
              carries the attribution that the row does not.
            </p>
            <Callout variant="warn" title="LAST USED IS NOT YET A SIGNAL">
              The API key resource carries a <Mono>last_used_at</Mono> field and the dashboard
              renders it. Nothing on the authentication path writes it today, so it stays null and
              an unused key is indistinguishable from a busy one by that field alone. We would
              rather say so here than have you build an incident timeline on a column that is not
              being maintained. Use the message and event logs, which are.
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The other thing worth knowing before you need it: revocation marks the row rather than
              deleting it. The key stays listed, with its name, its preview, its permission and the
              moment it was retired. An audit trail that erases the credential an incident was
              traced to is not an audit trail, and "there is no record of that key" is not a
              sentence you want to write in a post-mortem.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Finally, prevention that actually works: keep <Mono>ms_live_</Mono> out of anything a
              browser downloads, add a secret scanner to CI that fails the build on the prefix — it
              is a distinctive, greppable eight characters, which is another quiet argument for the
              scheme — and prefer <Mono>sending_access</Mono> everywhere it will do, so that the
              worst case of a leak is bounded before it happens. If an agent is going to be holding
              one of these, the{' '}
              <a
                href="/guides/mcp-agent-inbox"
                className="text-accent underline underline-offset-4"
              >
                agent inbox guide
              </a>{' '}
              covers the confirmation gate that sits in front of sending regardless of what the key
              allows.
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
