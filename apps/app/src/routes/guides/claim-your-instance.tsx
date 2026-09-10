import { Callout, StepCard, Terminal } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Lede, Mono } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'claim-your-instance'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/claim-your-instance')({
  head: () => guideHead(SLUG),
  component: Page,
})

const DOORS: Array<{ name: string; good: string; cost: string }> = [
  {
    name: 'Passkey',
    good: 'Always available, phishing-resistant, and the credential the claim itself is made with — it needs no email, no DNS and no identity provider, which is exactly why a brand-new deployment can create one. Discoverable, so signing in later types no address at all.',
    cost: 'Bound to the hostname it was registered on. Move the instance to another host and every passkey enrolled on the old one stops working there; register two, and pin MS_PUBLIC_URL before you enrol either.',
  },
  {
    name: 'Recovery code',
    good: 'Ten, issued once when you claim, single-use and enforced in the UPDATE rather than in application code. This is the answer to “the laptop with the passkey is gone”, and the reason the product lets you remove your last passkey at all.',
    cost: 'Shown exactly once. Store them somewhere that is not the laptop holding the passkey, or you have two copies of the same failure.',
  },
  {
    name: 'Cloudflare Access',
    good: 'Your identity provider decides who reaches the instance, and the assertion is verified properly — signature against your team’s published keys, iss against the team domain, aud against the application tag, exp and iat against the clock.',
    cost: 'Appears only when MS_ACCESS_TEAM and MS_ACCESS_AUD are both set. Worth it if your team already runs Access; overhead if it would exist only for this.',
  },
  {
    name: 'Emailed one-time code',
    good: 'Nothing to configure and no password to leak: six digits, ten minutes, five attempts. The response never varies with the address — whether an account exists, whether it is suppressed, whether the code was logged rather than sent — because a sign-in form that answers that question is an enumeration endpoint.',
    cost: 'Offered only once a sending domain is verified, and it sends through this deployment. If your sending is broken, so is this door — which is the whole argument for keeping a second one open.',
  },
  {
    name: 'OIDC',
    good: 'Central provisioning and de-provisioning, the right answer past a couple of people. Authorization Code with PKCE (S256), state and nonce in a short-lived signed cookie, JWKS-verified signatures, alg:none refused outright, and email_verified required — with claims read only after the signature verifies.',
    cost: 'Three variables must all be set before the button renders, discovery and JWKS are cached for an hour, and auto-provisioning an unknown address needs a domain allowlist as well as the flag. A misconfigured redirect URI locks everyone out at once.',
  },
  {
    name: 'CLI device flow',
    good: 'For programs and for your own terminal: npx mailysend login prints a short code, you approve it in a browser that is already signed in, and the CLI receives a full-access key named after the client.',
    cost: 'What it hands back is an API key, not a human session. Revoke it from Settings → Access like any other key, and do not treat a key as a sign-in method for a person.',
  },
]

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          The instance has an owner — you — the first-run path is permanently closed, and you can
          sign in by at least two independent routes. That last part is the one people skip and
          regret: a single sign-in method on infrastructure that sends its own login codes is a
          circular dependency waiting for a bad afternoon.
        </p>
      }
    >
      {{
        'why-a-claim': (
          <>
            <Lede>
              A deployed instance is a public URL before it is anybody’s. There is no central
              account system to have registered with in advance — that is the whole design — so the
              first-run flow cannot be a sign-up. It is a claim: a one-time proof that the person at
              the keyboard is the person who deployed it.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Everything else needs something you do not have yet.
              </strong>{' '}
              A fresh deployment has no verified sending domain, so it cannot email you a code. It
              has no identity provider, so Cloudflare Access answers nothing. It has nobody in{' '}
              <Mono>memberships</Mono>, so there is no account to sign into. A passkey is the one
              credential that needs none of that: the browser already open on the page creates it,
              and it is the strongest of the lot. So claiming is “prove you have a browser pointed
              at this instance, and that you read its log”, and then write down ten recovery codes.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The claim code is what makes first-claimant-wins safe.
              </strong>{' '}
              First boot mints one and prints it once into the deployment’s log, alongside the
              bootstrap API key, and stores only its SHA-256. Reading a Worker’s log —{' '}
              <Mono>wrangler tail</Mono>, or the Worker’s <em>Logs</em> tab — is something only the
              person who deployed it can do, and it needs no email, no DNS and no identity provider,
              which is the same reason a passkey is the claim credential. Whoever else finds the URL
              cannot claim it.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The window is genuinely a window.</strong> Once an owner
              exists the claim path is closed and cannot be reopened, including by you: every{' '}
              <Mono>/v1/setup/*</Mono> route refuses with <Mono>instance_claimed</Mono>. A
              re-openable first-run path is an account takeover with extra steps. Two people opening{' '}
              <Mono>/setup</Mono> at the same moment also produce exactly one owner — the claim row
              is written first and alone, as a conditional insert, so the loser writes zero rows and
              is refused <em>before</em> any credential of theirs reaches the database. Done the
              other way round, the loser would be left holding a working passkey, which is a sign-in
              rather than a failed setup.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Upgrading an older deployment does not open a window.
              </strong>{' '}
              The first boot after the upgrade marks any instance that already has a member as
              claimed, so <Mono>/setup</Mono> cannot be used to take over a running deployment. An
              instance with no member at all stays unclaimed — which is precisely the case{' '}
              <Mono>/setup</Mono> exists for: a deploy nobody ever managed to sign into. Such an
              instance has no stored claim code either, and so is not asked for one, rather than
              being permanently unclaimable.
            </p>
          </>
        ),
        'claim-it': (
          <>
            <Lede>
              Two minutes, and the safe version is the one where you decide who may claim it before
              the instance is reachable.
            </Lede>
            <div className="flex flex-col gap-3.5">
              <StepCard step={1} title="Optional: pin the owner first" variant="rule">
                <p className="mt-1.5 mb-2 text-[15px] leading-[1.6] text-muted">
                  Set <Mono>MS_OWNER_EMAIL</Mono> before the first request reaches the instance and
                  the claim completes only for that address — every other claimant is refused with{' '}
                  <em>This instance is reserved for a different address</em>. It is{' '}
                  <strong className="text-ink">a restriction, not a nomination</strong>: it creates
                  nobody, sends nothing, and nothing will happen until you open <Mono>/setup</Mono>{' '}
                  yourself. When it is set, the claim code is not asked for — two locks on one door
                  buys nothing.
                </p>
                <Terminal
                  lines={[
                    { kind: 'command', text: 'npx wrangler secret put MS_OWNER_EMAIL' },
                    { kind: 'output', text: 'you@yourdomain.com' },
                  ]}
                />
                <p className="mt-2 mb-0 text-[14px] leading-[1.6] text-muted-2">
                  It is deliberately absent from the Cloudflare deploy form, which stores answers as
                  masked secrets and does not prefill defaults — an optional variable rendered there
                  looks exactly like a credential the deployment cannot start without.
                </p>
              </StepCard>
              <StepCard step={2} title="Read the claim code out of the log" variant="rule">
                <p className="mt-1.5 mb-2 text-[15px] leading-[1.6] text-muted">
                  Twelve characters in three groups of four, drawn from an alphabet with the
                  terminal-font confusables removed, printed once on first boot next to the
                  bootstrap API key. Only its hash is stored, so this log line is the only place it
                  exists.
                </p>
                <Code>
                  <Com>
                    {'#  Your claim code — /setup asks for this before it will let anyone in:'}
                  </Com>
                  {'\n\n      K7QF-3MPX-R9TB'}
                </Code>
              </StepCard>
              <StepCard step={3} title="Open /setup and register a passkey" variant="rule">
                <p className="mt-1.5 mb-0 text-[15px] leading-[1.6] text-muted">
                  You give an address, the code, and a passkey. The code is checked on both legs of
                  the flow — when the browser asks for a registration challenge and again when it
                  submits the credential — because the first leg is what stops a passkey prompt that
                  fails after you have already touched your key, and nothing but the challenge
                  carries between them. It is compared as a hash, in constant time, after
                  upper-casing and stripping spaces, so typing it back with the dashes is fine.
                </p>
              </StepCard>
              <StepCard step={4} title="Save the ten recovery codes" variant="rule">
                <p className="mt-1.5 mb-0 text-[15px] leading-[1.6] text-muted">
                  Shown once, single-use. Then <Mono>/setup</Mono> offers two more steps — adding a
                  sending domain, and minting your first API key with a live test send — and both
                  are skippable, because neither is required to have a working instance you can get
                  back into.
                </p>
              </StepCard>
            </div>
            <Callout variant="warn" title="LOST THE LOG?">
              <Mono>npx mailysend claim --url https://your-instance</Mono> is the break-glass path,
              and it is a strictly stronger proof than reading an inbox: it writes a one-time nonce
              straight into the deployment’s own database — through the Cloudflare D1 API when{' '}
              <Mono>CLOUDFLARE_ACCOUNT_ID</Mono> and <Mono>CLOUDFLARE_API_TOKEN</Mono> are in your
              environment, otherwise by printing the exact <Mono>wrangler d1 execute</Mono> command
              for you to run — and then proves it knows that value. Only somebody who can write that
              database can produce it, which is why it stays available <em>after</em> the instance
              is claimed as well.
            </Callout>
          </>
        ),
        'six-doors': (
          <>
            <Lede>
              Six ways in, and the right number to have enabled is two: one you use, and one that
              still works when the first one’s dependencies are down. Every door below is optional
              except the passkey, and the sign-in page renders each one only when it is genuinely
              open — a button that answers 501 costs the person trying to get in more time than no
              button at all.
            </Lede>
            <div className="flex flex-col gap-2.5">
              {DOORS.map((door) => (
                <div key={door.name} className="rounded-tile border border-line bg-card p-4">
                  <div className="text-[15px] font-semibold text-ink">{door.name}</div>
                  <p className="mt-1.5 mb-1 text-[14.5px] leading-[1.6] text-muted">{door.good}</p>
                  <p className="m-0 text-[13.5px] leading-[1.55] text-muted-2">{door.cost}</p>
                </div>
              ))}
            </div>
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">You can ask an instance which of these are open.</strong>{' '}
              <Mono>GET /v1/instance</Mono> is unauthenticated and is what every pre-auth screen
              renders from, so the page and the endpoint cannot disagree:
            </p>
            <Code>
              {
                '{ "object": "instance", "claimed": true, "mode": "single",\n  "claim":   { "code_required": false, "reserved": false },\n  "auth":    { "passkey": true, "access": false, "otp": true,\n               "device": true, "oidc": false },\n  "sending": { "ready": true, "verified_domains": 1, "last_error": null } }'
              }
            </Code>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-muted">
              It carries no secrets and no per-address facts by design. <Mono>auth.access</Mono> is
              simply whether both Access variables are set; <Mono>auth.otp</Mono> is whether{' '}
              <em>any</em> domain is verified, which is a fact about the deployment rather than
              about a person; and <Mono>claim.reserved</Mono> says an address is required without
              saying which. Until <Mono>auth.otp</Mono> is true, <Mono>POST /v1/auth/otp</Mono>{' '}
              answers <Mono>202 {'{"status":"unavailable"}'}</Mono> rather than claiming to have
              sent mail.
            </p>
            <Callout variant="warn" title="THE CIRCULAR DEPENDENCY">
              If one-time codes are your only sign-in method, and codes are delivered by the
              instance you are trying to sign in to, then a broken sending path locks you out of the
              tool you would use to fix the sending path. Register a passkey, or put Access in front
              of it. There is one narrow escape hatch, and it is a bootstrap measure rather than a
              plan: while no sending domain is verified, the code for <Mono>MS_OWNER_EMAIL</Mono> —
              and only that address — is written to the process log.
            </Callout>
          </>
        ),
        'lock-it-down': (
          <>
            <Lede>
              Turn off what you are not using. Every enabled method is a way in, and an unused one
              is a way in that nobody is watching.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The one that matters most is already handled.</strong>{' '}
              The first-run claim closes permanently the moment an owner exists, so there is nothing
              to remember to disable and no window left open behind you. What remains is ordinary
              hygiene: unset the OIDC variables if you stopped using that provider, unset{' '}
              <Mono>MS_ACCESS_TEAM</Mono> and <Mono>MS_ACCESS_AUD</Mono> if the Access application
              is gone, and remember that removing a door from the environment removes it from the
              sign-in page too, because the page is rendered from what is actually configured.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                A claimed instance invites people; it does not enrol them.
              </strong>{' '}
              After the claim, only existing members sign in — the exception being{' '}
              <Mono>MS_OIDC_AUTO_PROVISION=true</Mono>, which enrols an unknown address on first
              sign-in and refuses to work without a domain allowlist alongside it. That combination
              is the one configuration on this page that can quietly widen who has access, so it is
              worth writing down why you set it.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Nothing stored is a working credential.</strong> Session
              tokens are random values whose SHA-256 is the row’s primary key, so a dump of{' '}
              <Mono>sessions</Mono> cannot be replayed as a cookie; API keys, recovery codes and the
              claim code are stored the same way. Cookies are <Mono>HttpOnly</Mono>,{' '}
              <Mono>SameSite=Lax</Mono> and <Mono>Secure</Mono> unless the instance is being served
              over plain HTTP on localhost, and a session lasts thirty days. This is also why
              nothing in the product can show you a key a second time.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Moving to your own domain is a security event, not a cosmetic one.
              </strong>{' '}
              A passkey is bound to a hostname, so changing the host invalidates every passkey
              registered on the old one. Do it from{' '}
              <strong className="text-ink">Settings → Access</strong>, which pins the new value,
              records the old one, and tells you in advance that you will need a recovery code and a
              re-registration — and the sign-in page names the previous host when it sees the
              mismatch, instead of showing a login that simply never succeeds.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                There is no password store, and there will not be.
              </strong>{' '}
              A self-hosted email platform that invents one is adding the single credential most
              likely to be reused and leaked, to protect a dashboard that already sits behind
              whatever the operator put in front of it.
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
