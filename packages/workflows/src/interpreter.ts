import { parseDuration } from '@mailysend/core'
import type { AutomationContact, AutomationEffects, StepScope } from './effects.ts'
import type { AutomationPlan, AutomationStep, FlatStep } from './plan.ts'
import { PlanError } from './plan.ts'
import type { RuntimeFor, StepRuntime } from './runtime.ts'
import { guardStepResult, idempotencyKey, isEventRuntime } from './runtime.ts'

/**
 * The interpreter. There is exactly one, and this is it.
 *
 * Everything that decides what a step *means* lives in `executeStep` below.
 * Everything runtime-specific lives behind `StepRuntime`, and everything
 * outside the process lives behind `AutomationEffects`. A Workflows instance
 * and a Node alarm therefore run the same function over the same plan and
 * produce the same trace — which is asserted, not assumed, in the tests.
 */

/** A plan cannot loop backwards, so this only ever catches a corrupt plan. */
const MAX_STEP_EXECUTIONS = 4_096

export interface InterpretInput<S extends AutomationStep, R extends RuntimeFor<S>> {
  plan: AutomationPlan<S>
  runtime: R
  effects: AutomationEffects
  scope:
    | Omit<Extract<StepScope, { kind: 'member' }>, 'ordinal'>
    | Omit<Extract<StepScope, { kind: 'cohort' }>, 'ordinal'>
  instanceId: string
  /** The plan the instance was *started* against. A mismatch is fatal. */
  fingerprint: string
  startOrdinal?: number
}

export interface InterpretResult {
  status: 'completed' | 'exited'
  /** Step ids in execution order. The regression surface for driver parity. */
  trace: string[]
  steps: number
}

export class PlanFingerprintMismatch extends Error {
  constructor(expected: string, actual: string) {
    super(
      `this instance was started against plan ${expected} but the loaded plan is ${actual}. ` +
        'Publish a new automation version instead of editing one that has instances in flight.',
    )
    this.name = 'PlanFingerprintMismatch'
  }
}

interface StepOutcome {
  /** Overrides the cursor in `selected` walks. */
  jump?: number | null
  /** The step already moved its people; skip the generic advance. */
  advanced?: boolean
  exited?: boolean
}

interface ExecContext {
  runtime: StepRuntime
  effects: AutomationEffects
  instanceId: string
}

const branchTargets = (
  flat: FlatStep,
): { thenOrdinal: number | null; otherwiseOrdinal: number | null } => ({
  thenOrdinal: flat.thenNext ?? flat.flowNext,
  otherwiseOrdinal: flat.otherwiseNext ?? flat.flowNext,
})

const durationMs = (stepId: string, source: string): number => {
  const ms = parseDuration(source)
  if (ms === null) throw new PlanError(`step '${stepId}' has an unparseable duration '${source}'`)
  return ms
}

