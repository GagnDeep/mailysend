import { describe, expect, it } from 'vitest'
import { ActorBase } from '../src/server/actor-base.ts'
import * as worker from '../src/server.ts'

/**
 * The exported Durable Object classes.
 *
 * This is the shape of bug that neither a typecheck nor the rest of this suite
 * can see: on Node the actors are constructed directly by `NodeActorRegistry`
 * and every method works, while on Workers the same classes were bound
 * successfully, resolved successfully, and then refused every call — "the
 * receiving Durable Object does not support RPC, because its class was not
 * declared with `extends DurableObject`". A send reported that sentence as its
 * reason for failing.
 *
 * So these assertions are about the export contract rather than about
 * behaviour: every class named in `wrangler.jsonc` exists, extends the base
 * that the Cloudflare build swaps for the real one, and carries its actor's
 * methods where the RPC layer looks for them — on the prototype.
 */

/** Exactly the `class_name` values in `apps/app/wrangler.jsonc`. */
const BOUND = {
  SendingDomainDO: ['setVerification', 'getVerification', 'reserve', 'snapshot'],
  BroadcastDO: ['alarm'],
  BroadcastCounterDO: [],
  WebhookEndpointDO: ['alarm'],
  ScheduleShardDO: ['alarm'],
  MailboxDO: ['markRead'],
  SegmentDO: ['alarm', 'register', 'unregister'],
  AutomationCohortDO: ['alarm'],
  AutomationRunDO: ['alarm', 'start'],
  // The live socket's 101 comes back from `fetch`, so it has to survive the
  // wrapper like any other method.
  WorkspaceHubDO: ['publish', 'fetch', 'recent', 'connectionCount'],
} as const

describe('the exported Durable Objects', () => {
  it('exports one class per binding in wrangler.jsonc', () => {
    for (const name of Object.keys(BOUND)) {
      expect(typeof (worker as Record<string, unknown>)[name]).toBe('function')
    }
  })

  it('extends the base the Cloudflare build swaps for a real DurableObject', () => {
    for (const name of Object.keys(BOUND)) {
      const Klass = (worker as unknown as Record<string, new (...a: never[]) => unknown>)[name]
      expect(Object.getPrototypeOf(Klass)).toBe(ActorBase)
    }
  })

  it('puts each actor method on the prototype, where RPC looks for it', () => {
    for (const [name, methods] of Object.entries(BOUND)) {
      const Klass = (worker as unknown as Record<string, { prototype: object }>)[name]
      for (const method of methods) {
        expect(
          Object.getOwnPropertyDescriptor(Klass?.prototype ?? {}, method),
          `${name}.${method} is missing from the prototype`,
        ).toBeTruthy()
      }
    }
  })

  it('forwards a call to the actor it holds, with its arguments and its answer', async () => {
    const stored = new Map<string, unknown>()
    const ctx = {
      id: { toString: () => 'SendingDomain:ws_default:acme.dev' },
      storage: {
        get: async (key: string) => stored.get(key),
        put: async (key: string, value: unknown) => {
          stored.set(key, value)
        },
        delete: async (key: string) => stored.delete(key),
        list: async () => new Map(),
        setAlarm: async () => {},
        deleteAlarm: async () => {},
      },
      blockConcurrencyWhile: <T>(fn: () => Promise<T>) => fn(),
      waitUntil: () => {},
    }

    const instance = new worker.SendingDomainDO(ctx as never, {} as never)
    await instance.setVerification({
      status: 'verified',
      checkedAt: '2026-09-10T00:00:00.000Z',
      records: [{ name: 'acme.dev', record: 'TXT', status: 'verified' }],
    })

    // Through the wrapper, into the actor, into storage, and back out.
    await expect(instance.getVerification()).resolves.toMatchObject({ status: 'verified' })
  })
})
