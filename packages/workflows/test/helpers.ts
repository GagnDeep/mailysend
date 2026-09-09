import type { ActorStorage, Sql, SqlStatement } from '@mailysend/platform'
import type { AutomationContact, AutomationEffects, StepScope } from '../src/effects.ts'
import type { EventOutcome } from '../src/runtime.ts'
import type { WorkflowStepLike } from '../src/workflow.ts'

export class MemoryStorage {
  readonly map = new Map<string, unknown>()
  alarm: number | null = null

  async get(key: string | string[]): Promise<any> {
    if (Array.isArray(key)) {
      const out = new Map<string, unknown>()
      for (const k of key) if (this.map.has(k)) out.set(k, this.map.get(k))
      return out
    }
    return this.map.get(key)
  }

  async put(key: string | Record<string, unknown>, value?: unknown): Promise<void> {
    if (typeof key === 'string') this.map.set(key, structuredClone(value))
    else for (const [k, v] of Object.entries(key)) this.map.set(k, structuredClone(v))
  }

  async delete(key: string | string[]): Promise<any> {
    if (Array.isArray(key)) {
      let n = 0
      for (const k of key) if (this.map.delete(k)) n++
      return n
    }
    return this.map.delete(key)
  }

  async list(
    options: { prefix?: string; start?: string; end?: string; limit?: number } = {},
  ): Promise<any> {
    const keys = [...this.map.keys()]
      .filter((k) => (options.prefix ? k.startsWith(options.prefix) : true))
      .filter((k) => (options.start ? k >= options.start : true))
      .filter((k) => (options.end ? k < options.end : true))
      .sort()
      .slice(0, options.limit ?? Number.POSITIVE_INFINITY)
    return new Map(keys.map((k) => [k, this.map.get(k)]))
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm
  }

  async setAlarm(at: number | Date): Promise<void> {
    this.alarm = typeof at === 'number' ? at : at.getTime()
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null
  }
}

export const memoryStorage = (): ActorStorage => new MemoryStorage() as unknown as ActorStorage

/** Replays like Workflows does: one result per id, sleeps resolve at once. */
export class FakeWorkflowStep implements WorkflowStepLike {
  readonly journal = new Map<string, unknown>()
  readonly ran: string[] = []
  readonly slept: { id: string; ms: number }[] = []
  events: Record<string, unknown> = {}

  async do<T>(name: string, callback: () => Promise<T>): Promise<T> {
    if (this.journal.has(name)) return this.journal.get(name) as T
    this.ran.push(name)
    const value = await callback()
    this.journal.set(name, value)
    return value
  }

  async sleep(name: string, duration: number | string): Promise<void> {
    this.slept.push({ id: name, ms: typeof duration === 'number' ? duration : 0 })
  }

  async sleepUntil(name: string, timestamp: Date | number): Promise<void> {
    this.slept.push({
      id: name,
      ms: typeof timestamp === 'number' ? timestamp : timestamp.getTime(),
    })
  }

  async waitForEvent<T>(name: string, options: { type: string }): Promise<{ payload: T }> {
    this.slept.push({ id: name, ms: 0 })
    if (!(options.type in this.events)) throw new Error('timeout')
    return { payload: this.events[options.type] as T }
  }
}

export interface EffectCall {
  effect: string
  stepId?: string
  scope: StepScope
  extra?: Record<string, unknown>
}

export const contact = (over: Partial<AutomationContact> = {}): AutomationContact => ({
  id: 'con_00000000000000000000000001',
  email: 'ada@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  unsubscribed: false,
  data: null,
  ...over,
})

export interface FakeEffects extends AutomationEffects {
  readonly calls: EffectCall[]
  matches: boolean
}

export const fakeEffects = (over: Partial<AutomationEffects> = {}): FakeEffects => {
  const calls: EffectCall[] = []
  const base: FakeEffects = {
    calls,
    matches: true,
    async loadContact(scope) {
      calls.push({ effect: 'loadContact', scope })
      return contact()
    },
    async sendEmail(input) {
      calls.push({
        effect: 'sendEmail',
        stepId: input.stepId,
        scope: input.scope,
        extra: { idempotencyKey: input.idempotencyKey },
      })
      return { sent: 1 }
    },
    async fanOutCohort(input) {
      calls.push({ effect: 'fanOutCohort', stepId: input.stepId, scope: input.scope })
      return { enqueued: 25_000 }
    },
    async evaluateBranch(input) {
      calls.push({ effect: 'evaluateBranch', stepId: input.stepId, scope: input.scope })
      return { matched: base.matches }
    },
    async updateCohortBranch(input) {
      calls.push({ effect: 'updateCohortBranch', stepId: input.stepId, scope: input.scope })
      return { matched: 10, unmatched: 5 }
    },
    async tagContact(input) {
      calls.push({ effect: 'tagContact', stepId: input.stepId, scope: input.scope })
      return { tagged: 1 }
    },
    async callWebhook(input) {
      calls.push({ effect: 'callWebhook', stepId: input.stepId, scope: input.scope })
      return { status: 200 }
    },
    async advance(input) {
      calls.push({ effect: 'advance', scope: input.scope, extra: { toOrdinal: input.toOrdinal } })
      return { moved: 1 }
    },
    async completeEnrollment(input) {
      calls.push({ effect: 'completeEnrollment', scope: input.scope })
      return { completed: 1 }
    },
    ...over,
  }
  return base
}

export interface CapturedQuery {
  query: string
  params: unknown[]
}

export const fakeSql = (
  rows: Record<string, unknown> | null = null,
  changes = 3,
): { sql: Sql; captured: CapturedQuery[] } => {
  const captured: CapturedQuery[] = []
  const meta = { duration: 0, rows_read: 0, rows_written: 0, last_row_id: 0, changes }
  const sql = {
    prepare(query: string): SqlStatement {
      const entry: CapturedQuery = { query, params: [] }
      const statement: any = {
        bind(...values: unknown[]) {
          entry.params = values
          captured.push(entry)
          return statement
        },
        async first() {
          return rows
        },
        async all() {
          return { results: rows ? [rows] : [], success: true, meta }
        },
        async run() {
          return { success: true, meta }
        },
      }
      return statement as SqlStatement
    },
    async batch() {
      return []
    },
    async exec() {
      return { count: 0, duration: 0 }
    },
  }
  return { sql: sql as unknown as Sql, captured }
}

export const noEvent = (): EventOutcome => ({ received: false })
