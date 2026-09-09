import { formatAddress } from '@mailysend/core'
import { buildMime, mimeSize } from '../mime.ts'
import { signRequest } from '../sigv4.ts'
import type {
  DnsRequirement,
  OutboundMessage,
  Provider,
  ProviderLimits,
  SendResult,
} from '../types.ts'
import { SendError } from '../types.ts'

/**
 * Amazon SES v2.
 *
 * Written immediately after the Cloudflare adapter, on purpose. A single
 * implementation always looks like a clean abstraction; the second one is what
 * finds the leaks. Three showed up and were fixed in `types.ts` rather than
 * worked around here: the `unknown` error kind (SES can accept and then time
 * out), `reportsEvents` (SES needs an SNS configuration set, which is
 * per-account setup we cannot assume), and per-provider size limits (SES allows
 * 40 MB where Cloudflare allows 5 MiB).
 *
 * This is also the hedge that makes Cloudflare's beta status survivable: it is
 * one configuration line away, with automatic failover on 5xx.
 */

export const SES_LIMITS: ProviderLimits = {
  maxRecipients: 50,
  maxMessageBytes: 40 * 1024 * 1024,
  maxAttachmentBytes: 40 * 1024 * 1024,
  maxSubjectChars: 998,
  maxHeaderBytes: 100 * 1024,
  dailyQuota: null,
}

export interface SesProviderConfig {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
  /** Required for SES to publish delivery events; without it there are no events. */
  configurationSetName?: string
  endpoint?: string
}

export class SesProvider implements Provider {
  readonly name = 'ses' as const
  readonly limits = SES_LIMITS

  #config: SesProviderConfig

  constructor(config: SesProviderConfig) {
    this.#config = config
  }

