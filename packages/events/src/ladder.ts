import type { NormalizedEventType } from '@mailysend/contracts'
import { STATE_RANK, type StateName } from '@mailysend/contracts'

/**
 * The state ladder.
 *
 * Email events arrive out of order and more than once. Providers retry
 * webhooks, queues redeliver, and a `delivered` for one recipient can easily
 * land after a `bounced` for another. The usual response is to build an
 * ordering guarantee — sequence numbers, per-message serialisation, a lock.
 *
 * We do something cheaper and stronger: every status write is
 * `UPDATE … SET status = ?, state_rank = ? WHERE state_rank < ?`. A stale or
 * duplicated event simply matches no rows. Ordering stops being a requirement
 * rather than becoming a feature, which is why the event consumer can be a
 * plain stateless batch handler.
 *
 * The ranks are chosen so terminal negative states outrank the positive ladder:
 * once a message is a hard bounce, a late `delivered` must not resurrect it.
 */

export const eventToState: Record<NormalizedEventType, StateName> = {
  sent: 'sent',
  delivered: 'delivered',
  delivery_delayed: 'delivery_delayed',
  bounced: 'bounced',
  complained: 'complained',
  failed: 'failed',
  // A provider-side rejection never reached a mailbox, so it is a failure of
  // the send, not a delivery outcome.
  rejected: 'failed',
  opened: 'opened',
  clicked: 'clicked',
  // Unsubscribing says nothing about whether the message was delivered, so it
  // deliberately maps to the state it already implies rather than a new rung.
  unsubscribed: 'delivered',
}

export const rankFor = (type: NormalizedEventType): number => STATE_RANK[eventToState[type]]

export const stateFor = (type: NormalizedEventType): StateName => eventToState[type]

/**
 * Whether a transition should be written at all. Used by consumers that want to
 * skip work before touching the database, not as a substitute for the SQL
 * predicate — the predicate is the actual guarantee, because two consumers can
 * evaluate this simultaneously.
 */
export const advances = (currentRank: number, type: NormalizedEventType): boolean =>
  rankFor(type) > currentRank

/**
 * Opens and clicks are counted but do not always move the message's headline
 * status: a message that bounced for one recipient and was opened by another
 * should read as bounced. Rank ordering already encodes that.
 */
export const isEngagement = (type: NormalizedEventType): boolean =>
  type === 'opened' || type === 'clicked' || type === 'unsubscribed'

export const isTerminalFailure = (type: NormalizedEventType): boolean =>
  type === 'bounced' || type === 'failed' || type === 'rejected'
