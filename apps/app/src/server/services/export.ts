import { newId, r2Key } from '@mailysend/core'
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

export type ExportJob =
  | { type: 'compact'; workspace_id: string; month: string; prefix: string }
  | { type: 'export'; workspace_id: string; export_id: string; query: Record<string, unknown> }

export async function runExport(job: ExportJob, env: Env): Promise<void> {
  if (job.type === 'compact') return compactMonth(job, env)
  return runQueryExport(job, env)
}

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
  job: Extract<ExportJob, { type: 'export' }>,
  env: Env,
): Promise<void> {
  const sql = tenancyFor(env).db(job.workspace_id)
  const { results } = await sql
    .prepare(
      `SELECT id, from_address, to_addresses, subject, status, provider, provider_message_id,
              open_count, click_count, sent_at, delivered_at, created_at
         FROM messages WHERE workspace_id = ? ORDER BY id DESC LIMIT 100000`,
    )
    .bind(job.workspace_id)
    .all<Record<string, unknown>>()

  const header = Object.keys(results[0] ?? { id: '' }).join(',')
  const rows = results.map((row) => Object.values(row).map(csvCell).join(','))
  const key = r2Key.export(job.workspace_id, job.export_id, 'messages.csv')
  await env.BUCKET.put(key, [header, ...rows].join('\n'), {
    httpMetadata: {
      contentType: 'text/csv',
      contentDisposition: 'attachment; filename="messages.csv"',
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
      JSON.stringify({ status: 'ready', key, rows: results.length }),
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
