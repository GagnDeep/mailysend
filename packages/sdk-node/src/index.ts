import type { ClientOptions } from './http.ts'
import { HttpClient } from './http.ts'
import {
  Analytics,
  ApiKeys,
  Audiences,
  Automations,
  Broadcasts,
  Contacts,
  Domains,
  Emails,
  Inbound,
  Segments,
  Suppressions,
  Templates,
} from './resources.ts'
import { Webhooks } from './webhooks.ts'

/**
 * The MailySend client.
 *
 * ```ts
 * const mailysend = new MailySend(process.env.MAILYSEND_API_KEY)
 * await mailysend.emails.send({ from: 'you@example.com', to: 'them@example.com', subject: 'Hi', text: 'Hello' })
 * ```
 *
 * The constructor takes the key positionally to match every other mail SDK
 * people are migrating from, with an options object second for everything else.
 */
export class MailySend {
  readonly emails: Emails
  readonly domains: Domains
  readonly apiKeys: ApiKeys
  readonly audiences: Audiences
  readonly contacts: Contacts
  readonly segments: Segments
  readonly broadcasts: Broadcasts
  readonly automations: Automations
  readonly templates: Templates
  readonly suppressions: Suppressions
  readonly webhooks: Webhooks
  readonly analytics: Analytics
  readonly inbound: Inbound

  /** Escape hatch for endpoints newer than this SDK. Same auth, same retries. */
  readonly http: HttpClient

  constructor(apiKey?: string, options: Omit<ClientOptions, 'apiKey'> = {}) {
    this.http = new HttpClient({ ...options, ...(apiKey ? { apiKey } : {}) })
    this.emails = new Emails(this.http)
    this.domains = new Domains(this.http)
    this.apiKeys = new ApiKeys(this.http)
    this.audiences = new Audiences(this.http)
    this.contacts = new Contacts(this.http)
    this.segments = new Segments(this.http)
    this.broadcasts = new Broadcasts(this.http)
    this.automations = new Automations(this.http)
    this.templates = new Templates(this.http)
    this.suppressions = new Suppressions(this.http)
    this.webhooks = new Webhooks(this.http)
    this.analytics = new Analytics(this.http)
    this.inbound = new Inbound(this.http)
  }
}

/** `Mailysend` and `MailySendClient` alias the same class; people guess all three. */
export { MailySend as Mailysend, MailySend as MailySendClient }
export default MailySend

export { MailySendConnectionError, MailySendError } from './error.ts'
export type { ClientOptions, HttpCall, Query, RequestOptions } from './http.ts'
export { HttpClient, VERSION } from './http.ts'
export {
  Analytics,
  ApiKeys,
  AudienceContacts,
  Audiences,
  Automations,
  Broadcasts,
  Contacts,
  Domains,
  Emails,
  Inbound,
  Segments,
  Suppressions,
  Templates,
} from './resources.ts'
export type * from './types.ts'
export type { VerifyOptions } from './webhooks.ts'
export { SIGNATURE_TOLERANCE_SECONDS, verifySignature, Webhooks } from './webhooks.ts'
