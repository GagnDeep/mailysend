import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { bool, createdAt, json, updatedAt, workspaceId } from './_shared.ts'

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    plan: text('plan').notNull().default('self_hosted'),
    /** Per-workspace feature overrides. Layer four of `resolveFeatures`. */
    flags: json('flags'),
    /** Only ever populated in SaaS mode. */
    stripeCustomerId: text('stripe_customer_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('workspaces_slug').on(t.slug)],
)

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    /** Null for Access/SSO users, who never have a local password. */
    passwordHash: text('password_hash'),
    emailVerifiedAt: text('email_verified_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email').on(t.email)],
)

export const memberships = sqliteTable(
  'memberships',
  {
    workspaceId: workspaceId(),
    userId: text('user_id').notNull(),
    /** The four roles the design names. `owner` is the only one that can delete. */
    role: text('role', { enum: ['owner', 'developer', 'marketer', 'read_only'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('memberships_pk').on(t.workspaceId, t.userId),
    index('memberships_user').on(t.userId),
  ],
)

export const invites = sqliteTable(
  'invites',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    email: text('email').notNull(),
    role: text('role').notNull(),
    /** Hashed, like an API key: an invite link is a bearer credential. */
    tokenHash: text('token_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    acceptedAt: text('accepted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('invites_ws').on(t.workspaceId, t.email),
    uniqueIndex('invites_token').on(t.tokenHash),
  ],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    workspaceId: workspaceId(),
    expiresAt: text('expires_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user').on(t.userId), index('sessions_expiry').on(t.expiresAt)],
)

/**
 * Magic codes are how a fresh self-hosted deployment bootstraps its first login
 * — sent through the deployment's own Email Service, which doubles as the
 * setup wizard's proof that sending actually works.
 */
export const loginCodes = sqliteTable(
  'login_codes',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'),
    attempts: integer('attempts').notNull().default(0),
    /** The requester, so a script cannot spray codes at a thousand addresses. */
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('login_codes_email').on(t.email, t.expiresAt),
    index('login_codes_ip').on(t.ip, t.createdAt),
    index('login_codes_expiry').on(t.expiresAt),
  ],
)

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    /** SHA-256 of the token. The token itself is shown exactly once, at creation. */
    tokenHash: text('token_hash').notNull(),
    tokenPreview: text('token_preview').notNull(),
    environment: text('environment', { enum: ['live', 'test'] })
      .notNull()
      .default('live'),
    permission: text('permission', { enum: ['full_access', 'sending_access'] })
      .notNull()
      .default('full_access'),
    /** Scopes a sending key to one domain. */
    domainId: text('domain_id'),
    createdBy: text('created_by'),
    lastUsedAt: text('last_used_at'),
    expiresAt: text('expires_at'),
    revokedAt: text('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('api_keys_hash').on(t.tokenHash),
    index('api_keys_ws').on(t.workspaceId, t.createdAt),
  ],
)

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    actorType: text('actor_type', { enum: ['user', 'api_key', 'system'] }).notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    metadata: json('metadata'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_ws').on(t.workspaceId, t.createdAt)],
)

/**
 * Idempotency reservations.
 *
 * The atomic reservation is `INSERT … ON CONFLICT DO NOTHING` here, in SQL —
 * KV is only a read cache in front of it. A cache cannot be the arbiter of
 * uniqueness, and treating it as one is how duplicate sends happen under
 * concurrent retries.
 */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    workspaceId: workspaceId(),
    key: text('key').notNull(),
    /** Hash of the request body, so the same key with a different body is a 400. */
    requestHash: text('request_hash').notNull(),
    /** Null while in flight; set on completion so the retry can replay the response. */
    responseBody: text('response_body'),
    status: text('status', { enum: ['in_flight', 'completed'] })
      .notNull()
      .default('in_flight'),
    expiresAt: text('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('idempotency_pk').on(t.workspaceId, t.key),
    index('idempotency_expiry').on(t.expiresAt),
  ],
)

