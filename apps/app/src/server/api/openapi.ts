import {
  ApiKey,
  Attachment,
  Audience,
  Automation,
  AutomationStep,
  AutomationTrigger,
  BatchSendRequest,
  BatchSendResponse,
  Broadcast,
  Contact,
  CreateApiKeyRequest,
  CreateAudienceRequest,
  CreateAutomationRequest,
  CreateBroadcastRequest,
  CreateContactRequest,
  CreateDomainRequest,
  CreatedApiKey,
  CreateSegmentRequest,
  CreateSuppressionRequest,
  CreateTemplateRequest,
  CreateWebhookRequest,
  DnsRecord,
  Domain,
  Email,
  ErrorBody,
  InboundMessage,
  InboundThread,
  MetricSource,
  PlacementFigure,
  Segment,
  SendBroadcastRequest,
  SendEmailRequest,
  SendEmailResponse,
  StatsQuery,
  Suppression,
  Tag,
  Template,
  UpdateContactRequest,
  UpdateDomainRequest,
  UpdateEmailRequest,
  Webhook,
  WebhookPayload,
} from '@mailysend/contracts'
import type { z } from 'zod'
import { z as zod } from 'zod'

/**
 * The OpenAPI document.
 *
 * It is generated from the Zod schemas in `@mailysend/contracts` rather than
 * written by hand, because this one document backs the Scalar reference page,
 * the generated SDKs and the request validation. A hand-maintained copy would
 * drift from the validators within a release, and a drifted SDK is worse than
 * no SDK: it fails at the customer's runtime, not at ours.
 */

type JsonSchema = Record<string, unknown>

/**
 * `io: 'input'` for request bodies, `'output'` for responses.
 *
 * Several contracts transform on parse (`to: string | string[]` becomes
 * `string[]`), so the two sides genuinely differ and rendering one for both
 * would document a shape the API does not accept.
 */
const toSchema = (schema: z.ZodType, io: 'input' | 'output'): JsonSchema => {
  const out = zod.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    // A refinement has no JSON Schema equivalent; dropping the constraint is
    // right, failing the whole document over it is not.
    unrepresentable: 'any',
  }) as JsonSchema
  delete out.$schema
  return out
}

const SCHEMAS: Record<string, { schema: z.ZodType; io?: 'input' | 'output' }> = {
  ErrorBody: { schema: ErrorBody },
  Tag: { schema: Tag },
  Attachment: { schema: Attachment, io: 'input' },

  SendEmailRequest: { schema: SendEmailRequest, io: 'input' },
  SendEmailResponse: { schema: SendEmailResponse },
  BatchSendRequest: { schema: BatchSendRequest, io: 'input' },
  BatchSendResponse: { schema: BatchSendResponse },
  UpdateEmailRequest: { schema: UpdateEmailRequest, io: 'input' },
  Email: { schema: Email },

  Domain: { schema: Domain },
  DnsRecord: { schema: DnsRecord },
  CreateDomainRequest: { schema: CreateDomainRequest, io: 'input' },
  UpdateDomainRequest: { schema: UpdateDomainRequest, io: 'input' },

  ApiKey: { schema: ApiKey },
  CreatedApiKey: { schema: CreatedApiKey },
  CreateApiKeyRequest: { schema: CreateApiKeyRequest, io: 'input' },

  Audience: { schema: Audience },
  CreateAudienceRequest: { schema: CreateAudienceRequest, io: 'input' },
  Contact: { schema: Contact },
  CreateContactRequest: { schema: CreateContactRequest, io: 'input' },
  UpdateContactRequest: { schema: UpdateContactRequest, io: 'input' },
  Segment: { schema: Segment },
  CreateSegmentRequest: { schema: CreateSegmentRequest, io: 'input' },

  Template: { schema: Template },
  CreateTemplateRequest: { schema: CreateTemplateRequest, io: 'input' },

  Broadcast: { schema: Broadcast },
  CreateBroadcastRequest: { schema: CreateBroadcastRequest, io: 'input' },
  SendBroadcastRequest: { schema: SendBroadcastRequest, io: 'input' },

  Automation: { schema: Automation },
  AutomationStep: { schema: AutomationStep },
  AutomationTrigger: { schema: AutomationTrigger },
  CreateAutomationRequest: { schema: CreateAutomationRequest, io: 'input' },

  Webhook: { schema: Webhook },
  CreateWebhookRequest: { schema: CreateWebhookRequest, io: 'input' },
  WebhookPayload: { schema: WebhookPayload },

  Suppression: { schema: Suppression },
  CreateSuppressionRequest: { schema: CreateSuppressionRequest, io: 'input' },

  InboundMessage: { schema: InboundMessage },
  InboundThread: { schema: InboundThread },

  MetricSource: { schema: MetricSource },
  PlacementFigure: { schema: PlacementFigure },
  StatsQuery: { schema: StatsQuery, io: 'input' },
}

