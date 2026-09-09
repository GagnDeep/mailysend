import { ApiError } from '@mailysend/contracts'
import { describe, expect, it } from 'vitest'
import {
  admitInstanceMode,
  COHORT_MAX,
  estimateCohortInstances,
  INSTANCE_MODE_MAX_ENROLLMENTS,
  recommendMode,
  usesWaitUntil,
  WORKFLOWS_V2_MAX_CONCURRENT_INSTANCES,
} from '../src/instance.ts'

describe('the limits are real', () => {
  it('states the Workflows V2 concurrency cap', () => {
    expect(WORKFLOWS_V2_MAX_CONCURRENT_INSTANCES).toBe(50_000)
  })

  it('keeps instance mode below it, with headroom for other automations', () => {
    expect(INSTANCE_MODE_MAX_ENROLLMENTS).toBe(40_000)
    expect(INSTANCE_MODE_MAX_ENROLLMENTS).toBeLessThan(WORKFLOWS_V2_MAX_CONCURRENT_INSTANCES)
  })
})

describe('admitInstanceMode', () => {
  it('admits an automation inside both caps', () => {
    expect(() =>
      admitInstanceMode({ activeEnrollments: 39_999, concurrentInstances: 100 }),
    ).not.toThrow()
  })

  it('refuses the enrollment that would cross 40,000', () => {
    expect(() => admitInstanceMode({ activeEnrollments: 40_000, concurrentInstances: 0 })).toThrow(
      ApiError,
    )
  })

  it('refuses a batch that would cross it in one go', () => {
    expect(() =>
      admitInstanceMode({ activeEnrollments: 30_000, concurrentInstances: 0, adding: 11_000 }),
    ).toThrow(ApiError)
  })

  it('refuses when the account is already at the engine cap, even for a small automation', () => {
    expect(() =>
      admitInstanceMode({
        activeEnrollments: 10,
        concurrentInstances: WORKFLOWS_V2_MAX_CONCURRENT_INSTANCES,
      }),
    ).toThrow(/concurrent/)
  })

  it('answers with the documented error code and points at cohort mode', () => {
    try {
      admitInstanceMode({ activeEnrollments: 50_000, concurrentInstances: 0 })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const api = err as ApiError
      expect(api.code).toBe('automation_scale_exceeded')
      expect(api.status).toBe(422)
      expect(api.param).toBe('mode')
      expect(api.message).toContain('cohort mode')
    }
  })
})

describe('cohort arithmetic', () => {
  it('turns 500,000 contacts over a month into about 720 instances', () => {
    expect(estimateCohortInstances({ contacts: 500_000, spreadHours: 24 * 30 })).toBe(720)
  })

  it('splits a cohort that would exceed COHORT_MAX', () => {
    expect(COHORT_MAX).toBe(25_000)
    expect(estimateCohortInstances({ contacts: 500_000, spreadHours: 1 })).toBe(20)
  })

  it('never returns zero for a real audience', () => {
    expect(estimateCohortInstances({ contacts: 1, spreadHours: 0 })).toBe(1)
  })
})

describe('mode selection', () => {
  it('defaults to cohort, matching the contract', () => {
    expect(recommendMode([{ type: 'send' }, { type: 'wait', duration: '1d' }])).toBe('cohort')
  })

  it('forces instance mode when a step waits for a person, not a clock', () => {
    expect(recommendMode([{ type: 'wait_until', event: 'purchase', timeout: '7d' }])).toBe(
      'instance',
    )
  })

  it('sees a wait_until nested in a branch arm', () => {
    expect(
      usesWaitUntil([
        {
          type: 'branch',
          condition: 'x',
          // biome-ignore lint/suspicious/noThenProperty: `then` is the branch step's field name in @mailysend/contracts.
          then: [{ type: 'branch', condition: 'y', then: [{ type: 'wait_until' }] }],
        },
      ]),
    ).toBe(true)
  })
})
