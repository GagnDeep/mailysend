// biome-ignore-all lint/suspicious/noArrayIndexKey: the entries are prose, carry no id, and never reorder.

import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { Eyebrow } from './eyebrow.tsx'

export interface GainLossListProps {
  gains: ReactNode[]
  losses: ReactNode[]
  gainsLabel?: string
  lossesLabel?: string
  className?: string
}

/**
 * "What you gain / what you take on" from the Compare page. The `−` is U+2212,
 * not a hyphen, so it optically matches the `+` above it; both are hidden from
 * the accessibility tree because the group heading already says which list
 * this is, and "plus minus plus minus" read aloud is meaningless.
 */
const Row = ({ glyph, tone, children }: { glyph: string; tone: string; children: ReactNode }) => (
  <li className="flex gap-2.5">
    <span aria-hidden="true" className={cn('font-bold', tone)}>
      {glyph}
    </span>
    <span>{children}</span>
  </li>
)

export const GainLossList = ({
  gains,
  losses,
  gainsLabel = 'What you gain',
  lossesLabel = 'What you take on',
  className,
}: GainLossListProps) => (
  <div className={cn('rounded-panel border border-line bg-card p-6', className)}>
    <Eyebrow>{gainsLabel}</Eyebrow>
    <ul className="mt-3.5 flex list-none flex-col gap-2.5 p-0 text-[14.5px] leading-[1.6]">
      {gains.map((gain, i) => (
        <Row key={`gain-${i}`} glyph="+" tone="text-positive">
          {gain}
        </Row>
      ))}
    </ul>
    <Eyebrow className="mt-5">{lossesLabel}</Eyebrow>
    <ul className="mt-3.5 flex list-none flex-col gap-2.5 p-0 text-[14.5px] leading-[1.6]">
      {losses.map((loss, i) => (
        <Row key={`loss-${i}`} glyph="−" tone="text-warning">
          {loss}
        </Row>
      ))}
    </ul>
  </div>
)
