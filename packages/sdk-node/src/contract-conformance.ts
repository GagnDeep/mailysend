/**
 * Compile-time drift detection between `src/types.ts` and the real schemas.
 *
 * Nothing imports this file at runtime — esbuild never sees it, so it costs the
 * published bundle nothing. `tsc --noEmit` does see it, which is the point: the
 * day someone adds a field to `SendEmailRequest` in `@mailysend/contracts`
 * without adding it here, the SDK stops building rather than silently shipping
 * a type that lies about the API.
 *
 * The assertions are directional rather than exact equality. A *request* type
 * must accept everything the contract accepts, and a *response* type must
 * describe everything the contract returns. Checking equality instead would
 * make every additive change to the API a build break in a package that is
 * still perfectly correct.
 */

import type {
  ApiKey as ApiKeySchema,
  Audience as AudienceSchema,
  Automation as AutomationSchema,
  Broadcast as BroadcastSchema,
  Contact as ContactSchema,
  CreateApiKeyRequest as CreateApiKeyRequestSchema,
  CreateAudienceRequest as CreateAudienceRequestSchema,
  CreateAutomationRequest as CreateAutomationRequestSchema,
  CreateBroadcastRequest as CreateBroadcastRequestSchema,
  CreateContactRequest as CreateContactRequestSchema,
  CreateDomainRequest as CreateDomainRequestSchema,
  CreateSegmentRequest as CreateSegmentRequestSchema,
  CreateSuppressionRequest as CreateSuppressionRequestSchema,
  CreateTemplateRequest as CreateTemplateRequestSchema,
  CreateWebhookRequest as CreateWebhookRequestSchema,
  Domain as DomainSchema,
  Email as EmailSchema,
  ErrorBody as ErrorBodySchema,
  InboundMessage as InboundMessageSchema,
  InboundThread as InboundThreadSchema,
  PlacementFigure as PlacementFigureSchema,
  Segment as SegmentSchema,
  SendEmailRequest as SendEmailRequestSchema,
  Suppression as SuppressionSchema,
  Template as TemplateSchema,
  Webhook as WebhookSchema,
} from '@mailysend/contracts'
import type { z } from 'zod'
import type * as Sdk from './types.ts'

/** Fails to compile unless `T` is assignable to `U`. */
type Covers<T, U extends T> = [T, U]

// Requests: the contract's *input* type is what a caller may legally pass, so
// the SDK type has to accept at least that much.
type _SendEmailRequest = Covers<Sdk.SendEmailRequest, z.input<typeof SendEmailRequestSchema>>
type _CreateDomainRequest = Covers<
  Sdk.CreateDomainRequest,
  z.input<typeof CreateDomainRequestSchema>
>
type _CreateApiKeyRequest = Covers<
  Sdk.CreateApiKeyRequest,
  z.input<typeof CreateApiKeyRequestSchema>
>
type _CreateAudienceRequest = Covers<
  Sdk.CreateAudienceRequest,
  z.input<typeof CreateAudienceRequestSchema>
>
type _CreateContactRequest = Covers<
  Sdk.CreateContactRequest,
  z.input<typeof CreateContactRequestSchema>
>
type _CreateSegmentRequest = Covers<
  Sdk.CreateSegmentRequest,
  z.input<typeof CreateSegmentRequestSchema>
>
type _CreateTemplateRequest = Covers<
  Sdk.CreateTemplateRequest,
  z.input<typeof CreateTemplateRequestSchema>
>
type _CreateBroadcastRequest = Covers<
  Sdk.CreateBroadcastRequest,
  z.input<typeof CreateBroadcastRequestSchema>
>
type _CreateAutomationRequest = Covers<
  Sdk.CreateAutomationRequest,
  z.input<typeof CreateAutomationRequestSchema>
>
type _CreateSuppressionRequest = Covers<
  Sdk.CreateSuppressionRequest,
  z.input<typeof CreateSuppressionRequestSchema>
>
type _CreateWebhookRequest = Covers<
  Sdk.CreateWebhookRequest,
  z.input<typeof CreateWebhookRequestSchema>
>

// Responses: the contract's *output* type is what the server actually sends, so
// the SDK type has to describe at least that much.
type _Email = Covers<Sdk.Email, z.output<typeof EmailSchema>>
type _Domain = Covers<Sdk.Domain, z.output<typeof DomainSchema>>
type _ApiKey = Covers<Sdk.ApiKey, z.output<typeof ApiKeySchema>>
type _Audience = Covers<Sdk.Audience, z.output<typeof AudienceSchema>>
type _Contact = Covers<Sdk.Contact, z.output<typeof ContactSchema>>
type _Segment = Covers<Sdk.Segment, z.output<typeof SegmentSchema>>
type _Template = Covers<Sdk.Template, z.output<typeof TemplateSchema>>
type _Broadcast = Covers<Sdk.Broadcast, z.output<typeof BroadcastSchema>>
type _Automation = Covers<Sdk.Automation, z.output<typeof AutomationSchema>>
type _Suppression = Covers<Sdk.Suppression, z.output<typeof SuppressionSchema>>
type _Webhook = Covers<Sdk.Webhook, z.output<typeof WebhookSchema>>
type _InboundThread = Covers<Sdk.InboundThread, z.output<typeof InboundThreadSchema>>
type _InboundMessage = Covers<Sdk.InboundMessage, z.output<typeof InboundMessageSchema>>
type _PlacementFigure = Covers<Sdk.PlacementFigure, z.output<typeof PlacementFigureSchema>>
type _ErrorBody = Covers<Sdk.ErrorBody, z.output<typeof ErrorBodySchema>>

/** Referencing the aliases keeps `noUnusedLocals` and the linter quiet. */
export type ContractConformance = [
  _SendEmailRequest,
  _CreateDomainRequest,
  _CreateApiKeyRequest,
  _CreateAudienceRequest,
  _CreateContactRequest,
  _CreateSegmentRequest,
  _CreateTemplateRequest,
  _CreateBroadcastRequest,
  _CreateAutomationRequest,
  _CreateSuppressionRequest,
  _CreateWebhookRequest,
  _Email,
  _Domain,
  _ApiKey,
  _Audience,
  _Contact,
  _Segment,
  _Template,
  _Broadcast,
  _Automation,
  _Suppression,
  _Webhook,
  _InboundThread,
  _InboundMessage,
  _PlacementFigure,
  _ErrorBody,
]
