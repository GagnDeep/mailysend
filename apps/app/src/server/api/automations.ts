import {
  AutomationStep,
  AutomationTrigger,
  apiError,
  CreateAutomationRequest,
} from '@mailysend/contracts'
import { doName, hourKey, newId } from '@mailysend/core'
import { COHORT_MAX, INSTANCE_MODE_MAX_ENROLLMENTS } from '@mailysend/durable'
import { z } from 'zod'
import { requireRole, requireScope } from '../auth.ts'
import type { Ctx } from '../context.ts'
import { type App, createRouter, json, page, parseLimit, withContext } from './base.ts'

/**
 * `/v1/automations` — drip sequences.
 *
 * The one thing this endpoint refuses to be vague about is scale. Workflows V2
 * caps concurrent instances at 50,000, so a per-contact instance for a
 * thirty-day sequence over a large audience is not something we can build, only
 * something we can decline. `cohort` mode is therefore the default and its
 * trade-offs are stated in the response rather than buried in docs, and
 * `instance` mode fails loudly at its ceiling instead of quietly dropping
 * people out of a sequence they were promised.
 */

const automations: App = createRouter()

automations.use('*', withContext())

interface AutomationRow {
  id: string
  name: string
  status: string
  mode: string
  current_version: number
  enrolled_count: number
  created_at: string
  updated_at: string
}

/** What cohort mode cannot do, said in the response that chose cohort mode. */
const COHORT_CAVEAT = {
  timing: 'quantised' as const,
  message:
    'Cohort mode runs one workflow instance per hourly cohort of up to ' +
    `${COHORT_MAX.toLocaleString('en-US')} contacts, so step timing quantises to the cohort clock ` +
    '(a "wait 1 day" fires on the cohort\'s hour, not on each contact\'s own anniversary) and a ' +
    'per-contact `wait_until event` step is not expressible. Use `instance` mode for exact timing.',
  supports_wait_until_event: false,
}

const INSTANCE_CAVEAT = {
  timing: 'exact' as const,
  message:
    `Instance mode runs one workflow instance per contact and is capped at ${INSTANCE_MODE_MAX_ENROLLMENTS.toLocaleString('en-US')} ` +
    'active enrollments, below the platform limit of 50,000 concurrent instances.',
  supports_wait_until_event: true,
  max_active_enrollments: INSTANCE_MODE_MAX_ENROLLMENTS,
}

const modeInfo = (mode: string) => (mode === 'instance' ? INSTANCE_CAVEAT : COHORT_CAVEAT)

/**
 * Which engine actually advances the steps.
 *
 * The Node runtime has no Workflows engine, so the scheduler drives the same
 * step interpreter instead. Automations work either way, which is why nothing
 * here gates on the feature — but the caller is told, because "why did my wait
 * step fire two minutes late" has a different answer per driver.
 */
const driverFor = (ctx: Ctx) => (ctx.features.workflows ? 'workflows' : 'scheduler')

const toAutomation = (row: AutomationRow, trigger: unknown, steps: unknown[]) => ({
  object: 'automation' as const,
  id: row.id,
  name: row.name,
  status: row.status,
  mode: row.mode,
  trigger,
  steps,
  version: row.current_version,
  enrolled_count: row.enrolled_count,
  created_at: row.created_at,
})

