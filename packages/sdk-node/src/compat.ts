/**
 * `mailysend/compat` — the one-line migration.
 *
 * ```diff
 * - import { Resend } from 'resend'
 * + import { Resend } from 'mailysend/compat'
 * ```
 *
 * Everything below exists to make that diff the whole diff. Two things about
 * Resend's SDK are load-bearing and are reproduced exactly rather than
 * improved on:
 *
 *   1. **It never throws.** Every method resolves to `{ data, error }`. Code
 *      written against it has no try/catch, so a version of this class that
 *      threw would turn a migration into an outage on the first 4xx.
 *   2. **Its parameter names are its own.** `scheduledAt`, `audienceId`,
 *      `openTracking` — camelCase, and in places different from the wire
 *      format. Both spellings are accepted here; MailySend's own field names
 *      go out on the wire.
 *
 * New code should import `MailySend` from `mailysend` instead. This entry
 * point is for the codebase you are moving, not the one you are writing.
 */

import { MailySendError } from './error.ts'
import type { ClientOptions } from './http.ts'
import { HttpClient } from './http.ts'
import { ApiKeys, Audiences, Broadcasts, Contacts, Domains, Emails } from './resources.ts'
import type * as T from './types.ts'

/** Resend's error shape. `name` is the discriminator its users switch on. */
export interface ResendError {
  name: string
  message: string
  statusCode: number
}

export type ResendResponse<T> = { data: T; error: null } | { data: null; error: ResendError }

const ok = <T>(data: T): ResendResponse<T> => ({ data, error: null })

/**
 * Any thrown value becomes a Resend-shaped error rather than propagating. A
 * `TypeError` from a broken fetch polyfill has to arrive as `{ error }` too, or
 * the never-throws contract only holds for failures we predicted.
 */
const captured = async <T>(run: () => Promise<T>): Promise<ResendResponse<T>> => {
  try {
    return ok(await run())
  } catch (cause) {
    if (MailySendError.is(cause)) {
      return {
        data: null,
        error: { name: cause.name, message: cause.message, statusCode: cause.statusCode },
      }
    }
    return {
      data: null,
      error: {
        name: 'application_error',
        message: cause instanceof Error ? cause.message : String(cause),
        statusCode: 500,
      },
    }
  }
}

const readEnv = (name: string): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name]

// ---------------------------------------------------------------------------
// Payload translation
// ---------------------------------------------------------------------------

/** Resend's `CreateEmailOptions`, accepting both spellings of every renamed field. */
export interface ResendCreateEmailOptions
  extends Omit<T.SendEmailRequest, 'reply_to' | 'scheduled_at'> {
  reply_to?: T.EmailAddressList
  replyTo?: T.EmailAddressList
  scheduled_at?: string
  scheduledAt?: string
}

const toSendRequest = (payload: ResendCreateEmailOptions): T.SendEmailRequest => {
  const { replyTo, reply_to, scheduledAt, scheduled_at, ...rest } = payload
  const resolvedReplyTo = reply_to ?? replyTo
  const resolvedScheduledAt = scheduled_at ?? scheduledAt
  return {
    ...rest,
    ...(resolvedReplyTo === undefined ? {} : { reply_to: resolvedReplyTo }),
    ...(resolvedScheduledAt === undefined ? {} : { scheduled_at: resolvedScheduledAt }),
  }
}

/** Resend addresses a contact by id *or* by email; both forms are one path here. */
const contactKey = (input: { id?: string; email?: string }): string => {
  const key = input.id ?? input.email
  if (!key) {
    throw new MailySendError({
      message: 'Provide either `id` or `email`.',
      name: 'validation_error',
      code: 'validation_error',
      statusCode: 422,
    })
  }
  return key
}

// ---------------------------------------------------------------------------
// Resource shims
// ---------------------------------------------------------------------------

class ResendEmails {
  #emails: Emails

  constructor(emails: Emails) {
    this.#emails = emails
  }

  send(payload: ResendCreateEmailOptions): Promise<ResendResponse<{ id: string }>> {
    return captured(async () => {
      const sent = await this.#emails.send(toSendRequest(payload))
      return { id: sent.id }
    })
  }

