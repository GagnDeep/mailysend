import { AutomationStep as AutomationStepSchema } from '@mailysend/contracts'
import { stableHash } from '@mailysend/core'
import type { z } from 'zod'

/**
 * Steps in, a flat program out.
 *
 * Cloudflare Workflows replays an instance by *step id*: it re-runs the class
 * from the top and hands back the recorded result of every id it has seen
 * before. That makes the id the durable part of an automation, not the code —
 * rename or reorder a step in a published version and every in-flight instance
 * silently reattaches its history to the wrong work. So ids are positional and
 * derived (`s0.send`), the plan carries a fingerprint of the steps it was built
 * from, and editing an automation writes a new `automation_versions` row rather
 * than mutating one that instances are running against.
 *
 * The output is deliberately *flat*: a numbered program with explicit
 * successors rather than a tree. Two things fall out of that and neither is
 * available from a tree. `automation_enrollments.current_step` becomes an
 * ordinal a query can compare, which is what lets cohort mode move twenty-five
 * thousand people through a branch with one `UPDATE`. And resuming an instance
 * after a crash is "start at ordinal n", with no path to reconstruct.
 */

export type AutomationStep = z.infer<typeof AutomationStepSchema>
export type StepType = AutomationStep['type']

/**
 * A cohort is a set of people who share a clock, and `wait_until event` asks
 * for a clock per person. There is no set-shaped answer, so the step is removed
 * from the type rather than rejected at run time: a cohort plan that contains
 * one does not compile, at every call site, in the editor.
 */
export type CohortStep = Exclude<AutomationStep, { type: 'wait_until' }>

/**
 * Bumped when the flattening scheme changes. It is mixed into the fingerprint,
 * so a plan compiled by an older build is detected as stale for the same reason
 * an edited step list is — a changed layout invalidates recorded step ids just
 * as thoroughly as a changed step.
 */
export const PLAN_FORMAT = 1

/** Guards a pathological nesting depth long before the flattener recurses into it. */
export const MAX_BRANCH_DEPTH = 8

export const stepId = (index: number, type: StepType): string => `s${index}.${type}`

/**
 * Nested ids extend their branch's id with the arm they sit in:
 * `s2.branch.then.s0.send`. The whole path is positional, so the stability
 * argument that holds for a top-level step holds identically inside an arm.
 */
export const nestedStepId = (
  branchId: string,
  arm: 'then' | 'otherwise',
  index: number,
  type: StepType,
): string => `${branchId}.${arm}.${stepId(index, type)}`

export interface FlatStep<S extends AutomationStep = AutomationStep> {
  ordinal: number
  id: string
  step: S
  /**
   * Where the people at this ordinal go next. `null` is the end of the program.
   * The last step of a branch arm points at the join, not at whatever the
   * flattener happened to emit next.
   */
  flowNext: number | null
  /** The next ordinal in emission order. A cohort instance walks this. */
  linearNext: number | null
  /**
   * Branch only: the entry ordinal of each arm, already resolved to the join
   * when an arm is empty.
   */
  thenNext?: number
  otherwiseNext?: number
}

export interface AutomationPlan<S extends AutomationStep = AutomationStep> {
  version: number
  mode: 'cohort' | 'instance'
  /**
   * How the *instance cursor* moves, which is the one place the two modes
   * genuinely differ. An instance-mode run is one person, so the cursor is that
   * person's position and follows `flowNext`. A cohort run is a set, so the
   * cursor is a pass over the program and follows `linearNext` — every ordinal
   * is visited once, each acting on whoever is currently parked there. Keeping
   * this on the plan rather than as a flag inside the interpreter is what stops
   * the two modes growing separate step semantics.
   */
  walk: 'linear' | 'selected'
  fingerprint: string
  steps: FlatStep<S>[]
}

export type CohortPlan = AutomationPlan<CohortStep>
export type InstancePlan = AutomationPlan<AutomationStep>

export interface PlanIssue {
  /** Dotted position in the source steps, e.g. `steps[2].then[0]`. */
  path: string
  message: string
}

export type PlanResult<P> = { ok: true; plan: P } | { ok: false; issues: PlanIssue[] }

export class PlanError extends Error {
  readonly issues: PlanIssue[]

  constructor(message: string, issues: PlanIssue[] = []) {
    super(message)
    this.name = 'PlanError'
    this.issues = issues
  }
}

/**
 * Key-sorted JSON. The fingerprint has to survive a round trip through a TEXT
 * column and whatever key order the writer's `JSON.stringify` chose, or every
 * deploy would look like a plan change.
 */
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

export const fingerprintSteps = (steps: unknown[]): string =>
  stableHash(`${PLAN_FORMAT} ${canonicalJson(steps)}`)
    .toString(16)
    .padStart(8, '0')

interface Node {
  id: string
  step: AutomationStep
  ordinal: number
  /** Named `thenArm` rather than `then` so a plan node is never a thenable. */
  thenArm?: Node[]
  otherwiseArm?: Node[]
}

const buildList = (
  raw: unknown[],
  prefix: (index: number, type: StepType) => string,
  path: string,
  depth: number,
  issues: PlanIssue[],
): Node[] => {
  const nodes: Node[] = []
  for (let i = 0; i < raw.length; i++) {
    const at = `${path}[${i}]`
    const parsed = AutomationStepSchema.safeParse(raw[i])
    if (!parsed.success) {
      issues.push({ path: at, message: parsed.error.issues[0]?.message ?? 'is not a valid step' })
      continue
    }
    const step = parsed.data
    const node: Node = { id: prefix(nodes.length, step.type), step, ordinal: -1 }

    if (step.type === 'branch') {
      if (depth >= MAX_BRANCH_DEPTH) {
        issues.push({ path: at, message: `branches may nest at most ${MAX_BRANCH_DEPTH} deep` })
        continue
      }
      node.thenArm = buildList(
        step.then,
        (index, type) => nestedStepId(node.id, 'then', index, type),
        `${at}.then`,
        depth + 1,
        issues,
      )
      node.otherwiseArm = buildList(
        step.otherwise ?? [],
        (index, type) => nestedStepId(node.id, 'otherwise', index, type),
        `${at}.otherwise`,
        depth + 1,
        issues,
      )
    }

    nodes.push(node)
  }
  return nodes
}