const ref = (name: keyof typeof SCHEMAS | string): JsonSchema => ({
  $ref: `#/components/schemas/${name}`,
})

/** Every list endpoint returns this envelope; it is described once. */
const list = (item: JsonSchema): JsonSchema => ({
  type: 'object',
  properties: {
    object: { type: 'string', const: 'list' },
    data: { type: 'array', items: item },
    has_more: { type: 'boolean' },
    next_cursor: { type: ['string', 'null'] },
  },
  required: ['object', 'data'],
})

const deleted = (object: string): JsonSchema => ({
  type: 'object',
  properties: {
    object: { type: 'string', const: object },
    id: { type: 'string' },
    deleted: { type: 'boolean', const: true },
  },
  required: ['object', 'id', 'deleted'],
})

const body = (schema: JsonSchema, required = true) => ({
  required,
  content: { 'application/json': { schema } },
})

const ok = (schema: JsonSchema, description = 'Success') => ({
  description,
  content: { 'application/json': { schema } },
})

/** The error responses every endpoint can produce, attached once per operation. */
const ERROR_RESPONSES = {
  '401': {
    description: 'Missing, invalid or restricted API key',
    content: { 'application/json': { schema: ref('ErrorBody') } },
  },
  '404': {
    description: 'No such resource',
    content: { 'application/json': { schema: ref('ErrorBody') } },
  },
  '422': {
    description: 'Validation error',
    content: { 'application/json': { schema: ref('ErrorBody') } },
  },
  '429': {
    description: 'Rate limited',
    content: { 'application/json': { schema: ref('ErrorBody') } },
  },
}

interface OperationInput {
  tag: string
  summary: string
  description?: string
  parameters?: JsonSchema[]
  requestBody?: ReturnType<typeof body>
  response: JsonSchema
  status?: string
  responseDescription?: string
}

const operation = (input: OperationInput) => ({
  tags: [input.tag],
  summary: input.summary,
  ...(input.description ? { description: input.description } : {}),
  operationId: `${input.tag}.${input.summary}`.replace(/[^A-Za-z0-9.]+/g, '_').toLowerCase(),
  ...(input.parameters ? { parameters: input.parameters } : {}),
  ...(input.requestBody ? { requestBody: input.requestBody } : {}),
  responses: {
    [input.status ?? '200']: ok(input.response, input.responseDescription ?? 'Success'),
    ...ERROR_RESPONSES,
  },
})

const pathParam = (name: string, description: string): JsonSchema => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' },
})

const query = (
  name: string,
  description: string,
  schema: JsonSchema = { type: 'string' },
): JsonSchema => ({
  name,
  in: 'query',
  required: false,
  description,
  schema,
})

const PAGINATION = [
  query('limit', 'Page size, 1–100. Defaults to 25.', {
    type: 'integer',
    minimum: 1,
    maximum: 100,
  }),
  query('cursor', 'The `next_cursor` from the previous page. Keyset, never an offset.'),
]

const RANGE = [
  query('from', 'Start of the range, ISO-8601. Defaults to 30 days ago.'),
  query('to', 'End of the range, ISO-8601. Defaults to now.'),
]

/** Anything whose shape is assembled in a handler rather than by a contract. */
const freeform = (description: string): JsonSchema => ({ type: 'object', description })