  /** Resend exposes `create` as an alias of `send`; some codebases only use it. */
  create(payload: ResendCreateEmailOptions): Promise<ResendResponse<{ id: string }>> {
    return this.send(payload)
  }

  get(id: string): Promise<ResendResponse<T.Email>> {
    return captured(() => this.#emails.get(id))
  }

  update(payload: {
    id: string
    scheduledAt?: string
    scheduled_at?: string
  }): Promise<ResendResponse<{ object: 'email'; id: string }>> {
    return captured(() => {
      const at = payload.scheduled_at ?? payload.scheduledAt
      if (!at) {
        throw new MailySendError({
          message: 'Provide `scheduledAt`.',
          name: 'missing_required_field',
          code: 'missing_required_field',
          statusCode: 422,
        })
      }
      return this.#emails.update(payload.id, { scheduled_at: at })
    })
  }

  cancel(id: string): Promise<ResendResponse<{ object: 'email'; id: string }>> {
    return captured(() => this.#emails.cancel(id))
  }
}

class ResendBatch {
  #emails: Emails

  constructor(emails: Emails) {
    this.#emails = emails
  }

  /** Resend nests the array one level deep in the response; so do we. */
  send(
    payloads: ResendCreateEmailOptions[],
    options?: { idempotencyKey?: string },
  ): Promise<ResendResponse<{ data: { id: string }[] }>> {
    return captured(async () => {
      const result = await this.#emails.batch(
        payloads.map(toSendRequest),
        options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
      )
      return { data: result.data.filter((item): item is { id: string } => 'id' in item) }
    })
  }

  create(
    payloads: ResendCreateEmailOptions[],
    options?: { idempotencyKey?: string },
  ): Promise<ResendResponse<{ data: { id: string }[] }>> {
    return this.send(payloads, options)
  }
}

class ResendDomains {
  #domains: Domains

  constructor(domains: Domains) {
    this.#domains = domains
  }

