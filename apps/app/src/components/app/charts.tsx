import { cn } from '@mailysend/ui'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  BreakdownRecord,
  EngagementSplitRecord,
  TimeseriesPointRecord,
} from '~/lib/api-client.ts'
import { num } from './format.ts'

/**
 * The only file in the app that imports `recharts`.
 *
 * Two things are true of every chart here. It is decorative — the SVG is
 * `aria-hidden` and the same numbers are repeated in a real `<table>`, because
 * a canvas of `<path>` elements is not a way to read a figure with a screen
 * reader, a keyboard, or a printer. And it owns no colours: every fill is a
 * token custom property, so the charts move when the theme does instead of
 * drifting into a private palette.
 */

const AXIS_TICK = {
  fill: 'var(--color-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
} as const

const TOOLTIP_CONTENT = {
  background: 'var(--color-card)',
  border: '1px solid var(--color-line-soft)',
  borderRadius: 'var(--radius-md)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--color-ink)',
} as const

const TOOLTIP_LABEL = { color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' } as const

/**
 * Recharts animates on mount by default and has no notion of the media query,
 * so the preference has to be read here and handed to every series.
 */
const usePrefersReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}

interface ChartFrameProps {
  title: string
  caption?: ReactNode
  height: number
  empty?: boolean
  emptyMessage?: string
  children: ReactNode
  /** The same numbers as a real table, visually hidden but read and printed. */
  table: ReactNode
  className?: string
}

const ChartFrame = ({
  title,
  caption,
  height,
  empty = false,
  emptyMessage = 'No data in this window.',
  children,
  table,
  className,
}: ChartFrameProps) => (
  <figure className={cn('m-0 rounded-tile border border-line-soft bg-card p-4', className)}>
    <figcaption className="ms-eyebrow text-[10.5px] text-muted-2">{title}</figcaption>
    {caption ? <p className="m-0 mt-1.5 text-[13px] leading-snug text-muted">{caption}</p> : null}
    {empty ? (
      <p className="m-0 mt-4 text-[14px] text-muted">{emptyMessage}</p>
    ) : (
      <>
        <div aria-hidden="true" className="mt-3 w-full" style={{ height }}>
          {children}
        </div>
        {table}
      </>
    )}
  </figure>
)