const assignOrdinals = (nodes: Node[], next: { value: number }): void => {
  for (const node of nodes) {
    node.ordinal = next.value++
    // Arms are emitted immediately after their branch, so a cohort's linear
    // pass reaches the `then` set before the `otherwise` set and both before
    // the join. Any other order would let people at the join advance past
    // people still parked in an arm that has not run yet.
    if (node.thenArm) assignOrdinals(node.thenArm, next)
    if (node.otherwiseArm) assignOrdinals(node.otherwiseArm, next)
  }
}

const linkList = (nodes: Node[], join: number | null, out: Map<number, FlatStep>): void => {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    const after = nodes[i + 1]?.ordinal ?? join
    // `exit` is terminal for the people who reach it whatever follows it in the
    // source, which is the entire reason the step exists.
    const flowNext = node.step.type === 'exit' ? null : after
    const flat: FlatStep = {
      ordinal: node.ordinal,
      id: node.id,
      step: node.step,
      flowNext,
      linearNext: null,
    }

    if (node.step.type === 'branch') {
      // An empty arm is a jump straight to the join. Falling back to the branch
      // itself would be a one-step infinite loop, so a plan with a branch at
      // the very end of the program resolves to `null` instead.
      flat.thenNext = node.thenArm?.[0]?.ordinal ?? flowNext ?? undefined
      flat.otherwiseNext = node.otherwiseArm?.[0]?.ordinal ?? flowNext ?? undefined
      linkList(node.thenArm ?? [], flowNext, out)
      linkList(node.otherwiseArm ?? [], flowNext, out)
    }

    out.set(node.ordinal, flat)
  }
}

export interface CompileOptions {
  version: number
}

/**
 * Compiles a step list into an instance-mode plan. Every step type is available
 * here because an instance is one person with one clock.
 */
export const compileInstancePlan = (
  steps: unknown[],
  options: CompileOptions,
): PlanResult<InstancePlan> => {
  const issues: PlanIssue[] = []
  const nodes = buildList(steps, stepId, 'steps', 0, issues)
  if (issues.length > 0) return { ok: false, issues }
  if (nodes.length === 0) {
    return {
      ok: false,
      issues: [{ path: 'steps', message: 'an automation needs at least one step' }],
    }
  }

  assignOrdinals(nodes, { value: 0 })
  const linked = new Map<number, FlatStep>()
  linkList(nodes, null, linked)

  const flat: FlatStep[] = []
  for (let ordinal = 0; ordinal < linked.size; ordinal++) {
    const step = linked.get(ordinal)
    if (!step) {
      return {
        ok: false,
        issues: [{ path: 'steps', message: `ordinal ${ordinal} was not emitted` }],
      }
    }
    step.linearNext = ordinal + 1 < linked.size ? ordinal + 1 : null
    flat.push(step)
  }

  return {
    ok: true,
    plan: {
      version: options.version,
      mode: 'instance',
      walk: 'selected',
      fingerprint: fingerprintSteps(steps),
      steps: flat,
    },
  }
}

const isCohortStep = (step: AutomationStep): step is CohortStep => step.type !== 'wait_until'

/**
 * Compiles a cohort-mode plan, narrowing every step to `CohortStep`.
 *
 * The narrowing is the point: the returned plan's element type genuinely
 * excludes `wait_until`, so a cohort driver that tried to grow a `waitForEvent`
 * case would have nothing to switch on.
 */
export const compileCohortPlan = (
  steps: unknown[],
  options: CompileOptions,
): PlanResult<CohortPlan> => {
  const compiled = compileInstancePlan(steps, options)
  if (!compiled.ok) return compiled

  const issues: PlanIssue[] = []
  const narrowed: FlatStep<CohortStep>[] = []
  for (const flat of compiled.plan.steps) {
    if (!isCohortStep(flat.step)) {
      issues.push({
        path: flat.id,
        message:
          "`wait_until` waits for one person's event and a cohort has one clock for everyone. " +
          'Switch this automation to instance mode, or replace the step with a `wait`.',
      })
      continue
    }
    narrowed.push({ ...flat, step: flat.step })
  }
  if (issues.length > 0) return { ok: false, issues }

  return { ok: true, plan: { ...compiled.plan, mode: 'cohort', walk: 'linear', steps: narrowed } }
}

export const compilePlan = (
  mode: 'cohort' | 'instance',
  steps: unknown[],
  options: CompileOptions,
): PlanResult<AutomationPlan> =>
  mode === 'cohort' ? compileCohortPlan(steps, options) : compileInstancePlan(steps, options)

/** Throws rather than returning issues, for call sites that already validated. */
export const compilePlanOrThrow = (
  mode: 'cohort' | 'instance',
  steps: unknown[],
  options: CompileOptions,
): AutomationPlan => {
  const result = compilePlan(mode, steps, options)
  if (!result.ok) {
    throw new PlanError(
      `automation steps do not compile: ${result.issues[0]?.message ?? 'unknown'}`,
      result.issues,
    )
  }
  return result.plan
}
