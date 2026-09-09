import { newId } from '@mailysend/core'
import type { ActorStorage } from '@mailysend/platform'
import type { InterpretResult } from './interpreter.ts'
import { compilePlanOrThrow } from './plan.ts'
import type { EventOutcome, EventStepRuntime, InstancePayload } from './runtime.ts'
import { guardPayload } from './runtime.ts'
import type { AutomationWorkflowDeps } from './workflow.ts'
import { runPlan } from './workflow.ts'

/**
 * The Node driver.
 *
 * `capabilities.workflows` is false on Node — there is no Workflows engine —
 * so automations run off alarms instead. The temptation is to write a second,
 * simpler interpreter for the self-hosted path; that is exactly how the two
 * runtimes end up sending different mail from the same automation, and nobody
 * finds out until a customer migrates.
 *
 * So this driver does not interpret anything. It reimplements only the three
 * things Workflows gives us for free: a journal so `do` runs once, a wake time
 * so `sleep` suspends instead of blocking, and replay-from-the-top so a resumed
 * instance reaches its suspension point through the same code path it took the
 * first time. Replay is the load-bearing part — it is why `interpret` needs no
 * idea which driver it is under.
 */

class Suspend extends Error {
  readonly wakeAt: number

  constructor(wakeAt: number) {
    super(`suspended until ${new Date(wakeAt).toISOString()}`)
    this.name = 'Suspend'
    this.wakeAt = wakeAt
  }
}

interface JournalEntry {
  v: unknown
}

interface InstanceRecord {
  payload: InstancePayload
  status: 'running' | 'sleeping' | 'done' | 'failed'
  wakeAt: number | null
  error?: string
}

/** Lexicographic order is time order, so `list({ end })` is a range query. */
const dueKey = (wakeAt: number, instanceId: string) =>
  `due:${String(wakeAt).padStart(15, '0')}:${instanceId}`

const instanceKey = (instanceId: string) => `inst:${instanceId}`
const journalKey = (instanceId: string, stepId: string) => `j:${instanceId}:${stepId}`
const eventKey = (instanceId: string, name: string) => `ev:${instanceId}:${name}`

export class SchedulerStepRuntime implements EventStepRuntime {
  #storage: ActorStorage
  #instanceId: string
  #now: number

  constructor(storage: ActorStorage, instanceId: string, now: number) {
    this.#storage = storage
    this.#instanceId = instanceId
    this.#now = now
  }

  async do<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const key = journalKey(this.#instanceId, id)
    const recorded = await this.#storage.get<JournalEntry>(key)
    if (recorded !== undefined) return recorded.v as T
    const value = await fn()
    await this.#storage.put(key, { v: value } satisfies JournalEntry)
    return value
  }

  async sleep(id: string, ms: number): Promise<void> {
    return this.#suspendUntil(id, this.#now + ms)
  }

  async sleepUntil(id: string, at: Date): Promise<void> {
    return this.#suspendUntil(id, at.getTime())
  }