export async function openApiDocument(): Promise<object> {
  const { getEnv } = await import('../env.ts')
  // Templated, because outside a request there is no correct absolute URL to
  // fall back to. This used to read `https://api.mailysend.com`, a name that
  // has never resolved and never will: there is no hosted MailySend, so the
  // server *is* whatever the operator deployed. OpenAPI server variables are
  // the construct for exactly that, and a generator turns them into a required
  // constructor argument rather than a default that fails at DNS.
  let publicUrl: string | null = null
  try {
    publicUrl = getEnv().MS_PUBLIC_URL.replace(/\/$/, '')
  } catch {
    // Generated outside a request (CI, SDK codegen).
  }
  const servers = publicUrl
    ? [{ url: `${publicUrl}/v1`, description: 'This deployment' }]
    : [
        {
          url: '{deployment}/v1',
          description: 'Your deployment',
          variables: {
            deployment: {
              default: 'https://mailysend.example',
              description: 'The origin you deployed MailySend to, with no trailing slash.',
            },
          },
        },
      ]

  const schemas: Record<string, JsonSchema> = {}
  for (const [name, entry] of Object.entries(SCHEMAS)) {
    schemas[name] = toSchema(entry.schema, entry.io ?? 'output')
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'MailySend API',
      version: '1.0.0',
      description:
        'A Resend-compatible email API. Point the `resend` SDK at this base URL and it works ' +
        'unchanged; everything beyond that surface is additive.',
      license: { name: 'AGPL-3.0-or-later' },
    },
    servers,
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'emails', description: 'Send and inspect individual messages.' },
      { name: 'domains', description: 'Sending domains, DNS and authentication.' },
      { name: 'api-keys', description: 'Keys and their permissions.' },
      { name: 'audiences', description: 'Lists of contacts.' },
      { name: 'contacts', description: 'People in an audience.' },
      { name: 'segments', description: 'Saved predicates over an audience.' },
      { name: 'broadcasts', description: 'One message to an audience or segment.' },
      { name: 'templates', description: 'Stored bodies with version history.' },
      { name: 'automations', description: 'Multi-step sequences.' },
      { name: 'suppressions', description: 'Addresses that must not be mailed.' },
      { name: 'webhooks', description: 'Signed event delivery.' },
      { name: 'logs', description: 'The operator view of every message.' },
      { name: 'analytics', description: 'Counts of record, and inbox placement.' },
      { name: 'inbound', description: 'Received mail, threads and replies.' },
    ],
    paths: {
      ...emailPaths(),
      ...domainPaths(),
      ...apiKeyPaths(),
      ...audiencePaths(),
      ...contactPaths(),
      ...segmentPaths(),
      ...broadcastPaths(),
      ...templatePaths(),
      ...automationPaths(),
      ...suppressionPaths(),
      ...webhookPaths(),
      ...logPaths(),
      ...analyticsPaths(),
      ...inboundPaths(),
    },
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'An API key: `Authorization: Bearer ms_live_…` (or `ms_test_…`).',
        },
      },
    },
  }
}

const emailPaths = () => ({
  '/emails': {
    post: operation({
      tag: 'emails',
      summary: 'Send an email',
      description: 'Resend-compatible. `Idempotency-Key` is honoured for 24 hours.',
      requestBody: body(ref('SendEmailRequest')),
      response: ref('SendEmailResponse'),
    }),
    get: operation({
      tag: 'emails',
      summary: 'List emails',
      parameters: [...PAGINATION, query('status', 'Filter by delivery status.')],
      response: list(ref('Email')),
    }),
  },
  '/emails/batch': {
    post: operation({
      tag: 'emails',
      summary: 'Send up to 100 emails',
      description: 'Partial success: a failed item reports its index, the rest are still sent.',
      requestBody: body(ref('BatchSendRequest')),
      response: ref('BatchSendResponse'),
    }),
  },
  '/emails/{id}': {
    get: operation({
      tag: 'emails',
      summary: 'Retrieve an email',
      parameters: [pathParam('id', 'An `em_` id.')],
      response: ref('Email'),
    }),
    patch: operation({
      tag: 'emails',
      summary: 'Reschedule an email',
      parameters: [pathParam('id', 'An `em_` id.')],
      requestBody: body(ref('UpdateEmailRequest')),
      response: freeform('The rescheduled message.'),
    }),
    delete: operation({
      tag: 'emails',
      summary: 'Cancel a scheduled email',
      parameters: [pathParam('id', 'An `em_` id.')],
      response: freeform('The canceled message.'),
    }),
  },
  '/emails/{id}/events': {
    get: operation({
      tag: 'emails',
      summary: 'List the events for an email',
      parameters: [pathParam('id', 'An `em_` id.')],
      response: list(freeform('A normalized delivery event.')),
    }),
  },
})

const domainPaths = () => ({
  '/domains': {
    post: operation({
      tag: 'domains',
      summary: 'Create a domain',
      requestBody: body(ref('CreateDomainRequest')),
      response: ref('Domain'),
    }),
    get: operation({
      tag: 'domains',
      summary: 'List domains',
      parameters: PAGINATION,
      response: list(ref('Domain')),
    }),
  },
  '/domains/{id}': {
    get: operation({
      tag: 'domains',
      summary: 'Retrieve a domain',
      parameters: [pathParam('id', 'A `dom_` id.')],
      response: ref('Domain'),
    }),
    patch: operation({
      tag: 'domains',
      summary: 'Update a domain',
      parameters: [pathParam('id', 'A `dom_` id.')],
      requestBody: body(ref('UpdateDomainRequest')),
      response: ref('Domain'),
    }),
    delete: operation({
      tag: 'domains',
      summary: 'Delete a domain',
      parameters: [pathParam('id', 'A `dom_` id.')],
      response: deleted('domain'),
    }),
  },
  '/domains/{id}/verify': {
    post: operation({
      tag: 'domains',
      summary: 'Re-check DNS for a domain',
      parameters: [pathParam('id', 'A `dom_` id.')],
      response: ref('Domain'),
    }),
  },
})