automations.post('/', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'automations:write')
  requireRole(ctx.actor, 'marketer')
  const body = CreateAutomationRequest.parse(await c.req.json())
  const mode = body.mode ?? 'cohort'

  if (mode === 'cohort' && body.steps.some((step) => step.type === 'wait_until')) {
    throw apiError('validation_error', {
      message: `${COHORT_CAVEAT.message} This automation uses a \`wait_until\` step.`,
      param: 'steps',
    })
  }

  const id = newId('automation')
  const now = new Date().toISOString()
  await ctx.sql.batch([
    ctx.sql
      .prepare(
        `INSERT INTO automations
           (id, workspace_id, name, status, mode, current_version, enrolled_count, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, 1, 0, ?, ?)`,
      )
      .bind(id, ctx.workspace.id, body.name, mode, now, now),
    ctx.sql
      .prepare(
        `INSERT INTO automation_versions (id, workspace_id, automation_id, version, steps, created_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .bind(newId('automation'), ctx.workspace.id, id, JSON.stringify(body.steps), now),
    ctx.sql
      .prepare(
        `INSERT INTO automation_triggers (id, workspace_id, automation_id, type, config)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        newId('automation'),
        ctx.workspace.id,
        id,
        body.trigger.type,
        JSON.stringify(body.trigger),
      ),
  ])

  return json({
    object: 'automation',
    id,
    name: body.name,
    status: 'draft',
    mode,
    trigger: body.trigger,
    steps: body.steps,
    version: 1,
    enrolled_count: 0,
    created_at: now,
    execution: modeInfo(mode),
  })
})

automations.get('/', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const cursor = c.req.query('cursor')
  const status = c.req.query('status')
  const rows = await ctx.sql
    .prepare(
      `SELECT id, name, status, mode, current_version, enrolled_count, created_at, updated_at
         FROM automations
        WHERE workspace_id = ?
          ${cursor ? 'AND id < ?' : ''}
          ${status ? 'AND status = ?' : ''}
        ORDER BY id DESC LIMIT ?`,
    )
    .bind(ctx.workspace.id, ...(cursor ? [cursor] : []), ...(status ? [status] : []), limit + 1)
    .all<AutomationRow>()

  return json(
    page(
      rows.results.map((row) => ({
        object: 'automation' as const,
        id: row.id,
        name: row.name,
        status: row.status,
        mode: row.mode,
        version: row.current_version,
        enrolled_count: row.enrolled_count,
        created_at: row.created_at,
      })),
      limit,
    ),
  )
})

automations.get('/:id', async (c) => {
  const ctx = c.get('ctx')
  const { automation, trigger, steps } = await load(ctx, c.req.param('id'))
  return json({
    ...toAutomation(automation, trigger, steps),
    execution: { ...modeInfo(automation.mode), driver: driverFor(ctx) },
  })
})

/** Editing steps writes a new version: step ids are positional and replay by id. */
automations.patch('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'automations:write')
  requireRole(ctx.actor, 'marketer')
  const body = z
    .object({
      name: z.string().min(1).max(200).optional(),
      mode: z.enum(['cohort', 'instance']).optional(),
      trigger: AutomationTrigger.optional(),
      steps: z.array(AutomationStep).min(1).max(100).optional(),
    })
    .parse(await c.req.json())

  const { automation } = await load(ctx, c.req.param('id'))
  const mode = body.mode ?? automation.mode

  if (mode === 'instance' && automation.enrolled_count > INSTANCE_MODE_MAX_ENROLLMENTS) {
    throw apiError('automation_scale_exceeded', {
      message: `This automation has ${automation.enrolled_count} enrollments, past the instance-mode ceiling of ${INSTANCE_MODE_MAX_ENROLLMENTS}. Keep it in cohort mode.`,
      param: 'mode',
    })
  }
  if (mode === 'cohort' && body.steps?.some((step) => step.type === 'wait_until')) {
    throw apiError('validation_error', { message: COHORT_CAVEAT.message, param: 'steps' })
  }

  const now = new Date().toISOString()
  let version = automation.current_version
  if (body.steps) {
    version = (await maxVersion(ctx, automation.id)) + 1
    await ctx.sql
      .prepare(
        `INSERT INTO automation_versions (id, workspace_id, automation_id, version, steps, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId('automation'),
        ctx.workspace.id,
        automation.id,
        version,
        JSON.stringify(body.steps),
        now,
      )
      .run()
  }

  await ctx.sql
    .prepare(
      `UPDATE automations SET name = ?, mode = ?, current_version = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ?`,
    )
    .bind(body.name ?? automation.name, mode, version, now, automation.id, ctx.workspace.id)
    .run()

  if (body.trigger) {
    await ctx.sql
      .prepare('DELETE FROM automation_triggers WHERE workspace_id = ? AND automation_id = ?')
      .bind(ctx.workspace.id, automation.id)
      .run()
    await ctx.sql
      .prepare(
        `INSERT INTO automation_triggers (id, workspace_id, automation_id, type, config)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        newId('automation'),
        ctx.workspace.id,
        automation.id,
        body.trigger.type,
        JSON.stringify(body.trigger),
      )
      .run()
  }

  const reloaded = await load(ctx, automation.id)
  return json({
    ...toAutomation(reloaded.automation, reloaded.trigger, reloaded.steps),
    execution: { ...modeInfo(mode), driver: driverFor(ctx) },
  })
})

