/**
 * The MailySend MCP server.
 *
 * Nine tools, one HTTP endpoint, and one rule that shapes the rest of the
 * package: nothing here can put mail on the wire without a person having said
 * yes to that exact message first.
 */

export {
  ConfirmationGate,
  canonicalize,
  DEFAULT_CONFIRMATION_TTL_SECONDS,
  MemoryApprovals,
  MemoryConsumedTokens,
  type MintedConfirmation,
  type MintInput,
  payloadDigest,
  type RedeemFailure,
  type RedeemResult,
  type TokenClaims,
} from './confirmation.ts'
export { type HttpHandlerOptions, mcpHttpHandler, sseFrame } from './http.ts'
export {
  isNotification,
  isRpcRequest,
  JSONRPC_VERSION,
  RPC,
  type RpcFailure,
  type RpcId,
  type RpcRequest,
  type RpcResponse,
  type RpcSuccess,
  rpcError,
  rpcResult,
} from './jsonrpc.ts'
export {
  ConfirmationRejectedOutput,
  ConfirmationRequiredOutput,
  ConfirmationSummaryOutput,
  CreateContactInput,
  GetAnalyticsInput,
  GetEmailInput,
  GetThreadInput,
  type JsonSchema,
  jsonSchema,
  ListDomainsInput,
  ListEmailsInput,
  ReplyToThreadInput,
  ReplyToThreadOutput,
  SearchThreadsInput,
  SendEmailInput,
  SendEmailOutput,
  withConfirmationToken,
} from './schemas.ts'
export {
  McpServer,
  PROTOCOL_VERSION,
  RpcInvalidParams,
  SUPPORTED_PROTOCOL_VERSIONS,
} from './server.ts'
export {
  SENDING_TOOLS,
  TOOL_NAMES,
  TOOLS,
  TOOLS_BY_NAME,
  type ToolContext,
  type ToolDescriptor,
  type ToolName,
  type ToolResult,
} from './tools.ts'

export type {
  AnalyticsSummary,
  AnalyticsTotals,
  AuthContext,
  AuthPort,
  ConfirmationApprovals,
  ConfirmationSummary,
  ConsumedTokens,
  Email,
  EmailListInput,
  EmailListResult,
  McpBackend,
  McpServerOptions,
  PendingConfirmation,
  Permission,
  RepliedMessage,
  ReplyPayload,
  SendingToolName,
  SendOptions,
  SendPayload,
  SentEmail,
  StatsInput,
  ThreadDetail,
  ThreadHit,
} from './types.ts'
