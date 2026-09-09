import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { type ComparisonColumn, type ComparisonRow, ComparisonTable } from '../src/index.ts'

const columns: ComparisonColumn[] = [
  { key: 'mailysend', label: 'MailySend', emphasis: true },
  { key: 'resend', label: 'Resend' },
]

const rows: ComparisonRow[] = [
  { label: 'Model', values: { mailysend: 'MIT software', resend: 'SaaS' } },
  { label: 'Inbound', values: { mailysend: true, resend: false } },
]

const gridOf = (): string =>
  (screen.getByRole('table').getAttribute('style') ?? '').replace(/\s+/g, ' ')

describe('ComparisonTable', () => {
  it('keeps the label track when labelColumn is an empty string', () => {
    // The regression this exists for: an empty string is not `undefined`, so a
    // default parameter did not catch it, the label track vanished, and every
    // cell shifted one column left — each row ended up labelled with its
    // neighbour's value on the live compare page.
    render(<ComparisonTable columns={columns} rows={rows} labelColumn="" />)
    expect(gridOf()).toContain('minmax(170px, 1.5fr) repeat(2,')
  })

  it('honours an explicit label track', () => {
    render(<ComparisonTable columns={columns} rows={rows} labelColumn="200px" />)
    expect(gridOf()).toContain('200px repeat(2,')
  })

  it('renders one row header per row and one cell per column', () => {
    render(<ComparisonTable columns={columns} rows={rows} caption="Compare" />)
    expect(screen.getAllByRole('rowheader')).toHaveLength(2)
    expect(screen.getAllByRole('cell')).toHaveLength(4)
    expect(screen.getByText('Yes')).toBeDefined()
    expect(screen.getByText('No')).toBeDefined()
  })
})
