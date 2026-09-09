import type { AutomationStep } from './plan.ts'

/**
 * The seam between the interpreter and whatever is replaying it.
 *
 * Cloudflare's `WorkflowStep` and the Node scheduler both satisfy this, and the
 * interpreter is written against nothing else. That is the whole defence
 * against the two runtimes drifting: there is no second interpreter to drift
 * *from*, because a runtime cannot express a step semantic — it can only
 * memoise a result, suspend, or wake.
 */
export interface StepRuntime {
  /** Runs `fn` once per id and replays the recorded result on every rerun. */
  do<T>(id: string, fn: () => Promise<T>): Promise<T>
  sleep(id: string, ms: number): Promise<void>
  sleepUntil(id: string, at: Date): Promise<void>
}

export interface EventOutcome<T = unknown> {
  received: boolean
  payload?: T
}

/**
 * Waiting on a per-person event is a capability, not a step semantic, so it
 * lives in a separate interface. A cohort driver supplies `StepRuntime` and
 * therefore cannot be handed a plan that needs this.
 */
export interface EventStepRuntime extends StepRuntime {
  waitForEvent<T = unknown>(id: string, name: string, timeoutMs: number): Promise<EventOutcome<T>>
}

/**
 * A plan whose step union still contains `wait_until` demands an event-capable
 * runtime. `CohortPlan` narrows that member away, so a cohort plan is satisfied
 * by the plain `StepRuntime` and an instance plan is not.
 */
export type RuntimeFor<S extends AutomationStep> = [Extract<S, { type: 'wait_until' }>] extends [
  never,
]
  ? StepRuntime
  : EventStepRuntime

export const isEventRuntime = (runtime: StepRuntime): runtime is EventStepRuntime =>
  typeof (runtime as EventStepRuntime).waitForEvent === 'function'

/**
 * Workflows persists every step result and caps one at 1 MiB. Nothing here
 * should come anywhere near that: a step result is a receipt (how many were
 * sent, which arm was taken), never the material. The budget is two orders of
 * magnitude under the platform limit precisely so that hitting it means someone
 * put a payload where a receipt belongs — a contact record carried between
 * steps, a rendered body, a page of ids — and the failure names it while it is
 * still one contact rather than at the four-hundred-thousandth enrollment.
 */
export const STEP_RESULT_PLATFORM_MAX_BYTES = 1_048_576
export const STEP_RESULT_BUDGET_BYTES = 8_192
/** An instance payload is read on every replay, so it is held tighter still. */
export const PAYLOAD_BUDGET_BYTES = 2_048

export class StepResultTooLarge extends Error {
  readonly stepId: string
  readonly bytes: number
  readonly budget: number

  constructor(stepId: string, bytes: number, budget: number) {
    super(
      `step '${stepId}' returned ${bytes} bytes, over the ${budget} byte budget. ` +
        'Step results are receipts; load the data inside the step instead of carrying it between steps.',
    )
    this.name = 'StepResultTooLarge'
    this.stepId = stepId
    this.bytes = bytes
    this.budget = budget
  }
}

const encoder = new TextEncoder()

export const jsonBytes = (value: unknown): number => {
  const json = JSON.stringify(value)
  return json === undefined ? 0 : encoder.encode(json).length
}

export const guardStepResult = <T>(
  stepId: string,
  value: T,
  budget = STEP_RESULT_BUDGET_BYTES,
): T => {
  const bytes = jsonBytes(value)
  if (bytes > budget) throw new StepResultTooLarge(stepId, bytes, budget)
  return value
}

/**
 * What travels with an instance, and all that travels with it.
 *
 * No contact, no rendered body, no member list — an instance-mode payload is
 * four identifiers and an ordinal, and a cohort payload swaps the contact id
 * for a cohort key. Everything else is loaded inside a memoised step, where it
 * costs one read on the first pass and nothing on a replay.
 */
export interface InstancePayload {
  workspaceId: string
  automationId: string
  version: number
  /** The plan this instance was started against. Checked on every resume. */
  fingerprint: string
  /** Instance mode. Mutually exclusive with `cohort`. */
  contactId?: string
  /** Cohort mode: the ISO hour the cohort was sealed in, e.g. `2026-09-09/14`. */
  cohort?: string
  startOrdinal: number
}

export const guardPayload = (payload: InstancePayload): InstancePayload => {
  const bytes = jsonBytes(payload)
  if (bytes > PAYLOAD_BUDGET_BYTES) {
    throw new StepResultTooLarge('instance.payload', bytes, PAYLOAD_BUDGET_BYTES)
  }
  return payload
}

/**
 * A replayed send must not become a second delivery, and the only thing both
 * runtimes agree on across a crash is the instance id and the step id.
 */
export const idempotencyKey = (instanceId: string, stepId: string): string =>
  `${instanceId}:${stepId}`