  async waitForEvent<T = unknown>(
    id: string,
    name: string,
    timeoutMs: number,
  ): Promise<EventOutcome<T>> {
    const delivered = await this.#storage.get<JournalEntry>(eventKey(this.#instanceId, name))
    if (delivered !== undefined) return { received: true, payload: delivered.v as T }

    const key = journalKey(this.#instanceId, id)
    const recorded = await this.#storage.get<JournalEntry>(key)
    const deadline = recorded === undefined ? this.#now + timeoutMs : (recorded.v as number)
    if (recorded === undefined) await this.#storage.put(key, { v: deadline } satisfies JournalEntry)
    if (this.#now >= deadline) return { received: false }
    throw new Suspend(deadline)
  }

  /**
   * The wake time is journalled on the first pass so a replay resolves against
   * the deadline the instance originally chose. Recomputing it from `now` would
   * push the deadline forward on every replay, and a `wait 1h` that is replayed
   * hourly would never elapse.
   */
  async #suspendUntil(id: string, proposed: number): Promise<void> {
    const key = journalKey(this.#instanceId, id)
    const recorded = await this.#storage.get<JournalEntry>(key)
    const wakeAt = recorded === undefined ? proposed : (recorded.v as number)
    if (recorded === undefined) await this.#storage.put(key, { v: wakeAt } satisfies JournalEntry)
    if (this.#now >= wakeAt) return
    throw new Suspend(wakeAt)
  }
}

export interface SchedulerDriverOptions extends AutomationWorkflowDeps {
  storage: ActorStorage
  now?: () => number
  /** Set by the actor so a suspension re-arms the alarm. Optional in tests. */
  setAlarm?: (at: number) => Promise<void>
}

export interface StartResult {
  instanceId: string
  result: InterpretResult | null
  wakeAt: number | null
}

export class SchedulerDriver {
  readonly kind = 'scheduler' as const

  #options: SchedulerDriverOptions

  constructor(options: SchedulerDriverOptions) {
    this.#options = options
  }

  get #now(): number {
    return (this.#options.now ?? Date.now)()
  }

  async start(
    payload: InstancePayload,
    instanceId: string = newId('enrollment'),
  ): Promise<StartResult> {
    await this.#options.storage.put(instanceKey(instanceId), {
      payload: guardPayload(payload),
      status: 'running',
      wakeAt: null,
    } satisfies InstanceRecord)
    return this.resume(instanceId)
  }

  /** Runs the instance from the top; the journal makes everything before the
   *  suspension point a replay. */
  async resume(instanceId: string): Promise<StartResult> {
    const { storage } = this.#options
    const record = await storage.get<InstanceRecord>(instanceKey(instanceId))
    if (!record) throw new Error(`no scheduler instance '${instanceId}'`)
    if (record.status === 'done' || record.status === 'failed') {
      return { instanceId, result: null, wakeAt: null }
    }

    if (record.wakeAt !== null) await storage.delete(dueKey(record.wakeAt, instanceId))

    const now = this.#now
    const loaded = await this.#options.loadSteps({
      workspaceId: record.payload.workspaceId,
      automationId: record.payload.automationId,
      version: record.payload.version,
    })
    const plan = compilePlanOrThrow(loaded.mode, loaded.steps, { version: record.payload.version })

    try {
      const result = await runPlan({
        plan,
        runtime: new SchedulerStepRuntime(storage, instanceId, now),
        effects: this.#options.effects,
        payload: record.payload,
        instanceId,
      })
      await storage.put(instanceKey(instanceId), { ...record, status: 'done', wakeAt: null })
      return { instanceId, result, wakeAt: null }
    } catch (err) {
      if (!(err instanceof Suspend)) {
        // Kept rather than rethrown into an alarm that would retry forever: a
        // failed instance is a thing an operator has to be able to see.
        await storage.put(instanceKey(instanceId), {
          ...record,
          status: 'failed',
          wakeAt: null,
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
      await storage.put(instanceKey(instanceId), {
        ...record,
        status: 'sleeping',
        wakeAt: err.wakeAt,
      })
      await storage.put(dueKey(err.wakeAt, instanceId), instanceId)
      await this.#arm(err.wakeAt)
      return { instanceId, result: null, wakeAt: err.wakeAt }
    }
  }

  /** Delivers a `wait_until` event. The instance wakes on the next tick. */
  async deliverEvent(instanceId: string, name: string, payload: unknown): Promise<void> {
    const { storage } = this.#options
    await storage.put(eventKey(instanceId, name), { v: payload } satisfies JournalEntry)
    const record = await storage.get<InstanceRecord>(instanceKey(instanceId))
    if (record?.status !== 'sleeping') return
    if (record.wakeAt !== null) await storage.delete(dueKey(record.wakeAt, instanceId))
    const now = this.#now
    await storage.put(instanceKey(instanceId), { ...record, wakeAt: now })
    await storage.put(dueKey(now, instanceId), instanceId)
    await this.#arm(now)
  }

  /** Resumes everything due. Called from the actor's alarm. */
  async tick(): Promise<{ resumed: string[]; next: number | null }> {
    const { storage } = this.#options
    const now = this.#now
    const due = await storage.list<string>({
      prefix: 'due:',
      end: `due:${String(now).padStart(15, '0')}~`,
      limit: 100,
    })

    const resumed: string[] = []
    for (const instanceId of due.values()) {
      await this.resume(instanceId)
      resumed.push(instanceId)
    }

    const remaining = await storage.list<string>({ prefix: 'due:', limit: 1 })
    const nextKey = [...remaining.keys()][0]
    const next = nextKey === undefined ? null : Number(nextKey.split(':')[1])
    if (next !== null) await this.#arm(next)
    return { resumed, next }
  }

  async #arm(at: number): Promise<void> {
    if (this.#options.setAlarm) return this.#options.setAlarm(at)
    const existing = await this.#options.storage.getAlarm()
    if (existing === null || at < existing) await this.#options.storage.setAlarm(at)
  }
}
