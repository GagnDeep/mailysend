import { describe, expect, it } from 'vitest'
import { interpret, PlanFingerprintMismatch } from '../src/interpreter.ts'
import { compilePlanOrThrow } from '../src/plan.ts'
import { idempotencyKey, StepResultTooLarge } from '../src/runtime.ts'
import { WorkflowsStepRuntime } from '../src/workflow.ts'
import { contact, FakeWorkflowStep, fakeEffects } from './helpers.ts'

const send = (subject = 'Welcome') => ({ type: 'send', subject, html: '<p>hi</p>' })
const wait = (duration = '1d') => ({ type: 'wait', duration })
const tag = () => ({ type: 'tag', add: ['engaged'] })
const branch = (then: unknown[], otherwise?: unknown[]) => ({
  type: 'branch',
  condition: 'opened_last_30d',
  then,
  ...(otherwise ? { otherwise } : {}),
})

const member = {
  kind: 'member' as const,
  workspaceId: 'ws_default',
  automationId: 'aut_00000000000000000000000001',
  version: 3,
  contactId: 'con_00000000000000000000000001',
}

const cohort = {
  kind: 'cohort' as const,
  workspaceId: 'ws_default',
  automationId: 'aut_00000000000000000000000001',
  version: 3,
  cohort: '2026-09-09/14',
}

const runInstance = async (steps: unknown[], over = {}, scope: any = member) => {
  const plan = compilePlanOrThrow(scope.kind === 'cohort' ? 'cohort' : 'instance', steps, {
    version: 3,
  })
  const effects = fakeEffects(over)
  const step = new FakeWorkflowStep()
  const result = await interpret({
    plan,
    runtime: new WorkflowsStepRuntime(step),
    effects,
    scope,
    instanceId: 'wfi_abc',
    fingerprint: plan.fingerprint,
  })
  return { result, effects, step, plan }
}

describe('sending', () => {
  it('keys every send by instance and step so a replay cannot send twice', async () => {
    const { effects } = await runInstance([send(), wait(), send('Day two')])
    const keys = effects.calls
      .filter((c) => c.effect === 'sendEmail')
      .map((c) => c.extra?.idempotencyKey)
    expect(keys).toEqual(['wfi_abc:s0.send', 'wfi_abc:s2.send'])
    expect(idempotencyKey('wfi_abc', 's0.send')).toBe('wfi_abc:s0.send')
  })

  it('loads the contact inside the step, never before it', async () => {
    const { effects, step } = await runInstance([send()])
    // The load is recorded under the send's own step id, so on a replay it is
    // skipped along with the send.
    expect(effects.calls[0]?.effect).toBe('loadContact')
    expect(step.ran).toContain('s0.send')
    expect(step.journal.get('s0.send')).toEqual({ sent: 1 })
  })

  it('does not mail a contact who unsubscribed mid-automation', async () => {
    const { effects } = await runInstance([send()], {
      loadContact: async () => contact({ unsubscribed: true }),
    })
    expect(effects.calls.some((c) => c.effect === 'sendEmail')).toBe(false)
  })

  it('fans out instead of sending when the scope is a cohort', async () => {
    const { effects } = await runInstance([send()], {}, cohort)
    expect(effects.calls.map((c) => c.effect)).toEqual(['fanOutCohort', 'completeEnrollment'])
  })
})

describe('replay', () => {
  it('does not re-run a memoised step', async () => {
    const plan = compilePlanOrThrow('instance', [send(), tag()], { version: 3 })
    const effects = fakeEffects()
    const step = new FakeWorkflowStep()
    const run = () =>
      interpret({
        plan,
        runtime: new WorkflowsStepRuntime(step),
        effects,
        scope: member,
        instanceId: 'wfi_abc',
        fingerprint: plan.fingerprint,
      })

    const first = await run()
    const sends = effects.calls.filter((c) => c.effect === 'sendEmail').length
    const second = await run()

    expect(second.trace).toEqual(first.trace)
    expect(effects.calls.filter((c) => c.effect === 'sendEmail').length).toBe(sends)
    expect(step.ran).toEqual(['s0.send', 's0.send#advance', 's1.tag', 's1.tag#advance'])
  })

  it('refuses to run against a plan it was not started on', async () => {
    const plan = compilePlanOrThrow('instance', [send()], { version: 3 })
    await expect(
      interpret({
        plan,
        runtime: new WorkflowsStepRuntime(new FakeWorkflowStep()),
        effects: fakeEffects(),
        scope: member,
        instanceId: 'wfi_abc',
        fingerprint: 'deadbeef',
      }),
    ).rejects.toBeInstanceOf(PlanFingerprintMismatch)
  })
})

