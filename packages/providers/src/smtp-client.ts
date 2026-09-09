/**
 * A minimal ESMTP client.
 *
 * Runs on both runtimes because the socket is injected rather than imported:
 * Workers supply `connect` from `cloudflare:sockets`, Node supplies a shim over
 * `node:net`/`node:tls`. Both expose a `{ readable, writable }` pair, so the
 * protocol code below is identical.
 *
 * Note the direction: this is *outbound* SMTP, which Workers can do. Inbound
 * SMTP — running a listener on port 587 — is the one thing Workers genuinely
 * cannot do, and lives in apps/smtp-shim as a container instead.
 */

export interface SocketLike {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
  close(): Promise<void> | void
  /** Upgrades the connection in place for STARTTLS. Absent means no STARTTLS. */
  startTls?(): SocketLike
}

export type ConnectFn = (
  address: { hostname: string; port: number },
  options?: { secureTransport?: 'off' | 'on' | 'starttls'; allowHalfOpen?: boolean },
) => SocketLike

export interface SmtpAuth {
  user: string
  pass: string
}

export interface SmtpOptions {
  host: string
  port: number
  /** `tls` connects with TLS from the first byte (465); `starttls` upgrades (587). */
  secure: 'tls' | 'starttls' | 'none'
  auth?: SmtpAuth
  ehloName?: string
  timeoutMs?: number
  /** Rejecting an unverified certificate is the default; this is the escape hatch. */
  allowInsecure?: boolean
}

export class SmtpError extends Error {
  readonly code: number
  readonly response: string
  constructor(code: number, response: string) {
    super(`SMTP ${code}: ${response}`)
    this.name = 'SmtpError'
    this.code = code
    this.response = response
  }
  /** 4xx is "try later"; 5xx is "never". The distinction drives retry vs. bounce. */
  get transient(): boolean {
    return this.code >= 400 && this.code < 500
  }
}

/** One SMTP conversation, kept whole so the log drawer can show it verbatim. */
export interface SmtpTranscript {
  lines: { direction: 'C' | 'S'; text: string; at: number }[]
  finalResponse: string
  queueId: string | null
}

export class SmtpSession {
  #socket: SocketLike
  #reader: ReadableStreamDefaultReader<Uint8Array>
  #writer: WritableStreamDefaultWriter<Uint8Array>
  #buffer = ''
  #transcript: SmtpTranscript = { lines: [], finalResponse: '', queueId: null }
  #capabilities = new Set<string>()

  private constructor(socket: SocketLike) {
    this.#socket = socket
    this.#reader = socket.readable.getReader()
    this.#writer = socket.writable.getWriter()
  }

  get transcript(): SmtpTranscript {
    return this.#transcript
  }

  static async connect(connect: ConnectFn, options: SmtpOptions): Promise<SmtpSession> {
    const socket = connect(
      { hostname: options.host, port: options.port },
      {
        secureTransport:
          options.secure === 'tls' ? 'on' : options.secure === 'starttls' ? 'starttls' : 'off',
      },
    )
    let session = new SmtpSession(socket)

    await session.#expect(220)
    const ehloName = options.ehloName ?? 'mailysend'
    await session.#ehlo(ehloName)

    if (options.secure === 'starttls') {
      if (!session.#capabilities.has('STARTTLS')) {
        // Continuing in the clear would silently downgrade a connection the
        // caller asked to be encrypted. That is worse than failing.
        throw new Error(`${options.host} does not advertise STARTTLS but starttls was requested`)
      }
      await session.#command('STARTTLS', 220)
      if (!socket.startTls) throw new Error('this runtime cannot upgrade the socket for STARTTLS')
      const upgraded = socket.startTls()
      await session.#release()
      session = new SmtpSession(upgraded)
      // The capability list is only trustworthy after the upgrade; servers
      // routinely advertise AUTH only once the channel is encrypted.
      await session.#ehlo(ehloName)
    }

    if (options.auth) await session.#authenticate(options.auth)
    return session
  }

