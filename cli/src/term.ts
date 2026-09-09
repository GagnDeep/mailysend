/**
 * Terminal output.
 *
 * Hand-rolled rather than a dependency, for one reason that matters more than
 * bundle size: a CLI that prints to a pipe must print *parseable* text. Every
 * helper here degrades to plain ASCII when stdout is not a TTY, so
 * `mailysend logs | grep` behaves and `mailysend send --json` is valid JSON on
 * stdout with nothing else mixed in.
 *
 * There are no progress bars. A bar drawn from a count we do not have is a
 * lie told at 60fps; where an operation's length is unknowable we print a
 * running counter instead, which is honest and greppable.
 */

const colorEnabled =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  (process.env.FORCE_COLOR !== undefined || process.stdout.isTTY === true)

const wrap = (open: number, close: number) => (text: string) =>
  colorEnabled ? `\u001b[${open}m${text}\u001b[${close}m` : text

export const style = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/** Width of a string as the terminal sees it: escape sequences occupy no cells. */
export const displayWidth = (text: string): number => text.replace(ANSI, '').length

export const pad = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - displayWidth(text)))

export const out = (line = '') => {
  process.stdout.write(`${line}\n`)
}

/** Diagnostics go to stderr so they never contaminate piped stdout. */
export const err = (line = '') => {
  process.stderr.write(`${line}\n`)
}

export const heading = (text: string) => {
  out()
  out(style.bold(text))
}

export const note = (text: string) => out(style.dim(text))

/** The stderr twin of `note`: an error's hint belongs beside the error. */
export const hint = (text: string) => err(style.dim(text))

export const ok = (text: string) => out(`${style.green('ok')}  ${text}`)

export const warn = (text: string) => err(`${style.yellow('warn')}  ${text}`)

export const fail = (text: string) => err(`${style.red('error')}  ${text}`)

export const kv = (rows: [string, string][], indent = '  ') => {
  const width = Math.max(0, ...rows.map(([k]) => k.length))
  for (const [k, v] of rows) out(`${indent}${style.dim(pad(k, width))}  ${v}`)
}

export interface Column {
  header: string
  /** Right-align numeric columns so digits line up under each other. */
  align?: 'left' | 'right'
}

export const table = (columns: Column[], rows: string[][], indent = '  ') => {
  const widths = columns.map((c, i) =>
    Math.max(displayWidth(c.header), ...rows.map((r) => displayWidth(r[i] ?? ''))),
  )
  const line = (cells: string[], decorate: (s: string) => string) =>
    out(
      indent +
        cells
          .map((cell, i) => {
            const width = widths[i] ?? 0
            const text = decorate(cell)
            return columns[i]?.align === 'right'
              ? ' '.repeat(Math.max(0, width - displayWidth(text))) + text
              : pad(text, width)
          })
          .join('  ')
          .trimEnd(),
    )

  line(
    columns.map((c) => c.header),
    style.dim,
  )
  for (const row of rows) line(row, (s) => s)
}

/**
 * A counter for work whose total we genuinely know, and a bare spinner for
 * work whose total we do not. Both collapse to one line per state change when
 * stdout is not a TTY, so CI logs stay readable instead of filling with
 * carriage returns.
 */
export class Progress {
  #label: string
  #total: number | null
  #done = 0
  #timer: ReturnType<typeof setInterval> | null = null
  #frame = 0
  #live: boolean

  static frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

  constructor(label: string, total: number | null = null) {
    this.#label = label
    this.#total = total
    this.#live = process.stderr.isTTY === true && process.env.NO_COLOR === undefined
    if (this.#live && total === null) {
      this.#timer = setInterval(() => this.#paint(), 90)
      this.#timer.unref?.()
    }
    if (!this.#live) err(`${label}…`)
    else this.#paint()
  }

  #paint() {
    if (!this.#live) return
    const spinner = this.#total === null ? `${Progress.frames[this.#frame++ % 10]} ` : ''
    const count = this.#total === null ? '' : style.dim(` ${this.#done}/${this.#total}`)
    process.stderr.write(`\r\u001b[2K${style.cyan(spinner.trim())} ${this.#label}${count}`)
  }

  tick(by = 1) {
    this.#done += by
    this.#paint()
  }

  update(label: string) {
    this.#label = label
    this.#paint()
  }

  stop(final?: string) {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
    if (this.#live) process.stderr.write('\r\u001b[2K')
    if (final !== undefined) err(final)
  }
}

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

export const relativeTime = (iso: string): string => {
  const delta = Date.now() - new Date(iso).getTime()
  const abs = Math.abs(delta)
  const units: [number, string][] = [
    [86_400_000, 'd'],
    [3_600_000, 'h'],
    [60_000, 'm'],
    [1000, 's'],
  ]
  for (const [ms, suffix] of units) {
    if (abs >= ms) return `${Math.round(delta / ms)}${suffix}`
  }
  return 'now'
}
