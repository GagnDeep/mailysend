import { cn, Eyebrow } from '@mailysend/ui'
import type { ReactNode } from 'react'

/**
 * The frame every interactive widget on a guide sits in.
 *
 * Eleven widgets across twenty-six guides have to read as one system, and the
 * frame is what does that: a label saying what the thing is, a line saying
 * where its answer comes from, the controls, and the result.
 *
 * `source` is not decoration. Several of these widgets import the product's own
 * functions and run them in your browser, and a reader has no way to tell that
 * apart from a prose restatement unless the page says so — which is the whole
 * reason the widgets import real code instead of re-implementing it.
 *
 * ── SSR rules, non-negotiable ───────────────────────────────────────────────
 * `prerender.failOnError` is on, so one throw during prerender kills the build
 * for all forty-two pages. No `window`, `document` or `crypto.subtle` at module
 * scope or during render; initial state from literals only, never `Date.now()`
 * or `Math.random()` — a hydration mismatch is console-level and would ship
 * silently, which is worse than a build failure.
 *
 * And the content must render server-side. A widget's output is indexable prose
 * and lands in llms-full.txt, so a decision tree renders every leaf under the
 * control rather than only the currently selected one.
 */
export const WidgetShell = ({
  title,
  source,
  children,
  className,
}: {
  title: string
  /** Where the answer comes from — name the module when it is real code. */
  source: ReactNode
  children: ReactNode
  className?: string
}) => (
  <div className={cn('rounded-card border border-line bg-card p-5 sm:p-6', className)}>
    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
      <Eyebrow as="span" className="text-[10.5px]">
        {title}
      </Eyebrow>
    </div>
    <p className="mt-0 mb-4 text-[13px] leading-[1.5] text-muted-2">{source}</p>
    {children}
  </div>
)

/** The result panel every widget ends with, so an answer always looks the same. */
export const WidgetResult = ({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'positive' | 'warning'
  className?: string
}) => (
  <div
    className={cn(
      'rounded-tile border p-4 text-[14px] leading-[1.6]',
      tone === 'neutral' && 'border-line bg-tint text-ink',
      tone === 'positive' && 'border-positive/25 bg-positive-bg text-ink',
      tone === 'warning' && 'border-accent-border bg-accent-soft text-ink',
      className,
    )}
  >
    {children}
  </div>
)

/** A labelled control row, so every widget's inputs line up with every other's. */
export const WidgetField = ({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: ReactNode
  children: ReactNode
}) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink">
      {label}
    </label>
    {children}
    {hint ? <span className="text-[12.5px] text-muted-2">{hint}</span> : null}
  </div>
)
