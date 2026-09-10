// biome-ignore-all lint/complexity/noUselessFragments: a single-element FactTable cell must stay
// wrapped. Unwrapped, the row literal trips useJsxKeyInIterable — an error rather than an info,
// and a false one, since FactTable keys its own cells from the row key and the column name.
import { Callout, StepCard, Terminal } from '@mailysend/ui'
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

const SLUG = 'api-keys-and-environments'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/api-keys-and-environments')({
  head: () => guideHead(SLUG),
  component: Page,
})

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
            <Takeaway>
              Eight characters of environment, thirty-two characters of secret. The environment
              travels inside the credential, so a test key in a production log is something a person
              can notice rather than something you find out about when the mail arrives.
            </Takeaway>
            <Code>
              <Str>{'ms_live_'}</Str>
              {'V2h5IGFyZSB5b3UgcmVhZGluZyB0aA   '}
              <Com>{'← production. Real recipients.'}</Com>
              {'\n'}
              <Str>{'ms_test_'}</Str>
              {'aXMgYmFzZTY0IGluIGEgZG9jcz8g   '}
              <Com>{'← the test environment.'}</Com>
            </Code>
            <FactTable
              columns={['Part', 'What it is', 'Why it is that']}
              rows={[
                [
                  'ms_live_ · ms_test_',
                  'Eight characters of prefix',
                  'The environment, visible in the string itself — in a Slack thread, a screenshot, a logger’s output, or read aloud on a call. The alternative design, where the environment lives in a separate MAILYSEND_ENV variable, has no such moment.',
                ],
                [
                  '24 random bytes',
                  'base64url, thirty-two characters',
                  '192 bits of entropy — not a number chosen to sound impressive, just comfortably past the point where guessing is the attack. Nobody brute-forces one of these; they find it in a repository, a CI log or a screenshot.',
                ],
                [
                  '40 characters in total',
                  'Prefix plus secret',
                  'The whole token, returned in exactly one API response and never again.',
                ],
                [
                  'ms_live_V2h5…dGhp',
                  'The stored preview: first twelve, ellipsis, last four',
                  'Twelve is not arbitrary — the prefix is eight, so the preview shows the environment plus four characters of the secret. Enough to match against your secrets manager, nowhere near enough to be a credential.',
                ],
                [
                  '^ms_(live|test)_[A-Za-z0-9_-]{20,}$',
                  'The shape check, before anything else',
                  'A token that does not match is rejected on the spot — no hash, no cache read, no database round trip. A scanner spraying random bearer tokens at /v1 should cost you a regular expression, not a query.',
                ],
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">This mirrors Stripe's scheme deliberately</strong>, and
              not out of flattery. Every property in that table is about handling rather than about
              key length, because handling is where keys are actually lost.
            </p>
            <Gotcha title="The environment is checked twice">
              The prefix says one thing and the stored row says another, and both are written at the
              same moment when the key is minted. If they ever disagree, the row has been
              hand-edited or tampered with, and the request is refused rather than resolved in
              favour of the friendlier answer. In the same spirit, a key inherits the environment of
              whoever minted it: a session operating in test mode cannot hand out a live-sending
              credential by accident, because there is no code path where it could.
            </Gotcha>
          </>
        ),
        permissions: (
          <>
            <Lede>
              There are exactly two permission levels. Not a scope matrix, not a role builder, not a
              policy language — two values, and you can hold both of them in your head while looking
              at a form.
            </Lede>
            <Takeaway>
              <Mono>full_access</Mono> carries the wildcard scope; <Mono>sending_access</Mono>{' '}
              carries exactly one, <Mono>emails:send</Mono>. Everything below is what that one scope
              does and does not reach.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'full_access — the default',
                  tone: 'neutral',
                  points: [
                    'Everything the API can do: send, read messages and events, manage contacts, domains, templates, webhooks and other keys.',
                    'It is the default, and it is the one to think twice about.',
                  ],
                },
                {
                  label: 'sending_access — one scope',
                  tone: 'good',
                  points: [
                    <>
                      Exactly one scope, <Mono>emails:send</Mono>. No writes to contacts, domains,
                      webhooks or other keys.
                    </>,
                    'The right credential for an application server whose only job is to put messages in the queue.',
                  ],
                },
              ]}
            />
            <FactTable
              columns={['Scope', 'Held by', 'What it guards']}
              rows={[
                [
                  'emails:send',
                  'Both levels',
                  <>
                    <Mono>POST /v1/emails</Mono> and <Mono>POST /v1/emails/batch</Mono>
                  </>,
                ],
                [
                  'contacts:read',
                  'full_access only',
                  <>
                    <Mono>GET /v1/contacts/search</Mono>
                  </>,
                ],
                [
                  'contacts:write',
                  'full_access only',
                  'Creating, importing, updating and deleting contacts',
                ],
                ['audiences:write', 'full_access only', 'Creating and editing audiences'],
                ['segments:write', 'full_access only', 'Creating and editing segments'],
                [
                  'automations:write',
                  'full_access only',
                  'Creating, editing and running automations',
                ],
                ['inbound:write', 'full_access only', 'Inbound routing configuration'],
                [
                  'webhooks:write',
                  'full_access only',
                  'Creating, updating, deleting and test-sending endpoints',
                ],
                [<>api_keys:write</>, 'full_access only', 'Minting and revoking keys'],
              ]}
              caption="The refusal names the scope it wanted: “This API key is limited to sending; `webhooks:write` requires a full-access key.”"
            />
            <Gotcha title="The scope check is per route, and some read routes do not declare one">
              A route is guarded because its handler calls <Mono>requireScope</Mono>, so a handler
              that does not call it is reachable by any valid key. <Mono>GET /v1/contacts</Mono> and{' '}
              <Mono>GET /v1/contacts/:id</Mono> do not call it today — only{' '}
              <Mono>GET /v1/contacts/search</Mono> does — so a <Mono>sending_access</Mono> key can
              still read contacts through those two. Treat the narrow level as a bound on what a key
              may <em>change</em>, not yet as a guarantee about what it can see.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Two rather than twenty is the actual argument here.
              </strong>{' '}
              A permission model people do not understand is a permission model everybody sets to
              admin. A twelve-checkbox scope matrix looks more rigorous and produces worse outcomes,
              because the person creating the key at four in the afternoon does not know which six
              of the twelve their integration needs, and the safe-feeling move — tick them all — is
              the unsafe one.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              And <Mono>sending_access</Mono> genuinely is the common case. Most integrations are an
              application server that renders a receipt and posts it to <Mono>/v1/emails</Mono>. If
              it is ever compromised, the difference between the two levels is the difference
              between “somebody sent mail from our domain” and “somebody has our mailing list”.
            </p>
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
            <Callout title="EXPIRY IS THE HONEST WAY TO LEND ACCESS">
              A key can carry an <Mono>expires_at</Mono>, and authentication enforces it: past that
              moment the key is refused exactly as a revoked one is. It is the right shape for
              handing a contractor access, because a credential that stops working on its own is one
              you cannot forget to revoke. Set at creation, alongside the permission.
            </Callout>
            <Gotcha title="The domain pin is recorded, not enforced">
              A key may also carry a <Mono>domain_id</Mono>. It is validated at creation against the
              domains in your workspace, stored on the row, and returned on the key resource — and
              nothing on the send path reads it. The actor a request resolves to has no domain on
              it, so a pinned key can still send as any verified domain in the workspace. Until that
              changes, one sending domain per integration is the pin that actually holds.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Creating a key is itself a privileged action: it needs the <Mono>api_keys:write</Mono>{' '}
              scope and at least a developer role. A <Mono>sending_access</Mono> credential cannot
              mint itself a better one, which is the property that makes the narrow scope worth
              anything at all.
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
            <Takeaway>
              Authentication hashes what the caller presented and looks for that digest. The same
              direction, never the reverse — which is why a database dump yields nothing usable.
            </Takeaway>
            <Diagram
              steps={[
                { kicker: 'SHAPE', title: 'Regex', meta: 'no hash, no I/O' },
                { kicker: 'HASH', title: 'SHA-256, hex' },
                {
                  kicker: 'CACHE',
                  title: <>KV ak:&lt;hash&gt;</>,
                  meta: '300s TTL',
                  tone: 'accent',
                },
                { kicker: 'ROW', title: 'revoked_at · expires_at', meta: 'then the environment' },
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                This is the property worth being unfriendly about.
              </strong>{' '}
              If a key could be read back, the database would contain a set of working credentials,
              and every backup, every replica, every debugging export and every support engineer
              with read access would be holding them too. You cannot present a SHA-256 digest to{' '}
              <Mono>/v1/emails</Mono> and have it send anything.
            </p>
            <Gotcha title="A lost key is not recoverable, and that is the same property">
              Losing a key means creating a new one. That is not an oversight to be worked around,
              it is the guarantee above viewed from your side rather than an attacker's, and any
              feature that softened it would soften it for both of you.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">So what is the preview for?</strong> Telling two keys
              apart. It is what lets a colleague say “the one ending <Mono>dGhp</Mono>” in an
              incident channel without saying anything dangerous.
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
            <Takeaway>Overlap, cut over, revoke. In that order, nothing is ever offline.</Takeaway>
            <div className="flex flex-col gap-3.5">
              <StepCard
                step={1}
                title="Overlap — create the new key while the old one still works"
                variant="rule"
                description="Mint the replacement with the same permission, the same domain pin, and a name that says when and why. Nothing is using it yet. Both keys are now valid, which is the entire point: there is no instant at which zero keys work."
              />
              <StepCard
                step={2}
                title="Cut over — deploy the new value"
                variant="rule"
                description="Update the secret in your secrets manager and roll your services. Then wait for every long-lived process to actually pick it up — a worker that read its environment at boot three weeks ago is still using the old key no matter what your configuration says, and a cron job that runs monthly has not run yet."
              />
              <StepCard
                step={3}
                title="Revoke — retire the old key"
                variant="rule"
                description="Only once nothing is using it. Revoking marks the row rather than deleting it, so the key that a future investigation cares about is still there to be named."
              />
            </div>
            <Contrast
              sides={[
                {
                  label: 'Overlap → cut over → revoke',
                  tone: 'good',
                  points: [
                    'Two valid keys for the duration, so there is no instant at which zero work.',
                    'Rotation becomes a non-event, and a non-event is something you will actually do quarterly instead of never.',
                  ],
                },
                {
                  label: 'Revoke → deploy, or deploy → mint',
                  tone: 'bad',
                  points: [
                    'Revoking first is a deliberate outage as long as your deploy takes, plus however long it takes somebody to notice.',
                    'Skipping the overlap deploys a key that does not exist yet — the same outage, with a more confusing error message.',
                  ],
                },
              ]}
            />
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
            <Takeaway>
              Revoke first. Investigate second. Revocation is cheap and you can always mint a
              replacement; the window will not still be there in ten minutes, and the investigation
              will.
            </Takeaway>
            <Diagram
              steps={[
                { kicker: '1', title: 'Revoke', tone: 'accent' },
                { kicker: '2', title: 'Mint a replacement' },
                { kicker: '3', title: 'Deploy it' },
                { kicker: '4', title: 'Purge the leaked value' },
                { kicker: '5', title: 'Reconstruct what happened' },
              ]}
            />
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
              before it returns. Purging means rewriting the git history if that is what it takes —
              a revoked key in a commit is still a signal about your naming and your habits.
            </p>
            <Contrast
              sides={[
                {
                  label: 'What the trail can establish',
                  tone: 'good',
                  points: [
                    'What was sent. Every message is a row, with its sender, its recipients, its subject, its environment and its timestamp, and every delivery event is queryable.',
                    'If the leaked key was used to send, that mail is in your message list and you can read it.',
                    'A sudden run of sends you cannot account for, or sends from a domain that service never uses, is the strongest evidence available — and it usually answers the question that actually matters.',
                  ],
                },
                {
                  label: 'What it cannot',
                  tone: 'bad',
                  points: [
                    'Which key sent a given message. The row records the workspace, not the credential.',
                    'Whether a key was used at all, from the key resource itself.',
                    'The practical answer to both: give each integration its own sending domain, so the message carries the attribution the row does not.',
                  ],
                },
              ]}
            />
            <Gotcha title="Last used is not yet a signal">
              The API key resource carries a <Mono>last_used_at</Mono> field and the dashboard
              renders it. Nothing on the authentication path writes it today, so it stays null and
              an unused key is indistinguishable from a busy one by that field alone. We would
              rather say so here than have you build an incident timeline on a column that is not
              being maintained. Use the message and event logs, which are.
            </Gotcha>
            <Gotcha title="A send cannot be attributed to a specific key">
              A message row records the workspace, not the credential that created it. With two live
              keys in one workspace, the message log will not tell you which one sent a given
              message — so “was this key used to send this?” is a question the data cannot answer.
              If that distinction matters, separate the integrations by sending domain and let the
              message itself carry the attribution.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Revocation marks the row rather than deleting it.
              </strong>{' '}
              The key stays listed, with its name, its preview, its permission and the moment it was
              retired. An audit trail that erases the credential an incident was traced to is not an
              audit trail, and “there is no record of that key” is not a sentence you want to write
              in a post-mortem.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Finally, prevention that actually works: keep <Mono>ms_live_</Mono> out of anything a
              browser downloads, add a secret scanner to CI that fails the build on the prefix — it
              is a distinctive, greppable eight characters, which is another quiet argument for the
              scheme — and prefer <Mono>sending_access</Mono> everywhere it will do. If an agent is
              going to be holding one of these, the{' '}
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
