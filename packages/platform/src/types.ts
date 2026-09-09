/**
 * The platform seam.
 *
 * MailySend targets two runtimes with one codebase:
 *
 *   1. Cloudflare Workers — the product's reason to exist. D1, KV, R2, Queues,
 *      Durable Objects, Analytics Engine.
 *   2. Node — a plain server behind nginx (the self-host path for people who
 *      already have a box, and how mailysend.com itself is hosted). SQLite via
 *      `node:sqlite`, the filesystem, in-process queues and actors.
 *
 * Everything above this file is written against these interfaces and has no
 * idea which runtime it is on. The interfaces are deliberately shaped as
 * *subsets of the Cloudflare APIs* rather than a neutral invention: that way
 * the Workers adapters are zero-cost pass-throughs and the abstraction can
 * never drift away from the platform we primarily target.
 */

// ---------------------------------------------------------------------------
// SQL — a subset of D1Database
// ---------------------------------------------------------------------------

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  first<T = unknown>(column: string): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean; meta: SqlMeta }>
  run(): Promise<{ success: boolean; meta: SqlMeta }>
}

export interface SqlMeta {
  duration: number
  rows_read: number
  rows_written: number
  last_row_id: number
  changes: number
}

export interface Sql {
  prepare(query: string): SqlStatement
  /**
   * All-or-nothing on D1; wrapped in a transaction on Node. This is how the
   * event consumer collapses 100 events into ~6 writes, so it is not optional.
   */
  batch<T = unknown>(
    statements: SqlStatement[],
  ): Promise<{ results: T[]; success: boolean; meta: SqlMeta }[]>
  exec(query: string): Promise<{ count: number; duration: number }>
}

// ---------------------------------------------------------------------------
// KV — a subset of KVNamespace
// ---------------------------------------------------------------------------

export interface KvPutOptions {
  expirationTtl?: number
  expiration?: number
  metadata?: Record<string, unknown>
}

export interface Kv {
  get(key: string): Promise<string | null>
  get(key: string, type: 'text'): Promise<string | null>
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>
  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: KvPutOptions,
  ): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: { name: string; expiration?: number; metadata?: Record<string, unknown> }[]
    list_complete: boolean
    cursor?: string
  }>
}

// ---------------------------------------------------------------------------
// Blob — a subset of R2Bucket
// ---------------------------------------------------------------------------

export interface BlobObject {
  key: string
  size: number
  etag: string
  uploaded: Date
  httpMetadata?: { contentType?: string; contentDisposition?: string; cacheControl?: string }
  customMetadata?: Record<string, string>
}

export interface BlobBody extends BlobObject {
  body: ReadableStream
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
}

export interface BlobPutOptions {
  httpMetadata?: { contentType?: string; contentDisposition?: string; cacheControl?: string }
  customMetadata?: Record<string, string>
}

export interface Blob {
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream | null,
    options?: BlobPutOptions,
  ): Promise<BlobObject | null>
  get(key: string): Promise<BlobBody | null>
  head(key: string): Promise<BlobObject | null>
  delete(keys: string | string[]): Promise<void>
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    objects: BlobObject[]
    truncated: boolean
    cursor?: string
  }>
}

// ---------------------------------------------------------------------------
// Queue — a subset of Queue<T> plus the consumer side
// ---------------------------------------------------------------------------

export interface QueueSendOptions {
  delaySeconds?: number
  contentType?: 'json' | 'text' | 'bytes' | 'v8'
}

export interface Queue<T = unknown> {
  send(body: T, options?: QueueSendOptions): Promise<void>
  sendBatch(
    messages: { body: T; delaySeconds?: number }[],
    options?: { delaySeconds?: number },
  ): Promise<void>
}

export interface QueueMessage<T = unknown> {
  readonly id: string
  readonly timestamp: Date
  readonly body: T
  readonly attempts: number
  ack(): void
  retry(options?: { delaySeconds?: number }): void
}

export interface QueueBatch<T = unknown> {
  readonly queue: string
  readonly messages: QueueMessage<T>[]
  ackAll(): void
  retryAll(options?: { delaySeconds?: number }): void
}

export type QueueHandler<T = unknown> = (batch: QueueBatch<T>, env: unknown) => Promise<void>

// ---------------------------------------------------------------------------
// Actors — the portable subset of Durable Objects
// ---------------------------------------------------------------------------

/**
 * A Durable Object gives us three things we genuinely need and cannot get from
 * D1: a single-threaded serialisation point per key, durable local storage, and
 * an alarm. `Actor` is exactly those three and nothing else, which is why it
 * can be backed by an in-process instance on Node without lying about
 * semantics — a single Node process is trivially single-threaded per key.
 *
 * What the Node backing genuinely does not provide is *global* uniqueness
 * across processes. Node deployments therefore run one app process (the PM2
 * ecosystem file pins `instances: 1` for that reason, with a comment saying so).
 */
export interface ActorStorage {
  get<T = unknown>(key: string): Promise<T | undefined>
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>
  put(key: string, value: unknown): Promise<void>
  put(entries: Record<string, unknown>): Promise<void>
  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  list<T = unknown>(options?: {
    prefix?: string
    start?: string
    end?: string
    limit?: number
    reverse?: boolean
  }): Promise<Map<string, T>>
  getAlarm(): Promise<number | null>
  setAlarm(scheduledTime: number | Date): Promise<void>
  deleteAlarm(): Promise<void>
  /** SQLite-backed DOs expose this; Node backs it with the same `node:sqlite`. */
  sql?: {
    exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): { toArray(): T[] }
  }
}

/** What an actor class receives. Mirrors `DurableObjectState` at the parts we use. */
export interface ActorContext {
  readonly id: { toString(): string; name?: string }
  readonly storage: ActorStorage
  /** Serialises a critical section against concurrent event loop turns. */
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>
  waitUntil(promise: Promise<unknown>): void
}

/** A typed handle to one actor. Method calls are RPC on Workers, direct on Node. */
export type ActorStub<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => R extends Promise<unknown> ? R : Promise<R>
    : never
}

export interface ActorNamespace<T> {
  /** Named actors only. Ids are always produced by `doName()` in @mailysend/core. */
  get(name: string): ActorStub<T>
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * Analytics Engine: 1 index, 20 blobs, 20 doubles, 16 KB of blobs, 250 writes
 * per invocation, and — the constraint that shapes the whole retention story —
 * only three months of retention. It is the hot query layer, never the count of
 * record: it samples under load, so `rollups_daily` in SQL is the truth and R2
 * parquet is the archive.
 */
export interface Analytics {
  writeDataPoint(point: { indexes?: string[]; blobs?: (string | null)[]; doubles?: number[] }): void
}

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------

export type RuntimeKind = 'cloudflare' | 'node'

export interface PlatformCapabilities {
  /** False on Node: there is no Workflows engine, so automations run on the scheduler. */
  workflows: boolean
  /** False on Node: AE is Cloudflare-only; Node aggregates straight into rollups. */
  analyticsEngine: boolean
  /** False on Node: no `send_email` binding, so the Cloudflare transport must use REST. */
  emailBinding: boolean
  /** True on Node: a long-lived process can hold timers and poll its own queues. */
  longLivedProcess: boolean
  /** Wall-clock budget for one unit of work, ms. Workers: 30s CPU / 15min alarms. */
  maxTaskMs: number
}
