import { newId, r2Key } from '@mailysend/core'
import { compileLogFilters, LOG_COLUMNS } from '../api/logs.ts'
import { tenancyFor } from '../context.ts'
import type { Env } from '../env.ts'

/**
 * Export and archive.
 *
 * Analytics Engine retains three months and samples under load; the product
 * promises retention measured in years and numbers that reconcile with the
 * dashboard. Both are only true if the archive is built from the NDJSON
 * staging prefix — the same rows the SQL rollups came from — rather than by
 * querying AE back out.
 */

/**
 * `logs.export` is the shape `GET /v1/logs/export` actually sends. The union
 * used to declare `{ type: 'export', query }`, which nothing ever produced —
 * so the job fell through to the query branch with `format` and `filters`
 * sitting unread on it, and every export came back as the whole workspace in
 * CSV whatever had been asked for.
 */
export type ExportJob =
  | { type: 'compact'; workspace_id: string; month: string; prefix: string }
  | {
      type: 'logs.export'
      workspace_id: string
      export_id: string
      environment: string
      format: 'csv' | 'ndjson'
      filters: Record<string, string>
      requested_by?: string | null
      created_at?: string
    }

export async function runExport(job: ExportJob, env: Env): Promise<void> {
  if (job.type === 'compact') return compactMonth(job, env)
  if (job.type === 'logs.export') return runQueryExport(job, env)
  // Dispatched by name rather than by elimination. The queue also carries
  // `placement.test`, which `POST /v1/analytics/placement-tests` produces and
  // nothing consumes; falling through to the export branch ran the wrong job
  // against it instead of saying so.
  console.warn(`[export] no handler for job type ${(job as { type: string }).type}`)
}

/**
 * A hard ceiling, stated rather than discovered.
 *
 * The worker builds the file in memory, so "all of it" is not an option it can
 * honour. The export says how many rows it holds and whether it was cut short,
 * which is the difference between a truncated file and a truncated file you
 * know about.
 */
const MAX_ROWS = 100_000

/**
 * Compaction.
 *
 * Bounded per invocation: it takes one page of staged objects, appends them to
 * the month's part file and stops. A compaction that tries to do a whole month
 * in one go is a compaction that fails at month-end, when it matters most.
 */
const COMPACT_BATCH = 200

async function compactMonth(job: Extract<ExportJob, { type: 'compact' }>, env: Env): Promise<void> {
  const listing = await env.BUCKET.list({ prefix: job.prefix, limit: COMPACT_BATCH })
  if (listing.objects.length === 0) return

  const lines: string[] = []
  for (const object of listing.objects) {
    const body = await env.BUCKET.get(object.key)
    if (body) lines.push(await body.text())
  }

  // NDJSON, not parquet, for now. A pure-JS parquet writer is on the roadmap;
  // shipping a broken one would corrupt the only copy of data past three
  // months, and NDJSON is losslessly convertible later.
  const part = `${Date.now()}`
  await env.BUCKET.put(
    r2Key.eventArchive(job.workspace_id, job.month, part).replace(/\.parquet$/, '.ndjson'),
    lines.join('\n'),
    { httpMetadata: { contentType: 'application/x-ndjson' } },
  )

  await env.BUCKET.delete(listing.objects.map((o) => o.key))
  if (listing.truncated) await env.EXPORT_QUEUE.send(job)
}

async function runQueryExport(
  job: Extract<ExportJob, { type: 'logs.export' }>,
  env: Env,
): Promise<void> {
  const sql = tenancyFor(env).db(job.workspace_id)
  const format = job.format === 'ndjson' ? 'ndjson' : 'csv'

  // The same compiler `GET /v1/logs` uses, so the file is the page the operator
  // was looking at rather than an approximation of it.
  const filters = compileLogFilters(
    job.workspace_id,
    job.environment,
    new URLSearchParams(job.filters ?? {}),
  )

  const { results } = await sql
    .prepare(
      `SELECT ${LOG_COLUMNS} FROM messages
        WHERE ${filters.where}
        ORDER BY id DESC LIMIT ?`,
    )
    .bind(...filters.args, MAX_ROWS + 1)
    .all<Record<string, unknown>>()

  const truncated = results.length > MAX_ROWS
  const rows = truncated ? results.slice(0, MAX_ROWS) : results

  const file = format === 'ndjson' ? 'messages.ndjson' : 'messages.csv'
  const body =
    format === 'ndjson'
      ? rows.map((row) => JSON.stringify(row)).join('\n')
      : [
          Object.keys(rows[0] ?? { id: '' }).join(','),
          ...rows.map((row) => Object.values(row).map(csvCell).join(',')),
        ].join('\n')

  const key = r2Key.export(job.workspace_id, job.export_id, file)
  await env.BUCKET.put(key, body, {
    httpMetadata: {
      contentType: format === 'ndjson' ? 'application/x-ndjson' : 'text/csv',
      contentDisposition: `attachment; filename="${file}"`,
    },
  })

  // Export status lives in `settings` rather than a table of its own: an export
  // is a short-lived artefact with a TTL, and a table would need its own
  // lifecycle, its own indexes and its own cleanup for no additional answer.
  await sql
    .prepare(
      `INSERT INTO settings (workspace_id, key, value, updated_at) VALUES (?,?,?,?)
       ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(
      job.workspace_id,
      `export:${job.export_id}`,
      JSON.stringify({
        status: 'complete',
        key,
        rows: rows.length,
        format,
        truncated,
        max_rows: MAX_ROWS,
      }),
      new Date().toISOString(),
    )
    .run()
}

/** RFC 4180: quote anything containing a comma, quote or newline; double the quotes. */
const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export { newId }