const DataTable = ({
  caption,
  headers,
  rows,
}: {
  caption: string
  headers: string[]
  rows: (string | number)[][]
}) => (
  <table className="sr-only">
    <caption>{caption}</caption>
    <thead>
      <tr>
        {headers.map((header) => (
          <th key={header} scope="col">
            {header}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={String(row[0])}>
          <th scope="row">{row[0]}</th>
          {row.slice(1).map((cell, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional by column.
            <td key={index}>{cell}</td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
)

// ---------------------------------------------------------------------------
// Timeseries
// ---------------------------------------------------------------------------

const TIMESERIES_SERIES = [
  { key: 'sent', label: 'Sent', color: 'var(--color-ink)' },
  { key: 'delivered', label: 'Delivered', color: 'var(--color-positive)' },
  { key: 'opened', label: 'Opened', color: 'var(--color-accent)' },
  { key: 'clicked', label: 'Clicked', color: 'var(--color-accent-on-dark)' },
] as const

export interface TimeseriesChartProps {
  title: string
  caption?: ReactNode
  points: TimeseriesPointRecord[]
  /** How to render a bucket on the axis; the caller knows the granularity. */
  formatBucket?: (bucket: string) => string
  height?: number
}

export const TimeseriesChart = ({
  title,
  caption,
  points,
  formatBucket = (bucket) => bucket,
  height = 260,
}: TimeseriesChartProps) => {
  const reducedMotion = usePrefersReducedMotion()
  const data = points.map((point) => ({ ...point, label: formatBucket(point.bucket) }))

  return (
    <ChartFrame
      title={title}
      caption={caption}
      height={height}
      empty={data.length === 0}
      table={
        <DataTable
          caption={title}
          headers={['Bucket', ...TIMESERIES_SERIES.map((series) => series.label)]}
          rows={data.map((point) => [
            point.label,
            num(point.sent),
            num(point.delivered),
            num(point.opened),
            num(point.clicked),
          ])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {TIMESERIES_SERIES.map((series) => (
              <linearGradient
                key={series.key}
                id={`ms-fill-${series.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={series.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={series.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="var(--color-line-soft)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-line-soft)' }}
            minTickGap={24}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(value: number) => num(value)}
          />
          <RechartsTooltip contentStyle={TOOLTIP_CONTENT} labelStyle={TOOLTIP_LABEL} />
          {TIMESERIES_SERIES.map((series) => (
            <Area
              key={series.key}
              type="monotone"
              dataKey={series.key}
              name={series.label}
              stroke={series.color}
              fill={`url(#ms-fill-${series.key})`}
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={!reducedMotion}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

// ---------------------------------------------------------------------------
// Breakdowns
// ---------------------------------------------------------------------------

export type BreakdownMetric = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced'

export interface BreakdownChartProps {
  title: string
  caption?: ReactNode
  rows: BreakdownRecord[]
  metric?: BreakdownMetric
  /** Falls back to the raw key; domains and tags both arrive as opaque strings. */
  formatKey?: (key: string) => string
  className?: string
}

export const BreakdownChart = ({
  title,
  caption,
  rows,
  metric = 'delivered',
  formatKey = (key) => key,
  className,
}: BreakdownChartProps) => {
  const reducedMotion = usePrefersReducedMotion()
  const data = rows.map((row) => ({ ...row, label: formatKey(row.key) }))
  const height = Math.max(120, data.length * 30 + 24)

  return (
    <ChartFrame
      title={title}
      caption={caption}
      height={height}
      empty={data.length === 0}
      emptyMessage="Nothing grouped under this dimension yet."
      className={className}
      table={
        <DataTable
          caption={title}
          headers={['Key', 'Sent', 'Delivered', 'Opened', 'Clicked', 'Bounced']}
          rows={data.map((row) => [
            row.label,
            num(row.sent),
            num(row.delivered),
            num(row.opened),
            num(row.clicked),
            num(row.bounced),
          ])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-line-soft)" horizontal={false} />
          <XAxis
            type="number"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-line-soft)' }}
            tickFormatter={(value: number) => num(value)}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={116}
          />
          <RechartsTooltip
            cursor={{ fill: 'var(--color-line-soft)' }}
            contentStyle={TOOLTIP_CONTENT}
            labelStyle={TOOLTIP_LABEL}
          />
          <Bar
            dataKey={metric}
            name={metric}
            fill="var(--color-accent)"
            radius={[0, 5, 5, 0]}
            barSize={14}
            isAnimationActive={!reducedMotion}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

// ---------------------------------------------------------------------------
// Engagement split
// ---------------------------------------------------------------------------

/**
 * The five classes the edge assigns to every open and click. Nothing is
 * discarded, so this chart is the whole population and `human` is the subset
 * the rest of the screen defaults to.
 */
export const AUDIENCE_CLASS_LABEL: Record<string, string> = {
  human: 'Human',
  mpp: 'Apple MPP',
  proxy_prefetch: 'Gmail proxy',
  scanner: 'Security scanner',
  bot: 'Bot',
}

export interface EngagementSplitChartProps {
  title: string
  caption?: ReactNode
  rows: EngagementSplitRecord[]
  className?: string
}

export const EngagementSplitChart = ({
  title,
  caption,
  rows,
  className,
}: EngagementSplitChartProps) => {
  const reducedMotion = usePrefersReducedMotion()
  const data = rows.map((row) => ({
    ...row,
    label: AUDIENCE_CLASS_LABEL[row.audience_class] ?? row.audience_class,
  }))
  const height = Math.max(140, data.length * 44 + 24)

  return (
    <ChartFrame
      title={title}
      caption={caption}
      height={height}
      empty={data.length === 0}
      emptyMessage="No opens or clicks classified yet."
      className={className}
      table={
        <DataTable
          caption={title}
          headers={['Audience class', 'Opens', 'Clicks']}
          rows={data.map((row) => [row.label, num(row.opens), num(row.clicks)])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-line-soft)" horizontal={false} />
          <XAxis
            type="number"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-line-soft)' }}
            tickFormatter={(value: number) => num(value)}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={132}
          />
          <RechartsTooltip
            cursor={{ fill: 'var(--color-line-soft)' }}
            contentStyle={TOOLTIP_CONTENT}
            labelStyle={TOOLTIP_LABEL}
          />
          <Bar
            dataKey="opens"
            name="Opens"
            fill="var(--color-accent)"
            radius={[0, 5, 5, 0]}
            barSize={12}
            isAnimationActive={!reducedMotion}
          />
          <Bar
            dataKey="clicks"
            name="Clicks"
            fill="var(--color-positive-bright)"
            radius={[0, 5, 5, 0]}
            barSize={12}
            isAnimationActive={!reducedMotion}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
