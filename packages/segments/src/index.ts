/**
 * The segment DSL.
 *
 * `expression` on the `segments` table is source text; it is parsed to an AST,
 * compiled to a parameterised WHERE fragment, and never interpolated. The
 * column registry in fields.ts is the only place a SQL identifier can come
 * from, which is what makes a user-authored expression safe to run.
 */

export type {
  CompareOp,
  Duration,
  DurationUnit,
  EngagementEvent,
  Expr,
  FieldRef,
  Literal,
  Sugar,
} from './ast.ts'
export { DURATION_MS, expandSugar, SegmentError } from './ast.ts'
export type { CompiledSegment, CompileOptions, RelativeWindow } from './compile.ts'
export { compile, compileExpression, relativeWindows } from './compile.ts'
export { describe, formatExpression } from './describe.ts'
export type { ColumnDef, ColumnName, FieldType } from './fields.ts'
export { COLUMNS, columnNames, isColumn } from './fields.ts'
export { parse, tokenize } from './parser.ts'

export type {
  BoundarySweepResult,
  PreviewContact,
  PreviewResult,
  RecomputeResult,
  RunOptions,
  SegmentSpec,
} from './runner.ts'
export {
  boundarySweep,
  countSegment,
  previewSegment,
  recomputeDelta,
  recomputeFull,
} from './runner.ts'