const apiKeyPaths = () => ({
  '/api-keys': {
    post: operation({
      tag: 'api-keys',
      summary: 'Create an API key',
      description: 'The secret is returned exactly once and is not retrievable afterwards.',
      requestBody: body(ref('CreateApiKeyRequest')),
      response: ref('CreatedApiKey'),
    }),
    get: operation({
      tag: 'api-keys',
      summary: 'List API keys',
      parameters: PAGINATION,
      response: list(ref('ApiKey')),
    }),
  },
  '/api-keys/{id}': {
    delete: operation({
      tag: 'api-keys',
      summary: 'Revoke an API key',
      parameters: [pathParam('id', 'A `key_` id.')],
      response: deleted('api_key'),
    }),
  },
})

const audiencePaths = () => ({
  '/audiences': {
    post: operation({
      tag: 'audiences',
      summary: 'Create an audience',
      requestBody: body(ref('CreateAudienceRequest')),
      response: ref('Audience'),
    }),
    get: operation({
      tag: 'audiences',
      summary: 'List audiences',
      parameters: PAGINATION,
      response: list(ref('Audience')),
    }),
  },
  '/audiences/{id}': {
    get: operation({
      tag: 'audiences',
      summary: 'Retrieve an audience',
      parameters: [pathParam('id', 'An `aud_` id.')],
      response: ref('Audience'),
    }),
    delete: operation({
      tag: 'audiences',
      summary: 'Delete an audience',
      parameters: [pathParam('id', 'An `aud_` id.')],
      response: deleted('audience'),
    }),
  },
})

const contactPaths = () => ({
  '/contacts': {
    post: operation({
      tag: 'contacts',
      summary: 'Create a contact',
      requestBody: body(ref('CreateContactRequest')),
      response: ref('Contact'),
    }),
    get: operation({
      tag: 'contacts',
      summary: 'List contacts',
      parameters: [...PAGINATION, query('audience_id', 'Restrict to one audience.')],
      response: list(ref('Contact')),
    }),
  },
  '/contacts/{id}': {
    get: operation({
      tag: 'contacts',
      summary: 'Retrieve a contact',
      parameters: [pathParam('id', "A `con_` id, or the contact's email address.")],
      response: ref('Contact'),
    }),
    patch: operation({
      tag: 'contacts',
      summary: 'Update a contact',
      parameters: [pathParam('id', "A `con_` id, or the contact's email address.")],
      requestBody: body(ref('UpdateContactRequest')),
      response: ref('Contact'),
    }),
    delete: operation({
      tag: 'contacts',
      summary: 'Delete a contact',
      parameters: [pathParam('id', "A `con_` id, or the contact's email address.")],
      response: deleted('contact'),
    }),
  },
})

const segmentPaths = () => ({
  '/segments': {
    post: operation({
      tag: 'segments',
      summary: 'Create a segment',
      requestBody: body(ref('CreateSegmentRequest')),
      response: ref('Segment'),
    }),
    get: operation({
      tag: 'segments',
      summary: 'List segments',
      parameters: PAGINATION,
      response: list(ref('Segment')),
    }),
  },
  '/segments/{id}': {
    get: operation({
      tag: 'segments',
      summary: 'Retrieve a segment',
      parameters: [pathParam('id', 'A `seg_` id.')],
      response: ref('Segment'),
    }),
    patch: operation({
      tag: 'segments',
      summary: 'Update a segment',
      parameters: [pathParam('id', 'A `seg_` id.')],
      requestBody: body(ref('CreateSegmentRequest')),
      response: ref('Segment'),
    }),
    delete: operation({
      tag: 'segments',
      summary: 'Delete a segment',
      parameters: [pathParam('id', 'A `seg_` id.')],
      response: deleted('segment'),
    }),
  },
})

const broadcastPaths = () => ({
  '/broadcasts': {
    post: operation({
      tag: 'broadcasts',
      summary: 'Create a broadcast',
      requestBody: body(ref('CreateBroadcastRequest')),
      response: ref('Broadcast'),
    }),
    get: operation({
      tag: 'broadcasts',
      summary: 'List broadcasts',
      parameters: PAGINATION,
      response: list(ref('Broadcast')),
    }),
  },
  '/broadcasts/{id}': {
    get: operation({
      tag: 'broadcasts',
      summary: 'Retrieve a broadcast',
      parameters: [pathParam('id', 'A `bc_` id.')],
      response: ref('Broadcast'),
    }),
    patch: operation({
      tag: 'broadcasts',
      summary: 'Update a draft broadcast',
      parameters: [pathParam('id', 'A `bc_` id.')],
      requestBody: body(ref('CreateBroadcastRequest')),
      response: ref('Broadcast'),
    }),
    delete: operation({
      tag: 'broadcasts',
      summary: 'Delete a broadcast',
      parameters: [pathParam('id', 'A `bc_` id.')],
      response: deleted('broadcast'),
    }),
  },
  '/broadcasts/{id}/send': {
    post: operation({
      tag: 'broadcasts',
      summary: 'Send or schedule a broadcast',
      parameters: [pathParam('id', 'A `bc_` id.')],
      requestBody: body(ref('SendBroadcastRequest'), false),
      response: ref('Broadcast'),
    }),
  },
})

