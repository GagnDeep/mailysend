import type { AutomationEffects } from './effects.ts'
import type { InterpretResult } from './interpreter.ts'
import { interpret } from './interpreter.ts'
import type { AutomationPlan, AutomationStep } from './plan.ts'
import { compilePlanOrThrow } from './plan.ts'
import type { EventOutcome, EventStepRuntime, InstancePayload } from './runtime.ts'
import { guardPayload } from './runtime.ts'

/**
 * The Cloudflare Workflows driver.
 *
 * Structurally typed against `WorkflowStep` rather than importing
 * `cloudflare:workers`, for the same reason `packages/durable` does not: this
 * package has to load on Node, where that module does not exist. The app wraps
 * `AutomationWorkflow` in a real `WorkflowEntrypoint` and hands the `step`
 * object straight through.
 */
export interface WorkflowStepLike {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>
  sleep(name: string, duration: number | string): Promise<void>
  sleepUntil(name: string, timestamp: Date | number): Promise<void>
  waitForEvent<T>(
    name: string,
    options: { type: string; timeout?: number | string },
  ): Promise<{ payload: T }>
}

export interface WorkflowEventLike<T> {
  payload: T
  instanceId: string
}

/**
 * Adapts `WorkflowStep` to `StepRuntime`. The only real work is `waitForEvent`:
 * Workflows signals a timeout by throwing, and the interpreter treats a timeout
 * as a continue, so the throw is turned back into a value here rather than
 * teaching the interpreter about one runtime's error shape.
 */
export class WorkflowsStepRuntime implements EventStepRuntime {
  #step: WorkflowStepLike

  constructor(step: WorkflowStepLike) {
    this.#step = step
  }

  do<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return this.#step.do(id, fn)
  }

  sleep(id: string, ms: number): Promise<void> {
    return this.#step.sleep(id, ms)
  }

  sleepUntil(id: string, at: Date): Promise<void> {
    return this.#step.sleepUntil(id, at)
  }

  async waitForEvent<T = unknown>(
    id: string,
    name: string,
    timeoutMs: number,
  ): Promise<EventOutcome<T>> {
    try {
      const result = await this.#step.waitForEvent<T>(id, { type: name, timeout: timeoutMs })
      return { received: true, payload: result.payload }
    } catch {
      return { received: false }
    }
  }
}

export interface AutomationWorkflowDeps {
  /** Loads the published step list for `(automation_id, version)`. */
  loadSteps(input: {
    workspaceId: string
    automationId: string
    version: number
  }): Promise<{ steps: unknown[]; mode: 'cohort' | 'instance' }>
  effects: AutomationEffects
}

/**
 * One generic Workflow for every automation.
 *
 * There is no per-automation code and no codegen: the steps are data, the plan
 * is derived from them, and this class is the interpreter's Workflows-shaped
 * shell. A new automation is a row, not a deploy.
 */
export class AutomationWorkflow {
  #deps: AutomationWorkflowDeps

  constructor(deps: AutomationWorkflowDeps) {
    this.#deps = deps
  }

  async run(
    event: WorkflowEventLike<InstancePayload>,
    step: WorkflowStepLike,
  ): Promise<InterpretResult> {
    const payload = guardPayload(event.payload)
    const loaded = await this.#deps.loadSteps({
      workspaceId: payload.workspaceId,
      automationId: payload.automationId,
      version: payload.version,
    })
    const plan = compilePlanOrThrow(loaded.mode, loaded.steps, { version: payload.version })

    return runPlan({
      plan,
      runtime: new WorkflowsStepRuntime(step),
      effects: this.#deps.effects,
      payload,
      instanceId: event.instanceId,
    })
  }
}

export interface RunPlanInput {
  plan: AutomationPlan<AutomationStep>
  runtime: EventStepRuntime
  effects: AutomationEffects
  payload: InstancePayload
  instanceId: string
}

/**
 * Turns a payload into the scope the interpreter wants. Shared by both drivers
 * so a cohort payload cannot mean one thing on Workers and another on Node.
 */
export const runPlan = (input: RunPlanInput): Promise<InterpretResult> => {
  const { payload } = input
  const common = {
    workspaceId: payload.workspaceId,
    automationId: payload.automationId,
    version: payload.version,
  }
  const scope =
    payload.cohort !== undefined
      ? { kind: 'cohort' as const, ...common, cohort: payload.cohort }
      : { kind: 'member' as const, ...common, contactId: payload.contactId ?? '' }

  if (scope.kind === 'member' && scope.contactId === '') {
    throw new Error('an instance-mode payload needs either a contactId or a cohort')
  }

  return interpret({
    plan: input.plan,
    runtime: input.runtime,
    effects: input.effects,
    scope,
    instanceId: input.instanceId,
    fingerprint: payload.fingerprint,
    startOrdinal: payload.startOrdinal,
  })
}
