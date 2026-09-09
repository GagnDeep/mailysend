import type { HttpClient, RequestOptions } from './http.ts'
import { asQuery } from './http.ts'
import type * as T from './types.ts'

/**
 * Resources are deliberately thin: a method is a URL, a verb and a type
 * parameter. Auth, idempotency and retrying all live in `HttpClient`, so there
 * is exactly one place where those policies are written down and no endpoint
 * can quietly opt out of them.
 */
abstract class Resource {
  protected http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

export class Emails extends Resource {
  send(body: T.SendEmailRequest, options?: RequestOptions): Promise<T.SendEmailResponse> {
    return this.http.request({ method: 'POST', path: '/v1/emails', body, options })
  }

  /**
   * Up to 100 messages in one call. A single bad item does not fail the batch —
   * the response carries `{ index, error }` in its place, so the caller can tell
   * which one failed without diffing arrays.
   */
  batch(body: T.BatchSendRequest, options?: RequestOptions): Promise<T.BatchSendResponse> {
    return this.http.request({ method: 'POST', path: '/v1/emails/batch', body, options })
  }

  list(params?: T.ListEmailsParams, options?: RequestOptions): Promise<T.ListResponse<T.Email>> {
    return this.http.request({ method: 'GET', path: '/v1/emails', query: asQuery(params), options })
  }

  get(id: string, options?: RequestOptions): Promise<T.Email> {
    return this.http.request({
      method: 'GET',
      path: `/v1/emails/${encodeURIComponent(id)}`,
      options,
    })
  }

  /** Reschedules a message that has not left yet. */
  update(
    id: string,
    body: T.UpdateEmailRequest,
    options?: RequestOptions,
  ): Promise<{ object: 'email'; id: string }> {
    return this.http.request({
      method: 'PATCH',
      path: `/v1/emails/${encodeURIComponent(id)}`,
      body,
      options,
    })
  }

  cancel(id: string, options?: RequestOptions): Promise<{ object: 'email'; id: string }> {
    return this.http.request({
      method: 'DELETE',
      path: `/v1/emails/${encodeURIComponent(id)}`,
      options,
    })
  }

  events(id: string, options?: RequestOptions): Promise<T.ListResponse<T.EmailEvent>> {
    return this.http.request({
      method: 'GET',
      path: `/v1/emails/${encodeURIComponent(id)}/events`,
      options,
    })
  }
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

export class Domains extends Resource {
  create(body: T.CreateDomainRequest, options?: RequestOptions): Promise<T.Domain> {
    return this.http.request({ method: 'POST', path: '/v1/domains', body, options })
  }

  list(params?: T.PaginationParams, options?: RequestOptions): Promise<T.ListResponse<T.Domain>> {
    return this.http.request({
      method: 'GET',
      path: '/v1/domains',
      query: asQuery(params),
      options,
    })
  }

  get(id: string, options?: RequestOptions): Promise<T.Domain> {
    return this.http.request({
      method: 'GET',
      path: `/v1/domains/${encodeURIComponent(id)}`,
      options,
    })
  }

  update(id: string, body: T.UpdateDomainRequest, options?: RequestOptions): Promise<T.Domain> {
    return this.http.request({
      method: 'PATCH',
      path: `/v1/domains/${encodeURIComponent(id)}`,
      body,
      options,
    })
  }

  remove(id: string, options?: RequestOptions): Promise<T.DeletedResponse<'domain'>> {
    return this.http.request({
      method: 'DELETE',
      path: `/v1/domains/${encodeURIComponent(id)}`,
      options,
    })
  }

  verify(id: string, options?: RequestOptions): Promise<T.Domain> {
    return this.http.request({
      method: 'POST',
      path: `/v1/domains/${encodeURIComponent(id)}/verify`,
      options,
    })
  }

