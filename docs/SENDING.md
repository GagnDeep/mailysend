# Sending

MailySend does not deliver mail. A transport does, and which one you pick
changes what you have to publish in DNS, how large a message may be, and how
much you get told about what happened afterwards. This page is about choosing
one and setting it up honestly.

Configure transports at **Settings → Transports**. Credentials are encrypted
with AES-GCM before they are stored and are never returned by the API — the
response says which fields are set, never what they are.

## Choosing

| | Cloudflare | Amazon SES | Resend | SMTP relay |
|---|---|---|---|---|
| Max message | 5 MiB | 40 MB | 40 MB | 25 MiB (typical) |
| Reports delivery events | yes | with a configuration set | yes | **no** |
| Creates the sending identity for you | yes, in its own dashboard | yes, over its API | yes, over its API | no |
| DNS you publish by hand | **none** | four records | theirs, fetched live | ours, and they are correct |
| Setup effort | lowest, if the domain is already on Cloudflare | highest | low | medium |

The honest summary: **Cloudflare** if the domain is already on your Cloudflare
account, **SES** if you send at volume and can wait out a sandbox review,
**Resend** if you want to be sending this afternoon, **SMTP** if you already
have a relay you trust.

A transport with `reportsEvents: false` — that is, SMTP — cannot tell you a
message was opened, clicked, or bounced hours later. Delivery state stops at
`sent`, and everything after that is inferred from DSNs. That is a real
limitation, not a missing feature.

## Bind the domain to one transport

On the domain's page, **Sending transport** binds the domain to a single
transport. This matters more than it looks: left unbound, the DNS records shown
are the union across every transport this workspace could fall back to, and two
transports that each want an apex `v=spf1` record cannot both have one. RFC 7208
§3.2 makes a second SPF record at the same name a permanent error, not a
fallback — so where a union is unavoidable, the includes are merged into one
legal record instead.

## Cloudflare Email Service

Cloudflare onboards a domain itself, and it does it better than we could.

1. In the Cloudflare dashboard: **Compute → Email Service → Email Sending →
   Onboard Domain**. The domain must already be on the same Cloudflare account.
2. Cloudflare writes every record automatically — the MX bounce records, the SPF
   include, DKIM at `cf-bounce._domainkey.<domain>`, and DMARC.
3. Back in MailySend, press **Check records**. Verification is pure observation
   over DNS-over-HTTPS, so **no API token is needed**.

MailySend therefore shows **no records to copy** for a Cloudflare domain. The
records it lists are marked *published for you* and exist only so verification
has something to resolve. Publishing your own version of one is how a domain
ends up with two conflicting answers to the same question.

There is no documented public REST endpoint for that onboarding flow, which is
why the button hands you to the dashboard rather than pretending to do it.

## Amazon SES

1. Enter an access key and secret at **Settings → Transports**, with the region
   your SES identities live in. Identities are per-region; a key that works in
   `us-east-1` proves nothing about `eu-west-1`.
2. Bind the domain to SES and press **Set up with this transport**. This calls
   `CreateEmailIdentity` with **BYODKIM**, handing SES the RSA private key
   MailySend generated for this domain, and configures the MAIL FROM subdomain
   so bounces align with your domain rather than with amazonses.com.
3. Publish the four records shown, then verify.

Because SES signs with *our* key under *our* selector, the record you published,
the selector in the signature and the key that signed are finally the same key.
Before BYODKIM they were three unrelated things.

**The sandbox.** A new SES account can only send to addresses you have verified,
at 200 messages a day. `Test connection` reports this as `unknown` rather than
`ok`, because a sandbox account is not broken and is not ready either. Ask AWS
for production access before you rely on it.

**Events** arrive over SNS and need a configuration set with a subscription
pointed at this instance. Without one, SES reports nothing back and
`reportsEvents` is false — which the transport says, rather than assuming.

## Resend

1. Enter the API key.
2. Bind the domain to Resend and press **Set up with this transport**. MailySend
   calls `POST /domains` and then shows *their* records and *their* verification
   state.

Resend mints its own DKIM key under its own selector, neither of which is
knowable before the domain exists there. Earlier versions of MailySend printed a
row whose value was the literal text *"add the DKIM value shown in your Resend
dashboard"* — unverifiable by construction. It is gone.

## SMTP relay

Anything with a hostname and credentials. This is the transport where our own
DKIM signing does the work, so the `ms1._domainkey` record has to be published
and correct — and as of this release it is, because the send path actually signs
with the key that record advertises.

1. Host, port (587 for STARTTLS, 465 for implicit TLS), username and password.
2. Publish the three records shown. The SPF include is a guess based on your
   relay's hostname; adjust it to whatever your provider documents.
3. `Test connection` opens a real session and quits, so a failure here is a
   failure you would have had on the first send.

## Publishing the records

Every record has a copy button, and the whole set has **Copy all** (tab-separated,
which every registrar's bulk import and every spreadsheet reads) and **Zone file**
(BIND, with TXT values chunked at 255 bytes so a DKIM key actually loads).

Verification re-checks on its own, backing off from 15 seconds to five minutes,
so an open tab settles rather than hammering a resolver that will not have news.
A failed row shows what resolved beside what was wanted — it is a trailing dot
more often than not.

If the domain is a Cloudflare zone and you have supplied a token with
`Zone:DNS:Edit`, **Write records for me** publishes them. It is strictly an
accelerator: every path completes without it, and what it wrote is recorded per
row so it stays reversible.

## DKIM

MailySend generates an RSA-2048 keypair per domain. The private half never
leaves the row and is not readable through the API. Signing is relaxed/relaxed,
`rsa-sha256`, over WebCrypto, and only headers actually present in the message
are listed in `h=` — listing an absent header is how a signature ends up
covering something an attacker can then add.

Ed25519 (RFC 8463) is not used: it is still ignored or rejected by enough
receivers that signing with it alone would cost alignment at exactly the mailbox
providers that matter most.

## See also

- [RECEIVING.md](RECEIVING.md) — the other half of a domain.
- [MAIL.md](MAIL.md) — reading and replying.
- [CONFIGURATION.md](CONFIGURATION.md) — environment variables.
