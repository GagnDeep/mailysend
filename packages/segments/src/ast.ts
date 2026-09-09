import type { ColumnName } from './fields.ts'

/**
 * The parsed form of an expression.
 *
 * The AST is deliberately *time-independent*: a `30d` window is stored as a
 * duration, not as the timestamp it resolves to. Resolution happens in the
 * compiler, against a `now` passed in. That is what lets a segment be parsed
 * once, cached, and recompiled every hour by the boundary sweep without the
 * cached copy silently referring to yesterday's clock.
 */

export type DurationUnit = 's' | 'm' | 'h' | 'd' | 'w'

export const DURATION_MS: Record<DurationUnit, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
}

export interface Duration {
  count: number
  unit: DurationUnit
  ms: number
}

export type FieldRef =
  | { kind: 'column'; name: ColumnName }
  /** `data.plan` / `data["seat count"]`, possibly nested: `data.billing.plan`. */
  | { kind: 'data'; path: string[] }

export type Literal =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'duration'; duration: Duration }

export type CompareOp =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'starts_with'
  | 'ends_with'

export type EngagementEvent = 'opened' | 'clicked' | 'sent' | 'bounced'

export type Sugar =
  | { kind: 'recent'; event: EngagementEvent; window: Duration }
  | { kind: 'never'; event: 'opened' | 'clicked' }
  | { kind: 'subscribed' }
  | { kind: 'bounced' }

export type Expr =
  | { type: 'and'; left: Expr; right: Expr }
  | { type: 'or'; left: Expr; right: Expr }
  | { type: 'not'; operand: Expr }
  | { type: 'compare'; field: FieldRef; op: CompareOp; value: Literal; offset: number }
  | { type: 'in'; field: FieldRef; values: Literal[]; offset: number }
  | { type: 'isNull'; field: FieldRef; negated: boolean; offset: number }
  /**
   * Sugar survives parsing instead of being desugared on the spot, because
   * describe.ts has to say "opened in the last 30 days" rather than the
   * mechanically-correct-but-useless "last open is not null and after
   * 2026-08-10T14:00:00Z". The compiler expands it; the printer does not.
   */
  | { type: 'sugar'; source: string; sugar: Sugar; offset: number }

/** A parse or compile failure, carrying the character offset for the editor caret. */
export class SegmentError extends Error {
  readonly offset: number
  readonly kind: 'syntax' | 'type'

  constructor(message: string, offset: number, kind: 'syntax' | 'type' = 'syntax') {
    super(message)
    this.name = 'SegmentError'
    this.offset = offset
    this.kind = kind
  }
}

const timestampFor = (event: EngagementEvent): ColumnName =>
  event === 'opened'
    ? 'last_open_at'
    : event === 'clicked'
      ? 'last_click_at'
      : event === 'sent'
        ? 'last_send_at'
        : 'last_open_at'

const counterFor = (event: EngagementEvent): ColumnName =>
  event === 'opened'
    ? 'open_count'
    : event === 'clicked'
      ? 'click_count'
      : event === 'sent'
        ? 'send_count'
        : 'bounce_count'

/**
 * Expands sugar into the real comparisons it stands for.
 *
 * `bounced_last_30d` is the odd one out: there is no `last_bounce_at` column,
 * so a *windowed* bounce predicate cannot be answered from the denormalised
 * columns at all. Rather than join `message_events` — which is exactly the cost
 * those columns exist to avoid — it degrades to "has ever bounced" and
 * describe.ts says so. Being visibly approximate beats being quietly slow.
 */
export const expandSugar = (node: Extract<Expr, { type: 'sugar' }>): Expr => {
  const { sugar, offset } = node
  switch (sugar.kind) {
    case 'recent': {
      if (sugar.event === 'bounced') {
        return { type: 'compare', field: col('bounce_count'), op: '>', value: num(0), offset }
      }
      return {
        type: 'compare',
        field: col(timestampFor(sugar.event)),
        op: '>',
        value: { kind: 'duration', duration: sugar.window },
        offset,
      }
    }
    case 'never':
      return {
        type: 'compare',
        field: col(counterFor(sugar.event)),
        op: '=',
        value: num(0),
        offset,
      }
    case 'subscribed':
      return {
        type: 'compare',
        field: col('unsubscribed'),
        op: '=',
        value: { kind: 'boolean', value: false },
        offset,
      }
    case 'bounced':
      return { type: 'compare', field: col('bounce_count'), op: '>', value: num(0), offset }
  }
}

const col = (name: ColumnName): FieldRef => ({ kind: 'column', name })
const num = (value: number): Literal => ({ kind: 'number', value })