automations.delete('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'automations:write')
  requireRole(ctx.actor, 'marketer')
  const id = c.req.param('id')
  // Archived rather than deleted: in-flight enrollments still reference the
  // version they started on, and dropping the steps would strand them.
  const res = await ctx.sql
    .prepare(
      `UPDATE automations SET status = 'archived', updated_at = ? WHERE id = ? AND workspace_id = ?`,
    )
    .bind(new Date().toISOString(), id, ctx.workspace.id)
    .run()
  if (res.meta.changes === 0) throw apiError('not_found')
  await ctx.sql
    .prepare('DELETE FROM automation_triggers WHERE workspace_id = ? AND automation_id = ?')
    .bind(ctx.workspace.id, id)
    .run()
  return json({ object: 'automation', id, deleted: true, status: 'archived' })
})

automations.post('/:id/activate', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'automations:write')
  requireRole(ctx.actor, 'marketer')
  const { automation, steps } = await load(ctx, c.req.param('id'))
  if (steps.length === 0) {
    throw apiError('validation_error', {
      message: 'An automation needs at least one step to activate.',
    })
  }
  await setStatus(ctx, automation.id, 'active')
  return json({
    object: 'automation',
    id: automation.id,
    status: 'active',
    version: automation.current_version,
    execution: { ...modeInfo(automation.mode), driver: driverFor(ctx) },
  })
})

/** Pause stops new enrollments; contacts already in flight keep their place. */
automations.post('/:id/pause', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'automations:write')
  requireRole(ctx.actor, 'marketer')
  const { automation } = await load(ctx, c.req.param('id'))
  await setStatus(ctx, automation.id, 'paused')
  return json({ object: 'automation', id: automation.id, status: 'paused' })
})

automations.get('/:id/enrollments', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const cursor = c.req.query('cursor')
  const status = c.req.query('status')
  const { automation } = await load(ctx, c.req.param('id'))

  const rows = await ctx.sql
    .prepare(
      `SELECT e.id, e.contact_id, e.version, e.cohort, e.instance_id, e.status, e.current_step,
              e.created_at, e.completed_at, c.email
         FROM automation_enrollments e
         LEFT JOIN contacts c ON c.id = e.contact_id AND c.workspace_id = e.workspace_id
        WHERE e.workspace_id = ? AND e.automation_id = ?
          ${cursor ? 'AND e.id < ?' : ''}
          ${status ? 'AND e.status = ?' : ''}
        ORDER BY e.id DESC LIMIT ?`,
    )
    .bind(
      ctx.workspace.id,
      automation.id,
      ...(cursor ? [cursor] : []),
      ...(status ? [status] : []),
      limit + 1,
    )
    .all<{
      id: string
      contact_id: string
      version: number
      cohort: string | null
      instance_id: string | null
      status: string
      current_step: number
      created_at: string
      completed_at: string | null
      email: string | null
    }>()

  return json(
    page(
      rows.results.map((row) => ({ object: 'automation_enrollment' as const, ...row })),
      limit,
    ),
  )
})

