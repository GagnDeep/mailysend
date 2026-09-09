/**
 * Formatting the dashboard agrees on.
 *
 * All of it is locale-aware and none of it guesses a timezone: the log row
 * shows the reader's own clock, and the tooltip shows the ISO string that the
 * API actually returned, so a support conversation can quote either.
 */

export const num = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : value.toLocaleString()

export const pct = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined ? '—' : `${value.toFixed(digits)}%`

/** A ratio expressed as a percentage, with the zero-denominator case named. */
export const ratio = (numerator: number, denominator: number, digits = 1): string =>
  denominator === 0 ? '—' : `${((numerator / denominator) * 100).toFixed(digits)}%`

export const clockTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString(undefined, { hour12: false })
}

export const dateTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export const shortDate = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
]

export const relativeTime = (iso: string, now: number = Date.now()): string => {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const delta = then - now
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(delta) >= ms || unit === 'second') {
      return formatter.format(Math.round(delta / ms), unit)
    }
  }
  return 'just now'
}

export const bytes = (value: number): string => {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export const duration = (ms: number | null | undefined): string =>
  ms === null || ms === undefined ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`

/** `Name <addr@example.com>` → `addr@example.com`, for the columns that need one. */
export const bareAddress = (value: string): string => {
  const match = value.match(/<([^>]+)>\s*$/)
  return (match?.[1] ?? value).trim()
}

export const initials = (name: string | null, email: string): string => {
  const source = name?.trim() || email
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}
