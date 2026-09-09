import { SMTPServer } from 'smtp-server'

/**
 * The SMTP submission relay.
 *
 * It does exactly one thing: accept an authenticated submission, and hand the
 * raw MIME to `POST /v1/emails/raw`. It parses nothing, stores nothing, and
 * keeps no state — so it can be restarted at any moment, scaled to any number
 * of replicas, and it holds no secret beyond the API key the client presents.
 *
 * The credential *is* the MailySend API key. Inventing a second credential
 * store here would mean a second revocation path that nobody remembers to use.
 */

const PORT = Number(process.env.PORT ?? 587)
const API_URL = process.env.MS_API_URL ?? 'http://localhost:8917'
const MAX_SIZE = Number(process.env.MS_MAX_SIZE ?? 26_214_400)

const server = new SMTPServer({
  name: process.env.MS_HOSTNAME ?? 'smtp.mailysend.local',
  size: MAX_SIZE,
  authOptional: false,
  // STARTTLS only when a certificate is mounted. Behind Spectrum or a TLS
  // terminator the connection is already encrypted; advertising STARTTLS we
  // cannot complete would be worse than not advertising it.
  ...(process.env.MS_TLS_KEY && process.env.MS_TLS_CERT
    ? { key: process.env.MS_TLS_KEY, cert: process.env.MS_TLS_CERT }
    : { disabledCommands: ['STARTTLS'] }),

  onAuth(auth, _session, callback) {
    // Two spellings, because clients differ: `api_token` as the username with
    // the key as the password (Cloudflare's convention), or the key as both.
    const key =
      auth.username === 'api_token' || auth.username === 'apikey' ? auth.password : auth.password
    if (!key?.startsWith('ms_')) {
      return callback(new Error('Invalid credentials. Use your MailySend API key as the password.'))
    }
    callback(null, { user: key })
  },

  onData(stream, session, callback) {
    const chunks = []
    let size = 0
    let truncated = false

    stream.on('data', (chunk) => {
      size += chunk.length
      // `smtp-server` enforces `size` too, but a client that ignores the EHLO
      // advertisement can still stream past it; refusing to buffer is the point.
      if (size > MAX_SIZE) {
        truncated = true
        return
      }
      chunks.push(chunk)
    })

    stream.on('end', async () => {
      if (truncated || stream.sizeExceeded) {
        return callback(new Error(`552 5.3.4 Message exceeds ${MAX_SIZE} bytes`))
      }
      try {
        const response = await fetch(`${API_URL}/v1/emails/raw`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${session.user}`,
            'content-type': 'message/rfc822',
            // Envelope recipients are authoritative — they are what the client
            // actually asked us to deliver to, and they can legitimately differ
            // from the To: header (Bcc, mailing lists, forwarding).
            'x-envelope-from': session.envelope.mailFrom?.address ?? '',
            'x-envelope-to': session.envelope.rcptTo.map((r) => r.address).join(','),
          },
          body: Buffer.concat(chunks),
        })

        if (response.ok) return callback()

        const body = await response.text().catch(() => '')
        // 4xx from us is the client's fault and permanent; 5xx is ours and the
        // sender should retry. Mapping them the other way round would make a
        // transient outage look like a rejected message.
        const code = response.status >= 500 ? '451 4.3.0' : '550 5.3.0'
        callback(new Error(`${code} ${body.slice(0, 200) || response.statusText}`))
      } catch (err) {
        callback(new Error(`451 4.3.0 Upstream unavailable: ${err.message}`))
      }
    })
  },
})

server.on('error', (err) => console.error('[smtp]', err.message))

server.listen(PORT, '0.0.0.0', () => {
  console.log(`mailysend smtp-shim listening on :${PORT} → ${API_URL}`)
})

const shutdown = () => server.close(() => process.exit(0))
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