const templatePaths = () => ({
  '/templates': {
    post: operation({
      tag: 'templates',
      summary: 'Create a template',
      requestBody: body(ref('CreateTemplateRequest')),
      response: ref('Template'),
    }),
    get: operation({
      tag: 'templates',
      summary: 'List templates',
      parameters: PAGINATION,
      response: list(ref('Template')),
    }),
  },
  '/templates/{id}': {
    get: operation({
      tag: 'templates',
      summary: 'Retrieve a template',
      parameters: [pathParam('id', 'A `tpl_` id.')],
      response: ref('Template'),
    }),
    patch: operation({
      tag: 'templates',
      summary: 'Rename a template',
      description: 'Body changes create a version; this endpoint only edits metadata.',
      parameters: [pathParam('id', 'A `tpl_` id.')],
      requestBody: body({
        type: 'object',
        properties: { name: { type: 'string' }, slug: { type: 'string' } },
      }),
      response: ref('Template'),
    }),
    delete: operation({
      tag: 'templates',
      summary: 'Delete a template',
      parameters: [pathParam('id', 'A `tpl_` id.')],
      response: deleted('template'),
    }),
  },
  '/templates/{id}/versions': {
    post: operation({
      tag: 'templates',
      summary: 'Create a template version',
      description:
        'A `jsx-ast` body is validated here and rejected with the failing paths. The new version is ' +
        'a draft until it is published.',
      parameters: [pathParam('id', 'A `tpl_` id.')],
      requestBody: body({
        type: 'object',
        properties: {
          subject: { type: 'string' },
          html: { type: 'string' },
          text: { type: 'string' },
          ast: { description: 'The data-only AST produced by `mailysend templates push`.' },
        },
      }),
      response: freeform('The created version.'),
    }),
    get: operation({
      tag: 'templates',
      summary: 'List template versions',
      parameters: [pathParam('id', 'A `tpl_` id.')],
      response: list(freeform('A template version.')),
    }),
  },
  '/templates/{id}/publish': {
    post: operation({
      tag: 'templates',
      summary: 'Publish a template version',
      parameters: [pathParam('id', 'A `tpl_` id.')],
      requestBody: body({ type: 'object', properties: { version: { type: 'integer' } } }, false),
      response: freeform('The published pointer.'),
    }),
  },
  '/templates/{id}/rollback': {
    post: operation({
      tag: 'templates',
      summary: 'Roll back to an earlier version',
      description: 'Copies the earlier version forward as a new one; history is never rewritten.',
      parameters: [pathParam('id', 'A `tpl_` id.')],
      requestBody: body({
        type: 'object',
        properties: { version: { type: 'integer' } },
        required: ['version'],
      }),
      response: freeform('The new published pointer.'),
    }),
  },
  '/templates/{id}/preview': {
    post: operation({
      tag: 'templates',
      summary: 'Render a preview',
      description:
        'Returns the rendered subject, HTML and text plus the render warnings — a `gmail_clipping` ' +
        "warning means the footer, including the unsubscribe link, is behind Gmail's clip.",
      parameters: [pathParam('id', 'A `tpl_` id.')],
      requestBody: body(
        {
          type: 'object',
          properties: { version: { type: 'integer' }, data: { type: 'object' } },
        },
        false,
      ),
      response: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          html: { type: 'string' },
          text: { type: 'string' },
          warnings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                at: { type: 'string' },
              },
            },
          },
          variables: { type: 'array', items: { type: 'string' } },
        },
      },
    }),
  },
  '/templates/{id}/test': {
    post: operation({
      tag: 'templates',
      summary: 'Send a test render',
      description:
        'Up to five addresses. Suppression is bypassed so the tester always receives it.',
      parameters: [pathParam('id', 'A `tpl_` id.')],
      requestBody: body({
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'array', items: { type: 'string' }, maxItems: 5 },
          version: { type: 'integer' },
          data: { type: 'object' },
        },
        required: ['from', 'to'],
      }),
      response: freeform('The accepted test messages and the render warnings.'),
    }),
  },
})

const AUTOMATION_EXECUTION = freeform(
  'Which execution mode is in force, what it costs in timing precision, and which engine ' +
    '(`workflows` or `scheduler`) is advancing the steps on this deployment.',
)

