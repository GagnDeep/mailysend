import type { AutomationStep } from './plan.ts'

/**
 * Everything the interpreter is allowed to touch outside itself.
 *
 * The interpreter has no database handle, no queue, no fetch and no clock it
 * did not receive. That is what makes "one interpreter, two drivers" checkable
 * rather than aspirational: the drivers differ in how a step is *replayed*, the
 * effects differ in how a step is *carried out*, and the file that decides what
 * a step means imports neither.
 */

/** The columns `contacts` actually has. Anything else is a guess. */
export interface AutomationContact {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  unsubscribed: boolean
  data: Record<string, unknown> | null
}

/**
 * Who a step is acting on. The two shapes are the two modes, and the
 * interpreter switches on this rather than on a mode flag so that both
 * semantics sit side by side in one `switch` and cannot quietly diverge.
 */
export type StepScope =
  | {
      kind: 'member'
      workspaceId: string
      automationId: string
      version: number
      contactId: string
      ordinal: number
    }
  | {
      kind: 'cohort'
      workspaceId: string
      automationId: string
      version: number
      cohort: string
      ordinal: number
    }

export type SendStep = Extract<AutomationStep, { type: 'send' }>
export type TagStep = Extract<AutomationStep, { type: 'tag' }>
export type WebhookStep = Extract<AutomationStep, { type: 'webhook' }>
export type BranchStep = Extract<AutomationStep, { type: 'branch' }>

export interface SendInput {
  scope: Extract<StepScope, { kind: 'member' }>
  contact: AutomationContact
  step: SendStep
  stepId: string
  /** `<instance_id>:<step_id>`. Passed straight through as `Idempotency-Key`. */
  idempotencyKey: string
}

export interface FanOutInput {
  scope: Extract<StepScope, { kind: 'cohort' }>
  step: SendStep
  stepId: string
  /**
   * Prefix for the per-recipient idempotency key. The fan-out appends the
   * contact id, so a replayed fan-out re-enqueues the same keys and the send
   * pipeline drops the duplicates instead of mailing the cohort twice.
   */
  idempotencyPrefix: string
}

export interface BranchInput {
  scope: StepScope
  step: BranchStep
  stepId: string
  /** Where matching members go. */
  thenOrdinal: number | null
  /** Where the rest go. */
  otherwiseOrdinal: number | null
}

export interface TagInput {
  scope: StepScope
  step: TagStep
  stepId: string
}

export interface WebhookInput {
  scope: StepScope
  step: WebhookStep
  stepId: string
  contact: AutomationContact | null
}

export interface AdvanceInput {
  scope: StepScope
  toOrdinal: number
}

export interface AutomationEffects {
  /**
   * Loads the contact for a member-scoped step. Called *inside* the step, never
   * before it, so the record never becomes part of the instance payload.
   */
  loadContact(scope: Extract<StepScope, { kind: 'member' }>): Promise<AutomationContact | null>

  sendEmail(input: SendInput): Promise<{ sent: number }>

  /** Cohort `send`: hands the cohort to the broadcast machinery. */
  fanOutCohort(input: FanOutInput): Promise<{ enqueued: number }>

  /**
   * Instance `branch`: runs the compiled segment predicate against one contact.
   *
   * It is a query rather than an in-process evaluation on the already-loaded
   * contact, because the alternative is a second implementation of the segment
   * language — and a segment that means one thing in a nightly recompute and
   * another inside an automation is the exact bug this port exists to prevent.
   */
  evaluateBranch(input: BranchInput): Promise<{ matched: boolean }>

  /** Cohort `branch`: partitions the set with one `UPDATE` per arm. */
  updateCohortBranch(input: BranchInput): Promise<{ matched: number; unmatched: number }>

  tagContact(input: TagInput): Promise<{ tagged: number }>

  callWebhook(input: WebhookInput): Promise<{ status: number }>

  /** Moves whoever is at `scope.ordinal` to `toOrdinal`. */
  advance(input: AdvanceInput): Promise<{ moved: number }>

  completeEnrollment(input: { scope: StepScope }): Promise<{ completed: number }>
}