  create(payload: { name: string; region?: string }): Promise<ResendResponse<T.Domain>> {
    return captured(() => this.#domains.create(payload))
  }

  get(id: string): Promise<ResendResponse<T.Domain>> {
    return captured(() => this.#domains.get(id))
  }

  list(): Promise<ResendResponse<{ data: T.Domain[] }>> {
    return captured(async () => ({ data: (await this.#domains.list()).data }))
  }

  update(payload: {
    id: string
    openTracking?: boolean
    open_tracking?: boolean
    clickTracking?: boolean
    click_tracking?: boolean
    tls?: 'opportunistic' | 'enforced'
  }): Promise<ResendResponse<T.Domain>> {
    return captured(() => {
      const body: T.UpdateDomainRequest = {}
      const opens = payload.open_tracking ?? payload.openTracking
      const clicks = payload.click_tracking ?? payload.clickTracking
      if (opens !== undefined) body.open_tracking = opens
      if (clicks !== undefined) body.click_tracking = clicks
      if (payload.tls !== undefined) body.tls = payload.tls
      return this.#domains.update(payload.id, body)
    })
  }

  remove(id: string): Promise<ResendResponse<T.DeletedResponse<'domain'>>> {
    return captured(() => this.#domains.remove(id))
  }

  verify(id: string): Promise<ResendResponse<T.Domain>> {
    return captured(() => this.#domains.verify(id))
  }
}

class ResendApiKeys {
  #apiKeys: ApiKeys

  constructor(apiKeys: ApiKeys) {
    this.#apiKeys = apiKeys
  }

  create(payload: {
    name: string
    permission?: T.ApiKeyPermission
    domain_id?: string
    domainId?: string
  }): Promise<ResendResponse<{ id: string; token: string }>> {
    return captured(async () => {
      const domainId = payload.domain_id ?? payload.domainId
      const created = await this.#apiKeys.create({
        name: payload.name,
        ...(payload.permission ? { permission: payload.permission } : {}),
        ...(domainId ? { domain_id: domainId } : {}),
      })
      return { id: created.id, token: created.token }
    })
  }

  list(): Promise<ResendResponse<{ data: T.ApiKey[] }>> {
    return captured(async () => ({ data: (await this.#apiKeys.list()).data }))
  }

  remove(id: string): Promise<ResendResponse<Record<string, never>>> {
    return captured(async () => {
      await this.#apiKeys.remove(id)
      return {} as Record<string, never>
    })
  }
}

class ResendAudiences {
  #audiences: Audiences

  constructor(audiences: Audiences) {
    this.#audiences = audiences
  }

  create(payload: { name: string }): Promise<ResendResponse<T.Audience>> {
    return captured(() => this.#audiences.create(payload))
  }

  get(id: string): Promise<ResendResponse<T.Audience>> {
    return captured(() => this.#audiences.get(id))
  }

  list(): Promise<ResendResponse<{ data: T.Audience[] }>> {
    return captured(async () => ({ data: (await this.#audiences.list()).data }))
  }

  remove(id: string): Promise<ResendResponse<T.DeletedResponse<'audience'>>> {
    return captured(() => this.#audiences.remove(id))
  }
}

class ResendContacts {
  #contacts: Contacts
  #audiences: Audiences

  constructor(contacts: Contacts, audiences: Audiences) {
    this.#contacts = contacts
    this.#audiences = audiences
  }

  create(payload: {
    email: string
    audienceId?: string
    audience_id?: string
    firstName?: string
    first_name?: string
    lastName?: string
    last_name?: string
    unsubscribed?: boolean
  }): Promise<ResendResponse<T.Contact>> {
    return captured(() => {
      const audienceId = payload.audience_id ?? payload.audienceId
      const body: T.CreateContactRequest = { email: payload.email }
      const firstName = payload.first_name ?? payload.firstName
      const lastName = payload.last_name ?? payload.lastName
      if (firstName !== undefined) body.first_name = firstName
      if (lastName !== undefined) body.last_name = lastName
      if (payload.unsubscribed !== undefined) body.unsubscribed = payload.unsubscribed
      return audienceId
        ? this.#audiences.contacts.create(audienceId, body)
        : this.#contacts.create(body)
    })
  }

  get(payload: {
    id?: string
    email?: string
    audienceId?: string
    audience_id?: string
  }): Promise<ResendResponse<T.Contact>> {
    return captured(() => {
      const audienceId = payload.audience_id ?? payload.audienceId
      const key = contactKey(payload)
      return audienceId ? this.#audiences.contacts.get(audienceId, key) : this.#contacts.get(key)
    })
  }

  list(payload?: {
    audienceId?: string
    audience_id?: string
  }): Promise<ResendResponse<{ data: T.Contact[] }>> {
    return captured(async () => {
      const audienceId = payload?.audience_id ?? payload?.audienceId
      const page = audienceId
        ? await this.#audiences.contacts.list(audienceId)
        : await this.#contacts.list()
      return { data: page.data }
    })
  }

  update(payload: {
    id?: string
    email?: string
    audienceId?: string
    audience_id?: string
    firstName?: string
    first_name?: string
    lastName?: string
    last_name?: string
    unsubscribed?: boolean
  }): Promise<ResendResponse<T.Contact>> {
    return captured(() => {
      const audienceId = payload.audience_id ?? payload.audienceId
      const key = contactKey(payload)
      const body: T.UpdateContactRequest = {}
      const firstName = payload.first_name ?? payload.firstName
      const lastName = payload.last_name ?? payload.lastName
      if (firstName !== undefined) body.first_name = firstName
      if (lastName !== undefined) body.last_name = lastName
      if (payload.unsubscribed !== undefined) body.unsubscribed = payload.unsubscribed
      return audienceId
        ? this.#audiences.contacts.update(audienceId, key, body)
        : this.#contacts.update(key, body)
    })
  }

  remove(payload: {
    id?: string
    email?: string
    audienceId?: string
    audience_id?: string
  }): Promise<ResendResponse<T.DeletedResponse<'contact'>>> {
    return captured(() => {
      const audienceId = payload.audience_id ?? payload.audienceId
      const key = contactKey(payload)
      return audienceId
        ? this.#audiences.contacts.remove(audienceId, key)
        : this.#contacts.remove(key)
    })
  }
}

class ResendBroadcasts {
  #broadcasts: Broadcasts

  constructor(broadcasts: Broadcasts) {
    this.#broadcasts = broadcasts
  }

  create(payload: {
    audienceId?: string
    audience_id?: string
    from: string
    subject: string
    name?: string
    html?: string
    text?: string
    replyTo?: string | string[]
    reply_to?: string | string[]
    previewText?: string
    preview_text?: string
  }): Promise<ResendResponse<{ id: string }>> {
    return captured(async () => {
      const audienceId = payload.audience_id ?? payload.audienceId
      if (!audienceId) {
        throw new MailySendError({
          message: 'Provide `audienceId`.',
          name: 'missing_required_field',
          code: 'missing_required_field',
          statusCode: 422,
        })
      }
      const replyTo = payload.reply_to ?? payload.replyTo
      const previewText = payload.preview_text ?? payload.previewText
      const created = await this.#broadcasts.create({
        audience_id: audienceId,
        from: payload.from,
        subject: payload.subject,
        ...(payload.name === undefined ? {} : { name: payload.name }),
        ...(payload.html === undefined ? {} : { html: payload.html }),
        ...(payload.text === undefined ? {} : { text: payload.text }),
        ...(replyTo === undefined ? {} : { reply_to: replyTo }),
        ...(previewText === undefined ? {} : { preview_text: previewText }),
      })
      return { id: created.id }
    })
  }

  get(id: string): Promise<ResendResponse<T.Broadcast>> {
    return captured(() => this.#broadcasts.get(id))
  }

  list(): Promise<ResendResponse<{ data: T.Broadcast[] }>> {
    return captured(async () => ({ data: (await this.#broadcasts.list()).data }))
  }

  update(
    payload: { id: string } & T.UpdateBroadcastRequest,
  ): Promise<ResendResponse<{ id: string }>> {
    return captured(async () => {
      const { id, ...rest } = payload
      const updated = await this.#broadcasts.update(id, rest)
      return { id: updated.id }
    })
  }

  send(
    id: string,
    payload?: { scheduledAt?: string; scheduled_at?: string },
  ): Promise<ResendResponse<{ id: string }>> {
    return captured(async () => {
      const at = payload?.scheduled_at ?? payload?.scheduledAt
      const sent = await this.#broadcasts.send(id, at ? { scheduled_at: at } : {})
      return { id: sent.id }
    })
  }

  remove(id: string): Promise<ResendResponse<T.DeletedResponse<'broadcast'>>> {
    return captured(() => this.#broadcasts.remove(id))
  }
}

// ---------------------------------------------------------------------------
// The class
// ---------------------------------------------------------------------------

export class Resend {
  readonly emails: ResendEmails
  readonly batch: ResendBatch
  readonly domains: ResendDomains
  readonly apiKeys: ResendApiKeys
  readonly audiences: ResendAudiences
  readonly contacts: ResendContacts
  readonly broadcasts: ResendBroadcasts

  constructor(apiKey?: string, options: Omit<ClientOptions, 'apiKey'> = {}) {
    // `RESEND_API_KEY` is checked first: a codebase mid-migration still has it
    // set, and asking people to rename an environment variable is exactly the
    // second line this entry point exists to avoid.
    const key = apiKey ?? readEnv('RESEND_API_KEY') ?? readEnv('MAILYSEND_API_KEY')
    // `RESEND_BASE_URL` for the same reason, and it matters more here than the
    // key does: pointing that variable at a deployment is the entire migration
    // the README leads with, because the official `resend` client resolves its
    // host as `process.env.RESEND_BASE_URL || 'https://api.resend.com'`. An app
    // that swapped its import to `mailysend/compat` and changed nothing else
    // would otherwise be told it has no base URL while one is sitting in the
    // environment.
    const base = options.baseUrl ?? readEnv('RESEND_BASE_URL') ?? readEnv('MAILYSEND_BASE_URL')
    const http = new HttpClient({
      ...options,
      ...(key ? { apiKey: key } : {}),
      ...(base ? { baseUrl: base } : {}),
    })

    const emails = new Emails(http)
    const audiences = new Audiences(http)
    this.emails = new ResendEmails(emails)
    this.batch = new ResendBatch(emails)
    this.domains = new ResendDomains(new Domains(http))
    this.apiKeys = new ResendApiKeys(new ApiKeys(http))
    this.audiences = new ResendAudiences(audiences)
    this.contacts = new ResendContacts(new Contacts(http), audiences)
    this.broadcasts = new ResendBroadcasts(new Broadcasts(http))
  }
}

export default Resend
