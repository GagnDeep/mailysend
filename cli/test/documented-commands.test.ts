import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ENTRIES, GLOBAL_FLAGS } from '../src/main.ts'

/**
 * Every `mailysend …` the website prints has to be a command the CLI accepts.
 *
 * This is here because the audit that produced it found six invocations that
 * were not: `export --range 30d --to r2://…`, `alerts add --notify slack`,
 * `import resend --key … --history 30d`, `traffic acme.dev --cloudflare 10%`,
 * a `domains set` that did not exist, and a `rollback` described as a traffic
 * rollback when it rolls back templates. One block in the docs even carried a
 * comment claiming it was checked against `cli/src/main.ts` — and it was the
 * only block that survived, because nothing enforced the claim.
 *
 * So the claim is enforced here instead. Copy is written faster than code and
 * drifts from it silently; a test is the only thing that notices.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

const SOURCES = [
  'apps/app/src/routes',
  'apps/app/src/content',
  'apps/app/src/components/marketing',
  'README.md',
  'packages/sdk-node/README.md',
]

const walk = (path: string): string[] => {
  const info = statSync(path, { throwIfNoEntry: false })
  if (!info) return []
  if (info.isFile()) return [path]
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.name === 'node_modules' ? [] : walk(join(path, entry.name)),
  )
}

const files = SOURCES.flatMap((source) => walk(join(ROOT, source))).filter((file) =>
  /\.(tsx?|md)$/.test(file),
)

/**
 * `mailysend`, optionally behind `$ ` or `npx `, followed by its arguments.
 *
 * The run stops at a quote, a backtick, a JSX brace or a newline, which is
 * where a source-level string ends. A continuation (`\`) ends the run too: the
 * next line is a separate match and would be a false positive, so lines that
 * end in one are joined before matching.
 */
const INVOCATION = /(?:\$\s*)?(?:npx\s+)?mailysend((?:[ \t]+[^\s'"`{}<>]+)+)/g

/** Placeholders and prose the samples legitimately contain. */
const isPlaceholder = (token: string) =>
  token.startsWith('<') ||
  token.startsWith('$') ||
  token.includes('…') ||
  token.includes('...') ||
  token === '--' ||
  token === '|'

/**
 * Comments are stripped first. They are the one place in these files that
 * discusses commands without printing them — including the note in `deploy.tsx`
 * explaining that `mailysend deploy --domain` was removed *because* there is no
 * such flag, which this test would otherwise read as the claim it was written
 * to retract.
 */
const uncommented = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')

const commandsIn = (text: string): { command: string[]; flags: string[] }[] => {
  const joined = uncommented(text).replace(/\\\\?\s*\n\s*/g, ' ')
  const found: { command: string[]; flags: string[] }[] = []

  for (const match of joined.matchAll(INVOCATION)) {
    const tail = match[1] ?? ''
    // `#` starts a trailing comment in every terminal sample on the site.
    const tokens =
      tail
        .split('#')[0]
        ?.trim()
        .split(/[ \t]+/) ?? []
    const first = tokens[0]
    if (first === undefined) continue
    // Prose and code also contain the word: `const mailysend = new MailySend`,
    // `mailysend — or keep the resend SDK`. An invocation's next token is a
    // subcommand or a flag and nothing else.
    if (!/^--?[a-z]/.test(first) && !/^[a-z][a-z-]*$/.test(first)) continue

    const words = tokens.filter((t) => !t.startsWith('-') && !isPlaceholder(t))
    const flags = tokens.filter((t) => t.startsWith('-') && !isPlaceholder(t))
    if (words.length === 0 && flags.length === 0) continue
    found.push({ command: words, flags })
  }
  return found
}

const resolve = (words: string[]) =>
  ENTRIES.filter((e) => e.match.length === 2).find(
    (e) => e.match[0] === words[0] && e.match[1] === words[1],
  ) ?? ENTRIES.find((e) => e.match.length === 1 && e.match[0] === words[0])

describe('every documented command exists', () => {
  it('finds invocations to check', () => {
    const total = files.reduce(
      (sum, file) => sum + commandsIn(readFileSync(file, 'utf8')).length,
      0,
    )
    // A regex that silently stops matching would make this suite pass by
    // checking nothing, which is the one failure mode it cannot have.
    expect(total).toBeGreaterThan(15)
  })

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const invocations = commandsIn(text)
    if (invocations.length === 0) continue
    const shown = file.slice(ROOT.length)

    it(`${shown} names only real commands and flags`, () => {
      for (const { command, flags } of invocations) {
        // `mailysend --version`, `mailysend --help`: global flags, no command.
        if (command.length === 0) {
          for (const flag of flags) expect(GLOBAL_FLAGS).toHaveProperty(nameOf(flag))
          continue
        }

        const entry = resolve(command)
        expect(entry, `${shown}: \`mailysend ${command.join(' ')}\` is not a command`).toBeDefined()
        if (!entry) continue

        const specs = { ...GLOBAL_FLAGS, ...entry.flags }
        for (const flag of flags) {
          const name = nameOf(flag)
          const known = flag.startsWith('--')
            ? Object.hasOwn(specs, name)
            : Object.values(specs).some((spec) => spec.short === name)
          expect(known, `${shown}: \`mailysend ${entry.match.join(' ')}\` has no ${flag}`).toBe(
            true,
          )
        }
      }
    })
  }
})

/** `--dry-run=1` and `-o events.ndjson` both reduce to the flag's own name. */
const nameOf = (flag: string) => flag.replace(/^--?/, '').split('=')[0] ?? ''
