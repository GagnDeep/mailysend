import { formatAddress } from '@mailysend/core'
import { buildMime, mimeSize } from '../mime.ts'
import type {
  DnsRequirement,
  OutboundMessage,
  Provider,
  ProviderLimits,
  SendResult,
} from '../types.ts'
import { SendError } from '../types.ts'

/**
 * Cloudflare Email Service — the default transport.
 *
 * Two paths, because the two runtimes have different access:
 *   - the `send_email` binding, when running on Workers. No HTTP hop at all,
 *     which is the design's central performance claim.
 *   - the REST endpoint, when running on Node or when no binding is configured.
 *
 * Status: beta, Workers Paid only. That is disclosed in the product's own FAQ,
 * and it is the reason `Provider` exists as an interface rather than as a
 * Cloudflare-shaped module with three escape hatches.
 */

/** Published limits. The 5 MiB ceiling is why the docs' "25 MB" copy was wrong. */
export const CLOUDFLARE_LIMITS: ProviderLimits = {
  maxRecipients: 50,
  // 25 MiB applies only to verified destination addresses; 5 MiB is the number
  // that governs mail to the open internet, so it is the one we enforce.
  maxMessageBytes: 5 * 1024 * 1024,
  maxAttachmentBytes: 5 * 1024 * 1024,
  maxSubjectChars: 998,
  maxHeaderBytes: 16 * 1024,
  // Ramps with reputation and is not published. SendingDomainDO learns it from
  // rejections rather than us inventing a number here.
  dailyQuota: null,
}

interface SendEmailBinding {
  send(message: {
    from: string
    to: string[]
    raw: string
  }): Promise<{ messageId?: string } | undefined>
}

export interface CloudflareProviderConfig {
  /** Present when running on Workers. Preferred: no HTTP round trip. */
  binding?: SendEmailBinding
  /** Required for the REST path. */
  accountId?: string
  apiToken?: string
  /** Overridable for testing against a local mock. */
  baseUrl?: string
}

export class CloudflareProvider implements Provider {
  readonly name = 'cloudflare' as const
  readonly limits = CLOUDFLARE_LIMITS
  /** Lifecycle events arrive on a Queues subscription, scoped per sending domain. */
  readonly reportsEvents = true

  #config: CloudflareProviderConfig

