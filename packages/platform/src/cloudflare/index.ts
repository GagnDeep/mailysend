import type { ActorNamespace, ActorStub, PlatformCapabilities } from '../types.ts'

/**
 * Cloudflare adapters.
 *
 * These are deliberately thin. `Sql`, `Kv`, `Blob`, `Queue` and `Analytics`
 * were specified as subsets of D1Database, KVNamespace, R2Bucket, Queue and
 * AnalyticsEngineDataset, so a binding *is* already the interface — the casts
 * below are the entire adapter, and there is no per-call overhead on the
 * runtime we actually optimise for.
 *
 * Only actors need real work, because a DO namespace is addressed by id rather
 * than by name.
 */

export const CLOUDFLARE_CAPABILITIES: PlatformCapabilities = {
  workflows: true,
  analyticsEngine: true,
  emailBinding: true,
  longLivedProcess: false,
  // 30s CPU for a request, 15 minutes of wall time inside an alarm handler.
  maxTaskMs: 15 * 60 * 1000,
}

/** Minimal shape of `DurableObjectNamespace` so this file needs no CF types at build time. */
interface DoNamespaceLike {
  idFromName(name: string): unknown
  get(id: unknown): unknown
}

/**
 * Wraps a Durable Object namespace as an `ActorNamespace`.
 *
 * Every actor in MailySend is addressed by a name built by `doName()` in
 * @mailysend/core, never by a random id — a random id cannot be re-derived
 * after a restart, and every one of our actors is a singleton for some key
 * (a domain, a broadcast, a mailbox).
 */
export function actorNamespace<T extends object>(ns: DoNamespaceLike): ActorNamespace<T> {
  return {
    get(name: string): ActorStub<T> {
      // With RPC (a class extending `DurableObject`), stub methods are callable
      // directly and return promises, which is exactly the `ActorStub` contract.
      return ns.get(ns.idFromName(name)) as ActorStub<T>
    },
  }
}

/** Identity helpers, present so call sites read the same on both runtimes. */
export const asSql = <T>(binding: T) => binding
export const asKv = <T>(binding: T) => binding
export const asBlob = <T>(binding: T) => binding
export const asQueue = <T>(binding: T) => binding
export const asAnalytics = <T>(binding: T) => binding
