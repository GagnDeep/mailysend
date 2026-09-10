import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PlatformCapabilities } from '../types.ts'
import { NodeActorRegistry } from './actor.ts'
import { NodeAnalytics } from './analytics.ts'
import { NodeBlob } from './blob.ts'
import { NodeKv } from './kv.ts'
import { NodeQueueBroker } from './queue.ts'
import { NodeSql } from './sql.ts'

export { NodeActorRegistry } from './actor.ts'
export { NodeAnalytics } from './analytics.ts'
export { NodeBlob } from './blob.ts'
export { NodeKv } from './kv.ts'
export { NodeQueueBroker } from './queue.ts'
export { NodeSql } from './sql.ts'

export const NODE_CAPABILITIES: PlatformCapabilities = {
  // No Workflows engine off Cloudflare; automations run on the scheduler
  // against the same step interpreter, so behaviour matches even though the
  // durability story is weaker (a crash mid-step replays from the last write).
  workflows: false,
  analyticsEngine: false,
  // No `send_email` binding off Cloudflare. The Cloudflare transport still
  // works — it just uses the REST endpoint, which needs an API token.
  emailBinding: false,
  longLivedProcess: true,
  // A Node process has no 30s CPU ceiling; the cap is a self-imposed watchdog
  // so a runaway step is still bounded.
  maxTaskMs: 15 * 60 * 1000,
}

export interface NodePlatformOptions {
  /** Everything durable lives under here: SQLite file, blobs, uploads. */
  dataDir: string
  /** Namespaces to create up front. Extra ones are created on demand. */
  kvNamespaces?: string[]
  blobBuckets?: string[]
  analyticsDatasets?: string[]
}

/**
 * Builds the whole Node-side platform. Returns the raw pieces rather than a
 * pre-baked env so that apps/app can assemble a binding object whose property
 * names are identical to `wrangler.jsonc`'s — the point being that application
 * code reads `env.DB` and `env.SEND_QUEUE` on both runtimes.
 */
export function createNodePlatform(options: NodePlatformOptions) {
  const { dataDir } = options
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(dataDir, 'blobs'), { recursive: true })

  const sql = new NodeSql(join(dataDir, 'mailysend.db'))

  const kv = new Map<string, NodeKv>()
  const getKv = (name: string) => {
    let ns = kv.get(name)
    if (!ns) {
      ns = new NodeKv(sql.db, name)
      kv.set(name, ns)
    }
    return ns
  }

  const blobs = new Map<string, NodeBlob>()
  const getBlob = (name: string) => {
    let b = blobs.get(name)
    if (!b) {
      b = new NodeBlob(join(dataDir, 'blobs', name))
      blobs.set(name, b)
    }
    return b
  }

  const analytics = new Map<string, NodeAnalytics>()
  const getAnalytics = (dataset: string) => {
    let a = analytics.get(dataset)
    if (!a) {
      a = new NodeAnalytics(sql.db, dataset)
      analytics.set(dataset, a)
    }
    return a
  }

  // The env is passed to consumers and actors, and is populated by the caller
  // immediately after construction — hence the mutable object rather than a
  // value threaded through three constructors.
  const env: Record<string, unknown> = {}
  const queues = new NodeQueueBroker(sql.db, env)
  const actors = new NodeActorRegistry(sql.db, env, { sqlDir: join(dataDir, 'actors') })

  for (const n of options.kvNamespaces ?? []) getKv(n)
  for (const b of options.blobBuckets ?? []) getBlob(b)
  for (const d of options.analyticsDatasets ?? []) getAnalytics(d)

  return {
    kind: 'node' as const,
    capabilities: NODE_CAPABILITIES,
    sql,
    kv: getKv,
    blob: getBlob,
    analytics: getAnalytics,
    queues,
    actors,
    env,
    start() {
      queues.start()
      actors.start()
      // KV expiry is lazy on read; this keeps the table from growing without
      // bound in a long-lived process.
      const sweep = setInterval(() => {
        for (const ns of kv.values()) ns.sweep()
      }, 60_000)
      sweep.unref?.()
      return () => {
        clearInterval(sweep)
        queues.stop()
        actors.stop()
      }
    },
  }
}

export type NodePlatform = ReturnType<typeof createNodePlatform>
