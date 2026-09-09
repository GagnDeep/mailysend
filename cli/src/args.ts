/**
 * Argument parsing, hand-rolled.
 *
 * The whole surface is `--flag`, `--flag=value`, `--flag value`, `-abc` and a
 * `--` terminator, which is a hundred lines rather than a dependency tree. The
 * one rule worth stating: a flag only consumes the next token when the spec
 * says it takes a value. Guessing from whether the next token starts with `-`
 * is how `--to -someone@example.com` silently becomes a boolean flag and an
 * unrelated positional.
 */

export type FlagKind = 'boolean' | 'string' | 'number' | 'list'

export interface FlagSpec {
  kind: FlagKind
  short?: string
  describe: string
  /** Shown in `--help` as `--flag <placeholder>`. */
  placeholder?: string
  default?: string | number | boolean | string[]
}

export type FlagSpecs = Record<string, FlagSpec>

export interface ParsedArgs {
  positionals: string[]
  flags: Record<string, string | number | boolean | string[] | undefined>
  /** Everything after a bare `--`, handed to a child process untouched. */
  passthrough: string[]
}

export class ArgError extends Error {}

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

export const parseArgs = (argv: string[], specs: FlagSpecs): ParsedArgs => {
  const byShort = new Map<string, string>()
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.short) byShort.set(spec.short, name)
  }

  const positionals: string[] = []
  const passthrough: string[] = []
  const flags: ParsedArgs['flags'] = {}

  for (const [name, spec] of Object.entries(specs)) {
    if (spec.default !== undefined) flags[camel(name)] = spec.default
    else if (spec.kind === 'boolean') flags[camel(name)] = false
    else if (spec.kind === 'list') flags[camel(name)] = []
  }

  const assign = (name: string, raw: string | null, tokens: string[], at: { i: number }) => {
    const spec = specs[name]
    if (!spec) throw new ArgError(`Unknown flag --${name}`)
    const key = camel(name)

    if (spec.kind === 'boolean') {
      if (raw !== null && raw !== 'true' && raw !== 'false') {
        throw new ArgError(`--${name} is a switch and takes no value`)
      }
      flags[key] = raw !== 'false'
      return
    }

    const value = raw ?? tokens[++at.i]
    if (value === undefined) throw new ArgError(`--${name} needs a value`)

    if (spec.kind === 'number') {
      const n = Number(value)
      if (!Number.isFinite(n)) throw new ArgError(`--${name} must be a number, got ${value}`)
      flags[key] = n
    } else if (spec.kind === 'list') {
      flags[key] = [...((flags[key] as string[] | undefined) ?? []), ...value.split(',')]
    } else {
      flags[key] = value
    }
  }

  const at = { i: 0 }
  for (; at.i < argv.length; at.i++) {
    const token = argv[at.i]!

    if (token === '--') {
      passthrough.push(...argv.slice(at.i + 1))
      break
    }

    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      const name = eq === -1 ? token.slice(2) : token.slice(2, eq)
      const raw = eq === -1 ? null : token.slice(eq + 1)
      if (name.startsWith('no-') && specs[name.slice(3)]?.kind === 'boolean') {
        flags[camel(name.slice(3))] = false
        continue
      }
      assign(name, raw, argv, at)
      continue
    }

    // A lone `-` is a filename by convention (stdin), never a flag cluster.
    if (token.startsWith('-') && token.length > 1) {
      const cluster = token.slice(1)
      for (let c = 0; c < cluster.length; c++) {
        const name = byShort.get(cluster[c]!)
        if (!name) throw new ArgError(`Unknown flag -${cluster[c]}`)
        const takesValue = specs[name]?.kind !== 'boolean'
        if (takesValue) {
          const rest = cluster.slice(c + 1)
          assign(name, rest === '' ? null : rest, argv, at)
          break
        }
        assign(name, null, argv, at)
      }
      continue
    }

    positionals.push(token)
  }

  return { positionals, flags, passthrough }
}

export const helpFor = (usage: string, describe: string, specs: FlagSpecs): string => {
  const rows = Object.entries(specs).map(([name, spec]) => {
    const short = spec.short ? `-${spec.short}, ` : '    '
    const placeholder =
      spec.kind === 'boolean'
        ? ''
        : ` <${spec.placeholder ?? (spec.kind === 'list' ? 'a,b' : spec.kind)}>`
    return [`${short}--${name}${placeholder}`, spec.describe] as const
  })
  const width = Math.max(0, ...rows.map(([left]) => left.length))
  const lines = rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`)
  return [`${describe}\n`, `  ${usage}\n`, 'Options', ...lines].join('\n')
}
