# SMTP shim

`smtp.<your-domain>:587` — an authenticated SMTP submission endpoint that relays into
`POST /v1/emails/raw`.

**This cannot run on Workers.** `connect()` is egress-only and there is no inbound TCP
listener, so an SMTP server needs a real socket stack. That is the whole reason this is a
container and not a fourth Worker.

## Running it

```bash
docker build -t mailysend-smtp apps/smtp-shim
docker run -p 587:587 -e MS_API_URL=https://your-deployment mailysend-smtp
```

On Cloudflare Containers, put it behind Spectrum on port 587. Anywhere else, put it
behind whatever already terminates TLS for you.

## Credentials

Username `api_token`, password your MailySend API key. There is no second credential
store — revoking the key revokes SMTP access, which is the only revocation path anyone
will remember to use.

## If you would rather not run a container

Point your application at Cloudflare's own relay: `smtps://smtp.mx.cloudflare.net:465`,
username `api_token`, password a Cloudflare API token.

Stated plainly, because the trade-off is real: **those sends do not pass through
MailySend**, so they will not appear in its logs, its analytics, or its webhooks. You get
delivery; you do not get the product.
