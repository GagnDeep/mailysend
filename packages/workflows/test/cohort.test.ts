import { describe, expect, it } from 'vitest'
import { createEnrollmentEffects } from '../src/cohort.ts'
import type { BranchStep, StepScope } from '../src/effects.ts'
import { fakeSql } from './helpers.ts'

const cohortScope: StepScope = {
  kind: 'cohort',
  workspaceId: 'ws_default',
  automationId: 'aut_00000000000000000000000001',
  version: 3,
  cohort: '2026-09-09/14',
  ordinal: 2,
}

const memberScope: StepScope = {
  kind: 'member',
  workspaceId: 'ws_default',
  automationId: 'aut_00000000000000000000000001',
  version: 3,
  contactId: 'con_00000000000000000000000001',
  ordinal: 2,
}

const step: BranchStep = {
  type: 'branch',
  condition: 'opened_last_30d and data.plan = "pro"',
  // biome-ignore lint/suspicious/noThenProperty: `then` is the branch step's field name in @mailysend/contracts.
  then: [],
}

describe('cohort branch', () => {
  it('partitions the set with one UPDATE per arm', async () => {
    const { sql, captured } = fakeSql(null, 17)
    const effects = createEnrollmentEffects(sql, { now: () => new Date('2026-09-09T14:00:00Z') })

    const result = await effects.updateCohortBranch({
      scope: cohortScope,
      step,
      stepId: 's2.branch',
      thenOrdinal: 3,
      otherwiseOrdinal: 5,
    })

    expect(captured).toHaveLength(2)
    expect(result).toEqual({ matched: 17, unmatched: 17 })
  })

  it('binds every user-supplied value, including the segment expression', async () => {
    const { sql, captured } = fakeSql()
    const effects = createEnrollmentEffects(sql, { now: () => new Date('2026-09-09T14:00:00Z') })
    await effects.updateCohortBranch({
      scope: cohortScope,
      step,
      stepId: 's2.branch',
      thenOrdinal: 3,
      otherwiseOrdinal: 5,
    })

    const matched = captured[0]!
    // The condition text names a custom field and a duration; neither may
    // appear in the query, only in the bound parameters.
    expect(matched.query).not.toContain('pro')
    expect(matched.query).not.toContain('30')
    expect(matched.query).not.toContain('plan')
    expect(matched.params).toContain('$."plan"')
    expect(matched.params).toContain('pro')
  })

  it('binds the parameters in textual order, SET value first', async () => {
    const { sql, captured } = fakeSql()
    const effects = createEnrollmentEffects(sql, { now: () => new Date('2026-09-09T14:00:00Z') })
    await effects.updateCohortBranch({
      scope: cohortScope,
      // biome-ignore lint/suspicious/noThenProperty: `then` is the branch step's field name in @mailysend/contracts.
      step: { type: 'branch', condition: 'unsubscribed = false', then: [] },
      stepId: 's2.branch',
      thenOrdinal: 3,
      otherwiseOrdinal: 5,
    })

    expect(captured[0]?.params).toEqual([
      3,
      'ws_default',
      'aut_00000000000000000000000001',
      3,
      '2026-09-09/14',
      'active',
      2,
      'ws_default',
      0,
    ])
    expect(captured[1]?.params).toEqual([
      5,
      'ws_default',
      'aut_00000000000000000000000001',
      3,
      '2026-09-09/14',
      'active',
      2,
    ])
  })

  it('needs no predicate on the complement, because the matches have already left', async () => {
    const { sql, captured } = fakeSql()
    const effects = createEnrollmentEffects(sql, { now: () => new Date('2026-09-09T14:00:00Z') })
    await effects.updateCohortBranch({
      scope: cohortScope,
      step,
      stepId: 's2.branch',
      thenOrdinal: 3,
      otherwiseOrdinal: 5,
    })
    expect(captured[0]?.query).toContain('contact_id IN (SELECT id FROM contacts')
    expect(captured[1]?.query).not.toContain('contact_id IN')
    expect(captured[1]?.query).toContain('current_step = ?')
  })

  it('completes an arm that leads nowhere instead of parking people on null', async () => {
    const { sql, captured } = fakeSql()
    const effects = createEnrollmentEffects(sql, { now: () => new Date('2026-09-09T14:00:00Z') })
    await effects.updateCohortBranch({
      scope: cohortScope,
      step,
      stepId: 's2.branch',
      thenOrdinal: null,
      otherwiseOrdinal: null,
    })
    expect(captured[0]?.query).toContain("status = 'completed'")
    expect(captured[1]?.query).toContain("status = 'completed'")
  })

  it('refuses a member scope, which belongs to evaluateBranch', async () => {
    const { sql } = fakeSql()
    const effects = createEnrollmentEffects(sql)
    await expect(
      effects.updateCohortBranch({
        scope: memberScope,
        step,
        stepId: 's2.branch',
        thenOrdinal: 3,
        otherwiseOrdinal: 5,
      }),
    ).rejects.toThrow('evaluateBranch')
  })
})

