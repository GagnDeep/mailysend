import { describe, expect, it } from 'vitest'
import { selectDriver } from '../src/index.ts'
import { interpret } from '../src/interpreter.ts'
import { compilePlanOrThrow } from '../src/plan.ts'
import type { InstancePayload } from '../src/runtime.ts'
import { SchedulerDriver } from '../src/scheduler.ts'
import { AutomationWorkflow, WorkflowsStepRuntime } from '../src/workflow.ts'
import { FakeWorkflowStep, fakeEffects, memoryStorage } from './helpers.ts'

const steps = [
  { type: 'send', subject: 'Welcome', html: '<p>hi</p>' },
  { type: 'wait', duration: '1d' },
  {
    type: 'branch',
    condition: 'opened_last_30d',
    // biome-ignore lint/suspicious/noThenProperty: `then` is the branch step's field name in @mailysend/contracts.
    then: [
      { type: 'send', subject: 'Nice' },
      { type: 'wait', duration: '2h' },
    ],
    otherwise: [{ type: 'tag', add: ['cold'] }],
  },
  { type: 'webhook', url: 'https://example.com/hook' },
]

const payload: InstancePayload = {
  workspaceId: 'ws_default',
  automationId: 'aut_00000000000000000000000001',
  version: 3,
  fingerprint: compilePlanOrThrow('instance', steps, { version: 3 }).fingerprint,
  contactId: 'con_00000000000000000000000001',
  startOrdinal: 0,
}

const loadSteps = async () => ({ steps, mode: 'instance' as const })

/** Runs the plan the way Workflows does: one pass, sleeps resolve at once. */
const runOnWorkflows = async () => {
  const plan = compilePlanOrThrow('instance', steps, { version: 3 })
  const effects = fakeEffects()
  const result = await interpret({
    plan,
    runtime: new WorkflowsStepRuntime(new FakeWorkflowStep()),
    effects,
    scope: {
      kind: 'member',
      workspaceId: payload.workspaceId,
      automationId: payload.automationId,
      version: payload.version,
      contactId: payload.contactId!,
    },
    instanceId: 'wfi_parity',
    fingerprint: payload.fingerprint,
  })
  return { result, effects }
}

/** Runs the same plan off alarms, advancing a fake clock past each suspension. */
const runOnScheduler = async () => {
  const storage = memoryStorage()
  const effects = fakeEffects()
  let now = Date.parse('2026-09-09T14:00:00.000Z')
  const driver = new SchedulerDriver({ storage, effects, loadSteps, now: () => now })

  let state = await driver.start(payload, 'wfi_parity')
  const suspensions: number[] = []
  while (state.wakeAt !== null) {
    suspensions.push(state.wakeAt)
    now = state.wakeAt
    state = await driver.resume(state.instanceId)
  }
  return { result: state.result, effects, suspensions, storage, driver }
}

describe('one interpreter, two drivers', () => {
  it('produces an identical step trace on Workflows and on the scheduler', async () => {
    const workflows = await runOnWorkflows()
    const scheduler = await runOnScheduler()
    expect(scheduler.result?.trace).toEqual(workflows.result.trace)
    expect(scheduler.result?.status).toBe(workflows.result.status)
  })

  it('produces an identical sequence of effects', async () => {
    const workflows = await runOnWorkflows()
    const scheduler = await runOnScheduler()
    const shape = (calls: { effect: string; stepId?: string; extra?: Record<string, unknown> }[]) =>
      calls.map((c) => `${c.effect}:${c.stepId ?? ''}:${c.extra?.toOrdinal ?? ''}`)
    expect(shape(scheduler.effects.calls)).toEqual(shape(workflows.effects.calls))
  })

  it('runs each effect exactly once despite replaying from the top each wake', async () => {
    const scheduler = await runOnScheduler()
    const sends = scheduler.effects.calls.filter((c) => c.effect === 'sendEmail')
    expect(sends).toHaveLength(2)
    expect(sends.map((c) => c.extra?.idempotencyKey)).toEqual([
      'wfi_parity:s0.send',
      'wfi_parity:s2.branch.then.s0.send',
    ])
  })

  it('suspends once per wait, at the time the wait asked for', async () => {
    const scheduler = await runOnScheduler()
    const start = Date.parse('2026-09-09T14:00:00.000Z')
    expect(scheduler.suspensions).toEqual([start + 86_400_000, start + 86_400_000 + 7_200_000])
  })
})

