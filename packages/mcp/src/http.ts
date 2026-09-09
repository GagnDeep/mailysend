import { ApiError } from '@mailysend/contracts'
import { RPC, type RpcResponse, rpcError } from './jsonrpc.ts'
import { type McpServer, PROTOCOL_VERSION } from './server.ts'

/**
 * Streamable HTTP.
 *
 * One endpoint, one POST per message. The SSE half exists because a client that
 * asked for `text/event-stream` is a client whose framing assumes it; answering
 * such a request with `application/json` is the kind of mismatch that shows up
 * as a hang rather than an error.
 */

const JSON_MIME = 'application/json'
const SSE_MIME = 'text/event-stream'

export const sseFrame = (payload: unknown): string =>
  `event: message\ndata: ${JSON.stringify(payload)}\n\n`

interface Negotiation {
  json: boolean
  sse: boolean
}

// A wildcard Accept counts as accepting both — a curl user should not have to
// know this endpoint's content types in order to talk to it.
const negotiate = (header: string | null): Negotiation & { prefersSse: boolean } => {
  const raw = (header ?? JSON_MIME).toLowerCase()
  const types = raw.split(',').map((t) => t.split(';')[0]?.trim() ?? '')
  const wildcard = types.includes('*/*')
  const jsonAt = types.findIndex((t) => t === JSON_MIME || t === 'application/*')
  const sseAt = types.findIndex((t) => t === SSE_MIME || t === 'text/*')
  const json = wildcard || jsonAt >= 0
  const sse = wildcard || sseAt >= 0
  // Order in `Accept` is how a client says which framing it actually wants;
  // a client that lists both (as the spec requires) gets the simpler one.
  const prefersSse = sse && (!json || (sseAt >= 0 && jsonAt >= 0 && sseAt < jsonAt))
  return { json, sse, prefersSse }
}

const respond = (
  payload: RpcResponse,
  init: { status?: number; sse: boolean; headers?: Record<string, string> },
): Response => {
  const headers: Record<string, string> = {
    'mcp-protocol-version': PROTOCOL_VERSION,
    'cache-control': 'no-store',
    ...init.headers,
  }
  if (init.sse) {
    return new Response(sseFrame(payload), {
      status: init.status ?? 200,
      headers: {
        ...headers,
        'content-type': `${SSE_MIME}; charset=utf-8`,
        connection: 'keep-alive',
      },
    })
  }
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { ...headers, 'content-type': JSON_MIME },
  })
}

export interface HttpHandlerOptions {
  /** Sent on 401 so a client knows what kind of credential to present. */
  realm?: string
}

/**
 * Returns a `fetch` handler for the MCP endpoint. Mount it at whatever path the
 * app prefers — this function deliberately does no routing of its own.
 */
export const mcpHttpHandler =
  (server: McpServer, options: HttpHandlerOptions = {}) =>
  async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers':
            'authorization, content-type, accept, mcp-protocol-version',
          'access-control-max-age': '86400',
        },
      })
    }

    if (request.method !== 'POST') {
      // No server-initiated stream: every MailySend tool answers within one
      // request, so a long-lived GET channel would be an idle socket per agent.
      return new Response(JSON.stringify(new ApiError('method_not_allowed').toBody()), {
        status: 405,
        headers: { allow: 'POST, OPTIONS', 'content-type': JSON_MIME },
      })
    }

    const accept = negotiate(request.headers.get('accept'))
    if (!accept.json && !accept.sse) {
      return new Response(
        JSON.stringify({
          statusCode: 406,
          name: 'not_acceptable',
          message: `This endpoint speaks \`${JSON_MIME}\` and \`${SSE_MIME}\`.`,
          code: 'validation_error',
        }),
        { status: 406, headers: { 'content-type': JSON_MIME } },
      )
    }
    const sse = accept.prefersSse

    let auth: Awaited<ReturnType<McpServer['authenticate']>>
    try {
      auth = await server.authenticate(request.headers.get('authorization'))
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError('invalid_api_key')
      return respond(rpcError(null, RPC.applicationError, apiErr.message, apiErr.toBody()), {
        status: apiErr.status,
        sse: false,
        headers: {
          'www-authenticate': `Bearer realm="${options.realm ?? 'mailysend'}", error="invalid_token"`,
        },
      })
    }

    let message: unknown
    try {
      message = await request.json()
    } catch {
      return respond(rpcError(null, RPC.parseError, 'Request body is not valid JSON.'), {
        status: 400,
        sse,
      })
    }

    const response = await server.dispatch(message, auth)
    // A notification is answered with 202 and no body, which is what tells a
    // client its `notifications/initialized` landed rather than went missing.
    if (response === null) return new Response(null, { status: 202 })

    return respond(response, { sse })
  }
