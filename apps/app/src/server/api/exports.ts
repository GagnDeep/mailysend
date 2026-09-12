import { apiError } from '@mailysend/contracts'
import type { Ctx } from '../context.ts'
import { type App, createRouter, json, withContext } from './base.ts'

/**
 * `/v1/exports` — the other half of `GET /v1/logs/export`.
 *
 * That endpoint returns `{ object: 'export', id, status: 'queued' }` and hands
 * the work to the queue. Until now nothing read the result: the worker wrote a
 * record into `settings` and an object into R2, and there was no way to learn
 * either had happened. An asynchronous export whose result cannot be fetched is
 * not an export.
 *
 * Status lives under `settings` key `export:<id>`, which is where the worker
 * puts it — see `server/services/export.ts`. The key is scoped to the
 * workspace by the row's own `workspace_id`, so one workspace cannot read
 * another's export by guessing an id.
 */

const exports_: App = createRouter()

exports_.use('*', withContext())

interface ExportRecord {
  status: 'complete'
  key: string
  rows: number
  format: 'csv' | 'ndjson'
  truncated: boolean
  max_rows: number
}

const record = async (ctx: Ctx, id: string): Promise<ExportRecord | null> => {
  const row = await ctx.sql
    .prepare('SELECT value FROM settings WHERE workspace_id = ? AND key = ?')
    .bind(ctx.workspace.id, `export:${id}`)
    .first<{ value: string }>()
  if (!row) return null
  try {
    return JSON.parse(row.value) as ExportRecord
  } catch {
    return null
  }
}

/**
 * `GET /v1/exports/:id` — is it done, and how big is it?
 *
 * A queued export and an id that never existed are the same row-shaped absence
 * here, so this reports `queued` rather than 404 for both. Guessing wrong in
 * the other direction is worse: a poller that exits on a 404 would give up on
 * every export during the seconds before the worker runs.
 */
exports_.get('/:id', async (c) => {
  const id = c.req.param('id')
  const found = await record(c.get('ctx'), id)
  if (!found) return json({ object: 'export', id, status: 'queued' })
  return json({
    object: 'export',
    id,
    status: 'complete',
    format: found.format,
    rows: found.rows,
    truncated: found.truncated,
    max_rows: found.max_rows,
    url: `/v1/exports/${id}/download`,
  })
})

/**
 * `GET /v1/exports/:id/download` — the file itself, under the same API auth as
 * everything else.
 *
 * Deliberately not a pre-signed R2 URL: a signed URL is a bearer token for the
 * data that travels in a query string, gets logged by every proxy between here
 * and the client, and cannot be revoked. Streaming through the API keeps the
 * key the only credential.
 */
exports_.get('/:id/download', async (c) => {
  const ctx = c.get('ctx')
  const found = await record(ctx, c.req.param('id'))
  if (!found) throw apiError('not_found', { message: 'That export is not ready yet.' })

  const object = await ctx.env.BUCKET.get(found.key)
  if (!object) {
    throw apiError('not_found', {
      message: 'That export has expired. Request a new one with GET /v1/logs/export.',
    })
  }

  const headers = new Headers({
    'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
    'content-length': String(object.size),
  })
  const disposition = object.httpMetadata?.contentDisposition
  if (disposition) headers.set('content-disposition', disposition)
  return new Response(object.body, { headers })
})

export { exports_ as exports }
