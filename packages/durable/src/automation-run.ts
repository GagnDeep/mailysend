import type { Queue, Sql } from '@mailysend/platform'
import { compileExpression } from '@mailysend/segments'
import type {
  AdvanceInput,
  AutomationContact,
  AutomationEffects,
  BranchInput,
  FanOutInput,
  InstancePayload,
  SendInput,
  StepScope,
  TagInput,
  WebhookInput,
} from '@mailysend/workflows'
import { compilePlanOrThrow, guardPayload, SchedulerDriver } from '@mailysend/workflows'
import { Actor } from './base.ts'

/**
 * The automation runner.
 *
 * One actor runs one automation's instances — cohort or per-contact — and it
 * runs them *inside* the actor rather than from a queue consumer, because the
 * scheduler needs three things an actor is the only place to get: durable
 * storage for the journal, an alarm for the sleeps, and a single serialisation
 * point so a resume and a fresh start cannot interleave on the same instance.
 *
 * Why not Cloudflare Workflows here, when `@mailysend/workflows` exports an
 * `AutomationWorkflow` built for exactly that? Because Workflows exists only on
 * the Cloudflare target, and an automation that keeps exact timing on one
 * runtime and quantises on the other is a behavioural difference that would
 * show up as a support ticket, not as a build error. The interpreter is shared;
 * this class is its scheduler-driver shell, and the Workflows shell stays
 * exported for a deployment that wants to opt into it.
 *
 * The effects below reach for `this.env` — the Durable Object's own bindings,
 * which are the Worker's bindings. That is what keeps this class runnable on
 * both targets: it never needs a closure handed to it at construction time,
 * which a Durable Object could not receive anyway.
 */
