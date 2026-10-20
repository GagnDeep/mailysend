/**
 * Reading wrangler's human output, because some of it has no `--json`.
 *
 * `wrangler queues info` prints a block of labelled lines and offers no
 * machine-readable form, so the build has to parse prose. That is survivable
 * as long as the parsing lives in one tested place rather than as a regex
 * inline in a script nobody runs locally — which is exactly how the build
 * spent eleven lines of every run reporting that every queue was
 *
 *   already consumed by "1", not "ptetrainer-mail"
 *
 * The pattern had matched `Number of Consumers: 1` and captured the count.
 * The real shape is two lines, and the names carry a `worker:` prefix:
 *
 *   Number of Consumers: 1
 *   Consumers: worker:ptetrainer-mail
 */

/** Scripts named on a `Consumers:`/`Producers:` line, without the `worker:` prefix. */
const namesOn = (text, label) => {
  const line = new RegExp(`^${label}:[ \\t]*(.+)$`, 'im').exec(text ?? '')
  if (!line) return []
  return line[1]
    .split(',')
    .map((entry) =>
      entry
        .trim()
        .replace(/^worker:/i, '')
        .trim(),
    )
    .filter((entry) => entry.length > 0 && entry !== '(none)')
}

/** The Workers consuming a queue, as `wrangler queues info` reported them. */
export const consumersOf = (text) => namesOn(text, 'Consumers')

/** The Workers producing to a queue. */
export const producersOf = (text) => namesOn(text, 'Producers')

/**
 * Whether a failed `queues info` means "there is no such queue" or "the
 * question could not be asked".
 *
 * The difference decides whether a build may give an instance its own storage,
 * so guessing is not an option: a missing queue is a fact about the account, a
 * refused token is an absence of facts, and only the first one may be acted on.
 */
export const isMissingQueue = (message) => /\bQueue\b[^\n]*\bdoes not exist\b/i.test(message ?? '')
