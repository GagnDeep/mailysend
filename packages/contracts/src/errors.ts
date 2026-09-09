import { z } from 'zod'

/**
 * The error surface.
 *
 * Resend returns `{ statusCode, name, message }`. We return that *plus*
 * `code`, `doc_url` and (where it helps) `param` — supersetting rather than
 * diverging, so a Resend SDK reading `.name` still works while our own SDK gets
 * something machine-switchable.
 */
export const ErrorBody = z.object({
  statusCode: z.number().int(),
  /** Resend-compatible error name, e.g. `validation_error`. */
  name: z.string(),
  message: z.string(),
  /** Stable machine code. Never reused, never renamed. */
  code: z.string(),
  /** The offending field, in dotted path form, when there is exactly one. */
  param: z.string().optional(),
  doc_url: z.string().url().optional(),
  /** Present on 429 and on provider-quota errors. Seconds. */
  retry_after: z.number().int().optional(),
})
export type ErrorBody = z.infer<typeof ErrorBody>

/**
 * Every error the API can produce, with its HTTP status and Resend-compatible
 * name. Adding a case here is the only way to introduce a new error: the
 * handler takes a key of this map, so a typo is a build failure and the docs
 * table generates from it.
 */
export const ERRORS = {
  // --- request / auth -----------------------------------------------------
  validation_error: {
    status: 422,
    name: 'validation_error',
    message: 'The request body is invalid.',
  },
  missing_required_field: {
    status: 422,
    name: 'missing_required_field',
    message: 'A required field is missing.',
  },
  invalid_api_key: {
    status: 401,
    name: 'invalid_api_key',
    message: 'The API key is invalid, revoked or expired.',
  },
  missing_api_key: {
    status: 401,
    name: 'missing_api_key',
    message: 'Missing Authorization header. Use `Authorization: Bearer ms_…`.',
  },
  // --- dashboard sessions -------------------------------------------------
  // Distinct from `invalid_api_key` on purpose: the remedy is different, and a
  // dashboard that tells a signed-out person to check their API key is the
  // reason they file a ticket instead of clicking "sign in".
  not_signed_in: {
    status: 401,
    name: 'not_signed_in',
    message: 'You are not signed in. Sign in to the dashboard to continue.',
  },
  invalid_login_code: {
    status: 401,
    name: 'invalid_login_code',
    message: 'That code is wrong or has expired. Request a new one.',
  },
  restricted_api_key: {
    status: 401,
    name: 'restricted_api_key',
    message: 'This API key does not have permission for that action.',
  },
  not_found: { status: 404, name: 'not_found', message: 'The requested resource does not exist.' },
  method_not_allowed: {
    status: 405,
    name: 'method_not_allowed',
    message: 'This method is not supported for this endpoint.',
  },
  rate_limit_exceeded: {
    status: 429,
    name: 'rate_limit_exceeded',
    message: 'Too many requests. Slow down and retry after the indicated delay.',
  },
  daily_quota_exceeded: {
    status: 429,
    name: 'daily_quota_exceeded',
    message: 'The sending domain has reached its daily quota for this provider.',
  },
  concurrent_idempotent_requests: {
    status: 409,
    name: 'concurrent_idempotent_requests',
    message: 'Another request with the same Idempotency-Key is still in flight.',
  },
  idempotency_key_conflict: {
    status: 400,
    name: 'invalid_idempotent_request',
    message: 'This Idempotency-Key was used with a different request body.',
  },

  // --- sending ------------------------------------------------------------
  invalid_from_address: {
    status: 403,
    name: 'invalid_from_address',
    message: 'The `from` address is not on a verified sending domain.',
  },
  domain_not_verified: {
    status: 403,
    name: 'not_found',
    message: 'The sending domain exists but is not verified yet.',
  },
  invalid_to_address: {
    status: 422,
    name: 'invalid_to_address',
    message: 'One or more recipient addresses are invalid.',
  },
  too_many_recipients: {
    status: 422,
    name: 'invalid_parameter',
    message: 'A single message may not exceed 50 recipients across to, cc and bcc.',
  },
  message_too_large: {
    status: 413,
    name: 'invalid_attachment',
    message: "The rendered message exceeds the active provider's size limit.",
  },
  attachment_too_large: {
    status: 413,
    name: 'invalid_attachment',
    message: "An attachment exceeds the active provider's size limit.",
  },
  subject_too_long: {
    status: 422,
    name: 'invalid_parameter',
    message: 'Subject exceeds 998 characters.',
  },
  recipient_suppressed: {
    status: 403,
    name: 'recipient_suppressed',
    message: 'The recipient is on the suppression list.',
  },
  no_content: {
    status: 422,
    name: 'missing_required_field',
    message: 'Provide one of `html`, `text`, `react` or `template_id`.',
  },
  provider_unavailable: {
    status: 502,
    name: 'application_error',
    message: 'The sending provider rejected the request or was unreachable.',
  },
  provider_not_configured: {
    status: 400,
    name: 'application_error',
    message: 'No sending provider is configured for this workspace.',
  },
  scheduling_in_past: {
    status: 422,
    name: 'invalid_parameter',
    message: '`scheduled_at` must be in the future.',
  },
  scheduling_too_far: {
    status: 422,
    name: 'invalid_parameter',
    message: '`scheduled_at` may be at most 30 days in the future.',
  },

  // --- resources ----------------------------------------------------------
  domain_already_exists: {
    status: 409,
    name: 'invalid_parameter',
    message: 'That domain is already registered in this workspace.',
  },
  contact_already_exists: {
    status: 409,
    name: 'invalid_parameter',
    message: 'That contact already exists in this audience.',
  },
  segment_expression_invalid: {
    status: 422,
    name: 'validation_error',
    message: 'The segment expression could not be parsed.',
  },
  resource_in_use: {
    status: 409,
    name: 'invalid_parameter',
    message: 'Something still references this resource. Remove the dependency first.',
  },
  ab_inconclusive: {
    status: 200,
    name: 'ab_inconclusive',
    message: 'The A/B test did not reach significance. No winner was promoted.',
  },
  broadcast_not_editable: {
    status: 409,
    name: 'invalid_parameter',
    message: 'A broadcast can only be edited while it is a draft.',
  },
  broadcast_already_sent: {
    status: 409,
    name: 'invalid_parameter',
    message: 'That broadcast has already been sent.',
  },
  automation_scale_exceeded: {
    status: 422,
    name: 'invalid_parameter',
    message:
      'Instance-mode automations support at most 40,000 active enrollments. Switch this automation to cohort mode.',
  },
  template_render_failed: {
    status: 422,
    name: 'validation_error',
    message: 'The template could not be rendered with the supplied data.',
  },

  // --- platform -----------------------------------------------------------
  internal_error: {
    status: 500,
    name: 'application_error',
    message: 'Something went wrong on our side.',
  },
  not_implemented: {
    status: 501,
    name: 'application_error',
    message: 'That capability is not available in this deployment.',
  },
  setup_incomplete: {
    status: 503,
    name: 'application_error',
    message: 'This deployment has not finished provisioning. Open the dashboard to complete setup.',
  },
} as const satisfies Record<string, { status: number; name: string; message: string }>

export type ErrorCode = keyof typeof ERRORS

/** Thrown anywhere; converted to `ErrorBody` by one handler in apps/app. */
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly param?: string
  readonly retryAfter?: number

  constructor(
    code: ErrorCode,
    opts: { message?: string; param?: string; retryAfter?: number } = {},
  ) {
    const spec = ERRORS[code]
    super(opts.message ?? spec.message)
    this.name = 'ApiError'
    this.code = code
    this.status = spec.status
    this.param = opts.param
    this.retryAfter = opts.retryAfter
  }

  toBody(): ErrorBody {
    const spec = ERRORS[this.code]
    return {
      statusCode: spec.status,
      name: spec.name,
      message: this.message,
      code: this.code,
      ...(this.param ? { param: this.param } : {}),
      ...(this.retryAfter ? { retry_after: this.retryAfter } : {}),
      doc_url: `https://mailysend.com/docs/errors#${this.code}`,
    }
  }
}

export const apiError = (
  code: ErrorCode,
  opts?: { message?: string; param?: string; retryAfter?: number },
) => new ApiError(code, opts)