automations.post('/:id/enroll', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'automations:write')
  requireRole(ctx.actor, 'marketer')
  const body = z.object({ contact_id: z.string().min(3).max(64) }).parse(await c.req.json())
  const { automation } = await load(ctx, c.req.param('id'))

  if (automation.status !== 'active') {
    throw apiError('validation_error', {
      message: `This automation is ${automation.status}. Activate it before enrolling contacts.`,
    })
  }

  const contact = await ctx.sql
    .prepare('SELECT id FROM contacts WHERE id = ? AND workspace_id = ?')
    .bind(body.contact_id, ctx.workspace.id)
    .first<{ id: string }>()
  if (!contact) throw apiError('not_found', { message: 'No such contact.' })

  const existing = await ctx.sql
    .prepare(
      `SELECT id, status FROM automation_enrollments
        WHERE workspace_id = ? AND automation_id = ? AND contact_id = ?`,
    )
    .bind(ctx.workspace.id, automation.id, body.contact_id)
    .first<{ id: string; status: string }>()
  // Re-enrolling silently would send the whole sequence twice, which is the
  // complaint that gets a sending domain blocked.
  if (existing) {
    return json({
      object: 'automation_enrollment',
      id: existing.id,
      automation_id: automation.id,
      contact_id: body.contact_id,
      status: existing.status,
      already_enrolled: true,
    })
  }

  if (automation.mode === 'instance') {
    const active = await ctx.sql
      .prepare(
        `SELECT COUNT(*) AS count FROM automation_enrollments
          WHERE workspace_id = ? AND automation_id = ? AND status = 'active'`,
      )
      .bind(ctx.workspace.id, automation.id)
      .first<{ count: number }>()
    if ((active?.count ?? 0) >= INSTANCE_MODE_MAX_ENROLLMENTS) {
      throw apiError('automation_scale_exceeded', {
        message: `This automation already has ${active?.count ?? 0} active instance-mode enrollments, the ceiling this deployment enforces below the platform's 50,000 concurrent-instance limit. Switch it to cohort mode (PATCH /v1/automations/${automation.id} with {"mode":"cohort"}) to keep enrolling.`,
        param: 'contact_id',
      })
    }
  }

  let cohort: string | null = null
  if (automation.mode === 'cohort') {
    const stub = ctx.env.AUTOMATION_COHORT.get(
      doName('AutomationCohort', ctx.workspace.id, automation.id),
    )
    const assigned = await stub.enroll({
      automationId: automation.id,
      workspaceId: ctx.workspace.id,
      version: automation.current_version,
      hour: hourKey(),
    })
    cohort = assigned.cohort
  }

  const id = newId('enrollment')
  const now = new Date().toISOString()
  await ctx.sql.batch([
    ctx.sql
      .prepare(
        `INSERT INTO automation_enrollments
           (id, workspace_id, automation_id, version, contact_id, instance_id, cohort, status, current_step, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, 'active', 0, ?)`,
      )
      .bind(
        id,
        ctx.workspace.id,
        automation.id,
        automation.current_version,
        body.contact_id,
        cohort,
        now,
      ),
    ctx.sql
      .prepare(
        'UPDATE automations SET enrolled_count = enrolled_count + 1 WHERE id = ? AND workspace_id = ?',
      )
      .bind(automation.id, ctx.workspace.id),
  ])

  // Instance mode needs a starter; cohort mode is started by the actor's alarm
  // when the hour seals, so enqueueing per contact there would be pure waste.
  if (automation.mode === 'instance') {
    ctx.background(
      ctx.env.AUTOMATION_QUEUE.send({
        type: 'enrollment.start',
        workspace_id: ctx.workspace.id,
        automation_id: automation.id,
        version: automation.current_version,
        enrollment_id: id,
        contact_id: body.contact_id,
        mode: automation.mode,
      }),
    )
  }

  return json({
    object: 'automation_enrollment',
    id,
    automation_id: automation.id,
    contact_id: body.contact_id,
    version: automation.current_version,
    cohort,
    status: 'active',
    created_at: now,
    execution: { ...modeInfo(automation.mode), driver: driverFor(ctx) },
  })
})

