import { formatAddress } from '@mailysend/core'
import type {
  DnsRequirement,
  OutboundMessage,
  Provider,
  ProviderLimits,
  SendResult,
} from '../types.ts'
import { SendError } from '../types.ts'

/**
 * Resend, as a transport.
 *
 * There is a pleasing symmetry here: MailySend speaks Resend's API on the way
 * in, and can speak it on the way out too. Practically it matters for
 * migrations — point MailySend at your existing Resend account, keep sending,
 * and move domains across one at a time instead of in a single cutover.
 */

export const RESEND_LIMITS: ProviderLimits = {
  maxRecipients: 50,
  maxMessageBytes: 40 * 1024 * 1024,
  maxAttachmentBytes: 40 * 1024 * 1024,
  maxSubjectChars: 998,
  maxHeaderBytes: 100 * 1024,
  dailyQuota: null,
}

export interface ResendProviderConfig {
  apiKey: string
  /** Honours the same env var Resend's own SDK does, so a proxy or mock drops in. */
  baseUrl?: string
}

export class ResendProvider implements Provider {
  readonly name = 'resend' as const
  readonly limits = RESEND_LIMITS
  readonly reportsEvents = true

  #config: ResendProviderConfig

  constructor(config: ResendProviderConfig) {
    this.#config = config
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const body = JSON.stringify({
      from: formatAddress(message.from),
      to: message.to.map((a) => a.address),
      ...(message.cc?.length ? { cc: message.cc.map((a) => a.address) } : {}),
      ...(message.bcc?.length ? { bcc: message.bcc.map((a) => a.address) } : {}),
      ...(message.replyTo?.length ? { reply_to: message.replyTo.map((a) => a.address) } : {}),
      subject: message.subject,
      ...(message.html ? { html: message.html } : {}),
      ...(message.text ? { text: message.text } : {}),
      headers: {
        ...message.headers,
        // Carried through so a DSN or a reply can still be matched back to our
        // id even though Resend mints its own.
        'X-MailySend-Id': message.emailId,
      },
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: base64(a.content),
              content_type: a.contentType,
              ...(a.contentId ? { content_id: a.contentId } : {}),
            })),
          }
        : {}),
    })

    const url = `${this.#config.baseUrl ?? 'https://api.resend.com'}/emails`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#config.apiKey}`,
          'Content-Type': 'application/json',
          // Resend honours this; it turns a network-level retry from a possible
          // duplicate into a guaranteed no-op, which is the one duplicate source
          // we can actually close on this transport.
          'Idempotency-Key': message.emailId,
        },
        body,
      })
    } catch (err) {
      throw new SendError('unknown', this.name, `network failure contacting Resend: ${String(err)}`)
    }

    const text = await response.text()
    if (!response.ok) throw classifyResend(response, text)

    let providerMessageId: string | null = null
    try {
      providerMessageId = (JSON.parse(text) as { id?: string }).id ?? null
    } catch {
      /* accepted regardless */
    }
    return { providerMessageId, provider: this.name, acceptedAt: new Date().toISOString() }
  }

  dnsRecords(domain: string, opts: { selector: string; returnPath: string }): DnsRequirement[] {
    return [
      {
        record: 'TXT',
        name: `send.${domain}`,
        value: 'v=spf1 include:amazonses.com ~all',
        purpose: 'SPF for the Resend sending subdomain.',
      },
      {
        record: 'MX',
        name: `send.${domain}`,
        value: 'feedback-smtp.us-east-1.amazonses.com',
        priority: 10,
        purpose: 'Bounce collection for the Resend sending subdomain.',
      },
      {
        record: 'TXT',
        name: `_dmarc.${domain}`,
        value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
        purpose: 'Turns on DMARC reporting.',
      },
      {
        record: 'TXT',
        name: `${opts.selector}._domainkey.${domain}`,
        value: 'add the DKIM value shown in your Resend dashboard',
        purpose: 'DKIM key, issued by Resend when the domain is added there.',
      },
    ]
  }

  async verify() {
    try {
      const res = await fetch(`${this.#config.baseUrl ?? 'https://api.resend.com'}/domains`, {
        headers: { Authorization: `Bearer ${this.#config.apiKey}` },
      })
      return res.ok
        ? { status: 'ok' as const, detail: 'API key valid' }
        : { status: 'failed' as const, detail: `HTTP ${res.status}` }
    } catch (err) {
      return { status: 'failed' as const, detail: String(err) }
    }
  }
}

const base64 = (bytes: Uint8Array): string => {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK)
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

function classifyResend(response: Response, body: string): SendError {
  let name = ''
  let message = body.slice(0, 500)
  try {
    const parsed = JSON.parse(body) as { name?: string; message?: string }
    name = parsed.name ?? ''
    message = parsed.message ?? message
  } catch {
    /* keep raw */
  }

  if (response.status === 429) {
    return new SendError('throttled', 'resend', message, {
      retryAfterSeconds: Number(response.headers.get('retry-after')) || 60,
      providerCode: name,
    })
  }
  if (response.status === 401 || response.status === 403) {
    return new SendError('auth', 'resend', message, { providerCode: name })
  }
  if (response.status >= 500)
    return new SendError('transient', 'resend', message, { providerCode: name })
  return new SendError('permanent', 'resend', message, { providerCode: name })
}
