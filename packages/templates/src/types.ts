import type { TemplateEngine } from '@mailysend/contracts'
import type { z } from 'zod'

/** Mirrors the `engine` column on `templates`. */
export type Engine = z.infer<typeof TemplateEngine>

/**
 * Warnings are things the sender should know about but that must not fail a
 * render. A broadcast that stops half way because one contact is missing a
 * merge field is worse than one that goes out with a blank in it, so nothing in
 * this package throws on data problems — it records them, and the caller
 * decides whether to surface them in the UI or block a publish.
 */
export interface RenderWarning {
  code: WarningCode
  message: string
  /** Where it came from — a variable path, a selector, a url. */
  at?: string
}

export type WarningCode =
  | 'missing_variable'
  | 'unknown_helper'
  | 'unsupported_syntax'
  | 'raw_output_escaped'
  | 'empty_html'
  | 'text_generated'
  | 'subject_too_long'
  | 'subject_missing'
  | 'gmail_clipping'
  | 'image_missing_alt'
  | 'unsafe_url'
  | 'raw_html_placeholders'
  | 'uninlinable_css'
  | 'no_unsubscribe'
  | 'ast_invalid'

export interface RenderOptions {
  /**
   * Fold `<style>` rules into `style=` attributes. On by default: Gmail drops
   * `<style>` entirely in the clipped and forwarded views, and Outlook.com
   * rewrites it, so a template that only looks right with a style block only
   * looks right in half the inboxes.
   */
  inlineCss?: boolean
  /** Derive a text/plain part from the HTML when `text` is absent. */
  generateText?: boolean
  /** Locale for `formatDate` / `formatNumber`. */
  locale?: string
  /** Clock injection, so a rendered `{{formatDate}}` is stable under test. */
  now?: Date
  /** Sets `<html lang>` on generated wrappers. */
  lang?: string
}

export interface RenderResult {
  subject: string
  html: string
  text: string
  warnings: RenderWarning[]
}

export const warn = (code: WarningCode, message: string, at?: string): RenderWarning =>
  at === undefined ? { code, message } : { code, message, at }
