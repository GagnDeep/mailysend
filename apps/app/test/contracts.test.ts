import { EmailStatus, STATE_RANK } from '@mailysend/contracts'
import { describe, expect, it } from 'vitest'

/**
 * The two lists that have to be the same list.
 *
 * `STATE_RANK` defines the state ladder, and `stateFor()` writes whichever rung
 * an event maps to straight into `messages.status`. `EmailStatus` is what the
 * API promises that column can contain, and what the dashboard parses every
 * response with.
 *
 * They drifted: the ladder has `opened` at 50 and `clicked` at 60, and the
 * enum had neither. So the first time anybody opened a message, that row's
 * status became a value the dashboard's own schema rejected — and Zod rejects
 * the whole response, so the logs page read "Could not load recent activity"
 * for every message rather than for the opened one. Nothing else could see it:
 * the server does not validate its own output, the SDK conformance check
 * compares the SDK to the contract rather than the contract to the ladder, and
 * a status written by an event is invisible to a typechecker.
 */
describe('the status vocabulary', () => {
  it('offers exactly the rungs of the state ladder', () => {
    expect([...EmailStatus.options].sort()).toEqual(Object.keys(STATE_RANK).sort())
  })

  it('orders the enum by rank, so the ladder reads in order', () => {
    const ranked = [...EmailStatus.options].sort((a, b) => STATE_RANK[a] - STATE_RANK[b])
    expect(EmailStatus.options).toEqual(ranked)
  })
})
