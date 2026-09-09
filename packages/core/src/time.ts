/**
 * Time parsing for `scheduled_at` and automation `wait` durations.
 *
 * Resend accepts both ISO-8601 and natural language ("in 1 min", "tomorrow at
 * 9am"), and real callers use both. Anything we cannot parse confidently is
 * rejected rather than guessed at — silently scheduling mail for the wrong hour
 * is worse than a 422.
 */

const UNITS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
}

/** `"30m"`, `"2 days"`, `"1h30m"` → milliseconds. Null when unparseable. */
export const parseDuration = (input: string): number | null => {
  const matches = input.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/g)
  let total = 0
  let found = false
  for (const m of matches) {
    const unit = UNITS[m[2]!]
    if (!unit) return null
    total += Number.parseFloat(m[1]!) * unit
    found = true
  }
  return found ? total : null
}

export interface ScheduleParseResult {
  at: Date
  /** How we read the input, echoed in the API response so the caller can confirm. */
  interpretation: 'iso' | 'relative' | 'natural'
}

const CLOCK = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i

/** `"9am"` / `"14:30"` applied to a base date, in UTC. */
const applyClock = (base: Date, text: string): Date | null => {
  const m = text.match(CLOCK)
  if (!m) return null
  let hour = Number(m[1])
  const minute = Number(m[2] ?? 0)
  const meridiem = m[3]?.toLowerCase()
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  const out = new Date(base)
  out.setUTCHours(hour, minute, 0, 0)
  return out
}

export const parseScheduledAt = (input: string, now = new Date()): ScheduleParseResult | null => {
  const text = input.trim().toLowerCase()

  // ISO first: it is unambiguous, and a caller sending ISO deserves an exact answer.
  const iso = new Date(input)
  if (/\d{4}-\d{2}-\d{2}/.test(input) && !Number.isNaN(iso.getTime())) {
    return { at: iso, interpretation: 'iso' }
  }

  const relative = text.match(/^in\s+(.+)$/)
  if (relative) {
    const ms = parseDuration(relative[1]!)
    if (ms === null) return null
    return { at: new Date(now.getTime() + ms), interpretation: 'relative' }
  }

  if (text === 'now') return { at: now, interpretation: 'natural' }

  const dayOffset = text.startsWith('tomorrow') ? 1 : text.startsWith('today') ? 0 : null
  if (dayOffset !== null) {
    const base = new Date(now.getTime() + dayOffset * 86_400_000)
    const at =
      applyClock(base, text) ??
      (() => {
        const d = new Date(base)
        // No clock given: 09:00 UTC is a defensible default for "tomorrow", and
        // the interpretation is returned so the caller sees what we chose.
        d.setUTCHours(9, 0, 0, 0)
        return d
      })()
    return { at, interpretation: 'natural' }
  }

  // A bare duration ("30m") is accepted as relative — several SDK users send it.
  const bare = parseDuration(text)
  if (bare !== null) return { at: new Date(now.getTime() + bare), interpretation: 'relative' }

  return null
}

/** The window in which a message may be scheduled. Longer than a month is a mistake, not a plan. */
export const MAX_SCHEDULE_MS = 30 * 86_400_000

export const hourKey = (d: Date = new Date()): string =>
  d.toISOString().slice(0, 13).replace('T', '/')
export const dayKey = (d: Date = new Date()): string => d.toISOString().slice(0, 10)
export const monthKey = (d: Date = new Date()): string => d.toISOString().slice(0, 7)