describe('branching', () => {
  it('follows the chosen arm and skips the other in instance mode', async () => {
    const { result } = await runInstance([branch([send()], [tag()]), wait()], {})
    expect(result.trace).toEqual(['s0.branch', 's0.branch.then.s0.send', 's1.wait'])
  })

  it('follows the otherwise arm when the predicate misses', async () => {
    const { result } = await runInstance([branch([send()], [tag()]), wait()], {
      evaluateBranch: async () => ({ matched: false }),
    })
    expect(result.trace).toEqual(['s0.branch', 's0.branch.otherwise.s0.tag', 's1.wait'])
  })

  it('visits every ordinal in cohort mode, because both arms hold people', async () => {
    const { result, effects } = await runInstance([branch([send()], [tag()]), wait()], {}, cohort)
    expect(result.trace).toEqual([
      's0.branch',
      's0.branch.then.s0.send',
      's0.branch.otherwise.s0.tag',
      's1.wait',
    ])
    // The branch moves its own people, so no generic advance follows it.
    expect(effects.calls.filter((c) => c.effect === 'updateCohortBranch')).toHaveLength(1)
    expect(
      effects.calls.filter((c) => c.effect === 'advance').map((c) => c.extra?.toOrdinal),
    ).toEqual([3, 3])
  })
})

describe('exit', () => {
  it('ends an instance run and completes the enrollment', async () => {
    const { result, effects } = await runInstance([send(), { type: 'exit' }, tag()])
    expect(result.trace).toEqual(['s0.send', 's1.exit'])
    expect(result.status).toBe('exited')
    expect(effects.calls.at(-1)?.effect).toBe('completeEnrollment')
  })

  it('does not end a cohort pass, because only some of its people left', async () => {
    const { result } = await runInstance([branch([{ type: 'exit' }], [tag()]), wait()], {}, cohort)
    expect(result.trace).toContain('s1.wait')
    expect(result.status).toBe('completed')
  })
})

describe('waiting', () => {
  it('parses the duration and sleeps under the step id', async () => {
    const { step } = await runInstance([wait('1h30m')])
    expect(step.slept).toEqual([{ id: 's0.wait', ms: 5_400_000 }])
  })

  it('rejects a duration it cannot parse rather than guessing', async () => {
    await expect(runInstance([wait('soon')])).rejects.toThrow('unparseable duration')
  })

  it('treats a wait_until timeout as a continue, not a drop-out', async () => {
    const { result, effects } = await runInstance([
      { type: 'wait_until', event: 'purchase', timeout: '7d' },
      tag(),
    ])
    expect(result.trace).toEqual(['s0.wait_until', 's1.tag'])
    expect(effects.calls.some((c) => c.effect === 'tagContact')).toBe(true)
  })
})

describe('invariants', () => {
  it('refuses a cohort scope on a selected-walk plan', async () => {
    const plan = compilePlanOrThrow('instance', [send()], { version: 3 })
    await expect(
      interpret({
        plan,
        runtime: new WorkflowsStepRuntime(new FakeWorkflowStep()),
        effects: fakeEffects(),
        scope: cohort,
        instanceId: 'wfi_abc',
        fingerprint: plan.fingerprint,
      }),
    ).rejects.toThrow("needs a 'linear' plan")
  })

  it('fails the step that tries to carry a payload between steps', async () => {
    await expect(
      runInstance([send()], {
        sendEmail: async () => ({ sent: 1, body: 'x'.repeat(20_000) }) as any,
      }),
    ).rejects.toBeInstanceOf(StepResultTooLarge)
  })

  it('names the step and the budget when it does', async () => {
    const error: StepResultTooLarge = await runInstance([send()], {
      sendEmail: async () => ({ sent: 1, body: 'x'.repeat(20_000) }) as any,
    }).then(
      () => {
        throw new Error('expected the size guard to fire')
      },
      (e) => e as StepResultTooLarge,
    )
    expect(error.stepId).toBe('s0.send')
    expect(error.budget).toBe(8_192)
    expect(error.message).toContain('load the data inside the step')
  })
})
