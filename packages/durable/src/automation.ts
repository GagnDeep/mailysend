import { COHORT_MAX } from '@mailysend/core'
import { Actor } from './base.ts'

/**
 * Cohort-mode automation state.
 *
 * The hard limit, stated plainly: Workflows V2 caps concurrent instances at
 * 50,000. A thirty-day drip over 500,000 contacts wants half a million sleeping
 * instances, so per-contact instances are simply not available at audience
 * scale — no amount of engineering makes them so.
 *
 * Cohort mode is the answer: one instance per (automation version, hourly
 * cohort of ≤25,000 contacts). Five hundred thousand contacts over a month is
 * roughly seven hundred instances. `send` becomes broadcast-style fan-out and
 * `branch` becomes a set `UPDATE` through the segment compiler.
 *
 * The trade-off is real and the UI says so: timing quantises to the cohort
 * clock, and a per-contact `wait_until event` is not expressible. Instance mode
 * remains available below 40,000 enrollments, where exact timing is possible.
 */

export { COHORT_MAX, INSTANCE_MODE_MAX_ENROLLMENTS } from '@mailysend/core'

export interface CohortState {
  automationId: string
  workspaceId: string
  version: number
  /** ISO hour, e.g. `2026-09-09/14`. Also the instance id suffix. */
  cohort: string
  size: number
  currentStep: number
  status: 'open' | 'sealed' | 'running' | 'complete'
  openedAt: number
  sealedAt: number | null
}

export class AutomationCohortActor extends Actor {
  /**
   * Adds a contact to the currently open cohort, sealing and starting a new one
   * when it fills. Returns the cohort so the caller can record the enrollment.
   */
  async enroll(input: {
    automationId: string
    workspaceId: string
    version: number
    hour: string
  }): Promise<{
    cohort: string
    sealed: boolean
  }> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const key = `cohort:${input.version}:${input.hour}`
      let state = await this.storage.get<CohortState>(key)
      let sealed = false

      if (!state) {
        state = {
          automationId: input.automationId,
          workspaceId: input.workspaceId,
          version: input.version,
          cohort: input.hour,
          size: 0,
          currentStep: 0,
          status: 'open',
          openedAt: Date.now(),
          sealedAt: null,
        }
      }

      state.size++
      if (state.size >= COHORT_MAX && state.status === 'open') {
        // A full cohort starts immediately rather than waiting for its hour to
        // end: holding 25,000 people back for another 40 minutes would be a
        // worse experience than the quantisation we already accept.
        state.status = 'sealed'
        state.sealedAt = Date.now()
        sealed = true
      }

      await this.storage.put(key, state)
      if (sealed) await this.#startCohort(state)
      else await this.#armHourlySeal()

      return { cohort: input.hour, sealed }
    })
  }

  async advance(cohortKey: string, step: number): Promise<void> {
    const state = await this.storage.get<CohortState>(cohortKey)
    if (!state) return
    state.currentStep = step
    await this.storage.put(cohortKey, state)
  }

  async complete(cohortKey: string): Promise<void> {
    const state = await this.storage.get<CohortState>(cohortKey)
    if (!state) return
    state.status = 'complete'
    await this.storage.put(cohortKey, state)
  }

  async cohorts(): Promise<CohortState[]> {
    return [...(await this.storage.list<CohortState>({ prefix: 'cohort:' })).values()]
  }

  /**
   * Hands a sealed cohort to the runner.
   *
   * The runner is addressed by name rather than through an injected callback,
   * because a Durable Object cannot be handed a closure — its env is the
   * Worker's bindings. `START_COHORT` remains as the seam the unit tests use.
   */
  async #startCohort(state: CohortState) {
    if (this.env.START_COHORT) return this.env.START_COHORT(state)
    const name = ['AutomationRun', state.workspaceId, state.automationId].join(':')
    await this.env.AUTOMATION_RUN?.get(name).start(
      {
        workspaceId: state.workspaceId,
        automationId: state.automationId,
        version: state.version,
        // Filled in by the runner from the published version; the cohort actor
        // deliberately does not compile plans.
        fingerprint: '',
        cohort: state.cohort,
        startOrdinal: 0,
      },
      `${state.automationId}:${state.version}:${state.cohort}`,
    )
  }

  async #armHourlySeal() {
    const nextHour = Math.ceil(Date.now() / 3600_000) * 3600_000 + 30_000
    const existing = await this.storage.getAlarm()
    if (existing === null || existing > nextHour) await this.storage.setAlarm(nextHour)
  }

  /** Seals every cohort whose hour has ended and hands them to the workflow engine. */
  async alarm(): Promise<void> {
    const currentHour = new Date().toISOString().slice(0, 13).replace('T', '/')
    let openRemaining = false

    for (const [key, state] of await this.storage.list<CohortState>({ prefix: 'cohort:' })) {
      if (state.status !== 'open') continue
      if (state.cohort >= currentHour) {
        openRemaining = true
        continue
      }
      state.status = 'sealed'
      state.sealedAt = Date.now()
      await this.storage.put(key, state)
      await this.#startCohort(state)
    }

    if (openRemaining) await this.#armHourlySeal()
  }
}
