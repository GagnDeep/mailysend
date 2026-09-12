# mailysend

The official SDK for [MailySend](https://mailysend.com). One dependency, `fetch`
only, and the same code on Node 20+, Bun, Deno and Cloudflare Workers.

```sh
npm install mailysend
```

## Send an email

```ts
import { MailySend } from 'mailysend'

const mailysend = new MailySend(process.env.MAILYSEND_API_KEY, {
  baseUrl: process.env.MAILYSEND_BASE_URL, // https://mail.acme.com
})

const { id } = await mailysend.emails.send({
  from: 'Acme <hello@acme.com>',
  to: 'ada@example.com',
  subject: 'Your receipt',
  html: '<p>Thanks for your order.</p>',
})
```

Both arguments fall back to the environment — `MAILYSEND_API_KEY` and
`MAILYSEND_BASE_URL` — so in most apps the constructor is `new MailySend()`.

The base URL is **required**, and there is no default. MailySend is deployed
into your own Cloudflare account, so there is no address this client could guess
that would be right for anybody; it is whatever URL your deployment answers on,
with no trailing `/v1`. A missing one is refused at construction rather than
allowed to surface later as a DNS failure a long way from its cause.

## Coming from Resend

Change the import, and point `RESEND_BASE_URL` at your deployment.

```diff
  // RESEND_BASE_URL=https://mail.acme.com
- import { Resend } from 'resend'
+ import { Resend } from 'mailysend/compat'
```

`compat` reads `RESEND_BASE_URL` before `MAILYSEND_BASE_URL`, and `RESEND_API_KEY`
before `MAILYSEND_API_KEY` — so an app that has already repointed that variable
needs the import line and nothing else.

You may not need this package at all. The official `resend` client resolves its
host as `process.env.RESEND_BASE_URL || 'https://api.resend.com'`, so setting
that variable moves an existing integration without changing a line of code.
`compat` is for when you would rather be explicit about it.

`mailysend/compat` reproduces Resend's method names, parameter names and
`{ data, error }` return shape exactly — including the part where it never
throws. `RESEND_API_KEY` is still read from the environment, so there is no
config change either. Everything after `/v1` is Resend-compatible on the wire,
so responses come back in the shape your existing code already destructures.

Write new code against `MailySend` from `mailysend`; `compat` is for the
codebase you are moving, not the one you are starting.

## The full surface

Every `/v1` resource is on the client:

`emails` · `domains` · `apiKeys` · `audiences` · `contacts` · `segments` ·
`broadcasts` · `automations` · `templates` · `suppressions` · `webhooks` ·
`analytics` · `inbound`

```ts
await mailysend.emails.batch([{ /* … */ }, { /* … */ }])
await mailysend.domains.verify('dom_01J…')
await mailysend.audiences.contacts.create('aud_01J…', { email: 'ada@example.com' })
await mailysend.segments.preview({ audience_id: 'aud_01J…', expression: 'opened_last_30d' })
await mailysend.analytics.overview({ granularity: 'day' })
```

Anything newer than this SDK is still reachable, with the same auth and the same
retry policy:

```ts
await mailysend.http.request({ method: 'GET', path: '/v1/something-new' })
```

## Retries

429s and 5xx are retried with exponential backoff and full jitter, three times
by default. A `Retry-After` header — seconds or HTTP-date — is honoured over our
own curve; one longer than a minute is refused and the error is handed back to
you instead, because parking your request for an hour is not our decision to
make.

Every `POST` carries an `Idempotency-Key`, generated once per call and reused on
every retry, so a send that timed out *after* the server accepted it is
deduplicated rather than delivered twice. Pass your own when you have a natural
key:

```ts
await mailysend.emails.send(payload, { idempotencyKey: `order-${orderId}` })
```

Passing `idempotencyKey: null` removes the header — and with it, retrying that
request at all.

## Errors

Failures throw a `MailySendError` carrying the whole error body.

```ts
import { MailySendError } from 'mailysend'

try {
  await mailysend.emails.send(payload)
} catch (error) {
  if (MailySendError.is(error)) {
    error.code       // 'subject_too_long' — switch on this
    error.name       // 'invalid_parameter' — Resend-compatible, reused across errors
    error.statusCode // 422
    error.param      // 'subject'
    error.requestId  // quote this in a support ticket
  }
}
```

Switch on `code`. It is unique and never renamed; `name` exists for Resend
compatibility and covers several unrelated problems.

## Verifying webhooks

```ts
const valid = await mailysend.webhooks.verify(
  rawBody,
  request.headers.get('mailysend-signature'),
  process.env.MAILYSEND_WEBHOOK_SECRET,
)
```

`rawBody` must be the raw request body, byte for byte. Re-serialising a parsed
object reorders keys and normalises whitespace, and the signature is over bytes
— this is the most common reason a correct secret still fails to verify.

The timestamp is inside the signed material, so a captured delivery stays
cryptographically valid forever. The tolerance window (300 seconds by default,
`toleranceSeconds` to change it) is what makes it unreplayable.

## License

MIT
