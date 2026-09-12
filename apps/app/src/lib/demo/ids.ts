/**
 * Stable, schema-shaped identifiers for the tour.
 *
 * The fixtures are parsed by the same Zod schemas the API validates against —
 * see `router.ts` for why — and those schemas say an id is `<prefix>_` followed
 * by 26 characters of Crockford base32. So the demo mints real-looking ids
 * rather than `dom_1`, and mints them deterministically: a URL like
 * `/app/domains/dom_…` has to survive a page reload, which it would not if the
 * ids were random per module load.
 */

/** Crockford base32 with I, L, O and U removed, exactly as the contract's regex. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A tiny deterministic hash, so the same seed always produces the same id. */
const hash = (seed: string): number => {
  let h = 2_166_136_261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16_777_619)
  }
  return h >>> 0
}

/**
 * The time half of a ULID, so ids sort by age the way real ones do. Frozen to a
 * date rather than `Date.now()`: two ids minted either side of a millisecond
 * boundary would otherwise disagree between a server render and a hydration.
 */
const EPOCH = Date.UTC(2026, 7, 1)

const encode = (value: number, length: number): string => {
  let out = ''
  let n = value
  for (let i = 0; i < length; i++) {
    out = (ALPHABET[n % 32] as string) + out
    n = Math.floor(n / 32)
  }
  return out
}

export const demoId = (prefix: string, seed: string, ageMinutes = 0): string => {
  const time = EPOCH + ageMinutes * 60_000
  const random = hash(`${prefix}:${seed}`)
  return `${prefix}_${encode(time, 10)}${encode(random, 8)}${encode(hash(seed.split('').reverse().join('')), 8)}`
}
