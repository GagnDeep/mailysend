import { beforeEach, describe, expect, it } from 'vitest'
import { claimFor, type Harness, harness, sessionFor } from './harness.ts'

/**
 * The import wizard's own request shape.
 *
 * The wizard parses a spreadsheet in the browser, lets the reader point each
 * column at a field, and then posted `{ audience_id, csv, mapping }` to
 * `POST /v1/audiences/:id/import` — a route that has never existed. The import
 * endpoint, meanwhile, took a bare CSV or a JSON array and knew nothing about a
 * mapping, so even against the right path the column choices were discarded.
 * Both halves are tested here: the path, and that the mapping is obeyed.
 *
 * `skipped` is the counter worth a test of its own. It means "superseded by a
 * later row in this same file", not "already present" — a repeated address
 * updates the contact it matches, and reporting that as skipped would report
 * work that was done as work that was not.
 */

let h: Harness
let cookie: string
let audienceId: string

beforeEach(async () => {
  h = await harness()
  cookie = await sessionFor(h, await claimFor(h))
  const created = await h.fetch('/v1/audiences', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ name: 'Newsletter' }),
  })
  expect(created.status).toBe(201)
  audienceId = ((await created.json()) as { id: string }).id
})

const importCsv = async (body: Record<string, unknown>) => {
  const res = await h.fetch('/v1/contacts/import', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ audience_id: audienceId, ...body }),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as {
    status: string
    total_rows: number
    imported: number
    skipped: number
    failed: number
    errors: { row: number; email: string | null; message: string }[]
  }
}

const contacts = async () =>
  (
    await h.sql
      .prepare('SELECT email, first_name, data FROM contacts WHERE audience_id = ? ORDER BY email')
      .bind(audienceId)
      .all<{ email: string; first_name: string | null; data: string | null }>()
  ).results

describe('importing contacts from a mapped CSV', () => {
  it('renames the columns the reader chose, and files the rest as custom fields', async () => {
    const summary = await importCsv({
      csv: 'Email Address,Given name,Company\nANA@example.com,Ana,Acme\nbob@example.com,Bob,Globex\n',
      mapping: { 'Email Address': 'email', 'Given name': 'first_name', Company: 'data.company' },
    })

    expect(summary).toMatchObject({ status: 'complete', total_rows: 2, imported: 2, failed: 0 })
    expect(await contacts()).toEqual([
      { email: 'ana@example.com', first_name: 'Ana', data: '{"company":"Acme"}' },
      { email: 'bob@example.com', first_name: 'Bob', data: '{"company":"Globex"}' },
    ])
  })

  it('drops a column that was mapped to nothing, which is what "ignore" means', async () => {
    await importCsv({
      csv: 'Email Address,Internal note\nana@example.com,do not mail before Q3\n',
      mapping: { 'Email Address': 'email' },
    })
    expect(await contacts()).toEqual([{ email: 'ana@example.com', first_name: null, data: null }])
  })

  it('names the row, the address and the reason for every row it could not take', async () => {
    const summary = await importCsv({
      csv: 'Email Address\nana@example.com\nnot-an-address\n',
      mapping: { 'Email Address': 'email' },
    })

    expect(summary).toMatchObject({ status: 'partial', total_rows: 2, imported: 1, failed: 1 })
    // Line three of the file, which is what the reader's editor shows.
    expect(summary.errors[0]).toMatchObject({ row: 3, email: 'not-an-address' })
    expect((await contacts()).map((row) => row.email)).toEqual(['ana@example.com'])
  })

  it('counts a repeated address in one file as skipped, and keeps the later row', async () => {
    const summary = await importCsv({
      csv: 'Email Address,Given name\nana@example.com,Ana\nana@example.com,Anastasia\n',
      mapping: { 'Email Address': 'email', 'Given name': 'first_name' },
    })

    expect(summary).toMatchObject({ total_rows: 2, imported: 2, skipped: 1, failed: 0 })
    expect(await contacts()).toEqual([
      { email: 'ana@example.com', first_name: 'Anastasia', data: null },
    ])
  })
})