export class AutomationRunActor extends Actor {
  #driver(): SchedulerDriver {
    return new SchedulerDriver({
      storage: this.storage,
      setAlarm: async (at: number) => {
        const existing = await this.storage.getAlarm()
        if (existing === null || existing > at) await this.storage.setAlarm(at)
      },
      loadSteps: (input) => this.#loadSteps(input),
      effects: this.#effects(),
    })
  }

  get #sql(): Sql {
    return this.env.DB as Sql
  }

  async #loadSteps(input: { workspaceId: string; automationId: string; version: number }): Promise<{
    steps: unknown[]
    mode: 'cohort' | 'instance'
  }> {
    const row = await this.#sql
      .prepare(
        `SELECT v.steps, a.mode
           FROM automation_versions v
           JOIN automations a ON a.id = v.automation_id AND a.workspace_id = v.workspace_id
          WHERE v.workspace_id = ? AND v.automation_id = ? AND v.version = ?`,
      )
      .bind(input.workspaceId, input.automationId, input.version)
      .first<{ steps: string; mode: 'cohort' | 'instance' }>()
    if (!row) throw new Error(`automation ${input.automationId} has no version ${input.version}`)
    return { steps: JSON.parse(row.steps) as unknown[], mode: row.mode }
  }

  /**
   * Starts one run. The instance id is the caller's, and it is deterministic —
   * `enr_<automation>_<contact>` for a person, `<automation>:<cohort>` for a
   * set — so a redelivered trigger resumes the run that already exists instead
   * of starting a second one beside it.
   */
  async start(payload: InstancePayload, instanceId: string): Promise<{ wakeAt: number | null }> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const existing = await this.storage.get(`instance:${instanceId}`)
      if (existing) return { wakeAt: null }
      // Callers that do not compile plans — the cohort actor, the trigger
      // consumer — send an empty fingerprint and get the published one. A
      // caller that *does* send one keeps it, because that is the check that
      // stops an in-flight run reattaching to an edited version.
      const started = payload.fingerprint
        ? payload
        : { ...payload, fingerprint: await this.#fingerprint(payload) }
      const result = await this.#driver().start(guardPayload(started), instanceId)
      return { wakeAt: result.wakeAt }
    })
  }

  async #fingerprint(payload: InstancePayload): Promise<string> {
    const loaded = await this.#loadSteps(payload)
    return compilePlanOrThrow(loaded.mode, loaded.steps, { version: payload.version }).fingerprint
  }

  /** Resumes whatever the alarm was set for. */
  async alarm(): Promise<void> {
    const { next } = await this.#driver().tick()
    if (next !== null) await this.storage.setAlarm(next)
  }

  /**
   * Fails fast on a plan that will not compile, before anything is enrolled.
   * The API calls this on publish so a broken automation is a 422 at edit time
   * rather than a silent no-op an hour later.
   */
  async validate(steps: unknown[], mode: 'cohort' | 'instance', version: number): Promise<void> {
    compilePlanOrThrow(mode, steps, { version })
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  #effects(): AutomationEffects {
    const sql = this.#sql
    const env = this.env

    /** Sends are handed to the normal accept path, never composed here. */
    const sendQueue = env.AUTOMATION_QUEUE as Queue<Record<string, unknown>> | undefined

    const enrollmentWhere = (scope: StepScope): { clause: string; args: unknown[] } =>
      scope.kind === 'member'
        ? {
            clause: `workspace_id = ? AND automation_id = ? AND contact_id = ? AND status = 'active'`,
            args: [scope.workspaceId, scope.automationId, scope.contactId],
          }
        : {
            clause: `workspace_id = ? AND automation_id = ? AND cohort = ? AND status = 'active' AND current_step = ?`,
            args: [scope.workspaceId, scope.automationId, scope.cohort, scope.ordinal],
          }

    return {
      async loadContact(scope): Promise<AutomationContact | null> {
        const row = await sql
          .prepare(
            `SELECT id, email, first_name, last_name, unsubscribed, data
               FROM contacts WHERE workspace_id = ? AND id = ?`,
          )
          .bind(scope.workspaceId, scope.contactId)
          .first<{
            id: string
            email: string
            first_name: string | null
            last_name: string | null
            unsubscribed: number
            data: string | null
          }>()
        if (!row) return null
        return {
          id: row.id,
          email: row.email,
          first_name: row.first_name,
          last_name: row.last_name,
          unsubscribed: Boolean(row.unsubscribed),
          data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : null,
        }
      },

      async sendEmail(input: SendInput): Promise<{ sent: number }> {
        // An unsubscribed contact is dropped here rather than at the wire, so
        // the enrollment still advances: an automation must not stall on
        // somebody who left.
        if (input.contact.unsubscribed) return { sent: 0 }
        await sendQueue?.send({
          type: 'automation-send',
          workspace_id: input.scope.workspaceId,
          automation_id: input.scope.automationId,
          contact_id: input.contact.id,
          step: input.step,
          idempotency_key: input.idempotencyKey,
        })
        return { sent: 1 }
      },

      async fanOutCohort(input: FanOutInput): Promise<{ enqueued: number }> {
        // The cohort is not enumerated here. One message starts a paged walk in
        // the consumer, which is what keeps this call O(1) whether the cohort
        // holds fifty people or twenty-five thousand.
        await sendQueue?.send({
          type: 'automation-fanout',
          workspace_id: input.scope.workspaceId,
          automation_id: input.scope.automationId,
          cohort: input.scope.cohort,
          ordinal: input.scope.ordinal,
          step: input.step,
          idempotency_prefix: input.idempotencyPrefix,
          after: '',
        })
        return { enqueued: 0 }
      },

      async evaluateBranch(input: BranchInput): Promise<{ matched: boolean }> {
        if (input.scope.kind !== 'member') return { matched: false }
        const compiled = compileExpression(input.step.condition)
        const row = await sql
          .prepare(
            `SELECT 1 FROM contacts
              WHERE workspace_id = ? AND id = ? AND (${compiled.sql})`,
          )
          .bind(input.scope.workspaceId, input.scope.contactId, ...compiled.params)
          .first()
        return { matched: row !== null }
      },

      async updateCohortBranch(
        input: BranchInput,
      ): Promise<{ matched: number; unmatched: number }> {
        if (input.scope.kind !== 'cohort') return { matched: 0, unmatched: 0 }
        const compiled = compileExpression(input.step.condition)
        const where = enrollmentWhere(input.scope)

        // Matched first, then "everyone still parked here" — running it the
        // other way round would move the matched set twice.
        const matched = await sql
          .prepare(
            `UPDATE automation_enrollments SET current_step = ?
              WHERE ${where.clause}
                AND contact_id IN (
                      SELECT id FROM contacts
                       WHERE workspace_id = ? AND (${compiled.sql}))`,
          )
          .bind(input.thenOrdinal ?? -1, ...where.args, input.scope.workspaceId, ...compiled.params)
          .run()

        const unmatched = await sql
          .prepare(
            input.otherwiseOrdinal === null
              ? `UPDATE automation_enrollments
                    SET status = 'completed', completed_at = datetime('now')
                  WHERE ${where.clause}`
              : `UPDATE automation_enrollments SET current_step = ?
                  WHERE ${where.clause}`,
          )
          .bind(
            ...(input.otherwiseOrdinal === null
              ? where.args
              : [input.otherwiseOrdinal, ...where.args]),
          )
          .run()

        return { matched: matched.meta.changes, unmatched: unmatched.meta.changes }
      },

      async tagContact(input: TagInput): Promise<{ tagged: number }> {
        const where = enrollmentWhere(input.scope)
        const add = JSON.stringify(input.step.add ?? [])
        const remove = JSON.stringify(input.step.remove ?? [])

        // Tags live in `contacts.data.tags`, and the whole edit is one SQL
        // statement over the set. Reading twenty-five thousand rows into a
        // worker to push a string onto an array is the version of this that
        // does not survive contact with a real audience.
        const result = await sql
          .prepare(
            `UPDATE contacts
                SET data = json_set(COALESCE(data, json('{}')), '$.tags', (
                      SELECT json_group_array(tag) FROM (
                        SELECT value AS tag
                          FROM json_each(COALESCE(json_extract(contacts.data, '$.tags'), json('[]')))
                         WHERE value NOT IN (SELECT value FROM json_each(?))
                         UNION
                        SELECT value FROM json_each(?)
                      )
                    )),
                    updated_at = datetime('now')
              WHERE workspace_id = ?
                AND id IN (SELECT contact_id FROM automation_enrollments WHERE ${where.clause})`,
          )
          .bind(remove, add, input.scope.workspaceId, ...where.args)
          .run()
        return { tagged: result.meta.changes }
      },

      async callWebhook(input: WebhookInput): Promise<{ status: number }> {
        const response = await fetch(input.step.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'automation.step',
            automation_id: input.scope.automationId,
            step_id: input.stepId,
            scope: input.scope.kind,
            contact: input.contact,
          }),
          signal: AbortSignal.timeout(10_000),
        })
        // The body is not read: an automation webhook is a notification, and
        // reading an unbounded response inside a step is how one slow endpoint
        // becomes everybody's stalled automation.
        return { status: response.status }
      },

      async advance(input: AdvanceInput): Promise<{ moved: number }> {
        const where = enrollmentWhere(input.scope)
        const result = await sql
          .prepare(`UPDATE automation_enrollments SET current_step = ? WHERE ${where.clause}`)
          .bind(input.toOrdinal, ...where.args)
          .run()
        return { moved: result.meta.changes }
      },

      async completeEnrollment(input: { scope: StepScope }): Promise<{ completed: number }> {
        const where = enrollmentWhere(input.scope)
        const result = await sql
          .prepare(
            `UPDATE automation_enrollments
                SET status = 'completed', completed_at = datetime('now')
              WHERE ${where.clause}`,
          )
          .bind(...where.args)
          .run()
        return { completed: result.meta.changes }
      },
    }
  }
}