  async #ehlo(name: string) {
    const response = await this.#command(`EHLO ${name}`, 250)
    this.#capabilities.clear()
    for (const line of response.split(/\r?\n/)) {
      const cap = line
        .replace(/^\d{3}[ -]/, '')
        .trim()
        .toUpperCase()
      if (cap) {
        this.#capabilities.add(cap.split(' ')[0]!)
        if (cap.startsWith('AUTH'))
          for (const m of cap.split(/\s+/).slice(1)) this.#capabilities.add(`AUTH=${m}`)
      }
    }
  }

  async #authenticate(auth: SmtpAuth) {
    if (this.#capabilities.has('AUTH=PLAIN')) {
      const token = btoa(`\0${auth.user}\0${auth.pass}`)
      await this.#command(`AUTH PLAIN ${token}`, 235)
      return
    }
    if (this.#capabilities.has('AUTH=LOGIN')) {
      await this.#command('AUTH LOGIN', 334)
      await this.#command(btoa(auth.user), 334)
      await this.#command(btoa(auth.pass), 235)
      return
    }
    // Try PLAIN anyway: some servers authenticate without advertising it.
    await this.#command(`AUTH PLAIN ${btoa(`\0${auth.user}\0${auth.pass}`)}`, 235)
  }

  async send(envelope: { from: string; to: string[]; raw: string }): Promise<SmtpTranscript> {
    await this.#command(`MAIL FROM:<${envelope.from}>`, 250)
    for (const rcpt of envelope.to) await this.#command(`RCPT TO:<${rcpt}>`, [250, 251])
    await this.#command('DATA', 354)

    // Dot-stuffing: a line consisting of a single "." terminates DATA, so any
    // line in the body that starts with "." must be doubled or the message is
    // truncated at that point.
    const body = envelope.raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')
    await this.#writeRaw(`${body}\r\n.\r\n`)
    const final = await this.#expect(250)
    this.#transcript.finalResponse = final

    // Most MTAs return their own id here ("250 2.0.0 Ok: queued as 4F2B1..."),
    // and it is the only correlation handle raw SMTP gives us.
    const queued = final.match(
      /queued as ([A-Za-z0-9]+)|id=([A-Za-z0-9._-]+)|Ok:? ([A-Za-z0-9-]{8,})/i,
    )
    this.#transcript.queueId = queued?.[1] ?? queued?.[2] ?? queued?.[3] ?? null
    return this.#transcript
  }

  async quit() {
    try {
      await this.#command('QUIT', 221)
    } catch {
      /* a server that drops the connection on QUIT is not an error worth surfacing */
    }
    await this.#release()
  }

  async #release() {
    try {
      this.#reader.releaseLock()
      await this.#writer.close()
    } catch {
      /* already closed */
    }
    try {
      await this.#socket.close()
    } catch {
      /* already closed */
    }
  }

  async #command(line: string, expected: number | number[]): Promise<string> {
    // Credentials must not reach the transcript that gets stored and displayed.
    const redacted = /^AUTH|^[A-Za-z0-9+/=]{16,}$/.test(line) ? `${line.slice(0, 10)}…` : line
    this.#transcript.lines.push({ direction: 'C', text: redacted, at: Date.now() })
    await this.#writeRaw(`${line}\r\n`)
    return this.#expect(expected)
  }

  async #writeRaw(data: string) {
    await this.#writer.write(new TextEncoder().encode(data))
  }

  /** Reads one complete SMTP reply, honouring multi-line `250-` continuations. */
  async #expect(expected: number | number[]): Promise<string> {
    const codes = Array.isArray(expected) ? expected : [expected]
    const decoder = new TextDecoder()

    for (;;) {
      const complete = this.#buffer.match(/^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\r?\n/)
      if (complete) {
        const response = this.#buffer.slice(0, complete[0].length)
        this.#buffer = this.#buffer.slice(complete[0].length)
        const code = Number(complete[1])
        this.#transcript.lines.push({ direction: 'S', text: response.trim(), at: Date.now() })
        if (!codes.includes(code)) throw new SmtpError(code, response.trim())
        return response.trim()
      }

      const { value, done } = await this.#reader.read()
      if (done)
        throw new Error(`connection closed mid-reply; buffer was: ${this.#buffer.slice(0, 200)}`)
      this.#buffer += decoder.decode(value, { stream: true })
    }
  }
}
