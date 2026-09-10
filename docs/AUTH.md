# Signing in

MailySend has no password database. A self-hosted email platform that invents
one is adding the single credential most likely to be reused and leaked, to
protect a dashboard that already sits behind whatever the operator put in front
of it.

Every door below is optional except the first, and the sign-in page renders a
button **only when that door is actually configured**. A button that cannot work
is worse than no button.

## Passkeys

The default, and the only credential a brand-new deployment can create for
itself: no email, no DNS, no identity provider. This is what `/setup` claims the
instance with. A passkey cannot be phished and never leaves the device.

Passkeys are bound to the deployment's hostname. If you change `MS_PUBLIC_URL`,
existing passkeys stop working — the instance detects this and says so rather
than looking broken.

## Recovery codes

Ten, issued once at claim time, single-use, enforced in the `UPDATE`. This is
the answer to "the laptop with the passkey is gone", and the reason removing
your last passkey is allowed at all. Store them somewhere that is not the
laptop.

## Emailed one-time codes

Offered **only once a sending domain is verified** — otherwise there is nothing
to send the code with, and offering it would produce an inbox that never
receives anything. Six digits, ten minutes, five attempts.

The response never varies with the address. Whether the account exists, whether
it is suppressed, whether the code was logged rather than sent — none of that
reaches the caller, because a sign-in form that answers "does this person have an
account here" is an account enumeration endpoint.

**Bootstrap exception:** while no sending domain is verified, the code for
`MS_OWNER_EMAIL` — and only that address — is written to the process log, which
on a self-hosted box only the operator can read.

## Device flow

For the CLI: `mailysend login` shows a code, you approve it in the browser.

## Cloudflare Access

When `MS_ACCESS_TEAM` and `MS_ACCESS_AUD` are both set, the identity is already
proven at the edge. The assertion is verified properly — signature against the
team's published keys, `iss` against the team domain, `aud` against this
application's tag, `exp`/`iat` against the clock. Reading the email out of an
unverified token would let anyone with a text editor sign in as anyone.

## OpenID Connect

| Variable | Meaning |
|---|---|
| `MS_OIDC_ISSUER` | Issuer URL, e.g. `https://acme.okta.com` |
| `MS_OIDC_CLIENT_ID` | This application's client id |
| `MS_OIDC_CLIENT_SECRET` | Its secret |
| `MS_OIDC_ALLOWED_DOMAINS` | Comma-separated email domains. Empty means any address the provider vouches for |
| `MS_OIDC_AUTO_PROVISION` | `true` enrols an unknown address on first sign-in. Requires an allowlist |
| `MS_OIDC_LABEL` | What the button says. Defaults to "single sign-on" |

Register `${MS_PUBLIC_URL}/v1/auth/oidc/callback` as the redirect URI. All three
of issuer, client id and secret must be set before the button appears.

**What is checked, and why each check is there:**

- **Authorization Code with PKCE (S256).** `plain` is not offered; it protects
  nothing.
- **`state`**, in a short-lived signed cookie. Without it, a link is enough to
  sign somebody into an account that is not theirs.
- **`nonce`**, also in that cookie and compared against the ID token. Without it,
  a token from an earlier legitimate flow can be replayed.
- **Signature**, against the provider's JWKS over WebCrypto (RS256 and ES256).
  `alg: none` is refused explicitly — an unsigned token is the oldest JWT attack
  there is.
- **`iss`** against the configured issuer, and the discovery document is rejected
  if it names a different one.
- **`aud`** against the client id, so a token minted for a different application
  at the same issuer cannot be presented here.
- **`exp`**, with 60 seconds of leeway for clock skew and no more.
- **`email_verified`**. A provider that will not vouch for an address is telling
  you the holder may not own it; an absent claim is treated as unverified.

Claims are read only *after* the signature verifies. Checking them on an
unverified token is the same bug as not checking them at all, because the
decision has already been made on attacker-controlled input.

Discovery and JWKS are cached in KV for an hour, so a sign-in is not a hard
dependency on the provider being up at exactly that moment.

**Who gets in.** On an **unclaimed** instance the first person through any door
becomes the owner — the same rule the passkey and Access paths follow — subject
to `MS_OWNER_EMAIL` when it is set. Afterwards, only existing members sign in,
unless `MS_OIDC_AUTO_PROVISION=true` **and** a domain allowlist is set. A claimed
instance invites people; it does not enrol whoever can authenticate somewhere.

## Sessions

Every door mints the same session: a random token whose SHA-256 is the row's
primary key, so a dump of `sessions` cannot be replayed as a cookie. `HttpOnly`,
`SameSite=Lax`, `Secure` unless the instance is being served over plain HTTP on
localhost. Thirty days.

`MS_OWNER_EMAIL` is a **restriction, not a nomination**: setting it creates
nobody and sends nothing. It says only that no other address may claim this
instance.

## The claim code

First boot prints one, once, into the deployment's log — alongside the bootstrap
API key, and stored the same way: only its SHA-256 is kept. `/setup` asks for it
before it will claim an instance.

That is the answer to the obvious objection to first-claimant-wins. Reading a
Worker's log is something only the person who deployed it can do, and it needs
no email, no DNS and no identity provider — the same reason a passkey is the
claim credential. `wrangler tail`, or the Worker's *Logs* tab in the Cloudflare
dashboard.

Two deployments are never asked for it: one that booted before the code existed
(it has no stored hash, and would otherwise be permanently unclaimable), and one
with `MS_OWNER_EMAIL` set, which is already narrowed to a single address. Lost
the log? `npx mailysend claim` writes a nonce straight into the deployment's own
database, which is a strictly stronger proof and stays available afterwards.