  quota(id: string, options?: RequestOptions): Promise<T.DomainQuota> {
    return this.http.request({
      method: 'GET',
      path: `/v1/domains/${encodeURIComponent(id)}/quota`,
      options,
    })
  }
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export class ApiKeys extends Resource {
  /** The only response that ever carries the secret. Store it now or lose it. */
  create(body: T.CreateApiKeyRequest, options?: RequestOptions): Promise<T.CreatedApiKey> {
    return this.http.request({ method: 'POST', path: '/v1/api-keys', body, options })
  }

  list(params?: T.PaginationParams, options?: RequestOptions): Promise<T.ListResponse<T.ApiKey>> {
    return this.http.request({
      method: 'GET',
      path: '/v1/api-keys',
      query: asQuery(params),
      options,
    })
  }

  get(id: string, options?: RequestOptions): Promise<T.ApiKey> {
    return this.http.request({
      method: 'GET',
      path: `/v1/api-keys/${encodeURIComponent(id)}`,
      options,
    })
  }

  remove(id: string, options?: RequestOptions): Promise<T.DeletedResponse<'api_key'>> {
    return this.http.request({
      method: 'DELETE',
      path: `/v1/api-keys/${encodeURIComponent(id)}`,
      options,
    })
  }
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/**
 * Contacts are addressable two ways: flat (`/v1/contacts/:id`) and nested under
 * their audience (`/v1/audiences/:audience_id/contacts/:id`). Both exist on the
 * server, and the nested form is what Resend's SDK calls, so both are here.
 */
export class Contacts extends Resource {
  create(body: T.CreateContactRequest, options?: RequestOptions): Promise<T.Contact> {
    return this.http.request({ method: 'POST', path: '/v1/contacts', body, options })
  }

  list(
    params?: T.PaginationParams & { audience_id?: string; unsubscribed?: boolean },
    options?: RequestOptions,
  ): Promise<T.ListResponse<T.Contact>> {
    return this.http.request({
      method: 'GET',
      path: '/v1/contacts',
      query: asQuery(params),
      options,
    })
  }

  get(id: string, options?: RequestOptions): Promise<T.Contact> {
    return this.http.request({
      method: 'GET',
      path: `/v1/contacts/${encodeURIComponent(id)}`,
      options,
    })
  }

  update(id: string, body: T.UpdateContactRequest, options?: RequestOptions): Promise<T.Contact> {
    return this.http.request({
      method: 'PATCH',
      path: `/v1/contacts/${encodeURIComponent(id)}`,
      body,
      options,
    })
  }

  remove(id: string, options?: RequestOptions): Promise<T.DeletedResponse<'contact'>> {
    return this.http.request({
      method: 'DELETE',
      path: `/v1/contacts/${encodeURIComponent(id)}`,
      options,
    })
  }

  /** Bulk upsert. Rejected rows come back indexed rather than failing the call. */
  import(
    body: T.ImportContactsRequest,
    options?: RequestOptions,
  ): Promise<T.ImportContactsResponse> {
    return this.http.request({ method: 'POST', path: '/v1/contacts/import', body, options })
  }
}

// ---------------------------------------------------------------------------
// Audiences
// ---------------------------------------------------------------------------

export class AudienceContacts extends Resource {
  create(
    audienceId: string,
    body: T.CreateContactRequest,
    options?: RequestOptions,
  ): Promise<T.Contact> {
    return this.http.request({
      method: 'POST',
      path: `/v1/audiences/${encodeURIComponent(audienceId)}/contacts`,
      body,
      options,
    })
  }

  list(
    audienceId: string,
    params?: T.PaginationParams,
    options?: RequestOptions,
  ): Promise<T.ListResponse<T.Contact>> {
    return this.http.request({
      method: 'GET',
      path: `/v1/audiences/${encodeURIComponent(audienceId)}/contacts`,
      query: asQuery(params),
      options,
    })
  }

  get(audienceId: string, id: string, options?: RequestOptions): Promise<T.Contact> {
    return this.http.request({
      method: 'GET',
      path: `/v1/audiences/${encodeURIComponent(audienceId)}/contacts/${encodeURIComponent(id)}`,
      options,
    })
  }

  update(
    audienceId: string,
    id: string,
    body: T.UpdateContactRequest,
    options?: RequestOptions,
  ): Promise<T.Contact> {
    return this.http.request({
      method: 'PATCH',
      path: `/v1/audiences/${encodeURIComponent(audienceId)}/contacts/${encodeURIComponent(id)}`,
      body,
      options,
    })
  }

  remove(
    audienceId: string,
    id: string,
    options?: RequestOptions,
  ): Promise<T.DeletedResponse<'contact'>> {
    return this.http.request({
      method: 'DELETE',
      path: `/v1/audiences/${encodeURIComponent(audienceId)}/contacts/${encodeURIComponent(id)}`,
      options,
    })
  }
}

export class Audiences extends Resource {
  readonly contacts: AudienceContacts

  constructor(http: HttpClient) {
    super(http)
    this.contacts = new AudienceContacts(http)
  }

  create(body: T.CreateAudienceRequest, options?: RequestOptions): Promise<T.Audience> {
    return this.http.request({ method: 'POST', path: '/v1/audiences', body, options })
  }

  list(params?: T.PaginationParams, options?: RequestOptions): Promise<T.ListResponse<T.Audience>> {
    return this.http.request({
      method: 'GET',
      path: '/v1/audiences',
      query: asQuery(params),
      options,
    })
  }

  get(id: string, options?: RequestOptions): Promise<T.Audience> {
    return this.http.request({
      method: 'GET',
      path: `/v1/audiences/${encodeURIComponent(id)}`,
      options,
    })
  }

  update(id: string, body: T.UpdateAudienceRequest, options?: RequestOptions): Promise<T.Audience> {
    return this.http.request({
      method: 'PATCH',
      path: `/v1/audiences/${encodeURIComponent(id)}`,
      body,
      options,
    })
  }

  remove(id: string, options?: RequestOptions): Promise<T.DeletedResponse<'audience'>> {
    return this.http.request({
      method: 'DELETE',
      path: `/v1/audiences/${encodeURIComponent(id)}`,
      options,
    })
  }
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export class Segments extends Resource {
  create(body: T.CreateSegmentRequest, options?: RequestOptions): Promise<T.Segment> {
    return this.http.request({ method: 'POST', path: '/v1/segments', body, options })
  }

  list(
    params?: T.PaginationParams & { audience_id?: string },
    options?: RequestOptions,
  ): Promise<T.ListResponse<T.Segment>> {
    return this.http.request({
      method: 'GET',
      path: '/v1/segments',
      query: asQuery(params),
      options,
    })
  }

  get(id: string, options?: RequestOptions): Promise<T.Segment> {
    return this.http.request({
      method: 'GET',
      path: `/v1/segments/${encodeURIComponent(id)}`,
      options,
    })
  }

  update(id: string, body: T.UpdateSegmentRequest, options?: RequestOptions): Promise<T.Segment> {
    return this.http.request({
      method: 'PATCH',
      path: `/v1/segments/${encodeURIComponent(id)}`,
      body,
      options,
    })
  }

  remove(id: string, options?: RequestOptions): Promise<T.DeletedResponse<'segment'>> {
    return this.http.request({
      method: 'DELETE',
      path: `/v1/segments/${encodeURIComponent(id)}`,
      options,
    })
  }

  /** Counts and samples an expression without storing it. */
  preview(
    body: T.PreviewSegmentRequest,
    options?: RequestOptions,
  ): Promise<T.PreviewSegmentResponse> {
    return this.http.request({ method: 'POST', path: '/v1/segments/preview', body, options })
  }

  recompute(id: string, options?: RequestOptions): Promise<T.Segment> {
    return this.http.request({
      method: 'POST',
      path: `/v1/segments/${encodeURIComponent(id)}/recompute`,
      options,
    })
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export class Templates extends Resource {
  create(body: T.CreateTemplateRequest, options?: RequestOptions): Promise<T.Template> {
    return this.http.request({ method: 'POST', path: '/v1/templates', body, options })
  }

  list(params?: T.PaginationParams, options?: RequestOptions): Promise<T.ListResponse<T.Template>> {
    return this.http.request({
      method: 'GET',
      path: '/v1/templates',
      query: asQuery(params),
      options,
    })
  }

  get(id: string, options?: RequestOptions): Promise<T.Template> {
    return this.http.request({
      method: 'GET',
      path: `/v1/templates/${encodeURIComponent(id)}`,
      options,
    })
  }

  update(id: string, body: T.UpdateTemplateRequest, options?: RequestOptions): Promise<T.Template> {
    return this.http.request({
      method: 'PATCH',
      path: `/v1/templates/${encodeURIComponent(id)}`,
      body,
      options,
    })
  }

  remove(id: string, options?: RequestOptions): Promise<T.DeletedResponse<'template'>> {
    return this.http.request({
      method: 'DELETE',
      path: `/v1/templates/${encodeURIComponent(id)}`,
      options,
    })
  }

  createVersion(
    id: string,
    body: T.CreateTemplateVersionRequest,
    options?: RequestOptions,
  ): Promise<T.TemplateVersion> {
    return this.http.request({
      method: 'POST',
      path: `/v1/templates/${encodeURIComponent(id)}/versions`,
      body,
      options,
    })
  }

  listVersions(
    id: string,
    params?: T.PaginationParams,
    options?: RequestOptions,
  ): Promise<T.ListResponse<T.TemplateVersion>> {
    return this.http.request({
      method: 'GET',
      path: `/v1/templates/${encodeURIComponent(id)}/versions`,
      query: asQuery(params),
      options,
    })
  }

  publish(id: string, options?: RequestOptions): Promise<T.Template> {
    return this.http.request({
      method: 'POST',
      path: `/v1/templates/${encodeURIComponent(id)}/publish`,
      options,
    })
  }

  rollback(
    id: string,
    body: T.RollbackTemplateRequest,
    options?: RequestOptions,
  ): Promise<T.Template> {
    return this.http.request({
      method: 'POST',
      path: `/v1/templates/${encodeURIComponent(id)}/rollback`,
      body,
      options,
    })
  }

  /** Renders without sending. Warnings are advisory, not failures. */
  preview(
    id: string,
    body?: T.PreviewTemplateRequest,
    options?: RequestOptions,
  ): Promise<T.PreviewTemplateResponse> {
    return this.http.request({
      method: 'POST',
      path: `/v1/templates/${encodeURIComponent(id)}/preview`,
      body: body ?? {},
      options,
    })
  }

  test(
    id: string,
    body: T.TestTemplateRequest,
    options?: RequestOptions,
  ): Promise<T.SendEmailResponse> {
    return this.http.request({
      method: 'POST',
      path: `/v1/templates/${encodeURIComponent(id)}/test`,
      body,
      options,
    })
  }
}

// ---------------------------------------------------------------------------
// Broadcasts
// ---------------------------------------------------------------------------

export class Broadcasts extends Resource {
  create(body: T.CreateBroadcastRequest, options?: RequestOptions): Promise<T.Broadcast> {
    return this.http.request({ method: 'POST', path: '/v1/broadcasts', body, options })
  }

  list(
    params?: T.PaginationParams,
    options?: RequestOptions,
  ): Promise<T.ListResponse<T.Broadcast>> {
    return this.http.request({
      method: 'GET',
      path: '/v1/broadcasts',
      query: asQuery(params),
      options,
    })
  }

  get(id: string, options?: RequestOptions): Promise<T.Broadcast> {
    return this.http.request({
      method: 'GET',
      path: `/v1/broadcasts/${encodeURIComponent(id)}`,
      options,
    })
  }

  update(
    id: string,
    body: T.UpdateBroadcastRequest,
    options?: RequestOptions,
  ): Promise<T.Broadcast> {
    return this.http.request({
      method: 'PATCH',
      path: `/v1/broadcasts/${encodeURIComponent(id)}`,
      body,
      options,
    })
  }

  remove(id: string, options?: RequestOptions): Promise<T.DeletedResponse<'broadcast'>> {
    return this.http.request({
      method: 'DELETE',
      path: `/v1/broadcasts/${encodeURIComponent(id)}`,
      options,
    })
  }

  /** Omit `scheduled_at` to send now. */
  send(
    id: string,
    body?: T.SendBroadcastRequest,
    options?: RequestOptions,
  ): Promise<{ object: 'broadcast'; id: string }> {
    return this.http.request({
      method: 'POST',
      path: `/v1/broadcasts/${encodeURIComponent(id)}/send`,
      body: body ?? {},
      options,
    })
  }
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

export class Automations extends Resource {
  create(body: T.CreateAutomationRequest, options?: RequestOptions): Promise<T.Automation> {
    return this.http.request({ method: 'POST', path: '/v1/automations', body, options })
  }

  list(
    params?: T.PaginationParams,
    options?: RequestOptions,
  ): Promise<T.ListResponse<T.Automation>> {
    return this.http.request({
      method: 'GET',
      path: '/v1/automations',
      query: asQuery(params),
      options,
    })
  }

  get(id: string, options?: RequestOptions): Promise<T.Automation> {
    return this.http.request({
      method: 'GET',
      path: `/v1/automations/${encodeURIComponent(id)}`,
      options,
    })
  }

  /**
   * Editing steps publishes a new version rather than mutating the current one:
   * Workflows replay by positional step id, so renumbering a live version would
   * corrupt every instance already inside it.
   */
  update(
    id: string,
    body: T.UpdateAutomationRequest,
    options?: RequestOptions,
  ): Promise<T.Automation> {
    return this.http.request({
      method: 'PATCH',
      path: `/v1/automations/${encodeURIComponent(id)}`,
      body,
      options,
    })
  }

  remove(id: string, options?: RequestOptions): Promise<T.DeletedResponse<'automation'>> {
    return this.http.request({
      method: 'DELETE',
      path: `/v1/automations/${encodeURIComponent(id)}`,
      options,
    })
  }

  activate(id: string, options?: RequestOptions): Promise<T.Automation> {
    return this.http.request({
      method: 'POST',
      path: `/v1/automations/${encodeURIComponent(id)}/activate`,
      options,
    })
  }

  pause(id: string, options?: RequestOptions): Promise<T.Automation> {
    return this.http.request({
      method: 'POST',
      path: `/v1/automations/${encodeURIComponent(id)}/pause`,
      options,
    })
  }

  enrollments(
    id: string,
    params?: T.PaginationParams & { status?: string },
    options?: RequestOptions,
  ): Promise<T.ListResponse<T.AutomationEnrollment>> {
    return this.http.request({
      method: 'GET',
      path: `/v1/automations/${encodeURIComponent(id)}/enrollments`,
      query: asQuery(params),
      options,
    })
  }

  enroll(
    id: string,
    body: T.EnrollContactsRequest,
    options?: RequestOptions,
  ): Promise<{ object: 'list'; enrolled: number; skipped: number }> {
    return this.http.request({
      method: 'POST',
      path: `/v1/automations/${encodeURIComponent(id)}/enroll`,
      body,
      options,
    })
  }

  unenroll(
    id: string,
    contactId: string,
    options?: RequestOptions,
  ): Promise<T.DeletedResponse<'automation_enrollment'>> {
    return this.http.request({
      method: 'DELETE',
      path: `/v1/automations/${encodeURIComponent(id)}/enrollments/${encodeURIComponent(contactId)}`,
      options,
    })
  }

  stats(id: string, options?: RequestOptions): Promise<T.AutomationStats> {
    return this.http.request({
      method: 'GET',
      path: `/v1/automations/${encodeURIComponent(id)}/stats`,
      options,
    })
  }
}

// ---------------------------------------------------------------------------
// Suppressions
// ---------------------------------------------------------------------------

export class Suppressions extends Resource {
  create(body: T.CreateSuppressionRequest, options?: RequestOptions): Promise<T.Suppression> {
    return this.http.request({ method: 'POST', path: '/v1/suppressions', body, options })
  }

  list(
    params?: T.PaginationParams & { reason?: T.SuppressionReason; email?: string },
    options?: RequestOptions,
  ): Promise<T.ListResponse<T.Suppression>> {
    return this.http.request({
      method: 'GET',
      path: '/v1/suppressions',
      query: asQuery(params),
      options,
    })
  }

  bulk(
    body: T.BulkSuppressionRequest,
    options?: RequestOptions,
  ): Promise<T.BulkSuppressionResponse> {
    return this.http.request({ method: 'POST', path: '/v1/suppressions/bulk', body, options })
  }

  /** The path segment is an address, so it is encoded rather than interpolated. */
  remove(email: string, options?: RequestOptions): Promise<T.DeletedResponse<'suppression'>> {
    return this.http.request({
      method: 'DELETE',
      path: `/v1/suppressions/${encodeURIComponent(email)}`,
      options,
    })
  }
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export class Analytics extends Resource {
  overview(params?: T.StatsQuery, options?: RequestOptions): Promise<T.AnalyticsOverview> {
    return this.http.request({
      method: 'GET',
      path: '/v1/analytics/overview',
      query: asQuery(params),
      options,
    })
  }

  timeseries(
    params?: T.StatsQuery,
    options?: RequestOptions,
  ): Promise<{ object: 'list'; data: T.TimeseriesPoint[] }> {
    return this.http.request({
      method: 'GET',
      path: '/v1/analytics/timeseries',
      query: asQuery(params),
      options,
    })
  }

  byDomain(
    params?: T.StatsQuery,
    options?: RequestOptions,
  ): Promise<{ object: 'list'; data: T.AnalyticsBreakdownRow[] }> {
    return this.http.request({
      method: 'GET',
      path: '/v1/analytics/by-domain',
      query: asQuery(params),
      options,
    })
  }

  byTag(
    params?: T.StatsQuery,
    options?: RequestOptions,
  ): Promise<{ object: 'list'; data: T.AnalyticsBreakdownRow[] }> {
    return this.http.request({
      method: 'GET',
      path: '/v1/analytics/by-tag',
      query: asQuery(params),
      options,
    })
  }

  /** Broken out by audience class, because "opens" without that split is a guess. */
  engagement(
    params?: T.StatsQuery,
    options?: RequestOptions,
  ): Promise<{ object: 'list'; data: T.EngagementBreakdown[] }> {
    return this.http.request({
      method: 'GET',
      path: '/v1/analytics/engagement',
      query: asQuery(params),
      options,
    })
  }

  placement(
    params?: T.StatsQuery,
    options?: RequestOptions,
  ): Promise<{ object: 'list'; data: T.PlacementFigure[] }> {
    return this.http.request({
      method: 'GET',
      path: '/v1/analytics/placement',
      query: asQuery(params),
      options,
    })
  }

  createPlacementTest(
    body?: T.CreatePlacementTestRequest,
    options?: RequestOptions,
  ): Promise<T.PlacementTest> {
    return this.http.request({
      method: 'POST',
      path: '/v1/analytics/placement-tests',
      body: body ?? {},
      options,
    })
  }

  getPlacementTest(id: string, options?: RequestOptions): Promise<T.PlacementTest> {
    return this.http.request({
      method: 'GET',
      path: `/v1/analytics/placement-tests/${encodeURIComponent(id)}`,
      options,
    })
  }
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

export class Inbound extends Resource {
  listThreads(
    params?: T.ListThreadsParams,
    options?: RequestOptions,
  ): Promise<T.ListResponse<T.InboundThread>> {
    return this.http.request({
      method: 'GET',
      path: '/v1/inbound/threads',
      query: asQuery(params),
      options,
    })
  }

  getThread(id: string, options?: RequestOptions): Promise<T.InboundThreadDetail> {
    return this.http.request({
      method: 'GET',
      path: `/v1/inbound/threads/${encodeURIComponent(id)}`,
      options,
    })
  }

  /**
   * Replies inherit the thread's participants, subject and reply token, so the
   * recipient's client threads the answer with what they sent.
   */
  reply(
    threadId: string,
    body: T.ReplyToThreadRequest,
    options?: RequestOptions,
  ): Promise<T.SendEmailResponse> {
    return this.http.request({
      method: 'POST',
      path: `/v1/inbound/threads/${encodeURIComponent(threadId)}/reply`,
      body,
      options,
    })
  }

  getMessage(id: string, options?: RequestOptions): Promise<T.InboundMessage> {
    return this.http.request({
      method: 'GET',
      path: `/v1/inbound/messages/${encodeURIComponent(id)}`,
      options,
    })
  }
}
