import { buildSignedMime, mimeSize } from '../mime.ts'
import { type ConnectFn, SmtpError, SmtpSession } from '../smtp-client.ts'
import type {
  DnsRequirement,
  OutboundMessage,
  Provider,
  ProviderLimits,
  SendResult,
} from '../types.ts'
import { SendError } from '../types.ts'

/**
 * Generic SMTP relay.
 *
 * The escape hatch: any provider with an SMTP endpoint — Postmark, Mailgun,
 * SendGrid, a corporate relay, Cloudflare's own smtp.mx.cloudflare.net — works
 * without us writing an adapter for it.
 *
 * What it cannot do is report events. There are no delivery webhooks on a raw
 * relay, so lifecycle beyond "the MTA said 250" comes from DSN parsing on the
 * return path, and the dashboard says so rather than showing a blank timeline
 * and letting the customer assume something is broken.
 */

export const SMTP_LIMITS: ProviderLimits = {
  // Most relays accept far more, but a large RCPT list is a spam signal at many
  // receivers and the API contract promises 50 everywhere. Consistency wins.
  maxRecipients: 50,
  maxMessageBytes: 25 * 1024 * 1024,
  maxAttachmentBytes: 25 * 1024 * 1024,
  maxSubjectChars: 998,
  maxHeaderBytes: 100 * 1024,
  dailyQuota: null,
}

export interface SmtpProviderConfig {
  host: string
  port: number
  secure: 'tls' | 'starttls' | 'none'
  user?: string
  pass?: string
  ehloName?: string
  /** Injected so the same class runs on Workers and Node. */
  connect: ConnectFn
}

export class SmtpProvider implements Provider {
  readonly name = 'smtp' as const
  readonly limits = SMTP_LIMITS
  /** No webhooks on a raw relay. Lifecycle comes from DSNs, and only partly. */
  readonly reportsEvents = false

  #config: SmtpProviderConfig

  constructor(config: SmtpProviderConfig) {
    this.#config = config
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const raw = await buildSignedMime(message)
    const size = mimeSize(raw)
    if (size > this.limits.maxMessageBytes) {
      throw new SendError(
        'permanent',
        this.name,
        `message is ${(size / 1048576).toFixed(2)} MiB; this relay is configured for at most 25 MB`,
      )
    }

    const recipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])].map(
      (a) => a.address,
    )
    // The envelope sender is the return path, not the From: header — this is
    // what makes bounces arrive somewhere we can parse them.
    const envelopeFrom = message.returnPath ?? message.from.address

    let session: SmtpSession | undefined
    try {
      session = await SmtpSession.connect(this.#config.connect, {
        host: this.#config.host,
        port: this.#config.port,
        secure: this.#config.secure,
        ehloName: this.#config.ehloName,
        ...(this.#config.user && this.#config.pass
          ? { auth: { user: this.#config.user, pass: this.#config.pass } }
          : {}),
      })

      const transcript = await session.send({ from: envelopeFrom, to: recipients, raw })
      await session.quit()

      return {
        providerMessageId: transcript.queueId,
        provider: this.name,
        smtpResponse: transcript.finalResponse,
        acceptedAt: new Date().toISOString(),
      }
    } catch (err) {
      if (session) await session.quit().catch(() => {})
      throw classifySmtp(err)
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
        value: `v=spf1 a mx include:${this.#config.host} ~all`,
        purpose:
          'Authorises your relay to send as this domain. Adjust the include for your provider.',
        match: 'include',
      },
      {
        record: 'TXT',
        name: `_dmarc.${domain}`,
        value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
        purpose: 'Turns on DMARC reporting.',
        match: 'prefix',
      },
    ]
    if (opts.dkimPublicKey) {
      records.push({
        record: 'TXT',
        name: `${opts.selector}._domainkey.${domain}`,
        value: `v=DKIM1; k=rsa; p=${opts.dkimPublicKey}`,
        purpose:
          'DKIM key. MailySend signs on this selector before handing the message to the relay.',
      })
    }
    return records
  }

  async verify() {
    try {
      const session = await SmtpSession.connect(this.#config.connect, {
        host: this.#config.host,
        port: this.#config.port,
        secure: this.#config.secure,
        ehloName: this.#config.ehloName,
        ...(this.#config.user && this.#config.pass
          ? { auth: { user: this.#config.user, pass: this.#config.pass } }
          : {}),
      })
      await session.quit()
      return {
        status: 'ok' as const,
        detail: `connected to ${this.#config.host}:${this.#config.port}`,
      }
    } catch (err) {
      return {
        status: 'failed' as const,
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }
}

function classifySmtp(err: unknown): SendError {
  if (err instanceof SmtpError) {
    // 421/450/451/452 are explicitly "come back later".
    if (err.transient) {
      return new SendError('transient', 'smtp', err.message, {
        providerCode: String(err.code),
        smtpResponse: err.response,
        retryAfterSeconds: err.code === 421 ? 300 : 60,
      })
    }
    if (err.code === 530 || err.code === 535) {
      return new SendError('auth', 'smtp', err.message, {
        providerCode: String(err.code),
        smtpResponse: err.response,
      })
    }
    if (err.code === 550 && /suppress|blocked|blacklist/i.test(err.response)) {
      return new SendError('suppressed', 'smtp', err.message, {
        providerCode: String(err.code),
        smtpResponse: err.response,
      })
    }
    return new SendError('permanent', 'smtp', err.message, {
      providerCode: String(err.code),
      smtpResponse: err.response,
    })
  }

  const message = err instanceof Error ? err.message : String(err)
  // A connection that dies after DATA may well have delivered. Treating that as
  // transient would risk a duplicate; `unknown` deliberately blocks failover.
  if (/closed mid-reply|aborted|timeout/i.test(message)) {
    return new SendError('unknown', 'smtp', message)
  }
  return new SendError('transient', 'smtp', message)
}

/**
 * Node's socket, shaped like the Workers one.
 *
 * Lives here rather than in the Node platform package because it is the only
 * place that needs it, and keeping the import inside a function means a Workers
 * bundle never sees `node:net` at all.
 */
export async function nodeConnect(): Promise<ConnectFn> {
  const net = await import('node:net')
  const tls = await import('node:tls')

  const wrap = (socket: import('node:net').Socket, upgrade?: () => SmtpSocket): SmtpSocket => {
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        socket.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
        socket.on('end', () => {
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        })
        socket.on('error', (err) => controller.error(err))
      },
      cancel() {
        socket.destroy()
      },
    })
    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        return new Promise((resolve, reject) => {
          socket.write(chunk, (err) => (err ? reject(err) : resolve()))
        })
      },
      close() {
        socket.end()
      },
    })
    return {
      readable,
      writable,
      close: () => void socket.destroy(),
      ...(upgrade ? { startTls: upgrade } : {}),
    }
  }

  type SmtpSocket = ReturnType<ConnectFn>

  return (address, options) => {
    if (options?.secureTransport === 'on') {
      const socket = tls.connect({
        host: address.hostname,
        port: address.port,
        servername: address.hostname,
      })
      return wrap(socket as unknown as import('node:net').Socket)
    }
    const socket = net.connect({ host: address.hostname, port: address.port })
    return wrap(socket, () => {
      const upgraded = tls.connect({ socket, servername: address.hostname })
      return wrap(upgraded as unknown as import('node:net').Socket)
    })
  }
}
