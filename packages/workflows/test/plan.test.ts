import { describe, expect, it } from 'vitest'
import type { CohortStep } from '../src/plan.ts'
import {
  compileCohortPlan,
  compileInstancePlan,
  compilePlan,
  compilePlanOrThrow,
  fingerprintSteps,
  nestedStepId,
  stepId,
} from '../src/plan.ts'

const send = (subject = 'Welcome') => ({ type: 'send', subject, html: '<p>hi</p>' })
const wait = (duration = '1d') => ({ type: 'wait', duration })
const tag = () => ({ type: 'tag', add: ['engaged'] })
const branch = (then: unknown[], otherwise?: unknown[]) => ({
  type: 'branch',
  condition: 'opened_last_30d',
  then,
  ...(otherwise ? { otherwise } : {}),
})

describe('step ids', () => {
  it('is positional and carries the step type', () => {
    expect(stepId(0, 'send')).toBe('s0.send')
    expect(stepId(2, 'branch')).toBe('s2.branch')
    expect(nestedStepId('s2.branch', 'then', 0, 'send')).toBe('s2.branch.then.s0.send')
  })

  it('assigns ids by position, including inside branch arms', () => {
    const result = compileInstancePlan([send(), wait(), branch([send(), tag()], [wait('2h')])], {
      version: 1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.steps.map((s) => s.id)).toEqual([
      's0.send',
      's1.wait',
      's2.branch',
      's2.branch.then.s0.send',
      's2.branch.then.s1.tag',
      's2.branch.otherwise.s0.wait',
    ])
  })

  it('reassigns ids when steps are reordered, which is why editing forks a version', () => {
    const a = compilePlanOrThrow('instance', [send(), wait()], { version: 1 })
    const b = compilePlanOrThrow('instance', [wait(), send()], { version: 1 })
    expect(a.steps.map((s) => s.id)).toEqual(['s0.send', 's1.wait'])
    expect(b.steps.map((s) => s.id)).toEqual(['s0.wait', 's1.send'])
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })
})

describe('fingerprint', () => {
  it('is stable across key order', () => {
    const one = fingerprintSteps([{ type: 'send', subject: 'a', html: 'b' }])
    const two = fingerprintSteps([{ html: 'b', subject: 'a', type: 'send' }])
    expect(one).toBe(two)
  })

  it('changes when a step changes', () => {
    expect(fingerprintSteps([send('One')])).not.toBe(fingerprintSteps([send('Two')]))
  })

  it('changes when steps are reordered', () => {
    expect(fingerprintSteps([send(), wait()])).not.toBe(fingerprintSteps([wait(), send()]))
  })
})

describe('flattening', () => {
  it('emits arms immediately after their branch and joins both back', () => {
    const plan = compilePlanOrThrow(
      'instance',
      [send(), branch([send(), wait()], [tag()]), tag()],
      {
        version: 1,
      },
    )
    const byId = Object.fromEntries(plan.steps.map((s) => [s.id, s]))

    expect(plan.steps.map((s) => s.ordinal)).toEqual([0, 1, 2, 3, 4, 5])
    expect(byId['s1.branch']?.thenNext).toBe(2)
    expect(byId['s1.branch']?.otherwiseNext).toBe(4)
    // Both arms rejoin at the step after the branch, not at whatever was
    // emitted next.
    expect(byId['s1.branch.then.s1.wait']?.flowNext).toBe(5)
    expect(byId['s1.branch.otherwise.s0.tag']?.flowNext).toBe(5)
    expect(byId['s2.tag']?.flowNext).toBe(null)
  })

  it('sends an empty arm straight to the join', () => {
    const plan = compilePlanOrThrow('instance', [branch([send()]), tag()], { version: 1 })
    const b = plan.steps.find((s) => s.id === 's0.branch')
    expect(b?.thenNext).toBe(1)
    expect(b?.otherwiseNext).toBe(2)
  })

  it('makes exit terminal whatever follows it', () => {
    const plan = compilePlanOrThrow('instance', [{ type: 'exit' }, send()], { version: 1 })
    expect(plan.steps[0]?.flowNext).toBe(null)
    expect(plan.steps[0]?.linearNext).toBe(1)
  })

  it('walks linearly in cohort mode and by selection in instance mode', () => {
    const steps = [send(), branch([send()], [tag()])]
    expect(compilePlanOrThrow('cohort', steps, { version: 1 }).walk).toBe('linear')
    expect(compilePlanOrThrow('instance', steps, { version: 1 }).walk).toBe('selected')
  })
})

describe('cohort mode restrictions', () => {
  const waitUntil = { type: 'wait_until', event: 'purchase', timeout: '7d' }

  it('refuses wait_until with a message naming the way out', () => {
    const result = compileCohortPlan([send(), waitUntil], { version: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.path).toBe('s1.wait_until')
    expect(result.issues[0]?.message).toContain('instance mode')
  })

  it('refuses wait_until nested inside a branch arm', () => {
    const result = compileCohortPlan([branch([waitUntil])], { version: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.path).toBe('s0.branch.then.s0.wait_until')
  })

  it('accepts it in instance mode', () => {
    expect(compilePlan('instance', [send(), waitUntil], { version: 1 }).ok).toBe(true)
  })

  it('excludes wait_until from CohortStep at the type level', () => {
    const allowed: CohortStep = { type: 'wait', duration: '1d' }
    expect(allowed.type).toBe('wait')
    // @ts-expect-error a cohort has one clock for everyone, so `wait_until` is
    // not a member of its step union.
    const rejected: CohortStep = { type: 'wait_until', event: 'purchase', timeout: '7d' }
    expect(rejected).toBeTruthy()
  })
})

describe('validation', () => {
  it('reports the source position of a bad step', () => {
    const result = compileInstancePlan([send(), { type: 'nonsense' }], { version: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.path).toBe('steps[1]')
  })

  it('refuses an empty automation', () => {
    const result = compileInstancePlan([], { version: 1 })
    expect(result.ok).toBe(false)
  })

  it('caps branch nesting', () => {
    let nested: unknown[] = [send()]
    for (let i = 0; i < 12; i++) nested = [branch(nested)]
    const result = compileInstancePlan(nested, { version: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.message).toContain('nest at most')
  })
})
