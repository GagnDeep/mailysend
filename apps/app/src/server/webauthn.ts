import { apiError } from '@mailysend/contracts'
import {
  hashApiKey,
  newId,
  type RelyingParty,
  relyingPartyFrom,
  type StoredCredential,
} from '@mailysend/core'
import type { Sql } from '@mailysend/platform'
import type { Env } from './env.ts'

/**
 * Where passkeys and recovery codes live.
 *
 * The ceremony itself is in `@mailysend/core`; this is the database side of it,
 * shared by the sign-in router and the first-run claim so that a credential
 * created during setup and one added later from Settings are the same row
 * written the same way.
 */

/** Long enough for a person to find their security key; short enough to be useless later. */
const CHALLENGE_TTL_MS = 5 * 60_000

export const relyingParty = (env: Env): RelyingParty => relyingPartyFrom(env.MS_PUBLIC_URL)

export async function storeChallenge(
  sql: Sql,
  challenge: string,
  kind: 'register' | 'authenticate',
  rpId: string,
  userId?: string,
): Promise<void> {
  await sql
    .prepare(
      `INSERT INTO webauthn_challenges (id, challenge, user_id, kind, rp_id, expires_at, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(
      newId('challenge'),
      challenge,
      userId ?? null,
      kind,
      rpId,
      new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
      new Date().toISOString(),
    )
    .run()
}

/**
 * Spends a challenge.
 *
 * Deleted rather than marked, and the delete is what proves it was live: if it
 * removed no row the challenge was already spent or never existed, and either
 * way this ceremony is a replay. A `SELECT` followed by a `DELETE` would let
 * two concurrent assertions both pass the read.
 */
export async function consumeChallenge(
  sql: Sql,
  challenge: string,
  kind: 'register' | 'authenticate',
): Promise<{ userId: string | null; rpId: string } | null> {
  const row = await sql
    .prepare(
      `SELECT user_id, rp_id, expires_at FROM webauthn_challenges WHERE challenge = ? AND kind = ?`,
    )
    .bind(challenge, kind)
    .first<{ user_id: string | null; rp_id: string; expires_at: string }>()
  if (!row) return null

  const deleted = await sql
    .prepare('DELETE FROM webauthn_challenges WHERE challenge = ? AND kind = ?')
    .bind(challenge, kind)
    .run()
  const changes = (deleted as { meta?: { changes?: number } }).meta?.changes
  if (typeof changes === 'number' && changes === 0) return null

  if (Date.parse(row.expires_at) < Date.now()) return null
  return { userId: row.user_id, rpId: row.rp_id }
}

export interface CredentialRow extends StoredCredential {
  id: string
  userId: string
  workspaceId: string
  rpId: string
  name: string | null
}

const toCredential = (row: {
  id: string
  user_id: string
  workspace_id: string
  credential_id: string
  public_key: string
  sign_count: number
  transports: string | null
  rp_id: string
  name: string | null
}): CredentialRow => ({
  id: row.id,
  userId: row.user_id,
  workspaceId: row.workspace_id,
  credentialId: row.credential_id,
  publicKey: row.public_key,
  signCount: row.sign_count,
  rpId: row.rp_id,
  name: row.name,
  ...(row.transports ? { transports: JSON.parse(row.transports) as string[] } : {}),
})

const CREDENTIAL_COLUMNS =
  'id, user_id, workspace_id, credential_id, public_key, sign_count, transports, rp_id, name'

export async function findCredential(
  sql: Sql,
  credentialId: string,
): Promise<CredentialRow | null> {
  const row = await sql
    .prepare(`SELECT ${CREDENTIAL_COLUMNS} FROM webauthn_credentials WHERE credential_id = ?`)
    .bind(credentialId)
    .first<Parameters<typeof toCredential>[0]>()
  return row ? toCredential(row) : null
}

export async function credentialsForUser(sql: Sql, userId: string): Promise<CredentialRow[]> {
  const { results } = await sql
    .prepare(
      `SELECT ${CREDENTIAL_COLUMNS} FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at`,
    )
    .bind(userId)
    .all<Parameters<typeof toCredential>[0]>()
  return results.map(toCredential)
}

export const insertCredential = (
  sql: Sql,
  args: {
    workspaceId: string
    userId: string
    credential: StoredCredential
    rpId: string
    name?: string
  },
) =>
  sql
    .prepare(
      `INSERT INTO webauthn_credentials
         (id, workspace_id, user_id, credential_id, public_key, sign_count, transports, rp_id, name, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      newId('credential'),
      args.workspaceId,
      args.userId,
      args.credential.credentialId,
      args.credential.publicKey,
      args.credential.signCount,
      args.credential.transports ? JSON.stringify(args.credential.transports) : null,
      args.rpId,
      args.name ?? null,
      new Date().toISOString(),
    )

/**
 * Records a use.
 *
 * The sign count is the authenticator's own replay detector: a counter that
 * goes backwards means the credential has been cloned. Guarding the update on
 * the previous value means a replayed assertion writes nothing, and the caller
 * treats that as a failure.
 */
export const touchCredential = (sql: Sql, id: string, newSignCount: number) =>
  sql
    .prepare(
      'UPDATE webauthn_credentials SET sign_count = ?, last_used_at = ? WHERE id = ? AND sign_count <= ?',
    )
    .bind(newSignCount, new Date().toISOString(), id, newSignCount)

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

export const insertRecoveryCode = (
  sql: Sql,
  args: { workspaceId: string; userId: string; hash: string },
) =>
  sql
    .prepare(
      'INSERT INTO recovery_codes (id, workspace_id, user_id, code_hash, created_at) VALUES (?,?,?,?,?)',
    )
    .bind(newId('recoveryCode'), args.workspaceId, args.userId, args.hash, new Date().toISOString())

/**
 * Spends a recovery code.
 *
 * `WHERE used_at IS NULL` inside the UPDATE is the single-use guarantee. Two
 * requests carrying the same code race on one row and exactly one of them
 * changes it; the other is told, correctly, that the code is not valid.
 */
export async function spendRecoveryCode(
  sql: Sql,
  code: string,
): Promise<{ userId: string; workspaceId: string } | null> {
  const hash = await hashApiKey(code)
  const row = await sql
    .prepare('SELECT id, user_id, workspace_id FROM recovery_codes WHERE code_hash = ?')
    .bind(hash)
    .first<{ id: string; user_id: string; workspace_id: string }>()
  if (!row) return null

  const result = await sql
    .prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .bind(new Date().toISOString(), row.id)
    .run()
  const changes = (result as { meta?: { changes?: number } }).meta?.changes
  if (typeof changes === 'number' && changes === 0) return null
  if (typeof changes !== 'number') {
    // No `changes` from this driver: read back, and refuse if somebody else
    // spent it in between. Slower, never wrong.
    const after = await sql
      .prepare('SELECT used_at FROM recovery_codes WHERE id = ?')
      .bind(row.id)
      .first<{ used_at: string | null }>()
    if (!after?.used_at) return null
  }
  return { userId: row.user_id, workspaceId: row.workspace_id }
}

export const remainingRecoveryCodes = async (sql: Sql, userId: string): Promise<number> => {
  const row = await sql
    .prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL')
    .bind(userId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/** A passkey response body that is not a passkey response body. */
export const invalidCredential = () =>
  apiError('not_signed_in', { message: 'That passkey was not accepted.' })
