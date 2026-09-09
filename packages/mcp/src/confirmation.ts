import { base64url, hmacHex, sha256Hex, timingSafeEqual } from '@mailysend/core'
import type {
  ConfirmationApprovals,
  ConfirmationSummary,
  ConsumedTokens,
  PendingConfirmation,
  SendingToolName,
} from './types.ts'

/**
 * The confirmation gate.
 *
 * A tool that sends mail is the one place where an agent's mistake is not
 * recoverable — a bad database write can be corrected, a delivered message
 * cannot be recalled. So the send path is split in two calls with a human
 * between them, and every property that makes that split meaningful is checked
 * here rather than assumed:
 *
 *   - The token is signed with a server-side key, so an agent cannot fabricate
 *     one. (Necessary, but nowhere near sufficient — the agent can always ask
 *     the server to mint one.)
 *   - The token starts life *unapproved*. `ConfirmationApprovals.approve` is
 *     reachable from the dashboard and the CLI and from no MCP method at all,
 *     which is the property that actually prevents self-approval.
 *   - The token binds a digest of the exact message. Approving one message can
 *     never spend on a different one.
 *   - The token is single-use and short-lived.
 */

export const DEFAULT_CONFIRMATION_TTL_SECONDS = 600

export interface TokenClaims {
  v: 1
  tool: SendingToolName
  ws: string
  digest: string
  nonce: string
  exp: number
}

export type RedeemFailure =
  | 'invalid_token'
  | 'expired'
  | 'wrong_tool'
  | 'wrong_workspace'
  | 'payload_changed'
  | 'not_approved'
  | 'already_used'

export type RedeemResult =
  | { ok: true; claims: TokenClaims }
  | { ok: false; reason: RedeemFailure; message: string }

/**
 * Stable JSON. Two payloads that differ only in key order are the same message,
 * and re-approving because a client reordered its object would train people to
 * approve without reading — which is the failure mode this whole file exists to
 * prevent.
 */
