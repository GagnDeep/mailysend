import { doName, stableBucket } from '@mailysend/core'
import { INSTANCE_MODE_MAX_ENROLLMENTS } from '@mailysend/durable'
import type { Ctx } from '../context.ts'
import { tenancyFor } from '../context.ts'
import type { Env } from '../env.ts'

/**
 * Automation triggers.
 *
 * A trigger is only ever an *enrollment* decision — it decides who enters, and
 * nothing about what happens next. The step interpreter in
 * `@mailysend/workflows` owns execution, on Workflows or on the scheduler, so
 * the two runtimes cannot drift in behaviour just because they differ in driver.
 */

export interface TriggerJob {
  type: string
  workspace_id: string
  contact_id?: string
  audience_id?: string
  thread_id?: string
  message_id?: string
  data?: Record<string, unknown>
}

export async function handleAutomationTrigger(job: TriggerJob, env: Env): Promise<void> {
  const sql = tenancyFor(env).db(job.workspace_id)

  const { results: automations } = await sql
    .prepare(
      `SELECT a.id, a.mode, a.current_version, a.enrolled_count, t.config
         FROM automations a
         JOIN automation_triggers t ON t.automation_id = a.id AND t.workspace_id = a.workspace_id
        WHERE a.workspace_id = ? AND a.status = 'active' AND t.type = ?`,
    )
    .bind(job.workspace_id, job.type)
    .all<{
      id: string
      mode: string
      current_version: number
      enrolled_count: number
      config: string | null
    }>()

  for (const automation of automations) {
    if (!job.contact_id) continue
    if (!(await matchesFilter(sql, job, triggerFilter(automation.config)))) continue

    // The enrollment id is deterministic, so re-firing the same trigger for the
    // same contact collapses on the unique index rather than starting a second
    // parallel run of the same drip.
    const enrollmentId = `enr_${automation.id}_${job.contact_id}`
    const cohort = currentCohort()
    const inserted = await sql
      .prepare(
        `INSERT INTO automation_enrollments
           (id, workspace_id, automation_id, version, contact_id, cohort, status, current_step, created_at)
         VALUES (?,?,?,?,?,?, 'active', 0, ?)
         ON CONFLICT (workspace_id, automation_id, contact_id) DO NOTHING`,
      )
      .bind(
        enrollmentId,
        job.workspace_id,
        automation.id,
        automation.current_version,
        job.contact_id,
        automation.mode === 'cohort' ? cohort : null,
        new Date().toISOString(),
      )
      .run()
    if (inserted.meta.changes === 0) continue

    // The ceiling is enforced at the API too, but an automation can cross it
    // between edits — a trigger firing is the only place that notices, and
    // silently exceeding it would exhaust the runtime's instance budget for
    // every other automation in the account.
    if (
      automation.mode === 'instance' &&
      automation.enrolled_count >= INSTANCE_MODE_MAX_ENROLLMENTS
    ) {
      console.warn(
        `[automations] ${automation.id} is at the instance-mode ceiling; not enrolling ${job.contact_id}`,
      )
      continue
    }

    if (automation.mode === 'instance') {
      // The instance id is the enrollment id, so a redelivered trigger resumes
      // the run that exists rather than starting a second one beside it.
      await env.AUTOMATION_RUN.get(doName('AutomationRun', job.workspace_id, automation.id)).start(
        {
          workspaceId: job.workspace_id,
          automationId: automation.id,
          version: automation.current_version,
          fingerprint: '',
          contactId: job.contact_id,
          startOrdinal: 0,
        },
        enrollmentId,
      )
    } else {
      const actor = env.AUTOMATION_COHORT.get(
        doName('AutomationCohort', job.workspace_id, automation.id),
      )
      await actor.enroll({
        automationId: automation.id,
        workspaceId: job.workspace_id,
        version: automation.current_version,
        hour: cohort,
      })
    }
  }
}

/**
 * Cohorts are hourly, which is what makes 500k contacts ≈ 720 instances a
 * month. The `YYYY-MM-DD/HH` shape is not cosmetic: `AutomationCohortActor`'s
 * alarm decides which cohorts have closed with a string comparison against a
 * value in this exact format, so a different one here would leave every cohort
 * looking like it belonged to the future and none would ever run.
 */
const currentCohort = (): string => new Date().toISOString().slice(0, 13).replace('T', '/')

/**
 * `automation_triggers.config` holds the whole trigger definition; the segment
 * expression, when there is one, lives under `filter`. Reading it defensively
 * matters because a trigger written by an older version of the UI may not have
 * the key at all, and treating "absent" as "match nothing" would silently stop
 * an automation that had been running.
 */
const triggerFilter = (config: string | null): string | null => {
  if (!config) return null
  try {
    const parsed = JSON.parse(config) as { filter?: unknown }
    return typeof parsed.filter === 'string' ? parsed.filter : null
  } catch {
    return null
  }
}