describe('scheduler driver', () => {
  it('journals the wake time so a replay does not push the deadline forward', async () => {
    const storage = memoryStorage()
    let now = 1_000_000
    const driver = new SchedulerDriver({
      storage,
      effects: fakeEffects(),
      loadSteps: async () => ({
        steps: [{ type: 'wait', duration: '1h' }],
        mode: 'instance' as const,
      }),
      now: () => now,
    })
    const fingerprint = compilePlanOrThrow('instance', [{ type: 'wait', duration: '1h' }], {
      version: 3,
    }).fingerprint

    const first = await driver.start({ ...payload, fingerprint }, 'wfi_wait')
    expect(first.wakeAt).toBe(1_000_000 + 3_600_000)

    now += 60_000
    const second = await driver.resume('wfi_wait')
    expect(second.wakeAt).toBe(first.wakeAt)

    now = first.wakeAt!
    const third = await driver.resume('wfi_wait')
    expect(third.wakeAt).toBe(null)
    expect(third.result?.status).toBe('completed')
  })

  it('resumes what is due from a tick and re-arms on the next one', async () => {
    const storage = memoryStorage()
    let now = 1_000_000
    const driver = new SchedulerDriver({
      storage,
      effects: fakeEffects(),
      loadSteps: async () => ({
        steps: [
          { type: 'wait', duration: '1h' },
          { type: 'tag', add: ['done'] },
        ],
        mode: 'instance' as const,
      }),
      now: () => now,
    })
    const fingerprint = compilePlanOrThrow(
      'instance',
      [
        { type: 'wait', duration: '1h' },
        { type: 'tag', add: ['done'] },
      ],
      { version: 3 },
    ).fingerprint

    await driver.start({ ...payload, fingerprint }, 'wfi_a')
    expect((await driver.tick()).resumed).toEqual([])

    now += 3_600_000
    expect((await driver.tick()).resumed).toEqual(['wfi_a'])
    expect((await driver.tick()).next).toBe(null)
  })

  it('wakes a wait_until when the event arrives', async () => {
    const eventSteps = [
      { type: 'wait_until', event: 'purchase', timeout: '7d' },
      { type: 'tag', add: ['bought'] },
    ]
    const storage = memoryStorage()
    const effects = fakeEffects()
    let now = 1_000_000
    const driver = new SchedulerDriver({
      storage,
      effects,
      loadSteps: async () => ({ steps: eventSteps, mode: 'instance' as const }),
      now: () => now,
    })
    const fingerprint = compilePlanOrThrow('instance', eventSteps, { version: 3 }).fingerprint

    const started = await driver.start({ ...payload, fingerprint }, 'wfi_evt')
    expect(started.wakeAt).toBe(now + 7 * 86_400_000)

    now += 60_000
    await driver.deliverEvent('wfi_evt', 'purchase', { order: 'ord_1' })
    const ticked = await driver.tick()
    expect(ticked.resumed).toEqual(['wfi_evt'])
    expect(effects.calls.some((c) => c.effect === 'tagContact')).toBe(true)
  })

  it('records a failure rather than retrying it forever', async () => {
    const storage = memoryStorage()
    const driver = new SchedulerDriver({
      storage,
      effects: fakeEffects({
        loadContact: async () => {
          throw new Error('database is on fire')
        },
      }),
      loadSteps: async () => ({
        steps: [{ type: 'send', subject: 'x', html: 'y' }],
        mode: 'instance' as const,
      }),
    })
    const fingerprint = compilePlanOrThrow(
      'instance',
      [{ type: 'send', subject: 'x', html: 'y' }],
      {
        version: 3,
      },
    ).fingerprint

    await expect(driver.start({ ...payload, fingerprint }, 'wfi_bad')).rejects.toThrow('on fire')
    const record = await storage.get<{ status: string; error: string }>('inst:wfi_bad')
    expect(record?.status).toBe('failed')
    expect(record?.error).toContain('on fire')
  })
})

describe('AutomationWorkflow', () => {
  it('interprets steps loaded at run time, with no per-automation code', async () => {
    const effects = fakeEffects()
    const workflow = new AutomationWorkflow({ loadSteps, effects })
    const result = await workflow.run({ payload, instanceId: 'wfi_run' }, new FakeWorkflowStep())
    expect(result.trace[0]).toBe('s0.send')
    expect(result.status).toBe('completed')
  })

  it('refuses an oversized payload before it reaches the engine', async () => {
    const workflow = new AutomationWorkflow({ loadSteps, effects: fakeEffects() })
    await expect(
      workflow.run(
        { payload: { ...payload, contactId: 'x'.repeat(4_000) }, instanceId: 'wfi_big' },
        new FakeWorkflowStep(),
      ),
    ).rejects.toThrow('instance.payload')
  })
})

describe('selectDriver', () => {
  const options = { storage: memoryStorage(), effects: fakeEffects(), loadSteps }

  it('uses Workflows where the runtime has it', () => {
    expect(selectDriver({ workflows: true }, options).kind).toBe('workflows')
  })

  it('falls back to the scheduler on Node, where there is no Workflows engine', () => {
    expect(selectDriver({ workflows: false }, options).kind).toBe('scheduler')
  })
})