  /** Only true with a configuration set wired to SNS. Stated, not assumed. */
  get reportsEvents(): boolean {
    return Boolean(this.#config.configurationSetName)
  }

  get #endpoint(): string {
    return this.#config.endpoint ?? `https://email.${this.#config.region}.amazonaws.com`
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const raw = buildMime(message)
    const size = mimeSize(raw)
    if (size > this.limits.maxMessageBytes) {
      throw new SendError(
        'permanent',
        this.name,
        `message is ${(size / 1048576).toFixed(2)} MiB; SES accepts at most 40 MB`,
      )
    }

    const recipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])].map(
      (a) => a.address,
    )

    // Raw MIME rather than SES's structured `Simple` content: we already build
    // the exact bytes for the Cloudflare and SMTP paths, and sending the same
    // bytes everywhere means a rendering bug cannot be provider-specific.
    const body = JSON.stringify({
      FromEmailAddress: formatAddress(message.from),
      Destination: {
        ToAddresses: message.to.map((a) => a.address),
        ...(message.cc?.length ? { CcAddresses: message.cc.map((a) => a.address) } : {}),
        ...(message.bcc?.length ? { BccAddresses: message.bcc.map((a) => a.address) } : {}),
      },
      Content: { Raw: { Data: base64(raw) } },
      ...(this.#config.configurationSetName
        ? { ConfigurationSetName: this.#config.configurationSetName }
        : {}),
      ...(message.returnPath ? { FeedbackForwardingEmailAddress: message.returnPath } : {}),
      EmailTags: [{ Name: 'mailysend_id', Value: message.emailId }],
    })

    const url = `${this.#endpoint}/v2/email/outbound-emails`
    const headers = await signRequest(
      { url, method: 'POST', headers: { 'content-type': 'application/json' }, body },
      { ...this.#config, service: 'ses' },
    )

    let response: Response
    try {
      response = await fetch(url, { method: 'POST', headers, body })
    } catch (err) {
      throw new SendError('unknown', this.name, `network failure contacting SES: ${String(err)}`)
    }

    const text = await response.text()
    if (!response.ok) throw classifySes(response, text, recipients.length)

    let providerMessageId: string | null = null
    try {
      providerMessageId = (JSON.parse(text) as { MessageId?: string }).MessageId ?? null
    } catch {
      /* accepted regardless */
    }
    return { providerMessageId, provider: this.name, acceptedAt: new Date().toISOString() }
  }

  dnsRecords(
    domain: string,
    opts: { selector: string; returnPath: string; dkimPublicKey?: string },
  ): DnsRequirement[] {
    const records: DnsRequirement[] = [
      {
        record: 'TXT',
        name: domain,
        value: 'v=spf1 include:amazonses.com ~all',
        purpose: 'Authorises SES to send as this domain (SPF).',
      },
      {
        record: 'TXT',
        name: `_dmarc.${domain}`,
        value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
        purpose: 'Turns on DMARC reporting.',
      },
      {
        // SES puts the bounce domain on a MAIL FROM subdomain rather than
        // Cloudflare's cf-bounce CNAME — the reason the setup screen renders a
        // union of records per provider instead of one fixed list.
        record: 'MX',
        name: `${opts.returnPath}.${domain}`,
        value: `feedback-smtp.${this.#config.region}.amazonses.com`,
        priority: 10,
        purpose: 'Custom MAIL FROM domain, so bounces align with your domain.',
      },
      {
        record: 'TXT',
        name: `${opts.returnPath}.${domain}`,
        value: 'v=spf1 include:amazonses.com ~all',
        purpose: 'SPF for the MAIL FROM domain.',
      },
    ]
    if (opts.dkimPublicKey) {
      records.push({
        record: 'TXT',
        name: `${opts.selector}._domainkey.${domain}`,
        value: `v=DKIM1; k=rsa; p=${opts.dkimPublicKey}`,
        purpose: 'DKIM signing key (BYODKIM).',
      })
    }
    return records
  }

  async verify() {
    const url = `${this.#endpoint}/v2/email/account`
    try {
      const headers = await signRequest(
        { url, method: 'GET', headers: {}, body: '' },
        { ...this.#config, service: 'ses' },
      )
      const res = await fetch(url, { headers })
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
      const account = (await res.json()) as {
        ProductionAccessEnabled?: boolean
        SendingEnabled?: boolean
      }
      if (account.ProductionAccessEnabled === false) {
        // Worth saying plainly: sandbox SES silently only delivers to verified
        // addresses, which otherwise looks like a MailySend bug.
        return {
          ok: true,
          detail: 'SES is in sandbox mode — only verified recipients will receive mail',
        }
      }
      return { ok: account.SendingEnabled !== false, detail: 'production access enabled' }
    } catch (err) {
      return { ok: false, detail: String(err) }
    }
  }
}

const base64 = (input: string): string => {
  const bytes = new TextEncoder().encode(input)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK)
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

function classifySes(response: Response, body: string, recipientCount: number): SendError {
  let type = ''
  let message = body.slice(0, 500)
  try {
    const parsed = JSON.parse(body) as { __type?: string; message?: string; Message?: string }
    type = (parsed.__type ?? '').split('#').pop() ?? ''
    message = parsed.message ?? parsed.Message ?? message
  } catch {
    /* keep raw */
  }

  switch (type) {
    case 'TooManyRequestsException':
    case 'SendingQuotaExceededException':
      return new SendError('throttled', 'ses', message, {
        retryAfterSeconds: 60,
        providerCode: type,
      })
    case 'AccountSuspendedException':
    case 'SendingPausedException':
      return new SendError('auth', 'ses', message, { providerCode: type })
    case 'MessageRejected':
      return new SendError('permanent', 'ses', message, { providerCode: type })
    case 'MailFromDomainNotVerifiedException':
    case 'NotFoundException':
      return new SendError('permanent', 'ses', message, { providerCode: type })
    case 'LimitExceededException':
      return new SendError('throttled', 'ses', message, {
        retryAfterSeconds: 300,
        providerCode: type,
      })
  }

  if (response.status === 429)
    return new SendError('throttled', 'ses', message, { retryAfterSeconds: 60 })
  if (response.status === 403 || response.status === 401)
    return new SendError('auth', 'ses', message)
  if (response.status >= 500) return new SendError('transient', 'ses', message)
  if (/suppress/i.test(message)) {
    return new SendError('suppressed', 'ses', message, { providerCode: 'AccountSuppressionList' })
  }
  void recipientCount
  return new SendError('permanent', 'ses', message)
}