export const settings = sqliteTable(
  'settings',
  {
    workspaceId: workspaceId(),
    key: text('key').notNull(),
    value: json('value'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('settings_pk').on(t.workspaceId, t.key)],
)

/** Provider credentials, encrypted at rest with the deployment's data key. */
export const providerConfigs = sqliteTable(
  'provider_configs',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    provider: text('provider', { enum: ['cloudflare', 'ses', 'resend', 'smtp'] }).notNull(),
    enabled: bool('enabled').notNull().default(true),
    /** Lower runs first. Failover walks this order. */
    priority: integer('priority').notNull().default(100),
    /** Share of traffic when several providers are enabled at the same priority. */
    weight: integer('weight').notNull().default(100),
    /** AES-GCM ciphertext. Never returned by the API, not even to an owner. */
    credentials: text('credentials'),
    config: json('config'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('provider_configs_ws').on(t.workspaceId, t.provider),
    index('provider_configs_order').on(t.workspaceId, t.enabled, t.priority),
  ],
)

/**
 * Agent send confirmations.
 *
 * An MCP client that holds an API key can compose a message but cannot send
 * one: the tool returns a token, and only a signed-in person — through the
 * dashboard or the CLI — can approve it. The row is the record of that, and
 * `consumed_at` is what makes an approved token spendable exactly once, so a
 * retried tool call cannot turn one approval into two messages.
 */
export const mcpConfirmations = sqliteTable(
  'mcp_confirmations',
  {
    token: text('token').primaryKey(),
    workspaceId: workspaceId(),
    tool: text('tool').notNull(),
    /** The summary shown to the approver, frozen at mint time. */
    summary: text('summary').notNull(),
    status: text('status').notNull().default('pending'),
    decidedBy: text('decided_by'),
    consumedAt: text('consumed_at'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('mcp_confirmations_ws').on(t.workspaceId, t.status, t.expiresAt)],
)

/**
 * Passkeys.
 *
 * The credential a self-hosted instance is claimed with, and the one it is
 * signed into afterwards. There is deliberately no password column in use: a
 * passkey cannot be phished, cannot be reused on another site, and — the
 * property that matters most here — needs no email delivery, so a fresh
 * deployment with no verified sending domain can still be claimed.
 *
 * `rp_id` is stored per credential rather than derived at verification time.
 * WebAuthn binds a credential to the hostname it was created on, so an instance
 * that later moves from `*.workers.dev` to a custom domain has credentials that
 * *cannot* work on the new host. Recording the origin they were made for turns
 * that from a silent, unexplainable login failure into a banner that says which
 * host to go back to, or which recovery code to spend.
 */
export const webauthnCredentials = sqliteTable(
  'webauthn_credentials',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    userId: text('user_id').notNull(),
    /** Base64url, as the authenticator returns it. */
    credentialId: text('credential_id').notNull(),
    publicKey: text('public_key').notNull(),
    signCount: integer('sign_count').notNull().default(0),
    transports: text('transports'),
    rpId: text('rp_id').notNull(),
    name: text('name'),
    createdAt: createdAt(),
    lastUsedAt: text('last_used_at'),
  },
  (t) => [
    uniqueIndex('webauthn_credentials_cid').on(t.credentialId),
    index('webauthn_credentials_user').on(t.userId),
  ],
)

/**
 * In-flight WebAuthn challenges.
 *
 * Server-side rather than in a cookie, because the challenge is the entire
 * anti-replay mechanism: a client that chooses its own challenge can replay a
 * captured assertion forever. Rows are short-lived and reaped by cron.
 */
export const webauthnChallenges = sqliteTable(
  'webauthn_challenges',
  {
    id: text('id').primaryKey(),
    challenge: text('challenge').notNull(),
    userId: text('user_id'),
    kind: text('kind', { enum: ['register', 'authenticate'] }).notNull(),
    rpId: text('rp_id').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('webauthn_challenges_expiry').on(t.expiresAt)],
)

/**
 * Recovery codes.
 *
 * The answer to "the laptop with the passkey is gone". Ten per user, hashed
 * like an API key, single-use, and shown exactly once — at claim time, before
 * the instance will let anyone past the setup screen.
 */
export const recoveryCodes = sqliteTable(
  'recovery_codes',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    userId: text('user_id').notNull(),
    codeHash: text('code_hash').notNull(),
    usedAt: text('used_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('recovery_codes_hash').on(t.codeHash),
    index('recovery_codes_user').on(t.userId),
  ],
)

/**
 * CLI device codes.
 *
 * `mailysend login` runs over SSH and in containers, where a localhost callback
 * cannot be reached. The device code is stored hashed for the same reason a
 * session token is: the row is not a credential.
 */
export const deviceCodes = sqliteTable(
  'device_codes',
  {
    id: text('id').primaryKey(),
    deviceCodeHash: text('device_code_hash').notNull(),
    userCode: text('user_code').notNull(),
    client: text('client'),
    userId: text('user_id'),
    workspaceId: text('workspace_id'),
    approvedAt: text('approved_at'),
    deniedAt: text('denied_at'),
    /** The minted API key, held until the CLI polls for it, then cleared. */
    issuedToken: text('issued_token'),
    redeemedAt: text('redeemed_at'),
    expiresAt: text('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('device_codes_hash').on(t.deviceCodeHash),
    uniqueIndex('device_codes_user_code').on(t.userCode),
    index('device_codes_expiry').on(t.expiresAt),
  ],
)

/**
 * One-shot nonces written straight into the database by an operator who can
 * reach it — through `wrangler d1 execute`, the D1 HTTP API, or the SQLite file
 * on a Node box. Proving you can write this table proves you control the
 * deployment, which is a strictly stronger claim than controlling an inbox, and
 * is the break-glass path back in when every passkey is gone.
 */
export const claimNonces = sqliteTable(
  'claim_nonces',
  {
    nonce: text('nonce').primaryKey(),
    createdAt: createdAt(),
  },
  (t) => [index('claim_nonces_created').on(t.createdAt)],
)
