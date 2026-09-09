/**
 * Template rendering.
 *
 * One entry point (`renderTemplate`) over four engines, plus the HTML
 * post-processing the send path applies afterwards. Worker-safe throughout:
 * nothing here evaluates a string as code, and the one dependency that cannot
 * run on Workers (`mjml`) is behind a runtime-guarded dynamic import.
 */

export type {
  AstComponent,
  AstCondition,
  AstConditional,
  AstElement,
  AstExpr,
  AstFilter,
  AstInterpolation,
  AstLiteral,
  AstLoop,
  AstNode,
  AstPath,
  AstText,
  AstValue,
  CompareOp,
  ComponentName,
  FilterName,
  TemplateAst,
  ValidateAstResult,
} from './ast.ts'
export {
  AST_VERSION,
  AstNodeSchema,
  AstPathSchema,
  astDocument,
  COMPONENTS,
  extractAstVariables,
  renderAst,
  TemplateAstSchema,
  validateAst,
} from './ast.ts'
export type { HandlebarsInput, HandlebarsOutput } from './handlebars.ts'

export {
  extractHandlebarsVariables,
  HELPER_NAMES,
  renderHandlebars,
} from './handlebars.ts'
export { decodeEntities, escapeHtml, escapeUrlAttr, isSafeUrl } from './html.ts'
export type { InlineResult } from './inline.ts'
export { ensureTableLayout, inlineCss } from './inline.ts'
export type { MjmlOptions, MjmlResult } from './mjml.ts'
export { isNodeRuntime, MjmlUnavailableError, renderMjml } from './mjml.ts'
export type { ExtractVariablesInput } from './preview.ts'
export { extractVariables, generatePreviewData } from './preview.ts'
export type { RenderTemplateInput } from './render.ts'
export { htmlToText, renderTemplate } from './render.ts'
export type { TrackingOptions, UnsubscribeOptions } from './tracking.ts'
export {
  hasUnsubscribe,
  injectTracking,
  injectUnsubscribe,
  NO_TRACK_ATTRIBUTE,
} from './tracking.ts'
export type {
  Engine,
  RenderOptions,
  RenderResult,
  RenderWarning,
  WarningCode,
} from './types.ts'