const automationPaths = () => ({
  '/automations': {
    post: operation({
      tag: 'automations',
      summary: 'Create an automation',
      description:
        '`cohort` mode (the default) runs one workflow instance per hourly cohort and quantises ' +
        'step timing; `instance` mode is exact per contact and is capped below the platform limit ' +
        'of 50,000 concurrent instances.',
      requestBody: body(ref('CreateAutomationRequest')),
      response: ref('Automation'),
    }),
    get: operation({
      tag: 'automations',
      summary: 'List automations',
      parameters: [...PAGINATION, query('status', 'draft, active, paused or archived.')],
      response: list(ref('Automation')),
    }),
  },
  '/automations/{id}': {
    get: operation({
      tag: 'automations',
      summary: 'Retrieve an automation',
      parameters: [pathParam('id', 'An `aut_` id.')],
      response: AUTOMATION_EXECUTION,
    }),
    patch: operation({
      tag: 'automations',
      summary: 'Update an automation',
      description:
        'Changing `steps` creates a new version; in-flight enrollments finish on theirs.',
      parameters: [pathParam('id', 'An `aut_` id.')],
      requestBody: body({
        type: 'object',
        properties: {
          name: { type: 'string' },
          mode: { type: 'string', enum: ['cohort', 'instance'] },
          trigger: ref('AutomationTrigger'),
          steps: { type: 'array', items: ref('AutomationStep') },
        },
      }),
      response: ref('Automation'),
    }),
    delete: operation({
      tag: 'automations',
      summary: 'Archive an automation',
      parameters: [pathParam('id', 'An `aut_` id.')],
      response: deleted('automation'),
    }),
  },
  '/automations/{id}/activate': {
    post: operation({
      tag: 'automations',
      summary: 'Activate an automation',
      parameters: [pathParam('id', 'An `aut_` id.')],
      response: AUTOMATION_EXECUTION,
    }),
  },
  '/automations/{id}/pause': {
    post: operation({
      tag: 'automations',
      summary: 'Pause an automation',
      description: 'Stops new enrollments. Contacts already in flight keep their place.',
      parameters: [pathParam('id', 'An `aut_` id.')],
      response: freeform('The paused automation.'),
    }),
  },
  '/automations/{id}/enrollments': {
    get: operation({
      tag: 'automations',
      summary: 'List enrollments',
      parameters: [
        pathParam('id', 'An `aut_` id.'),
        ...PAGINATION,
        query('status', 'active, completed or removed.'),
      ],
      response: list(freeform("One contact's position in the sequence.")),
    }),
  },
  '/automations/{id}/enroll': {
    post: operation({
      tag: 'automations',
      summary: 'Enroll a contact',
      description:
        'In `instance` mode this returns `automation_scale_exceeded` past the enrollment ceiling ' +
        "and tells you to switch to cohort mode. The limit is the platform's, not a policy.",
      parameters: [pathParam('id', 'An `aut_` id.')],
      requestBody: body({
        type: 'object',
        properties: { contact_id: { type: 'string' } },
        required: ['contact_id'],
      }),
      response: freeform('The enrollment, its cohort and the execution trade-offs.'),
    }),
  },
  '/automations/{id}/enrollments/{contact_id}': {
    delete: operation({
      tag: 'automations',
      summary: 'Remove a contact from an automation',
      parameters: [pathParam('id', 'An `aut_` id.'), pathParam('contact_id', 'A `con_` id.')],
      response: deleted('automation_enrollment'),
    }),
  },
  '/automations/{id}/stats': {
    get: operation({
      tag: 'automations',
      summary: 'Per-step completion counts',
      parameters: [pathParam('id', 'An `aut_` id.')],
      response: freeform('Enrollment totals and a per-step funnel.'),
    }),
  },
})

const suppressionPaths = () => ({
  '/suppressions': {
    post: operation({
      tag: 'suppressions',
      summary: 'Suppress an address',
      requestBody: body(ref('CreateSuppressionRequest')),
      response: ref('Suppression'),
    }),
    get: operation({
      tag: 'suppressions',
      summary: 'List suppressions',
      parameters: [
        ...PAGINATION,
        query('reason', 'hard_bounce, complaint, unsubscribe, manual or provider.'),
      ],
      response: list(ref('Suppression')),
    }),
  },
  '/suppressions/{email}': {
    get: operation({
      tag: 'suppressions',
      summary: 'Check one address',
      parameters: [pathParam('email', 'The address, URL-encoded.')],
      response: ref('Suppression'),
    }),
    delete: operation({
      tag: 'suppressions',
      summary: 'Remove a suppression',
      parameters: [pathParam('email', 'The address, URL-encoded.')],
      response: freeform('The removed suppression.'),
    }),
  },
})

