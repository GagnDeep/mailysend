// biome-ignore-all lint/a11y/useSemanticElements: the matrix is a grid on purpose; see ComparisonTable.
// biome-ignore-all lint/a11y/useFocusableInteractive: `row` is a structural table role here, not a widget.

import { Fragment } from 'react'
import { cn } from '../lib/cn.ts'

export type ComparisonValue =
  | boolean
  | string
  | { kind: 'partial'; label?: string }
  | { kind: 'text'; label: string; tone?: 'positive' | 'negative' | 'muted' | 'neutral' }

export interface ComparisonColumn {
  key: string
  label: string
  /** The "us" column: bold and accent-coloured in every artboard. */
  emphasis?: boolean
}

export interface ComparisonRow {
  label: string
  values: Record<string, ComparisonValue | undefined>
}

export interface ComparisonTableProps {
  columns: ComparisonColumn[]
  rows: ComparisonRow[]
  /** Width below which the grid scrolls rather than squashes. */
  minWidth?: number
  /** Track sizing for the first (label) column. */
  labelColumn?: string
  className?: string
  caption?: string
}

const toneClass = {
  positive: 'font-semibold text-positive',
  negative: 'text-warning',
  muted: 'text-muted-2',
  neutral: 'text-muted',
} as const

const Cell = ({ value }: { value: ComparisonValue | undefined }) => {
  if (value === undefined) return <span className="text-muted-3">—</span>
  if (value === true) {
    return (
      <span className="font-semibold text-positive">
        <span aria-hidden="true">✓</span>
        <span className="sr-only">Yes</span>
      </span>
    )
  }
  if (value === false) {
    return (
      <span className="text-warning">
        <span aria-hidden="true">✗</span>
        <span className="sr-only">No</span>
      </span>
    )
  }
  if (typeof value === 'string') return <span className="text-muted">{value}</span>
  if (value.kind === 'partial') {
    return (
      <span className="text-muted-2">
        <span aria-hidden="true">~</span> {value.label ?? 'Partial'}
      </span>
    )
  }
  return <span className={toneClass[value.tone ?? 'neutral']}>{value.label}</span>
}

/**
 * A CSS grid, not a `<table>`.
 *
 * The comparison matrix has six columns of wildly different natural widths and
 * has to stay column-aligned while the first column stays wide — `grid` does
 * that with one `grid-template-columns` declaration where a table needs
 * `table-layout: fixed` plus per-cell widths, and then still collapses on a
 * narrow viewport. The ARIA table roles below put the semantics back: rows use
 * `display: contents` so the role tree is a table while the layout is a grid.
 *
 * The `min-width` + `overflow-x-auto` pair is load-bearing. Without it the
 * matrix widens the document and the whole page scrolls sideways on a phone.
 */
export const ComparisonTable = ({
  columns,
  rows,
  minWidth = 860,
  labelColumn = 'minmax(170px, 1.5fr)',
  className,
  caption,
}: ComparisonTableProps) => (
  <div
    className={cn(
      'overflow-x-auto rounded-panel border border-line bg-card p-[clamp(18px,3vw,28px)]',
      className,
    )}
  >
    <div
      role="table"
      aria-label={caption}
      className="grid text-[14px]"
      style={{
        minWidth,
        gridTemplateColumns: `${labelColumn} repeat(${columns.length}, minmax(104px, 1fr))`,
      }}
    >
      <div role="row" className="contents">
        <div role="columnheader" className="border-b border-line px-2.5 py-3">
          <span className="sr-only">{caption ?? 'Feature'}</span>
        </div>
        {columns.map((column) => (
          <div
            key={column.key}
            role="columnheader"
            className={cn(
              'border-b border-line px-2.5 py-3',
              column.emphasis ? 'font-bold text-accent' : 'font-semibold text-muted',
            )}
          >
            {column.label}
          </div>
        ))}
      </div>
      {rows.map((row, rowIndex) => {
        const last = rowIndex === rows.length - 1
        return (
          <Fragment key={row.label}>
            <div role="row" className="contents">
              <div
                role="rowheader"
                className={cn('px-2.5 py-3.5 text-muted', !last && 'border-b border-line-soft')}
              >
                {row.label}
              </div>
              {columns.map((column) => (
                <div
                  key={column.key}
                  role="cell"
                  className={cn('px-2.5 py-3.5', !last && 'border-b border-line-soft')}
                >
                  <Cell value={row.values[column.key]} />
                </div>
              ))}
            </div>
          </Fragment>
        )
      })}
    </div>
  </div>
)