automations.delete('/:id/enrollments/:contact_id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'automations:write')
  requireRole(ctx.actor, 'marketer')
  const automationId = c.req.param('id')
  const res = await ctx.sql
    .prepare(
      `UPDATE automation_enrollments SET status = 'removed', completed_at = ?
        WHERE workspace_id = ? AND automation_id = ? AND contact_id = ? AND status = 'active'`,
    )
    .bind(new Date().toISOString(), ctx.workspace.id, automationId, c.req.param('contact_id'))
    .run()
  if (res.meta.changes === 0) {
    throw apiError('not_found', {
      message: 'That contact is not actively enrolled in this automation.',
    })
  }
  await ctx.sql
    .prepare(
      `UPDATE automations SET enrolled_count = MAX(enrolled_count - 1, 0)
        WHERE id = ? AND workspace_id = ?`,
    )
    .bind(automationId, ctx.workspace.id)
    .run()
  return json({
    object: 'automation_enrollment',
    automation_id: automationId,
    contact_id: c.req.param('contact_id'),
    deleted: true,
  })
})

/**
 * Per-step funnel.
 *
 * `current_step` is where an enrollment is now, so everyone past step *n* has
 * completed it — which makes the drop-off between two steps readable without
 * storing a row per contact per step.
 */
automations.get('/:id/stats', async (c) => {
  const ctx = c.get('ctx')
  const { automation, steps } = await load(ctx, c.req.param('id'))

  const rows = await ctx.sql
    .prepare(
      `SELECT current_step, status, COUNT(*) AS count
         FROM automation_enrollments WHERE workspace_id = ? AND automation_id = ?
        GROUP BY current_step, status`,
    )
    .bind(ctx.workspace.id, automation.id)
    .all<{ current_step: number; status: string; count: number }>()

  const byStatus: Record<string, number> = {}
  let total = 0
  for (const row of rows.results) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + row.count
    total += row.count
  }

  const stepStats = steps.map((step, index) => {
    let at = 0
    let completed = 0
    for (const row of rows.results) {
      if (row.current_step === index && row.status === 'active') at += row.count
      if (row.current_step > index || row.status === 'completed') completed += row.count
    }
    return {
      step: index,
      id: `s${index}.${(step as { type: string }).type}`,
      type: (step as { type: string }).type,
      at,
      completed,
    }
  })

  return json({
    object: 'automation_stats',
    automation_id: automation.id,
    version: automation.current_version,
    mode: automation.mode,
    driver: driverFor(ctx),
    total_enrolled: total,
    active: byStatus.active ?? 0,
    completed: byStatus.completed ?? 0,
    removed: byStatus.removed ?? 0,
    steps: stepStats,
  })
})

async function load(
  ctx: Ctx,
  id: string,
): Promise<{ automation: AutomationRow; trigger: unknown; steps: unknown[] }> {
  const automation = await ctx.sql
    .prepare(
      `SELECT id, name, status, mode, current_version, enrolled_count, created_at, updated_at
         FROM automations WHERE id = ? AND workspace_id = ?`,
    )
    .bind(id, ctx.workspace.id)
    .first<AutomationRow>()
  if (!automation) throw apiError('not_found')

  const version = await ctx.sql
    .prepare(
      `SELECT steps FROM automation_versions
        WHERE workspace_id = ? AND automation_id = ? AND version = ?`,
    )
    .bind(ctx.workspace.id, id, automation.current_version)
    .first<{ steps: string }>()

  const trigger = await ctx.sql
    .prepare('SELECT config FROM automation_triggers WHERE workspace_id = ? AND automation_id = ?')
    .bind(ctx.workspace.id, id)
    .first<{ config: string }>()

  return {
    automation,
    trigger: trigger ? JSON.parse(trigger.config) : null,
    steps: version ? (JSON.parse(version.steps) as unknown[]) : [],
  }
}

const maxVersion = async (ctx: Ctx, automationId: string): Promise<number> => {
  const row = await ctx.sql
    .prepare(
      'SELECT MAX(version) AS max FROM automation_versions WHERE workspace_id = ? AND automation_id = ?',
    )
    .bind(ctx.workspace.id, automationId)
    .first<{ max: number | null }>()
  return row?.max ?? 0
}

const setStatus = async (ctx: Ctx, id: string, status: string): Promise<void> => {
  await ctx.sql
    .prepare('UPDATE automations SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .bind(status, new Date().toISOString(), id, ctx.workspace.id)
    .run()
}

export { automations }