const executeStep = async (
  flat: FlatStep,
  at: StepScope,
  ctx: ExecContext,
): Promise<StepOutcome> => {
  const { runtime, effects, instanceId } = ctx
  const run = <T>(id: string, fn: () => Promise<T>): Promise<T> =>
    runtime.do(id, async () => guardStepResult(id, await fn()))

  switch (flat.step.type) {
    case 'send': {
      const step = flat.step
      await run(flat.id, async () => {
        if (at.kind === 'cohort') {
          return effects.fanOutCohort({
            scope: at,
            step,
            stepId: flat.id,
            idempotencyPrefix: instanceId,
          })
        }
        // Loaded here rather than carried in the payload: on a replay this
        // whole body is skipped, so the read costs nothing the second time.
        const contact = await effects.loadContact(at)
        if (!contact) return { sent: 0 }
        // Unsubscribing mid-automation has to stop the next message, not just
        // future enrollments; the check belongs at the send, not the enroll.
        if (contact.unsubscribed) return { sent: 0 }
        return effects.sendEmail({
          scope: at,
          contact,
          step,
          stepId: flat.id,
          idempotencyKey: idempotencyKey(instanceId, flat.id),
        })
      })
      return {}
    }

    case 'wait': {
      await runtime.sleep(flat.id, durationMs(flat.id, flat.step.duration))
      return {}
    }

    case 'wait_until': {
      const step = flat.step
      if (!isEventRuntime(runtime)) {
        throw new PlanError(
          `step '${flat.id}' waits for an event, which needs an event-capable runtime. ` +
            'Cohort plans exclude this step type at compile time; this plan was built another way.',
        )
      }
      // A timeout continues rather than exits. A missed event silently dropping
      // people out of an automation is the failure mode nobody notices.
      await runtime.waitForEvent(flat.id, step.event, durationMs(flat.id, step.timeout))
      return {}
    }

    case 'branch': {
      const step = flat.step
      const { thenOrdinal, otherwiseOrdinal } = branchTargets(flat)
      if (at.kind === 'cohort') {
        await run(flat.id, () =>
          effects.updateCohortBranch({
            scope: at,
            step,
            stepId: flat.id,
            thenOrdinal,
            otherwiseOrdinal,
          }),
        )
        return { advanced: true }
      }
      const { matched } = await run(flat.id, () =>
        effects.evaluateBranch({ scope: at, step, stepId: flat.id, thenOrdinal, otherwiseOrdinal }),
      )
      return { jump: matched ? thenOrdinal : otherwiseOrdinal }
    }

    case 'tag': {
      const step = flat.step
      await run(flat.id, () => effects.tagContact({ scope: at, step, stepId: flat.id }))
      return {}
    }

    case 'webhook': {
      const step = flat.step
      await run(flat.id, async () => {
        const contact = at.kind === 'member' ? await effects.loadContact(at) : null
        return effects.callWebhook({ scope: at, step, stepId: flat.id, contact })
      })
      return {}
    }

    case 'exit':
      return { exited: true }
  }
}

export const interpret = async <S extends AutomationStep, R extends RuntimeFor<S>>(
  input: InterpretInput<S, R>,
): Promise<InterpretResult> => {
  const { plan, effects, instanceId, scope } = input

  if (plan.fingerprint !== input.fingerprint) {
    throw new PlanFingerprintMismatch(input.fingerprint, plan.fingerprint)
  }
  // A cohort walking `selected` would follow one arm and abandon the other set;
  // a member walking `linear` would run every arm for one person. Both are
  // silent data corruption rather than an error, so they are checked here.
  const expectedWalk = scope.kind === 'cohort' ? 'linear' : 'selected'
  if (plan.walk !== expectedWalk) {
    throw new PlanError(
      `a ${scope.kind}-scoped run needs a '${expectedWalk}' plan, not '${plan.walk}'`,
    )
  }

  const ctx: ExecContext = { runtime: input.runtime, effects, instanceId }
  const trace: string[] = []
  let cursor: number | null = input.startOrdinal ?? 0
  let exited = false

  while (cursor !== null) {
    if (trace.length >= MAX_STEP_EXECUTIONS) {
      throw new PlanError(
        `plan ${plan.fingerprint} did not terminate after ${MAX_STEP_EXECUTIONS} steps`,
      )
    }
    const flat: FlatStep | undefined = plan.steps[cursor]
    if (!flat) throw new PlanError(`ordinal ${cursor} is not in plan ${plan.fingerprint}`)

    const at: StepScope =
      scope.kind === 'member'
        ? { ...scope, ordinal: flat.ordinal }
        : { ...scope, ordinal: flat.ordinal }
    trace.push(flat.id)

    const outcome = await executeStep(flat, at, ctx)
    // A cohort pass walks past an `exit`; only some of its people left there.
    if (outcome.exited === true && plan.walk === 'selected') exited = true

    // `jump` is meaningful when it is `null`, so the fallback tests for
    // `undefined` rather than using `??`.
    const selected: number | null = outcome.jump !== undefined ? outcome.jump : flat.flowNext
    const target = plan.walk === 'selected' ? selected : flat.flowNext
    if (!outcome.advanced) {
      const id = `${flat.id}#advance`
      await ctx.runtime.do(id, async () =>
        guardStepResult(
          id,
          target === null
            ? await effects.completeEnrollment({ scope: at })
            : await effects.advance({ scope: at, toOrdinal: target }),
        ),
      )
    }

    cursor = plan.walk === 'selected' ? selected : flat.linearNext
  }

  return { status: exited ? 'exited' : 'completed', trace, steps: trace.length }
}

export type { AutomationContact }
