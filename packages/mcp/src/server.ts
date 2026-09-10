import { ApiError } from '@mailysend/contracts'
import { apiKeyMode, hashApiKey } from '@mailysend/core'
import { ConfirmationGate } from './confirmation.ts'
import {
  isNotification,
  isRpcRequest,
  RPC,
  type RpcId,
  type RpcRequest,
  type RpcResponse,
  rpcError,
  rpcResult,
} from './jsonrpc.ts'
import { TOOLS, TOOLS_BY_NAME, type ToolContext } from './tools.ts'
import type { AuthContext, ConfirmationApprovals, McpServerOptions } from './types.ts'

export const PROTOCOL_VERSION = '2025-06-18'

/**
 * Older revisions are answered with the version the client asked for when we
 * can honour it, because a client pinned to 2024-11-05 is a client that will
 * not be upgraded on our schedule.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const

const DEFAULT_SERVER_INFO = { name: 'mailysend', version: '0.1.0' }

const INSTRUCTIONS =
  'MailySend over MCP. Read tools answer immediately. The two tools that send mail — ' +
  '`send_email` and `reply_to_thread` — never send on their first call: they return a ' +
  'confirmation request that a person must approve out of band. There is no tool, method ' +
  'or argument that approves a confirmation, so do not look for one and do not retry in a ' +
  'loop; report the pending confirmation to the user and wait.'

/**
 * The JSON-RPC method table.
 *
 * It is exhaustive on purpose. `approve` is not in it, cannot be added by a
 * tool, and has no alias — an agent holding a valid API key still has no
 * reachable path to approving its own send.
 */
const METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'notifications/cancelled',
  'ping',
  'tools/list',
  'tools/call',
])

export class McpServer {
  #options: McpServerOptions
  #confirmations: ConfirmationGate
  #serverInfo: { name: string; version: string }

  constructor(options: McpServerOptions) {
    this.#options = options
    this.#confirmations = new ConfirmationGate({
      secret: options.confirmationSecret,
      ...(options.approvals ? { approvals: options.approvals } : {}),
      ...(options.consumed ? { consumed: options.consumed } : {}),
      ...(options.confirmationTtlSeconds === undefined
        ? {}
        : { ttlSeconds: options.confirmationTtlSeconds }),
      ...(options.now ? { now: options.now } : {}),
    })
    this.#serverInfo = options.serverInfo ?? DEFAULT_SERVER_INFO
  }

  /**
   * The human-facing half of the confirmation flow. It is a property of the
   * server object, reachable only by the process that constructed it — the
   * dashboard route and the CLI. Nothing on the JSON-RPC surface can reach it.
   */
  get approvals(): ConfirmationApprovals {
    return this.#confirmations.approvals
  }

  /** Resolves the bearer token. Throws `ApiError` so the transport can map it. */
  async authenticate(header: string | null): Promise<AuthContext> {
    const token = header?.replace(/^Bearer\s+/i, '').trim()
    if (!header || !token) throw new ApiError('missing_api_key')
    const mode = apiKeyMode(token)
    if (!mode) throw new ApiError('invalid_api_key')
    const resolved = await this.#options.auth.resolve(await hashApiKey(token))
    if (!resolved) throw new ApiError('invalid_api_key')
    return { ...resolved, mode }
  }

  async dispatch(message: unknown, auth: AuthContext): Promise<RpcResponse | null> {
    if (Array.isArray(message)) {
      // Batching was removed in the 2025-06-18 revision; accepting it anyway
      // would leave two framings to reason about in every later change.
      return rpcError(null, RPC.invalidRequest, 'JSON-RPC batching is not supported.')
    }
    if (!isRpcRequest(message)) {
      return rpcError(null, RPC.invalidRequest, 'Not a JSON-RPC 2.0 request.')
    }

    const id: RpcId = message.id ?? null
    if (!METHODS.has(message.method)) {
      if (isNotification(message)) return null
      return rpcError(id, RPC.methodNotFound, `Unknown method \`${message.method}\`.`)
    }
    if (isNotification(message)) return null

    try {
      return rpcResult(id, await this.#invoke(message, auth))
    } catch (err) {
      if (err instanceof ApiError) {
        return rpcError(id, RPC.applicationError, err.message, err.toBody())
      }
      if (err instanceof RpcInvalidParams) {
        return rpcError(id, RPC.invalidParams, err.message)
      }
      return rpcError(id, RPC.internalError, 'Internal error.', {
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async #invoke(request: RpcRequest, auth: AuthContext): Promise<unknown> {
    switch (request.method) {
      case 'ping':
        return {}

      case 'initialize': {
        const requested = (request.params as { protocolVersion?: string } | undefined)
          ?.protocolVersion
        const version =
          requested && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
            ? requested
            : PROTOCOL_VERSION
        return {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: this.#serverInfo,
          instructions: this.#options.instructions ?? INSTRUCTIONS,
        }
      }

      case 'tools/list':
        return {
          tools: TOOLS.map(({ handler, permission, ...descriptor }) => {
            void handler
            void permission
            return descriptor
          }),
        }

      case 'tools/call':
        return this.#callTool(request.params, auth)

      default:
        throw new RpcInvalidParams(`Unknown method \`${request.method}\`.`)
    }
  }

  async #callTool(params: unknown, auth: AuthContext): Promise<unknown> {
    const { name, arguments: args } = (params ?? {}) as {
      name?: unknown
      arguments?: unknown
    }
    if (typeof name !== 'string') throw new RpcInvalidParams('`name` is required.')

    const tool = TOOLS_BY_NAME.get(name)
    if (!tool) throw new RpcInvalidParams(`Unknown tool \`${name}\`.`)

    // The list is the same nine for every key. A restricted key gets a plain
    // `restricted_api_key` rather than a shorter list, because a tool that
    // silently disappears reads to a model as a tool that never existed.
    if (tool.permission !== 'any' && auth.permission !== tool.permission) {
      throw new ApiError('restricted_api_key', {
        message: `This API key may not call \`${name}\`. It needs \`${tool.permission}\`.`,
      })
    }

    const ctx: ToolContext = {
      auth,
      backend: this.#options.backend,
      confirmations: this.#confirmations,
      // Derived from the deployment rather than hardcoded: the agent's user
      // has to be able to open this, and they are not on mailysend.com.
      approvalChannel: this.#options.approvalChannel ?? 'https://mailysend.com/app/approvals',
    }
    const argsObject = args === undefined || args === null ? {} : (args as Record<string, unknown>)
    if (typeof argsObject !== 'object' || Array.isArray(argsObject)) {
      throw new RpcInvalidParams('`arguments` must be an object.')
    }
    return tool.handler(argsObject, ctx)
  }
}

export class RpcInvalidParams extends Error {}
