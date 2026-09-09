import type { ErrorBody } from './types.ts'

/**
 * The one error this SDK throws.
 *
 * It carries the whole `ErrorBody` rather than a flattened message because
 * `code` is the field callers should switch on: `name` is Resend-compatible and
 * therefore reused across unrelated failures (`invalid_parameter` covers eight
 * different problems), while `code` is unique and never renamed.
 */
export class MailySendError extends Error {
  override readonly name: string
  readonly statusCode: number
  readonly code: string
  readonly param?: string
  readonly doc_url?: string
  readonly retry_after?: number
  /** The transport status, which can differ from `statusCode` on a proxy error. */
  readonly status: number
  /** `MailySend-Request-Id`, when the response carried one. Quote it in support tickets. */
  readonly requestId?: string
  readonly body?: unknown

  constructor(
    body: Partial<ErrorBody> & { message: string },
    context: { status: number; requestId?: string; raw?: unknown } = { status: 0 },
  ) {
    super(body.message)
    this.name = body.name ?? 'application_error'
    this.statusCode = body.statusCode ?? context.status
    this.code = body.code ?? 'internal_error'
    this.param = body.param
    this.doc_url = body.doc_url
    this.retry_after = body.retry_after
    this.status = context.status
    this.requestId = context.requestId
    this.body = context.raw
  }

  /** Round-trips back to the wire shape, for logging and for the compat layer. */
  toBody(): ErrorBody {
    return {
      statusCode: this.statusCode,
      name: this.name,
      message: this.message,
      code: this.code,
      ...(this.param ? { param: this.param } : {}),
      ...(this.doc_url ? { doc_url: this.doc_url } : {}),
      ...(this.retry_after !== undefined ? { retry_after: this.retry_after } : {}),
    }
  }

  static is(value: unknown): value is MailySendError {
    return value instanceof MailySendError
  }
}

/**
 * A network failure, a DNS failure, an aborted request — anything where no HTTP
 * response ever arrived. Separated from `MailySendError` because the retry rule
 * differs: there is no server verdict to respect, only the method's safety.
 */
export class MailySendConnectionError extends MailySendError {
  constructor(message: string, cause?: unknown) {
    super(
      { message, name: 'connection_error', code: 'connection_error', statusCode: 0 },
      { status: 0 },
    )
    this.cause = cause
  }
}
