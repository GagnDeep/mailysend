/**
 * JSON-RPC 2.0, the subset MCP uses.
 *
 * Hand-rolled rather than pulled from a package: the wire format is thirty
 * lines, and a dependency here would be a dependency inside every Worker that
 * mounts the MCP endpoint.
 */

export const JSONRPC_VERSION = '2.0'

export const RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** Implementation-defined range. Carries an `ErrorBody` in `data`. */
  applicationError: -32001,
} as const

export type RpcId = string | number | null

export interface RpcRequest {
  jsonrpc: '2.0'
  id?: RpcId
  method: string
  params?: unknown
}

export interface RpcSuccess {
  jsonrpc: '2.0'
  id: RpcId
  result: unknown
}

export interface RpcFailure {
  jsonrpc: '2.0'
  id: RpcId
  error: { code: number; message: string; data?: unknown }
}

export type RpcResponse = RpcSuccess | RpcFailure

export const rpcResult = (id: RpcId, result: unknown): RpcSuccess => ({
  jsonrpc: JSONRPC_VERSION,
  id,
  result,
})

export const rpcError = (id: RpcId, code: number, message: string, data?: unknown): RpcFailure => ({
  jsonrpc: JSONRPC_VERSION,
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
})

export const isRpcRequest = (value: unknown): value is RpcRequest => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.jsonrpc !== JSONRPC_VERSION) return false
  if (typeof v.method !== 'string') return false
  return v.id === undefined || v.id === null || typeof v.id === 'string' || typeof v.id === 'number'
}

/** A request without an `id` is a notification and gets no response, ever. */
export const isNotification = (request: RpcRequest): boolean =>
  request.id === undefined || request.id === null