  constructor(config: CloudflareProviderConfig) {
    this.#config = config
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const raw = buildMime(message)
    const size = mimeSize(raw)
    if (size > this.limits.maxMessageBytes) {
      throw new SendError(
        'permanent',
        this.name,
        `message is ${(size / 1048576).toFixed(2)} MiB; the Cloudflare transport accepts at most 5 MiB to unverified destinations`,
      )
    }

    const recipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])].map(
      (a) => a.address,
    )
    if (recipients.length > this.limits.maxRecipients) {
      throw new SendError(
        'permanent',
        this.name,
        `at most ${this.limits.maxRecipients} recipients per message`,
      )
    }

    return this.#config.binding
      ? this.#sendViaBinding(message, raw, recipients)
      : this.#sendViaRest(message, raw, recipients)
  }

  async #sendViaBinding(
    message: OutboundMessage,
    raw: string,
    recipients: string[],
  ): Promise<SendResult> {
    try {
      const res = await this.#config.binding!.send({
        from: formatAddress(message.from),
        to: recipients,
        raw,
      })
      return {
        providerMessageId: (res as { messageId?: string })?.messageId ?? null,
        provider: this.name,
        acceptedAt: new Date().toISOString(),
      }
    } catch (err) {
      throw classify(err)
    }
  }

  async #sendViaRest(
    message: OutboundMessage,
    raw: string,
    recipients: string[],
  ): Promise<SendResult> {
    const { accountId, apiToken, baseUrl = 'https://api.cloudflare.com/client/v4' } = this.#config
    if (!accountId || !apiToken) {
      throw new SendError(
        'auth',
        this.name,
        'the Cloudflare transport needs either a send_email binding or an account id and API token',
      )
    }

    let response: Response
    try {
      response = await fetch(`${baseUrl}/accounts/${accountId}/email/sending/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: formatAddress(message.from), to: recipients, raw }),
      })
    } catch (err) {
      // The request never completed. We do not know whether it arrived, so this
      // is `unknown` and must not fail over — see SendError.canFailover.
      throw new SendError(
        'unknown',
        this.name,
        `network failure contacting Cloudflare: ${String(err)}`,
      )
    }

    const bodyText = await response.text()
    if (!response.ok) throw classifyRest(response, bodyText)

    let messageId: string | null = null
    try {
      const parsed = JSON.parse(bodyText) as { result?: { message_id?: string; id?: string } }
      messageId = parsed.result?.message_id ?? parsed.result?.id ?? null
    } catch {
      /* a 2xx with an unparseable body still means accepted */
    }

    return {
      providerMessageId: messageId,
      provider: this.name,
      acceptedAt: new Date().toISOString(),
    }
  }

  dnsRecords(
    domain: string,
    opts: { selector: string; returnPath: string; dkimPublicKey?: string },
  ): DnsRequirement[] {
    const records: DnsRequirement[] = [
      {
        record: 'TXT',
        name: domain,
        value: 'v=spf1 include:_spf.mx.cloudflare.net ~all',
        purpose: 'Authorises Cloudflare to send as this domain (SPF).',
      },
      {
        record: 'TXT',
        name: `_dmarc.${domain}`,
        value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
        purpose: 'Turns on DMARC reporting. Start at p=none, tighten once reports are clean.',
      },
      {
        // Cloudflare collects bounces on its own subdomain rather than the
        // envelope domain, which is why this record exists here and not for SES.
        record: 'CNAME',
        name: `${opts.returnPath}.${domain}`,
        value: 'bounce.mx.cloudflare.net',
        purpose: 'Return path for bounce collection. Without it, DSNs are lost.',
      },
    ]
    if (opts.dkimPublicKey) {
      records.push({
        record: 'TXT',
        name: `${opts.selector}._domainkey.${domain}`,
        value: `v=DKIM1; k=rsa; p=${opts.dkimPublicKey}`,
        purpose: 'Signs outgoing mail so receivers can verify it was not altered (DKIM).',
      })
    }
    return records
  }

  async verify(): Promise<{ status: 'ok' | 'unknown' | 'failed'; detail?: string }> {
    const { accountId, apiToken, baseUrl = 'https://api.cloudflare.com/client/v4' } = this.#config
    // Credentials first, precisely because they can actually be checked. The
    // binding is only evidence that `wrangler.jsonc` declares it.
    if (accountId && apiToken) {
      try {
        const res = await fetch(`${baseUrl}/accounts/${accountId}/email/sending/domains`, {
          headers: { Authorization: `Bearer ${apiToken}` },
        })
        return res.ok
          ? { status: 'ok', detail: 'REST reachable' }
          : { status: 'failed', detail: `HTTP ${res.status}` }
      } catch (err) {
        return { status: 'failed', detail: String(err) }
      }
    }
    if (this.#config.binding) {
      return {
        status: 'unknown',
        detail:
          'send_email binding declared, but nothing here can tell whether the Email Service is configured until the first send.',
      }
    }
    return { status: 'failed', detail: 'no binding and no API credentials' }
  }
}

/**
 * The binding throws plain Errors with a message, so classification is
 * string-matching. Ugly, but the alternative — treating everything as transient
 * — would retry permanent failures forever and burn quota.
 */
function classify(err: unknown): SendError {
  const message = err instanceof Error ? err.message : String(err)
  const m = message.toLowerCase()

  if (m.includes('daily_limit') || m.includes('e_daily_limit_exceeded')) {
    return new SendError('throttled', 'cloudflare', message, {
      retryAfterSeconds: 3600,
      providerCode: 'E_DAILY_LIMIT_EXCEEDED',
    })
  }
  if (m.includes('rate') && m.includes('limit')) {
    return new SendError('throttled', 'cloudflare', message, { retryAfterSeconds: 60 })
  }
  if (m.includes('recipient_suppressed') || m.includes('suppress')) {
    // Cloudflare keeps a suppression list we cannot read. The only way we learn
    // an address is on it is this error, so it is mirrored inward.
    return new SendError('suppressed', 'cloudflare', message, {
      providerCode: 'E_RECIPIENT_SUPPRESSED',
    })
  }
  if (m.includes('unauthorized') || m.includes('forbidden') || m.includes('token')) {
    return new SendError('auth', 'cloudflare', message)
  }
  if (
    m.includes('not verified') ||
    m.includes('invalid address') ||
    m.includes('malformed') ||
    m.includes('too large') ||
    // A sender or domain the account is not allowed to send from does not
    // become allowed by waiting. Falling through to `transient` meant five
    // retries and a message that failed twenty minutes later with a reason
    // that was knowable at the first attempt.
    m.includes('not allowed') ||
    m.includes('sender') ||
    m.includes('domain not') ||
    m.includes('unknown domain') ||
    m.includes('destination address')
  ) {
    return new SendError('permanent', 'cloudflare', message)
  }
  if (m.includes('timeout') || m.includes('aborted')) {
    return new SendError('unknown', 'cloudflare', message)
  }
  return new SendError('transient', 'cloudflare', message)
}

function classifyRest(response: Response, body: string): SendError {
  const retryAfter = Number(response.headers.get('retry-after')) || undefined
  let code: string | undefined
  let detail = body.slice(0, 500)
  try {
    const parsed = JSON.parse(body) as { errors?: { code?: number | string; message?: string }[] }
    if (parsed.errors?.length) {
      code = String(parsed.errors[0]!.code ?? '')
      detail =
        parsed.errors
          .map((e) => e.message)
          .filter(Boolean)
          .join('; ') || detail
    }
  } catch {
    /* keep the raw body */
  }

  if (response.status === 429) {
    return new SendError('throttled', 'cloudflare', detail, {
      retryAfterSeconds: retryAfter ?? 60,
      providerCode: code,
    })
  }
  if (response.status === 401 || response.status === 403) {
    return new SendError('auth', 'cloudflare', detail, { providerCode: code })
  }
  if (response.status >= 500) {
    return new SendError('transient', 'cloudflare', detail, {
      retryAfterSeconds: retryAfter,
      providerCode: code,
    })
  }
  if (/suppress/i.test(detail)) {
    return new SendError('suppressed', 'cloudflare', detail, { providerCode: code })
  }
  return new SendError('permanent', 'cloudflare', detail, { providerCode: code })
}
