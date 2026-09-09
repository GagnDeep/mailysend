import type { PlatformCapabilities } from '@mailysend/platform'
import type { SchedulerDriverOptions } from './scheduler.ts'
import { SchedulerDriver } from './scheduler.ts'
import { AutomationWorkflow } from './workflow.ts'

export type { EnrollmentEffects } from './cohort.ts'
export { createEnrollmentEffects } from './cohort.ts'
export type {
  AdvanceInput,
  AutomationContact,
  AutomationEffects,
  BranchInput,
  BranchStep,
  FanOutInput,
  SendInput,
  SendStep,
  StepScope,
  TagInput,
  TagStep,
  WebhookInput,
  WebhookStep,
} from './effects.ts'
export type { AdmissionInput } from './instance.ts'
export {
  admitInstanceMode,
  COHORT_MAX,
  estimateCohortInstances,
  INSTANCE_MODE_MAX_ENROLLMENTS,
  recommendMode,
  usesWaitUntil,
  WORKFLOWS_V2_MAX_CONCURRENT_INSTANCES,
} from './instance.ts'

export type { InterpretInput, InterpretResult } from './interpreter.ts'
export { interpret, PlanFingerprintMismatch } from './interpreter.ts'
export type {
  AutomationPlan,
  AutomationStep,
  CohortPlan,
  CohortStep,
  CompileOptions,
  FlatStep,
  InstancePlan,
  PlanIssue,
  PlanResult,
  StepType,
} from './plan.ts'
export {
  canonicalJson,
  compileCohortPlan,
  compileInstancePlan,
  compilePlan,
  compilePlanOrThrow,
  fingerprintSteps,
  MAX_BRANCH_DEPTH,
  nestedStepId,
  PLAN_FORMAT,
  PlanError,
  stepId,
} from './plan.ts'
export type {
  EventOutcome,
  EventStepRuntime,
  InstancePayload,
  RuntimeFor,
  StepRuntime,
} from './runtime.ts'
export {
  guardPayload,
  guardStepResult,
  idempotencyKey,
  isEventRuntime,
  jsonBytes,
  PAYLOAD_BUDGET_BYTES,
  STEP_RESULT_BUDGET_BYTES,
  STEP_RESULT_PLATFORM_MAX_BYTES,
  StepResultTooLarge,
} from './runtime.ts'
export type { SchedulerDriverOptions, StartResult } from './scheduler.ts'
export { SchedulerDriver, SchedulerStepRuntime } from './scheduler.ts'
export type {
  AutomationWorkflowDeps,
  RunPlanInput,
  WorkflowEventLike,
  WorkflowStepLike,
} from './workflow.ts'
export { AutomationWorkflow, runPlan, WorkflowsStepRuntime } from './workflow.ts'

export type AutomationDriver =
  | { kind: 'workflows'; workflow: AutomationWorkflow }
  | { kind: 'scheduler'; scheduler: SchedulerDriver }

/**
 * Picks the driver from the runtime's own capability rather than from
 * configuration. Promising Workflows on a runtime that has no Workflows engine
 * would surface as a confusing failure much later — see `resolveFeatures` in
 * @mailysend/core, which makes the same call for the same reason.
 */
export const selectDriver = (
  capabilities: Pick<PlatformCapabilities, 'workflows'>,
  options: SchedulerDriverOptions,
): AutomationDriver =>
  capabilities.workflows
    ? { kind: 'workflows', workflow: new AutomationWorkflow(options) }
    : { kind: 'scheduler', scheduler: new SchedulerDriver(options) }
