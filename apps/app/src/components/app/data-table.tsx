import {
  Button,
  Checkbox,
  cn,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mailysend/ui'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'

/**
 * A real `<table>` with sortable headers, selection and bulk actions.
 *
 * Sorting state lives on `aria-sort` on the `th` and the control is a button
 * inside the header cell, which is what a screen reader announces; a `div` grid
 * with click handlers looks identical and tells the reader nothing.
 */

export type SortDirection = 'asc' | 'desc'

export interface Column<T> {
  id: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** Returns the value to compare. Presence of this is what makes a column sortable. */
  sortBy?: (row: T) => string | number
  align?: 'left' | 'right'
  className?: string
  /** Column header is visual only; the cell already says what it is. */
  srOnlyHeader?: boolean
}

export interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowId: (row: T) => string
  caption?: ReactNode
  onRowClick?: (row: T) => void
  /** Turns on the leading checkbox column. */
  selection?: {
    selected: string[]
    onChange: (ids: string[]) => void
    actions: (selected: string[]) => ReactNode
  }
  defaultSort?: { columnId: string; direction: SortDirection }
  emptyMessage?: ReactNode
  className?: string
}

export function DataTable<T>({
  rows,
  columns,
  rowId,
  caption,
  onRowClick,
  selection,
  defaultSort,
  emptyMessage,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState(defaultSort)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const column = columns.find((candidate) => candidate.id === sort.columnId)
    if (!column?.sortBy) return rows
    const compare = column.sortBy
    return [...rows].sort((a, b) => {
      const left = compare(a)
      const right = compare(b)
      const order = left < right ? -1 : left > right ? 1 : 0
      return sort.direction === 'asc' ? order : -order
    })
  }, [rows, columns, sort])

  const toggleSort = (columnId: string) =>
    setSort((current) =>
      current?.columnId === columnId
        ? { columnId, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { columnId, direction: 'asc' },
    )

  const allIds = sorted.map(rowId)
  const allSelected = selection
    ? allIds.length > 0 && allIds.every((id) => selection.selected.includes(id))
    : false
  const someSelected = selection ? selection.selected.length > 0 && !allSelected : false

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {selection && selection.selected.length > 0 ? (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-2.5 rounded-md border border-accent-border bg-accent-soft px-3.5 py-2.5"
        >
          <span className="font-mono text-[12px] text-warning">
            {selection.selected.length} selected
          </span>
          {selection.actions(selection.selected)}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => selection.onChange([])}
          >
            Clear
          </Button>
        </div>
      ) : null}

      <Table>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <TableHeader>
          <TableRow>
            {selection ? (
              <TableHead scope="col" className="w-10">
                <Checkbox
                  aria-label={allSelected ? 'Deselect all rows' : 'Select all rows'}
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(checked) => selection.onChange(checked === true ? allIds : [])}
                />
              </TableHead>
            ) : null}
            {columns.map((column) => {
              const active = sort?.columnId === column.id
              return (
                <TableHead
                  key={column.id}
                  scope="col"
                  aria-sort={
                    active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                  className={cn(column.align === 'right' && 'text-right', column.className)}
                >
                  {column.sortBy ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-chip transition-colors duration-[0.18s] hover:text-ink',
                        active && 'text-ink',
                      )}
                    >
                      <span className={cn(column.srOnlyHeader && 'sr-only')}>{column.header}</span>
                      {active ? (
                        sort?.direction === 'asc' ? (
                          <ArrowUp aria-hidden="true" className="size-3" />
                        ) : (
                          <ArrowDown aria-hidden="true" className="size-3" />
                        )
                      ) : (
                        <ChevronsUpDown aria-hidden="true" className="size-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    <span className={cn(column.srOnlyHeader && 'sr-only')}>{column.header}</span>
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length + (selection ? 1 : 0)}
                className="py-8 text-center"
              >
                {emptyMessage ?? 'Nothing here.'}
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((row) => {
              const id = rowId(row)
              const checked = selection?.selected.includes(id) ?? false
              return (
                <TableRow
                  key={id}
                  data-state={checked ? 'selected' : undefined}
                  className={cn(onRowClick && 'cursor-pointer hover:bg-tint')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selection ? (
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        aria-label={`Select ${id}`}
                        checked={checked}
                        onCheckedChange={(next) =>
                          selection.onChange(
                            next === true
                              ? [...selection.selected, id]
                              : selection.selected.filter((candidate) => candidate !== id),
                          )
                        }
                      />
                    </TableCell>
                  ) : null}
                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(column.align === 'right' && 'text-right', column.className)}
                    >
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * Keyset pagination controls. There is no page number because the API's cursor
 * is opaque and there is no total — inventing "page 4 of 12" would be a lie
 * that gets slower the more data a workspace has.
 */
export const CursorPager = ({
  hasMore,
  hasPrevious,
  onNext,
  onPrevious,
  count,
}: {
  hasMore: boolean
  hasPrevious: boolean
  onNext: () => void
  onPrevious: () => void
  count: number
}) => (
  <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
    <span className="font-mono text-[11.5px] text-muted-2">{count} shown</span>
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={!hasPrevious} onClick={onPrevious}>
        Previous
      </Button>
      <Button variant="outline" size="sm" disabled={!hasMore} onClick={onNext}>
        Next
      </Button>
    </div>
  </nav>
)
