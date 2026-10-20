import { describe, expect, it } from 'vitest'
import { logTime } from '../src/components/app/format.ts'

/**
 * The log column's timestamp.
 *
 * It was `clockTime`, which is the time of day and nothing else — so on a quiet
 * instance, where the newest eight messages span a week, Recent activity read
 * as a list of things that had all happened this afternoon. The date appears
 * only when it changes the meaning, which keeps a busy instance's column as
 * narrow as it was.
 */

const NOW = Date.parse('2026-10-20T14:00:00.000Z')

describe('logTime', () => {
  // Asserted on the presence of a month name rather than on its position,
  // because both of these are rendered in the reader's own locale.
  it('shows the clock alone for something from today', () => {
    expect(logTime('2026-10-20T09:30:00.000Z', NOW)).not.toMatch(/[A-Za-z]/)
  })

  it('shows the date as well for something from another day', () => {
    expect(logTime('2026-10-13T09:30:00.000Z', NOW)).toMatch(/[A-Za-z]/)
  })

  /** The hourly rollup key `Date` cannot parse — the chart labels come through here too. */
  it('reads an hourly rollup key rather than printing it raw', () => {
    expect(logTime('2026-10-20/09', NOW)).not.toContain('/')
  })

  it('hands back anything it cannot read, rather than "Invalid Date"', () => {
    expect(logTime('not a date', NOW)).toBe('not a date')
  })
})
