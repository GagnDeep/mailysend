import { err, style } from '../term.ts'
import type { Diagnostic } from './diagnostics.ts'

/**
 * Diagnostics are printed all at once and grouped by line, because a template
 * usually fails for one *reason* expressed in several places — an author who
 * used `formatDate()` used it four times — and fixing them one round-trip at a
 * time is the difference between a two-minute migration and an afternoon.
 */
export const reportDiagnostics = (filename: string, diagnostics: Diagnostic[]) => {
  err()
  err(`${style.red('Cannot compile')} ${style.bold(filename)}`)
  err()

  for (const d of diagnostics) {
    const where = style.dim(`${filename}:${d.loc.line}:${d.loc.column}`)
    err(`  ${where}  ${style.yellow(d.code)}`)
    err(`    ${d.message}`)
    if (d.excerpt !== '') err(`    ${style.dim(d.excerpt)}`)
    err()
  }

  const unique = new Set(diagnostics.map((d) => d.code)).size
  err(
    style.dim(
      `${diagnostics.length} problem${diagnostics.length === 1 ? '' : 's'}, ` +
        `${unique} kind${unique === 1 ? '' : 's'}. ` +
        'The render worker never evaluates an expression, so each of these has ' +
        'to be expressed as data or moved into the send payload.',
    ),
  )
  err()
}
