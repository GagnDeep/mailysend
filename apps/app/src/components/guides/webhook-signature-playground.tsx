import { Input, Textarea } from '@mailysend/ui'
import { useEffect, useId, useState } from 'react'
import { Code } from '~/components/marketing/prose.tsx'
import { WidgetField, WidgetResult, WidgetShell } from './widget-shell.tsx'

/**
 * Compute a webhook signature in the browser, the way the server does.
 *
 * The construction mirrors `signWebhook` in `@mailysend/core`: HMAC-SHA256 over
 * `${timestamp}.${body}`, hex-encoded, presented as `t=…,v1=…`. It is
 * re-implemented here on WebCrypto rather than imported because the core module
 * reaches for platform bindings, and the fifteen lines below are the whole
 * algorithm — a reader who can see them can port it to any language.
 *
 * Two SSR constraints shape this component. `crypto.subtle` is undefined during
 * prerender *and* on any non-secure origin, so the hash is computed in an
 * effect and the component renders a complete, readable state without it. And
 * the timestamp is a fixed literal rather than `Date.now()`, because a value
 * that differs between the server render and the client render is a hydration
 * mismatch — which is console-level, and would therefore ship silently.
 */
const FIXED_TIMESTAMP = 1_767_225_600

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

const hmacHex = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
}

export const WebhookSignaturePlayground = () => {
  const id = useId()
  const [secret, setSecret] = useState('whsec_example_do_not_use')
  const [body, setBody] = useState('{"type":"email.delivered","data":{"email_id":"em_7Kq2xR"}}')
  const [signature, setSignature] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    // Not available on a non-secure origin; say so rather than showing nothing.
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      setUnavailable(true)
      return
    }
    let live = true
    hmacHex(secret, `${FIXED_TIMESTAMP}.${body}`)
      .then((hex) => {
        if (live) setSignature(hex)
      })
      .catch(() => {
        if (live) setUnavailable(true)
      })
    return () => {
      live = false
    }
  }, [secret, body])

  return (
    <WidgetShell
      title="SIGNATURE PLAYGROUND"
      source="HMAC-SHA256 over `${t}.${body}`, hex-encoded — the same construction signWebhook uses."
    >
      <div className="flex flex-col gap-4">
        <WidgetField label="Signing secret" htmlFor={`${id}-secret`}>
          <Input
            id={`${id}-secret`}
            value={secret}
            spellCheck={false}
            onChange={(event) => setSecret(event.target.value)}
            className="font-mono text-[13px]"
          />
        </WidgetField>
        <WidgetField
          label="Raw request body"
          htmlFor={`${id}-body`}
          hint="Verify against these exact bytes, before your framework parses them. Re-serialised JSON is a different string and will never match."
        >
          <Textarea
            id={`${id}-body`}
            value={body}
            rows={3}
            spellCheck={false}
            onChange={(event) => setBody(event.target.value)}
            className="font-mono text-[12.5px]"
          />
        </WidgetField>

        <div>
          <div className="ms-eyebrow mb-1.5 text-[10.5px]">MAILYSEND-SIGNATURE</div>
          <Code>
            {`t=${FIXED_TIMESTAMP},v1=${
              signature ?? (unavailable ? '<needs a secure origin>' : '<computing…>')
            }`}
          </Code>
        </div>

        {unavailable ? (
          <WidgetResult tone="warning">
            Web Crypto is unavailable here — it requires a secure origin (https, or localhost). The
            construction is still exactly what is printed above; only the hash is missing.
          </WidgetResult>
        ) : (
          <WidgetResult>
            Your receiver recomputes this from the header's <code className="font-mono">t</code>,
            the raw body and your secret, then compares in constant time. If the timestamp is more
            than five minutes from now, reject the delivery even when the hash matches — that bound
            is what stops a captured request being replayed tomorrow.
          </WidgetResult>
        )}
      </div>
    </WidgetShell>
  )
}
