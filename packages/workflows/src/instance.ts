import { apiError } from '@mailysend/contracts'
import {
  COHORT_MAX,
  INSTANCE_MODE_MAX_ENROLLMENTS,
  WORKFLOWS_V2_MAX_CONCURRENT_INSTANCES,
} from '@mailysend/core'

/**
 * Why cohort mode is the default, stated as arithmetic rather than as advice.
 *
 * Workflows V2 allows 50,000 *concurrent* instances per account. A thirty-day
 * drip holds an instance open for the whole thirty days, so one instance per
 * contact means the cap is the audience size — and it is an account-wide cap,
 * so one customer's 60,000-contact drip would stop every other customer's
 * automation from starting. There is no engineering around it: the number is
 * the platform's, and an automation that needs 500,000 sleeping instances
 * cannot run in instance mode on any amount of hardware we can buy.
 *
 * Instance mode is capped well below the platform limit at 40,000 enrollments,
 * leaving headroom for every other automation in the account. Above that the
 * API refuses and points at cohort mode, which turns the same 500,000 contacts
 * over a month into roughly 720 instances.
 */

export { COHORT_MAX, INSTANCE_MODE_MAX_ENROLLMENTS, WORKFLOWS_V2_MAX_CONCURRENT_INSTANCES }

export interface AdmissionInput {
  /** Active enrollments this automation would hold open in instance mode. */
  activeEnrollments: number
  /** Instances currently open across the whole account. */
  concurrentInstances: number
  /** How many this admission is about to add. */
  adding?: number
}

/**
 * Refuses an instance-mode run that would breach either cap.
 *
 * Both checks throw the same `automation_scale_exceeded`, whose message already
 * names cohort mode as the way out — the caller is a customer who wants their
 * automation to run, not an operator reading a limits table.
 */
export const admitInstanceMode = (input: AdmissionInput): void => {
  const adding = input.adding ?? 1
  if (input.activeEnrollments + adding > INSTANCE_MODE_MAX_ENROLLMENTS) {
    throw apiError('automation_scale_exceeded', {
      message:
        `Instance-mode automations support at most ${INSTANCE_MODE_MAX_ENROLLMENTS.toLocaleString('en-US')} ` +
        `active enrollments and this one would reach ${(input.activeEnrollments + adding).toLocaleString('en-US')}. ` +
        'Switch this automation to cohort mode.',
      param: 'mode',
    })
  }
  if (input.concurrentInstances + adding > WORKFLOWS_V2_MAX_CONCURRENT_INSTANCES) {
    throw apiError('automation_scale_exceeded', {
      message:
        `The workflow engine allows ${WORKFLOWS_V2_MAX_CONCURRENT_INSTANCES.toLocaleString('en-US')} concurrent ` +
        `instances and ${input.concurrentInstances.toLocaleString('en-US')} are already open. ` +
        'Switch this automation to cohort mode, which uses one instance per hourly cohort.',
      param: 'mode',
    })
  }
}

/**
 * How many instances a cohort-mode automation would hold, for the estimate the
 * editor shows next to the mode switch. One instance per (version, hourly
 * cohort), and a cohort splits once it passes `COHORT_MAX`.
 */
export const estimateCohortInstances = (input: {
  contacts: number
  spreadHours: number
}): number => {
  const hours = Math.max(1, Math.ceil(input.spreadHours))
  const perHour = input.contacts / hours
  return hours * Math.max(1, Math.ceil(perHour / COHORT_MAX))
}

/**
 * The mode to use when the caller did not choose one.
 *
 * Cohort, matching the contract's default, unless the steps contain a
 * `wait_until` — which a cohort cannot express at all, so the automation either
 * runs as instances or does not run. An automation that needs both exact timing
 * and more than 40,000 enrollments is refused by `admitInstanceMode` rather
 * than quietly downgraded, because quantising someone's "wait until they click"
 * to the nearest hour is a different product than the one they configured.
 */
export const recommendMode = (steps: unknown[]): 'cohort' | 'instance' =>
  usesWaitUntil(steps) ? 'instance' : 'cohort'

/** Walks branch arms too: a `wait_until` three levels down still forces the mode. */
export const usesWaitUntil = (steps: unknown[]): boolean =>
  steps.some((raw) => {
    const step = raw as { type?: string; then?: unknown; otherwise?: unknown }
    if (step?.type === 'wait_until') return true
    const then = Array.isArray(step?.then) ? step.then : []
    const otherwise = Array.isArray(step?.otherwise) ? step.otherwise : []
    return usesWaitUntil(then) || usesWaitUntil(otherwise)
  })
