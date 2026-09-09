import { z } from 'zod'
import { requireRole } from '../auth.ts'
import { type App, createRouter, json, withContext } from './base.ts'

/**
 * `/v1/preference-centre` — what a recipient sees when they click "manage
 * preferences" instead of "unsubscribe".
 *
 * Stored as one JSON blob in `settings` rather than as tables, because it is
 * read as a whole, written as a whole, and its shape is presentational. The one
 * thing that is *not* configurable is the unsubscribe-all link: a preference
 * centre that can hide it is a preference centre that breaks CAN-SPAM and the
 * List-Unsubscribe header at the same time, so the flag exists in the schema
 * and is pinned true on write.
 */
const preferences: App = createRouter()

preferences.use('*', withContext())

const SETTING_KEY = 'preference_centre'

const Topic = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  default_opted_in: z.boolean(),
})

const Centre = z.object({
  headline: z.string().min(1).max(200),
  body: z.string().max(2000),
  show_unsubscribe_all: z.boolean(),
  topics: z.array(Topic).max(50),
})

const DEFAULTS: z.infer<typeof Centre> = {
  headline: 'Choose what you hear about',
  body: 'Pick the emails you want. You can change this at any time, and unsubscribing from everything is always one click away.',
  show_unsubscribe_all: true,
  topics: [
    {
      id: 'product',
      name: 'Product updates',
      description: 'New features and changes that affect how you use the product.',
      default_opted_in: true,
    },
    {
      id: 'news',
      name: 'Company news',
      description: 'Occasional announcements. Never more than once a month.',
      default_opted_in: false,
    },
  ],
}

async function read(ctx: {
  sql: {
    prepare(q: string): { bind(...a: unknown[]): { first<T>(): Promise<T | null> } }
  }
  workspace: { id: string }
}): Promise<z.infer<typeof Centre>> {
  const row = await ctx.sql
    .prepare('SELECT value FROM settings WHERE workspace_id = ? AND key = ?')
    .bind(ctx.workspace.id, SETTING_KEY)
    .first<{ value: string | null }>()
  if (!row?.value) return DEFAULTS
  const parsed = Centre.safeParse(JSON.parse(row.value))
  // A stored blob that no longer matches the schema (an older version, a hand
  // edit) falls back rather than 500s: this endpoint is on the path of every
  // recipient clicking "manage preferences".
  return parsed.success ? parsed.data : DEFAULTS
}

preferences.get('/', async (c) => json(await read(c.get('ctx') as never)))

preferences.patch('/', async (c) => {
  const ctx = c.get('ctx')
  requireRole(ctx.actor, 'marketer')
  const body = Centre.partial().parse(await c.req.json())
  const current = await read(ctx as never)
  const next = { ...current, ...body, show_unsubscribe_all: true }

  // Two topics with the same id would silently merge in the recipient's
  // selection, which reads as "I unticked one and both went away".
  const ids = new Set<string>()
  for (const topic of next.topics) {
    if (ids.has(topic.id)) {
      const { apiError } = await import('@mailysend/contracts')
      throw apiError('validation_error', {
        message: `Duplicate topic id \`${topic.id}\`.`,
        param: 'topics',
      })
    }
    ids.add(topic.id)
  }

  await ctx.sql
    .prepare(
      `INSERT INTO settings (workspace_id, key, value, updated_at) VALUES (?,?,?,?)
       ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(ctx.workspace.id, SETTING_KEY, JSON.stringify(next), new Date().toISOString())
    .run()

  return json(next)
})

export { preferences }
