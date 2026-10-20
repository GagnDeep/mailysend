import { describe, expect, it } from 'vitest'
// @ts-expect-error — the build scripts are untyped .mjs on purpose.
import { chooseKvNamespace, ownsItsData, scopeDataNames } from '../instance-names.mjs'
// @ts-expect-error — as above.
import { consumersOf, isMissingQueue, producersOf } from '../wrangler-output.mjs'

const config = (name: string) => ({
  name,
  d1_databases: [{ binding: 'DB', database_name: 'mailysend' }],
  r2_buckets: [{ binding: 'BUCKET', bucket_name: 'mailysend' }],
})

/**
 * The decision that cost one instance its identity.
 *
 * A Worker uploaded by the Deploy to Cloudflare button is already "deployed"
 * by the time its first build runs, so asking that question handed a brand new
 * `ptetrainer-mail` the previous instance's database — its users, its passkeys
 * and a banner announcing that the instance had moved. These cases are the
 * difference between the two questions.
 */
describe('whether a build may give an instance its own storage', () => {
  it('gives a never-built Worker its own, even though the dashboard already uploaded it', () => {
    expect(
      ownsItsData(config('ptetrainer-mail'), { builtBefore: false, hasOwnDatabase: false }),
    ).toBe(true)
  })

  it('leaves a Worker this build has run for before on the storage it is running on', () => {
    expect(ownsItsData(config('mailysend14'), { builtBefore: true, hasOwnDatabase: false })).toBe(
      false,
    )
  })

  it('keeps a Worker on its own database once it has one, built before or not', () => {
    for (const builtBefore of [true, false]) {
      expect(ownsItsData(config('mailysend16'), { builtBefore, hasOwnDatabase: true })).toBe(true)
    }
  })

  it('never renames the default deployment, which is the one that owns these names', () => {
    expect(ownsItsData(config('mailysend'), { builtBefore: false, hasOwnDatabase: false })).toBe(
      false,
    )
  })

  it('renames the database and the bucket together, so neither is left behind', () => {
    const target = config('ptetrainer-mail')
    const changes = scopeDataNames(target, { builtBefore: false, hasOwnDatabase: false })

    expect(target.d1_databases[0]?.database_name).toBe('ptetrainer-mail')
    expect(target.r2_buckets[0]?.bucket_name).toBe('ptetrainer-mail')
    expect(changes).toHaveLength(2)
  })

  it('leaves a name the operator chose themselves alone', () => {
    const target = {
      name: 'ptetrainer-mail',
      d1_databases: [{ binding: 'DB', database_name: 'our-shared-db' }],
      r2_buckets: [],
    }
    scopeDataNames(target, { builtBefore: false, hasOwnDatabase: false })
    expect(target.d1_databases[0]?.database_name).toBe('our-shared-db')
  })

  /**
   * The suppression list is the reason this matters more than tidiness: every
   * instance addresses it under the same default workspace id, so two
   * instances on one bare namespace collide key for key.
   */
  it('refuses to adopt a bare namespace for an instance that owns its data', () => {
    const namespaces = [
      { id: 'a', title: 'SUPPRESSIONS' },
      { id: 'b', title: 'ptetrainer-mail-SUPPRESSIONS' },
    ]
    expect(chooseKvNamespace(namespaces, 'SUPPRESSIONS', 'ptetrainer-mail', true)?.id).toBe('b')
    expect(chooseKvNamespace([namespaces[0]], 'SUPPRESSIONS', 'ptetrainer-mail', true)).toBe(
      undefined,
    )
  })
})

/**
 * `wrangler queues info` has no `--json`, so this is prose parsing, and the
 * regex it replaces captured the count off `Number of Consumers: 1` — which is
 * why every build reported each queue as "already consumed by 1".
 */
describe('reading wrangler queue output', () => {
  const info = [
    'Queue Name: ptetrainer-mail-send',
    'Queue ID: 6aa7bcd52d774c0fad4e67656889affc',
    'Number of Producers: 1',
    'Producers: worker:ptetrainer-mail',
    'Number of Consumers: 1',
    'Consumers: worker:ptetrainer-mail',
  ].join('\n')

  it('names the consumer, not the number of them', () => {
    expect(consumersOf(info)).toEqual(['ptetrainer-mail'])
    expect(producersOf(info)).toEqual(['ptetrainer-mail'])
  })

  it('reads several consumers off one line', () => {
    expect(consumersOf('Consumers: worker:one, worker:two')).toEqual(['one', 'two'])
  })

  it('says nothing rather than guessing when the line is absent', () => {
    expect(consumersOf('Queue Name: ms-send\nNumber of Consumers: 0')).toEqual([])
    expect(consumersOf('')).toEqual([])
  })

  /**
   * A missing queue is a fact about the account and may be acted on. A refused
   * token is an absence of facts and may not: treating it as "no queues, so
   * this Worker is new" is what would hand a running instance a fresh database.
   */
  it('separates a queue that is not there from a question that could not be asked', () => {
    expect(isMissingQueue('Queue "ms-send" does not exist. To create it, run: ...')).toBe(true)
    expect(isMissingQueue('Authentication error [code: 10000]')).toBe(false)
    expect(isMissingQueue('')).toBe(false)
  })
})
