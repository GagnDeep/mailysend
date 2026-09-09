/**
 * Prefixed ULIDs.
 *
 * A ULID is 48 bits of millisecond timestamp followed by 80 bits of randomness,
 * encoded in Crockford base32. Two properties make it the right identifier here
 * and a UUIDv4 the wrong one:
 *
 *   - It sorts lexicographically by creation time. `WHERE id > ?` is therefore a
 *     time range scan on the primary key, which is how every list endpoint
 *     paginates without an offset and how R2 archive prefixes partition.
 *   - It is generated client-side with no coordination, which is what lets the
 *     API mint a message id *before* the provider is called.
 *
 * That last point is the single decision that makes multi-provider sending
 * possible: the id we return is ours, stable across failover and across a later
 * migration from one transport to another. `provider_message_id` is recorded
 * and queryable, but is never the identity.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32: no I, L, O, U
const TIME_LEN = 10
const RANDOM_LEN = 16

const encodeTime = (now: number): string => {
  let out = ''
  let t = now
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    out = ENCODING[t % 32] + out
    t = Math.floor(t / 32)
  }
  return out
}

const encodeRandom = (): string => {
  const bytes = new Uint8Array(RANDOM_LEN)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < RANDOM_LEN; i++) out += ENCODING[bytes[i]! % 32]
  return out
}

export const ulid = (seedTime = Date.now()): string => encodeTime(seedTime) + encodeRandom()

export const ID_PREFIXES = {
  email: 'em',
  domain: 'dom',
  audience: 'aud',
  contact: 'con',
  broadcast: 'bc',
  template: 'tpl',
  segment: 'seg',
  automation: 'aut',
  webhook: 'wh',
  apiKey: 'key',
  thread: 'thr',
  message: 'msg',
  workspace: 'ws',
  user: 'usr',
  event: 'ev',
  attachment: 'att',
  suppression: 'sup',
  link: 'lnk',
  enrollment: 'enr',
  delivery: 'del',
  incident: 'inc',
  placementTest: 'plt',
  inbound: 'inb',
} as const

export type IdKind = keyof typeof ID_PREFIXES

export const newId = <K extends IdKind>(
  kind: K,
  seedTime?: number,
): `${(typeof ID_PREFIXES)[K]}_${string}` => `${ID_PREFIXES[kind]}_${ulid(seedTime)}` as never

/** Recovers the creation time from an id, for range queries and archive paths. */
export const idTime = (id: string): Date => {
  const body = id.includes('_') ? id.slice(id.indexOf('_') + 1) : id
  let t = 0
  for (let i = 0; i < TIME_LEN; i++) t = t * 32 + ENCODING.indexOf(body[i]!)
  return new Date(t)
}

export const isId = <K extends IdKind>(kind: K, value: unknown): value is string =>
  typeof value === 'string' &&
  value.startsWith(`${ID_PREFIXES[kind]}_`) &&
  /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value.slice(ID_PREFIXES[kind].length + 1))

/**
 * A lower-bound id for a timestamp. Lets `WHERE id >= ?` express "since 9am"
 * against the primary key, with no separate created_at index to maintain.
 */
export const idLowerBound = <K extends IdKind>(kind: K, at: Date | number): string =>
  `${ID_PREFIXES[kind]}_${encodeTime(typeof at === 'number' ? at : at.getTime())}${'0'.repeat(RANDOM_LEN)}`

export const idUpperBound = <K extends IdKind>(kind: K, at: Date | number): string =>
  `${ID_PREFIXES[kind]}_${encodeTime(typeof at === 'number' ? at : at.getTime())}${'Z'.repeat(RANDOM_LEN)}`
