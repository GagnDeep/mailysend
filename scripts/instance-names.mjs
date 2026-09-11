/**
 * Scopes account-global resource names to the Worker that owns them.
 *
 * Queue names, D1 database names and R2 bucket names are account-global, and a
 * queue has exactly one consumer. So a second MailySend on one Cloudflare
 * account uploaded fine and then failed its trigger update, once per queue:
 *
 *   Queue 'ms-send' (UUID 'a82e…') already has a consumer. [code: 11004]
 *
 * — and where it did not fail, it was worse: the new instance bound `DB` and
 * `BUCKET` to the first instance's database and bucket and started reading
 * somebody else's mail. Neither is a thing the operator asked for by naming
 * their Worker something else.
 *
 * The rule is one line: every name that has to be unique on the account is
 * derived from the Worker's name. `mailysend16` gets `mailysend16-send`,
 * `mailysend16-inbound`, a `mailysend16` database and a `mailysend16` bucket.
 *
 * The default deployment is left exactly as it is. A deployment named
 * `mailysend` keeps `ms-send` and the `mailysend` database it already has,
 * because renaming those for an instance that is already running would point it
 * at an empty database, which is not a rename but a data loss with a changelog
 * entry. This only ever names resources for a Worker that does not have any.
 *
 * KV is not here: a namespace is addressed by id, not by name, and
 * `ensure-resources.mjs` resolves it by title — which is where the same
 * collision lived, and is fixed there.
 */

/** The name the repo ships with, and the only one that keeps the `ms-` prefix. */
export const DEFAULT_WORKER = 'mailysend'

/**
 * What this build will actually be called, which is not always what it says.
 *
 * Workers Builds and the Deploy to Cloudflare button let the operator name the
 * Worker in the dashboard, and pass that name to wrangler as
 * `WRANGLER_CI_OVERRIDE_NAME` rather than by editing the config. So the repo
 * behind `mailysend16` still says `"name": "mailysend"`, and keying the scoping
 * off the config alone would have scoped nothing for exactly the deployments
 * that need it — every instance created the one-click way.
 */
export const workerName = (config) => process.env.WRANGLER_CI_OVERRIDE_NAME?.trim() || config?.name

const QUEUE_PREFIX = 'ms-'

/**
 * Cloudflare queue names: lowercase letters, digits and dashes, 63 max. A
 * Worker name is already constrained to the same alphabet, so the only thing
 * that can go wrong is length, and the role is the half worth keeping.
 */
const queueNameFor = (worker, queue) =>
  `${worker}-${queue.startsWith(QUEUE_PREFIX) ? queue.slice(QUEUE_PREFIX.length) : queue}`.slice(
    0,
    63,
  )

/**
 * Renames the queues in a resolved config, in place, and says what changed.
 *
 * Queues only. Renaming a queue costs nothing — it holds work in flight, not
 * records — so this is safe to decide offline, from the name alone. The
 * database and the bucket are the opposite and are decided by
 * `scopeDataNames`, which is allowed to ask the account first.
 *
 * Returns an empty array for the default deployment, which is the signal to
 * every caller that there is nothing to say about it.
 */
export function scopeQueueNames(config) {
  const worker = workerName(config)
  if (!worker || worker === DEFAULT_WORKER) return []

  const changes = []
  const rename = (queue) => {
    if (typeof queue !== 'string' || queue.length === 0) return queue
    const scoped = queueNameFor(worker, queue)
    if (scoped !== queue) changes.push(`${queue} → ${scoped}`)
    return scoped
  }

  for (const producer of config.queues?.producers ?? []) producer.queue = rename(producer.queue)
  for (const consumer of config.queues?.consumers ?? []) {
    consumer.queue = rename(consumer.queue)
    if (consumer.dead_letter_queue) {
      consumer.dead_letter_queue = queueNameFor(worker, consumer.dead_letter_queue)
    }
  }

  return changes
}

/**
 * Whether this build may give the instance its *own* database and bucket.
 *
 * Getting this wrong in the unsafe direction cost a live deployment its data
 * for eight minutes: scoping on the name alone pointed a running `mailysend14`
 * at a `mailysend14` database that did not exist, the app created it, ran every
 * migration, and came up as a fresh unclaimed instance with the real one —
 * users, domains, mail — still sitting in `mailysend`. Nothing was lost, and
 * nothing about that was obvious from the build log either.
 *
 * So a rename is only ever applied to an instance that cannot yet have data:
 *
 *   - a database already named after the Worker — it was scoped before, and
 *     that is its database
 *   - otherwise a Worker that has never been deployed to this account — a new
 *     instance, which is the case the scoping exists for
 *   - otherwise nothing: a Worker that is already running keeps what it is
 *     running on, because the alternative is stranding it
 *
 * `deployed` and `hasOwnDatabase` are answers from the account, which is why
 * this takes them rather than looking them up: the only caller that can ask is
 * `ensure-resources.mjs`, which is the only thing holding credentials.
 */
export function scopeDataNames(config, { deployed, hasOwnDatabase }) {
  const worker = workerName(config)
  if (!worker || worker === DEFAULT_WORKER) return []
  if (!hasOwnDatabase && deployed) return []

  const changes = []
  // A name the operator chose themselves is left alone — pointing two Workers
  // at one database is a legitimate thing to ask for, and this cannot tell the
  // difference except by what the repo ships with.
  for (const database of config.d1_databases ?? []) {
    if (database.database_name === DEFAULT_WORKER) {
      database.database_name = worker
      delete database.database_id
      changes.push(`d1 ${DEFAULT_WORKER} → ${worker}`)
    }
  }
  for (const bucket of config.r2_buckets ?? []) {
    if (bucket.bucket_name === DEFAULT_WORKER) {
      bucket.bucket_name = worker
      changes.push(`r2 ${DEFAULT_WORKER} → ${worker}`)
    }
  }

  return changes
}