const webhookPaths = () => ({
  '/webhooks': {
    post: operation({
      tag: 'webhooks',
      summary: 'Create a webhook endpoint',
      description: 'The signing secret is returned once. Deliveries carry `MailySend-Signature`.',
      requestBody: body(ref('CreateWebhookRequest')),
      response: ref('Webhook'),
    }),
    get: operation({
      tag: 'webhooks',
      summary: 'List webhook endpoints',
      parameters: PAGINATION,
      response: list(ref('Webhook')),
    }),
  },
  '/webhooks/{id}': {
    get: operation({
      tag: 'webhooks',
      summary: 'Retrieve a webhook endpoint',
      parameters: [pathParam('id', 'A `wh_` id.')],
      response: ref('Webhook'),
    }),
    patch: operation({
      tag: 'webhooks',
      summary: 'Update a webhook endpoint',
      parameters: [pathParam('id', 'A `wh_` id.')],
      requestBody: body(ref('CreateWebhookRequest')),
      response: ref('Webhook'),
    }),
    delete: operation({
      tag: 'webhooks',
      summary: 'Delete a webhook endpoint',
      parameters: [pathParam('id', 'A `wh_` id.')],
      response: deleted('webhook'),
    }),
  },
})

const logPaths = () => ({
  '/logs': {
    get: operation({
      tag: 'logs',
      summary: 'Search the message log',
      parameters: [
        ...PAGINATION,
        ...RANGE,
        query('status', 'One status, or several comma separated.'),
        query('domain_id', 'A `dom_` id.'),
        query('provider', 'cloudflare, ses, resend or smtp.'),
        query('recipient', 'An exact recipient address.'),
        query('tag_name', 'Tag name to filter on.'),
        query('tag_value', 'Tag value, with `tag_name`.'),
        query('search', 'Substring match on subject, sender and recipients.'),
      ],
      response: list(freeform('One message, as the log shows it.')),
    }),
  },
  '/logs/export': {
    get: operation({
      tag: 'logs',
      summary: 'Export the filtered log',
      description:
        'Enqueues a job and returns its id; the file lands in object storage when it is done.',
      parameters: [...RANGE, query('format', 'csv (default) or ndjson.')],
      status: '202',
      response: freeform('The queued export job.'),
      responseDescription: 'Accepted',
    }),
  },
  '/logs/{id}': {
    get: operation({
      tag: 'logs',
      summary: 'Full detail for one message',
      description:
        'The row, its event timeline, the SMTP conversation, the webhook delivery attempts for its ' +
        'events, and the spooled envelope from object storage as `raw`.',
      parameters: [pathParam('id', 'An `em_` id.')],
      response: freeform('Everything the log drawer shows.'),
    }),
  },
})

const analyticsPaths = () => ({
  '/analytics/overview': {
    get: operation({
      tag: 'analytics',
      summary: 'Totals for a range',
      description:
        'Read from `rollups_daily`, the count of record. Analytics Engine is the hot chart layer ' +
        'and is sampled under load — it is never the source for this endpoint.',
      parameters: [
        ...RANGE,
        query('domain_id', 'A `dom_` id.'),
        query('provider', 'Sending provider.'),
      ],
      response: freeform(
        'Counts, rates, the open split by audience class, and the privacy-adjusted open rate.',
      ),
    }),
  },
  '/analytics/timeseries': {
    get: operation({
      tag: 'analytics',
      summary: 'Bucketed counts',
      parameters: [
        ...RANGE,
        query('granularity', 'hour, day, week or month. Defaults to day.'),
        query('domain_id', 'A `dom_` id.'),
        query('audience_class', 'human (default), all, bot, mpp, scanner or proxy_prefetch.'),
      ],
      response: freeform('One row per bucket.'),
    }),
  },
  '/analytics/by-domain': {
    get: operation({
      tag: 'analytics',
      summary: 'Totals per sending domain',
      parameters: RANGE,
      response: list(freeform('Per-domain counts and rates.')),
    }),
  },
  '/analytics/by-tag': {
    get: operation({
      tag: 'analytics',
      summary: 'Totals per tag',
      description:
        'Computed from `messages`, so it is bounded by message retention rather than by rollup retention.',
      parameters: [...RANGE, query('tag_name', 'Restrict to one tag name.')],
      response: list(freeform('Per-tag counts and rates.')),
    }),
  },
  '/analytics/engagement': {
    get: operation({
      tag: 'analytics',
      summary: 'Opens and clicks by audience class',
      description:
        'Defaults to `human`. `privacy_adjusted_open_rate` excludes Apple MPP opens from both the ' +
        'numerator and the delivered population that produced them.',
      parameters: [
        ...RANGE,
        query('audience_class', 'human (default), all, bot, mpp, scanner or proxy_prefetch.'),
      ],
      response: freeform('Engagement split by class, with the adjusted open rate.'),
    }),
  },
  '/analytics/placement': {
    get: operation({
      tag: 'analytics',
      summary: 'Inbox placement',
      description:
        'Every figure carries `source` (seed, postmaster, snds or estimate) and `confidence`. ' +
        'SMTP 250 means accepted, not inboxed: without seed data the figures are estimates and are ' +
        'labelled as such rather than presented as measurements.',
      parameters: [...RANGE, query('domain_id', 'A `dom_` id.')],
      response: {
        type: 'object',
        properties: {
          figures: { type: 'array', items: ref('PlacementFigure') },
          has_seed_data: { type: 'boolean' },
          note: { type: 'string' },
        },
      },
    }),
  },
  '/analytics/placement-tests': {
    post: operation({
      tag: 'analytics',
      summary: 'Start a seed-list placement test',
      requestBody: body(
        {
          type: 'object',
          properties: {
            name: { type: 'string' },
            domain_id: { type: 'string' },
            seed_addresses: { type: 'array', items: { type: 'string' }, maxItems: 200 },
          },
        },
        false,
      ),
      status: '202',
      responseDescription: 'Accepted',
      response: freeform('The running test.'),
    }),
  },
  '/analytics/placement-tests/{id}': {
    get: operation({
      tag: 'analytics',
      summary: 'Retrieve a placement test',
      parameters: [pathParam('id', 'A `plt_` id.')],
      response: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          figures: { type: 'array', items: ref('PlacementFigure') },
        },
      },
    }),
  },
})