export const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`
}

/**
 * Digested over the *parsed* payload, not the raw arguments: the summary the
 * human read was rendered from the parsed form, so that is the thing their
 * approval is about. It also means `to: 'a@b.com'` and `to: ['a@b.com']` are
 * correctly treated as the same message rather than as a tampering attempt.
 */
export const payloadDigest = (
  tool: SendingToolName,
  workspaceId: string,
  payload: unknown,
): Promise<string> => sha256Hex(`${tool}\n${workspaceId}\n${canonicalize(payload)}`)

const randomNonce = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return base64url.encode(bytes)
}

const encodeClaims = (claims: TokenClaims): string => base64url.encode(JSON.stringify(claims))

const decodeClaims = (encoded: string): TokenClaims | null => {
  try {
    const parsed = JSON.parse(base64url.decodeText(encoded)) as TokenClaims
    if (parsed?.v !== 1 || typeof parsed.digest !== 'string' || typeof parsed.exp !== 'number') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** In-memory defaults. A single-process deployment needs nothing more. */
export class MemoryApprovals implements ConfirmationApprovals {
  #pending = new Map<string, PendingConfirmation & { approved: boolean; rejected: boolean }>()

  async mint(pending: PendingConfirmation): Promise<void> {
    this.#pending.set(pending.token, { ...pending, approved: false, rejected: false })
  }

  async get(token: string): Promise<PendingConfirmation | null> {
    return this.#pending.get(token) ?? null
  }

  async isApproved(token: string): Promise<boolean> {
    const row = this.#pending.get(token)
    return Boolean(row?.approved) && !row?.rejected
  }

  async approve(token: string): Promise<boolean> {
    const row = this.#pending.get(token)
    if (!row || row.rejected) return false
    row.approved = true
    return true
  }

  async reject(token: string): Promise<boolean> {
    const row = this.#pending.get(token)
    if (!row) return false
    row.rejected = true
    row.approved = false
    return true
  }

  async pending(workspaceId: string): Promise<PendingConfirmation[]> {
    return [...this.#pending.values()].filter(
      (row) => row.workspaceId === workspaceId && !row.approved && !row.rejected,
    )
  }
}

export class MemoryConsumedTokens implements ConsumedTokens {
  #spent = new Map<string, number>()
  #now: () => number

  /**
   * Takes the same clock the gate mints with. Sweeping on `Date.now()` while
   * expiries are stamped from an injected clock silently drops entries the
   * moment the two disagree — and a dropped entry is a token that can be
   * replayed, so the single-use guarantee would evaporate rather than fail
   * loudly.
   */
  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now
  }

  async consume(token: string, expiresAt: number): Promise<boolean> {
    // Expired entries are dropped opportunistically; nothing here needs a timer.
    const now = this.#now()
    for (const [key, at] of this.#spent) if (at < now) this.#spent.delete(key)
    if (this.#spent.has(token)) return false
    this.#spent.set(token, expiresAt)
    return true
  }
}

export interface MintInput {
  tool: SendingToolName
  workspaceId: string
  payload: unknown
  summary: ConfirmationSummary
}

export interface MintedConfirmation {
  token: string
  expiresAt: number
  claims: TokenClaims
}

export class ConfirmationGate {
  #secret: string
  #approvals: ConfirmationApprovals
  #consumed: ConsumedTokens
  #ttlMs: number
  #now: () => number

  constructor(options: {
    secret: string
    approvals?: ConfirmationApprovals
    consumed?: ConsumedTokens
    ttlSeconds?: number
    now?: () => number
  }) {
    this.#secret = options.secret
    this.#approvals = options.approvals ?? new MemoryApprovals()
    this.#ttlMs = (options.ttlSeconds ?? DEFAULT_CONFIRMATION_TTL_SECONDS) * 1000
    this.#now = options.now ?? Date.now
    this.#consumed = options.consumed ?? new MemoryConsumedTokens({ now: this.#now })
  }

  get approvals(): ConfirmationApprovals {
    return this.#approvals
  }

  async #sign(encoded: string): Promise<string> {
    return hmacHex(this.#secret, encoded)
  }

  async mint(input: MintInput): Promise<MintedConfirmation> {
    const exp = this.#now() + this.#ttlMs
    const claims: TokenClaims = {
      v: 1,
      tool: input.tool,
      ws: input.workspaceId,
      digest: await payloadDigest(input.tool, input.workspaceId, input.payload),
      nonce: randomNonce(),
      exp,
    }
    const encoded = encodeClaims(claims)
    const token = `${encoded}.${await this.#sign(encoded)}`
    await this.#approvals.mint({
      token,
      tool: input.tool,
      workspaceId: input.workspaceId,
      summary: input.summary,
      createdAt: this.#now(),
      expiresAt: exp,
    })
    return { token, expiresAt: exp, claims }
  }

  /**
   * Order is deliberate. Signature and binding checks come first because they
   * are the ones a caller could be attacking; consumption comes last, right
   * before the send, and burns the token even if the send then fails. Burning
   * on failure risks a message that never went out; not burning risks one that
   * went out twice. Only the second is unrecoverable.
   */
  async redeem(input: {
    token: string
    tool: SendingToolName
    workspaceId: string
    payload: unknown
  }): Promise<RedeemResult> {
    const separator = input.token.lastIndexOf('.')
    if (separator <= 0) {
      return { ok: false, reason: 'invalid_token', message: 'The confirmation token is malformed.' }
    }
    const encoded = input.token.slice(0, separator)
    const signature = input.token.slice(separator + 1)
    if (!timingSafeEqual(signature, await this.#sign(encoded))) {
      return {
        ok: false,
        reason: 'invalid_token',
        message: 'The confirmation token was not issued by this server.',
      }
    }

    const claims = decodeClaims(encoded)
    if (!claims) {
      return { ok: false, reason: 'invalid_token', message: 'The confirmation token is malformed.' }
    }
    if (claims.tool !== input.tool) {
      return {
        ok: false,
        reason: 'wrong_tool',
        message: `That confirmation was issued for \`${claims.tool}\`, not \`${input.tool}\`.`,
      }
    }
    if (claims.ws !== input.workspaceId) {
      return {
        ok: false,
        reason: 'wrong_workspace',
        message: 'That confirmation belongs to a different workspace.',
      }
    }
    if (claims.exp <= this.#now()) {
      return {
        ok: false,
        reason: 'expired',
        message: 'The confirmation expired. Call the tool again to request a fresh one.',
      }
    }

    const digest = await payloadDigest(input.tool, input.workspaceId, input.payload)
    if (!timingSafeEqual(digest, claims.digest)) {
      return {
        ok: false,
        reason: 'payload_changed',
        message:
          'The message changed since it was confirmed. Call the tool again to confirm the new one.',
      }
    }

    if (!(await this.#approvals.isApproved(input.token))) {
      return {
        ok: false,
        reason: 'not_approved',
        message: 'A person has not approved this send yet.',
      }
    }

    if (!(await this.#consumed.consume(input.token, claims.exp))) {
      return {
        ok: false,
        reason: 'already_used',
        message: 'That confirmation has already been spent.',
      }
    }

    return { ok: true, claims }
  }
}