describe('instance branch', () => {
  it('asks the database rather than reimplementing the segment language', async () => {
    const { sql, captured } = fakeSql({ matched: 1 })
    const effects = createEnrollmentEffects(sql, { now: () => new Date('2026-09-09T14:00:00Z') })
    const result = await effects.evaluateBranch({
      scope: memberScope,
      step,
      stepId: 's2.branch',
      thenOrdinal: 3,
      otherwiseOrdinal: 5,
    })
    expect(result.matched).toBe(true)
    expect(captured[0]?.query).toContain('FROM contacts')
    expect(captured[0]?.params.slice(0, 2)).toEqual([
      'ws_default',
      'con_00000000000000000000000001',
    ])
  })

  it('reports a miss when no row comes back', async () => {
    const { sql } = fakeSql(null)
    const effects = createEnrollmentEffects(sql)
    const result = await effects.evaluateBranch({
      scope: memberScope,
      step,
      stepId: 's2.branch',
      thenOrdinal: 3,
      otherwiseOrdinal: 5,
    })
    expect(result.matched).toBe(false)
  })
})

describe('enrollment bookkeeping', () => {
  it('advances one row in member scope and a whole ordinal in cohort scope', async () => {
    const { sql, captured } = fakeSql(null, 25_000)
    const effects = createEnrollmentEffects(sql)

    await effects.advance({ scope: memberScope, toOrdinal: 4 })
    expect(captured[0]?.query).toContain('contact_id = ?')
    expect(captured[0]?.query).not.toContain('cohort = ?')

    const moved = await effects.advance({ scope: cohortScope, toOrdinal: 4 })
    expect(captured[1]?.query).toContain('cohort = ?')
    expect(captured[1]?.query).toContain('current_step = ?')
    expect(moved.moved).toBe(25_000)
  })

  it('reads only the contact columns that exist', async () => {
    const { sql, captured } = fakeSql({
      id: 'con_1',
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: null,
      unsubscribed: 0,
      data: '{"plan":"pro"}',
    })
    const effects = createEnrollmentEffects(sql)
    const loaded = await effects.loadContact(memberScope as Extract<StepScope, { kind: 'member' }>)
    expect(captured[0]?.query).toContain('id, email, first_name, last_name, unsubscribed, data')
    expect(loaded).toEqual({
      id: 'con_1',
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: null,
      unsubscribed: false,
      data: { plan: 'pro' },
    })
  })

  it('stamps completed_at when an enrollment ends', async () => {
    const { sql, captured } = fakeSql()
    const effects = createEnrollmentEffects(sql, { now: () => new Date('2026-09-09T14:00:00Z') })
    await effects.completeEnrollment({ scope: memberScope })
    expect(captured[0]?.query).toContain('completed_at = ?')
    expect(captured[0]?.params[0]).toBe('2026-09-09T14:00:00.000Z')
  })
})