const inboundPaths = () => ({
  '/inbound/mailboxes': {
    get: operation({
      tag: 'inbound',
      summary: 'List mailboxes',
      response: list(freeform('An inbound mailbox.')),
    }),
    post: operation({
      tag: 'inbound',
      summary: 'Create a mailbox',
      requestBody: body({
        type: 'object',
        properties: {
          address: { type: 'string' },
          name: { type: 'string' },
          forward_webhook_id: { type: 'string' },
          agent_enabled: { type: 'boolean' },
        },
        required: ['address'],
      }),
      response: freeform('The created mailbox.'),
    }),
  },
  '/inbound/mailboxes/{id}': {
    delete: operation({
      tag: 'inbound',
      summary: 'Delete a mailbox',
      description: 'Removes the route. Mail already received is kept.',
      parameters: [pathParam('id', 'An `inb_` id.')],
      response: deleted('inbound_mailbox'),
    }),
  },
  '/inbound/threads': {
    get: operation({
      tag: 'inbound',
      summary: 'List threads',
      parameters: [
        ...PAGINATION,
        query('mailbox_id', 'Restrict to one mailbox.'),
        query('unread', 'true to list only unread threads.'),
      ],
      response: list(ref('InboundThread')),
    }),
  },
  '/inbound/threads/{id}': {
    get: operation({
      tag: 'inbound',
      summary: 'Retrieve a thread',
      description: 'Messages come back with their bodies, fetched from object storage.',
      parameters: [pathParam('id', 'A `thr_` id.')],
      response: ref('InboundThread'),
    }),
    delete: operation({
      tag: 'inbound',
      summary: 'Delete a thread',
      parameters: [pathParam('id', 'A `thr_` id.')],
      response: deleted('inbound_thread'),
    }),
  },
  '/inbound/threads/{id}/reply': {
    post: operation({
      tag: 'inbound',
      summary: 'Reply to a thread',
      description: 'Sends through the normal path with `In-Reply-To` and `References` set.',
      parameters: [pathParam('id', 'A `thr_` id.')],
      requestBody: body({
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'array', items: { type: 'string' } },
          subject: { type: 'string' },
          html: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['from'],
      }),
      response: freeform('The accepted reply.'),
    }),
  },
  '/inbound/messages/{id}': {
    get: operation({
      tag: 'inbound',
      summary: 'Retrieve an inbound message',
      parameters: [pathParam('id', 'An `inb_` id.')],
      response: ref('InboundMessage'),
    }),
  },
  '/inbound/messages/{id}/raw': {
    get: operation({
      tag: 'inbound',
      summary: 'Download the original MIME',
      parameters: [pathParam('id', 'An `inb_` id.')],
      response: { type: 'string', description: 'The raw message, as `message/rfc822`.' },
    }),
  },
  '/inbound/search': {
    get: operation({
      tag: 'inbound',
      summary: 'Full-text search',
      description:
        'Runs against the FTS index each mailbox actor keeps over subjects and snippets.',
      parameters: [
        query('q', 'The search phrase. Required.'),
        query('mailbox_id', 'Restrict to one mailbox.'),
        query('limit', 'Up to 50.', { type: 'integer', minimum: 1, maximum: 50 }),
      ],
      response: list(ref('InboundMessage')),
    }),
  },
})
