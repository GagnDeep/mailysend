import { newId, r2Key } from '@mailysend/core'
import { tenancyFor } from '../context.ts'
import type { Env } from '../env.ts'

/**
 * DMARC aggregate report ingestion.
 *
 * Two constraints shape this file. Workers has no `DOMParser`, so the XML is
 * read with a streaming scanner rather than a tree parser — some reports are
 * tens of megabytes and a tree of one would not fit the memory budget anyway.
 * And reports arrive gzipped or zipped, so the container has to be unwrapped
 * before anything can be scanned.
 */

export interface DmarcJob {
  workspace_id: string
  raw_key: string
  filename: string
}

export async function ingestDmarcReport(job: DmarcJob, env: Env): Promise<void> {
  const object = await env.BUCKET.get(job.raw_key)
  if (!object) return

  const bytes = new Uint8Array(await object.arrayBuffer())
  const xml = await decompress(bytes, job.filename)
  const report = parseAggregateReport(xml)
  if (!report) return

  const sql = tenancyFor(env).db(job.workspace_id)
  const reportId = newId('event')
  const inserted = await sql
    .prepare(
      `INSERT INTO dmarc_reports
         (id, workspace_id, org_name, report_id, domain, date_begin, date_end, raw_key, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT (workspace_id, org_name, report_id) DO NOTHING`,
    )
    .bind(
      reportId,
      job.workspace_id,
      report.orgName,
      report.reportId,
      report.domain,
      report.dateBegin,
      report.dateEnd,
      r2Key.dmarcReport(job.workspace_id, reportId),
      new Date().toISOString(),
    )
    .run()
  // A redelivered report is the normal case, not an error: every receiver sends
  // the same aggregate to every configured rua address.
  if (inserted.meta.changes === 0) return

  await sql.batch(
    report.rows.map((row) =>
      sql
        .prepare(
          `INSERT INTO dmarc_rows
             (id, workspace_id, report_id, source_ip, count, disposition, dkim_result,
              spf_result, header_from, dkim_domain, spf_domain)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          newId('event'),
          job.workspace_id,
          reportId,
          row.sourceIp,
          row.count,
          row.disposition,
          row.dkim,
          row.spf,
          row.headerFrom,
          row.dkimDomain,
          row.spfDomain,
        ),
    ),
  )
}

async function decompress(bytes: Uint8Array, filename: string): Promise<string> {
  if (filename.endsWith('.gz')) {
    const stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'))
    return new Response(stream).text()
  }
  if (filename.endsWith('.zip')) return unzipFirstEntry(bytes)
  return new TextDecoder().decode(bytes)
}

/**
 * A minimal ZIP reader.
 *
 * DMARC zips contain exactly one deflated XML file, so this walks the central
 * directory to find it rather than pulling in a general-purpose archive
 * library — and it reads the central directory rather than scanning for local
 * headers, because a local header's sizes may be zero with the real values in
 * a trailing data descriptor.
 */
async function unzipFirstEntry(bytes: Uint8Array): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 65_557; i--) {
    if (view.getUint32(i, true) === 0x0605_4b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip archive')

  const centralOffset = view.getUint32(eocd + 16, true)
  const method = view.getUint16(centralOffset + 10, true)
  const compressedSize = view.getUint32(centralOffset + 20, true)
  const nameLength = view.getUint16(centralOffset + 28, true)
  const extraLength = view.getUint16(centralOffset + 30, true)
  const commentLength = view.getUint16(centralOffset + 32, true)
  const localOffset = view.getUint32(centralOffset + 42, true)
  void nameLength
  void extraLength
  void commentLength

  const localNameLength = view.getUint16(localOffset + 26, true)
  const localExtraLength = view.getUint16(localOffset + 28, true)
  const dataStart = localOffset + 30 + localNameLength + localExtraLength
  const data = bytes.subarray(dataStart, dataStart + compressedSize)

  if (method === 0) return new TextDecoder().decode(data)
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

interface AggregateReport {
  orgName: string
  reportId: string
  domain: string
  dateBegin: string
  dateEnd: string
  rows: {
    sourceIp: string
    count: number
    disposition: string
    dkim: string
    spf: string
    headerFrom: string
    dkimDomain: string | null
    spfDomain: string | null
  }[]
}

const tag = (xml: string, name: string, from = 0): string | null => {
  const open = xml.indexOf(`<${name}>`, from)
  if (open < 0) return null
  const close = xml.indexOf(`</${name}>`, open)
  return close < 0 ? null : xml.slice(open + name.length + 2, close).trim()
}

function parseAggregateReport(xml: string): AggregateReport | null {
  const orgName = tag(xml, 'org_name')
  const reportId = tag(xml, 'report_id')
  if (!orgName || !reportId) return null

  const rows: AggregateReport['rows'] = []
  let cursor = 0
  for (;;) {
    const start = xml.indexOf('<record>', cursor)
    if (start < 0) break
    const end = xml.indexOf('</record>', start)
    if (end < 0) break
    const record = xml.slice(start, end)
    cursor = end + 9

    rows.push({
      sourceIp: tag(record, 'source_ip') ?? '',
      count: Number(tag(record, 'count') ?? '0'),
      disposition: tag(record, 'disposition') ?? 'none',
      // `policy_evaluated` and `auth_results` both contain `dkim`/`spf`; the
      // evaluated policy comes first in every conforming report, and it is the
      // one the dashboard reports on.
      dkim: tag(record, 'dkim') ?? 'unknown',
      spf: tag(record, 'spf') ?? 'unknown',
      headerFrom: tag(record, 'header_from') ?? '',
      dkimDomain: tag(record, 'domain', record.indexOf('<dkim>')),
      spfDomain: tag(record, 'domain', record.indexOf('<spf>')),
    })
  }

  return {
    orgName,
    reportId,
    domain: tag(xml, 'domain') ?? '',
    dateBegin: new Date(Number(tag(xml, 'begin') ?? '0') * 1000).toISOString(),
    dateEnd: new Date(Number(tag(xml, 'end') ?? '0') * 1000).toISOString(),
    rows,
  }
}
