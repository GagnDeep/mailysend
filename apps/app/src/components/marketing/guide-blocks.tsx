import {
  Callout,
  cn,
  FlowConnector,
  FlowNode,
  type FlowTone,
  MonoChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mailysend/ui'
import type { ReactNode } from 'react'

/**
 * The blocks a guide is built from.
 *
 * Twenty-six guides written by different hands will invent twenty-six ways to
 * show the same four shapes — a reference table, a sequence, a contrast, a
 * one-line takeaway — and a reader who has to relearn the page furniture at
 * every guide is exactly the reader the brief said must never feel lost. These
 * are those four shapes, once.
 *
 * All of them render fully server-side. Guide prose is the SEO asset and it
 * lands in llms-full.txt, so nothing here may hide content behind interaction.
 */

/**
 * The one-sentence answer, before the explanation.
 *
 * Someone who already knows the area wants the conclusion and wants to leave;
 * someone who does not wants to know what they are about to read. The same
 * line serves both, and it costs the second reader nothing.
 */
export const Takeaway = ({ children }: { children: ReactNode }) => (
  <div className="mb-5 flex gap-3 rounded-tile border border-line-soft bg-card p-4">
    <MonoChip size="sm" tone="accent">
      TL;DR
    </MonoChip>
    <p className="m-0 text-[15px] leading-[1.6] text-ink">{children}</p>
  </div>
)

export interface FactTableProps {
  columns: string[]
  rows: Array<Array<ReactNode>>
  /** First column rendered mono — it is nearly always an identifier. */
  monoFirst?: boolean
  caption?: string
  className?: string
}

/**
 * The reference table a guide keeps reaching for.
 *
 * Wrapped in its own overflow container because these carry real identifiers —
 * `ms-automation-triggers`, `_dmarc.example.com` — which do not wrap, and a
 * table that widens the page body is worse on a phone than one that scrolls.
 */
export const FactTable = ({
  columns,
  rows,
  monoFirst = true,
  caption,
  className,
}: FactTableProps) => (
  <div className={cn('my-5 overflow-x-auto', className)}>
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={String(row[0])}>
            {row.map((cell, index) => (
              <TableCell
                // The row's first cell is the key; the column name identifies
                // the cell within it. Neither is the array index.
                key={`${String(row[0])}:${columns[index] ?? index}`}
                className={cn(index === 0 && monoFirst && 'font-mono text-[13px] text-ink')}
              >
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
    {caption ? <p className="mt-2 mb-0 text-[13px] text-muted-2">{caption}</p> : null}
  </div>
)

export interface DiagramStep {
  kicker?: string
  title: ReactNode
  meta?: ReactNode
  tone?: FlowTone
}

/**
 * A sequence, as boxes and arrows.
 *
 * Vertical on a phone and horizontal from `md` up, because these are usually
 * four or five hops and a five-across row on a 390px screen is five unreadable
 * boxes. Boxes and arrows rather than an SVG so it reflows and can be read out
 * in order.
 */
export const Diagram = ({ steps, className }: { steps: DiagramStep[]; className?: string }) => (
  <div
    className={cn('my-5 flex flex-col items-stretch gap-2 md:flex-row md:items-center', className)}
  >
    {steps.map((step, index) => (
      <div
        key={typeof step.title === 'string' ? step.title : `${step.kicker}-${index}`}
        className="contents"
      >
        {index > 0 ? <FlowConnector className="rotate-90 self-center md:rotate-0" /> : null}
        <FlowNode
          kicker={step.kicker}
          title={step.title}
          meta={step.meta}
          tone={step.tone}
          className="flex-1"
        />
      </div>
    ))}
  </div>
)

export interface ContrastSide {
  label: string
  tone: 'good' | 'bad' | 'neutral'
  points: ReactNode[]
}

/**
 * Two things, side by side, with the difference visible before it is read.
 *
 * The shape a guide falls into constantly — hard bounce against soft, instance
 * mode against cohort, what 250 means against what it does not — and the shape
 * that reads worst as consecutive paragraphs, because the reader has to hold
 * the first one in their head while reading the second.
 */
export const Contrast = ({ sides, className }: { sides: ContrastSide[]; className?: string }) => (
  <div className={cn('my-5 grid gap-3 md:grid-cols-2', className)}>
    {sides.map((side) => (
      <div
        key={side.label}
        className={cn(
          'rounded-tile border p-4',
          side.tone === 'good' && 'border-positive/40 bg-card',
          side.tone === 'bad' && 'border-accent-border bg-accent-soft',
          side.tone === 'neutral' && 'border-line-soft bg-card',
        )}
      >
        <div className="mb-2.5 font-mono text-[11.5px] tracking-[0.08em] text-muted-2 uppercase">
          {side.label}
        </div>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {/* A point is a prose fragment with no identity of its own, so the key
              is built from its position before the map rather than inside it. */}
          {side.points
            .map((point, index) => ({ point, key: `${side.label}:${index}` }))
            .map(({ point, key }) => (
              <li
                key={key}
                className="text-[14.5px] leading-[1.6] text-muted before:mr-2 before:text-accent before:content-['—']"
              >
                {point}
              </li>
            ))}
        </ul>
      </div>
    ))}
  </div>
)

/**
 * The thing that bites, in the place it bites.
 *
 * A thin alias over `Callout` so a guide does not have to remember which
 * variant means "this will cost you an afternoon" — and so the answer is the
 * same in all twenty-six.
 */
export const Gotcha = ({ title, children }: { title: string; children: ReactNode }) => (
  <Callout variant="warn" title={title.toUpperCase()}>
    {children}
  </Callout>
)
