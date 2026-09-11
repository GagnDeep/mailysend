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
 * Rewrites a resolved wrangler config in place and returns what changed.
 *
 * Returns an empty array for the default deployment, which is the signal to
 * every caller that there is nothing to say about it.
 */
export function scopeResourceNames(config) {
  const worker = config?.name
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

  // A database and a bucket named after the default deployment belong to the
  // default deployment. A name the operator chose themselves is left alone —
  // pointing two Workers at one database is a legitimate thing to ask for, and
  // this cannot tell the difference except by what the repo ships with.
  for (const database of config.d1_databases ?? []) {
    if (database.database_name === DEFAULT_WORKER) {
      database.database_name = worker
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