async function matchesFilter(
  sql: import('@mailysend/platform').Sql,
  job: TriggerJob,
  filter: string | null,
): Promise<boolean> {
  if (!filter) return true
  const { compile, parse } = await import('@mailysend/segments')
  try {
    const compiled = compile(parse(filter), { now: new Date() })
    const row = await sql
      .prepare(`SELECT 1 FROM contacts WHERE workspace_id = ? AND id = ? AND (${compiled.sql})`)
      .bind(job.workspace_id, job.contact_id, ...compiled.params)
      .first()
    return row !== null
  } catch (err) {
    // A filter that no longer parses must not silently enroll everyone. Refusing
    // to enroll is the safe direction: nobody gets mail they did not qualify for.
    console.error(`[automations] filter failed to compile, skipping enrollment`, err)
    return false
  }
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

interface AutomationSendJob {
  type: 'automation-send'
  workspace_id: string
  automation_id: string
  contact_id: string
  step: { template_id?: string; subject?: string; html?: string; text?: string; from?: string }
  idempotency_key: string
}

interface AutomationFanOutJob {
  type: 'automation-fanout'
  workspace_id: string
  automation_id: string
  cohort: string
  ordinal: number
  step: AutomationSendJob['step']
  idempotency_prefix: string
  after: string
}

/** How many of a cohort one queue message walks before handing off to the next. */
const FANOUT_PAGE = 500

/**
 * One automation send.
 *
 * It goes through `acceptEmail` — the same function the public API calls —
 * rather than composing a message here, so an automation send is subject to the
 * same suppression list, the same domain checks and the same idempotency
 * reservation as anything else. The step's own idempotency key is what makes a
 * replayed step collapse onto the message it already produced.
 */
export async function handleAutomationSend(job: AutomationSendJob, env: Env): Promise<void> {
  const ctx = await contextForWorkspace(env, job.workspace_id)
  const contact = await ctx.sql
    .prepare(
      `SELECT id, email, first_name, last_name, unsubscribed, data
         FROM contacts WHERE workspace_id = ? AND id = ?`,
    )
    .bind(job.workspace_id, job.contact_id)
    .first<{
      id: string
      email: string
      first_name: string | null
      last_name: string | null
      unsubscribed: number
      data: string | null
    }>()
  if (!contact || contact.unsubscribed) return

  await sendStep(ctx, job.step, contact, job.automation_id, job.idempotency_key)
}

/**
 * A cohort's `send`, walked in pages.
 *
 * The enrollment set is read by keyset over `contact_id`, one page per queue
 * message, so the memory and CPU of a fan-out are bounded no matter how large
 * the cohort is — and a crash resumes at the last page rather than at the
 * beginning. Each recipient's idempotency key is the step's prefix plus the
 * contact id, so a redelivered page produces no second message.
 */
export async function handleAutomationFanOut(job: AutomationFanOutJob, env: Env): Promise<void> {
  const ctx = await contextForWorkspace(env, job.workspace_id)
  const { results } = await ctx.sql
    .prepare(
      `SELECT c.id, c.email, c.first_name, c.last_name, c.unsubscribed, c.data
         FROM automation_enrollments e
         JOIN contacts c ON c.id = e.contact_id AND c.workspace_id = e.workspace_id
        WHERE e.workspace_id = ? AND e.automation_id = ? AND e.cohort = ?
          AND e.status = 'active' AND e.current_step = ? AND e.contact_id > ?
        ORDER BY e.contact_id ASC LIMIT ?`,
    )
    .bind(job.workspace_id, job.automation_id, job.cohort, job.ordinal, job.after, FANOUT_PAGE)
    .all<{
      id: string
      email: string
      first_name: string | null
      last_name: string | null
      unsubscribed: number
      data: string | null
    }>()

  for (const contact of results) {
    if (contact.unsubscribed) continue
    await sendStep(
      ctx,
      job.step,
      contact,
      job.automation_id,
      `${job.idempotency_prefix}:${contact.id}`,
    )
  }

  if (results.length === FANOUT_PAGE) {
    await env.AUTOMATION_QUEUE.send({ ...job, after: results[results.length - 1]!.id })
  }
}

interface ContactRow {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  data: string | null
}

async function sendStep(
  ctx: Ctx,
  step: AutomationSendJob['step'],
  contact: ContactRow,
  automationId: string,
  idempotencyKey: string,
): Promise<void> {
  const { acceptEmail } = await import('../send/accept.ts')
  const { SendEmailRequest } = await import('@mailysend/contracts')

  const from = step.from ?? (await defaultFrom(ctx))
  if (!from) {
    // Nothing to send *from* is a configuration error, not a transient one:
    // retrying would produce the same result every time until somebody adds a
    // verified domain, so it is logged once and dropped.
    console.error(`[automations] ${automationId} has no from address and no verified domain`)
    return
  }

  const request = SendEmailRequest.parse({
    from,
    to: [contact.email],
    subject: step.subject ?? '',
    ...(step.html ? { html: step.html } : {}),
    ...(step.text ? { text: step.text } : {}),
    ...(step.template_id ? { template_id: step.template_id } : {}),
    template_data: {
      contact: {
        id: contact.id,
        email: contact.email,
        first_name: contact.first_name,
        last_name: contact.last_name,
        ...(contact.data ? (JSON.parse(contact.data) as Record<string, unknown>) : {}),
      },
    },
  })

  await acceptEmail(ctx, request, {
    idempotencyKey,
    automationId,
    contactId: contact.id,
  })
}

/** The first verified domain, as `automations@<domain>`. */
async function defaultFrom(ctx: Ctx): Promise<string | null> {
  const row = await ctx.sql
    .prepare(
      `SELECT name FROM domains
        WHERE workspace_id = ? AND status = 'verified' ORDER BY created_at ASC LIMIT 1`,
    )
    .bind(ctx.workspace.id)
    .first<{ name: string }>()
  return row ? `automations@${row.name}` : null
}

async function contextForWorkspace(env: Env, workspaceId: string): Promise<Ctx> {
  const { buildContext } = await import('../context.ts')
  return buildContext(
    env,
    { workspaceId, environment: 'live', scopes: ['*'] },
    // A queue consumer has no response to outlive, so background work is
    // awaited inline rather than deferred into a context that is about to end.
    (promise) => {
      void promise.catch((err) => console.error('[automations] background', err))
    },
  )
}

export { stableBucket }
