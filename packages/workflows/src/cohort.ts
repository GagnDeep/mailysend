import type { Sql } from '@mailysend/platform'
import { compileExpression } from '@mailysend/segments'
import type {
  AdvanceInput,
  AutomationContact,
  AutomationEffects,
  BranchInput,
  StepScope,
} from './effects.ts'

/**
 * The database half of the effects port.
 *
 * `send`, `tag` and `webhook` reach outside the database and stay injected by
 * the app. What lives here is enrollment bookkeeping and the cohort branch,
 * because those are where getting the SQL wrong is expensive and where the
 * cohort design earns its keep: twenty-five thousand people cross a branch in
 * two `UPDATE`s, not twenty-five thousand round trips.
 *
 * Every column named below is one that `0000_init.sql` actually declares.
 */

/** What the enrollment SQL needs from `AutomationEffects`. */
export type EnrollmentEffects = Pick<
  AutomationEffects,
  'loadContact' | 'evaluateBranch' | 'updateCohortBranch' | 'advance' | 'completeEnrollment'
>

const ACTIVE = 'active'

const scopeParams = (scope: StepScope): unknown[] => [
  scope.workspaceId,
  scope.automationId,
  scope.version,
]

export const createEnrollmentEffects = (
  sql: Sql,
  options: { now?: () => Date } = {},
): EnrollmentEffects => {
  const now = options.now ?? (() => new Date())

  const loadContact = async (
    scope: Extract<StepScope, { kind: 'member' }>,
  ): Promise<AutomationContact | null> => {
    const row = await sql
      .prepare(
        `SELECT id, email, first_name, last_name, unsubscribed, data
           FROM contacts WHERE workspace_id = ? AND id = ?`,
      )
      .bind(scope.workspaceId, scope.contactId)
      .first<{
        id: string
        email: string
        first_name: string | null
        last_name: string | null
        unsubscribed: number
        data: string | null
      }>()
    if (!row) return null
    return {
      id: row.id,
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      unsubscribed: Boolean(row.unsubscribed),
      data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : null,
    }
  }

  const evaluateBranch = async (input: BranchInput): Promise<{ matched: boolean }> => {
    if (input.scope.kind !== 'member') {
      throw new Error('evaluateBranch is the instance-mode branch; cohorts use updateCohortBranch')
    }
    const compiled = compileExpression(input.step.condition, { now: now() })
    const row = await sql
      .prepare(
        `SELECT 1 AS matched FROM contacts
          WHERE workspace_id = ? AND id = ? AND ${compiled.sql}`,
      )
      .bind(input.scope.workspaceId, input.scope.contactId, ...compiled.params)
      .first<{ matched: number }>()
    return { matched: row !== null }
  }

  const updateCohortBranch = async (
    input: BranchInput,
  ): Promise<{ matched: number; unmatched: number }> => {
    const scope = input.scope
    if (scope.kind !== 'cohort') {
      throw new Error('updateCohortBranch is the cohort branch; instances use evaluateBranch')
    }
    const compiled = compileExpression(input.step.condition, { now: now() })
    const timestamp = now().toISOString()

    // SQLite binds `?` in textual order, so the SET value comes first, the
    // enrollment predicate next, and the compiled segment's own parameters last
    // because the subquery is textually last. The compiled fragment contributes
    // only bound values — see packages/segments/src/compile.ts.
    const matchedSql =
      input.thenOrdinal === null
        ? `UPDATE automation_enrollments SET status = 'completed', completed_at = ?`
        : 'UPDATE automation_enrollments SET current_step = ?'
    const matched = await sql
      .prepare(
        `${matchedSql}
          WHERE workspace_id = ? AND automation_id = ? AND version = ? AND cohort = ?
            AND status = ? AND current_step = ?
            AND contact_id IN (SELECT id FROM contacts WHERE workspace_id = ? AND ${compiled.sql})`,
      )
      .bind(
        input.thenOrdinal === null ? timestamp : input.thenOrdinal,
        ...scopeParams(scope),
        scope.cohort,
        ACTIVE,
        scope.ordinal,
        scope.workspaceId,
        ...compiled.params,
      )
      .run()

    // The complement needs no predicate of its own: the matching rows have
    // already left this ordinal, so whoever is still parked here is exactly the
    // `otherwise` arm. That also makes a replay of this step a pair of no-ops
    // rather than a second partition of a set that has already moved.
    const unmatchedSql =
      input.otherwiseOrdinal === null
        ? `UPDATE automation_enrollments SET status = 'completed', completed_at = ?`
        : 'UPDATE automation_enrollments SET current_step = ?'
    const unmatched = await sql
      .prepare(
        `${unmatchedSql}
          WHERE workspace_id = ? AND automation_id = ? AND version = ? AND cohort = ?
            AND status = ? AND current_step = ?`,
      )
      .bind(
        input.otherwiseOrdinal === null ? timestamp : input.otherwiseOrdinal,
        ...scopeParams(scope),
        scope.cohort,
        ACTIVE,
        scope.ordinal,
      )
      .run()

    return { matched: matched.meta.changes, unmatched: unmatched.meta.changes }
  }

  const advance = async (input: AdvanceInput): Promise<{ moved: number }> => {
    const scope = input.scope
    const result =
      scope.kind === 'member'
        ? await sql
            .prepare(
              `UPDATE automation_enrollments SET current_step = ?
                WHERE workspace_id = ? AND automation_id = ? AND version = ?
                  AND contact_id = ? AND status = ?`,
            )
            .bind(input.toOrdinal, ...scopeParams(scope), scope.contactId, ACTIVE)
            .run()
        : await sql
            .prepare(
              `UPDATE automation_enrollments SET current_step = ?
                WHERE workspace_id = ? AND automation_id = ? AND version = ?
                  AND cohort = ? AND status = ? AND current_step = ?`,
            )
            .bind(input.toOrdinal, ...scopeParams(scope), scope.cohort, ACTIVE, scope.ordinal)
            .run()
    return { moved: result.meta.changes }
  }

  const completeEnrollment = async (input: {
    scope: StepScope
  }): Promise<{ completed: number }> => {
    const scope = input.scope
    const timestamp = now().toISOString()
    const result =
      scope.kind === 'member'
        ? await sql
            .prepare(
              `UPDATE automation_enrollments SET status = 'completed', completed_at = ?
                WHERE workspace_id = ? AND automation_id = ? AND version = ?
                  AND contact_id = ? AND status = ?`,
            )
            .bind(timestamp, ...scopeParams(scope), scope.contactId, ACTIVE)
            .run()
        : await sql
            .prepare(
              `UPDATE automation_enrollments SET status = 'completed', completed_at = ?
                WHERE workspace_id = ? AND automation_id = ? AND version = ?
                  AND cohort = ? AND status = ? AND current_step = ?`,
            )
            .bind(timestamp, ...scopeParams(scope), scope.cohort, ACTIVE, scope.ordinal)
            .run()
    return { completed: result.meta.changes }
  }

  return { loadContact, evaluateBranch, updateCohortBranch, advance, completeEnrollment }
}
