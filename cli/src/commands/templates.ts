import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import { extractHandlebarsVariables, renderMjml } from '@mailysend/templates'
import { ApiClient } from '../api.ts'
import type { FlagSpecs } from '../args.ts'
import { CliError, type CommandContext } from '../command.ts'
import { compileJsxToAst } from '../compile/jsx.ts'
import { reportDiagnostics } from '../compile/report.ts'
import { resolveCredentials } from '../config.ts'
import { note, ok, out, Progress, style, table } from '../term.ts'

export const templatesFlags: FlagSpecs = {
  dir: {
    kind: 'string',
    describe: 'Directory to scan for .tsx, .jsx, .mjml and .hbs templates',
    default: 'emails',
  },
  subject: { kind: 'string', describe: 'Subject line for the pushed version' },
  slug: { kind: 'string', describe: 'Slug to publish under (single-file pushes only)' },
  'dry-run': { kind: 'boolean', short: 'n', describe: 'Compile and print, upload nothing' },
  json: { kind: 'boolean', describe: 'Emit the compiled body as JSON' },
  publish: { kind: 'boolean', describe: 'Publish the new version immediately', default: true },
}

/**
 * What `templates push` accepts, and what each extension becomes on the server.
 *
 * The three paths differ in where the compile happens, not in what is stored:
 *
 *   - `.tsx` / `.jsx` — a react-email component, compiled here to a data-only
 *     AST. The render worker walks JSON and never evaluates anything.
 *   - `.mjml` — compiled here too, because MJML is a build step and is not
 *     Worker-safe (see `packages/templates/src/mjml.ts`). What is stored is the
 *     HTML it produced, and the `.mjml` file stays the thing you edit.
 *   - `.hbs` / `.handlebars` — stored as written; the merge pass at send time
 *     is the interpreter in `packages/templates/src/handlebars.ts`.
 *
 * MJML whose output still carries `{{…}}` is stored as `handlebars`, since the
 * merge pass runs after MJML and those braces are meant for it.
 */
const EXTENSIONS = /\.(tsx|jsx|mjml|hbs|handlebars)$/

type Engine = 'jsx-ast' | 'handlebars' | 'html'

interface Compiled {
  file: string
  slug: string
  engine: Engine
  ast?: unknown
  html?: string
  variables: string[]
}

interface TemplateRecord {
  id: string
  slug: string
  name: string
  version: number
  engine?: Engine
}

const slugify = (file: string): string =>
  basename(file, extname(file))
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const collect = async (target: string): Promise<string[]> => {
  const info = await stat(target).catch(() => null)
  if (!info) throw new CliError(`No such file or directory: ${target}`)
  if (info.isFile()) return [target]

  const found: string[] = []
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) await walk(path)
        continue
      }
      if (EXTENSIONS.test(entry.name)) found.push(path)
    }
  }
  await walk(target)
  return found.sort()
}

export const templatesPush = async (ctx: CommandContext) => {
  // [2], not [1]: `templates push ./emails` parses as three positionals, and
  // reading the second one made a bare `templates push` look for a directory
  // called `push` — the default `--dir` was unreachable from the command the
  // docs print.
  const target = resolve(ctx.args.positionals[2] ?? String(ctx.args.flags.dir ?? 'emails'))
  const files = await collect(target)
  if (files.length === 0) {
    throw new CliError(`No .tsx, .jsx, .mjml or .hbs templates under ${target}`)
  }

  const slugOverride = ctx.args.flags.slug as string | undefined
  if (slugOverride !== undefined && files.length > 1) {
    throw new CliError('--slug applies to a single file; drop it to push a directory')
  }

  // Compile everything before uploading anything. A half-pushed directory
  // leaves the workspace in a state no one asked for, and the compiler is
  // fast enough that there is no reason to interleave.
  const compiled: Compiled[] = []
  let failed = 0

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const shown = relative(process.cwd(), file)
    const slug = slugOverride ?? slugify(file)
    const ext = extname(file).toLowerCase()

    if (ext === '.hbs' || ext === '.handlebars') {
      compiled.push({
        file: shown,
        slug,
        engine: 'handlebars',
        html: source,
        variables: extractHandlebarsVariables(source),
      })
      continue
    }

    if (ext === '.mjml') {
      // `MjmlUnavailableError`'s own advice is "run `mailysend templates
      // push`" — which is what is running. Inside this command the missing
      // peer is the whole story, so it is told the same way `@react-email/render`
      // is told in the SDK: name the package, name the install.
      let html: string
      try {
        html = (await renderMjml(source)).html
      } catch (error) {
        const message = (error as Error).message
        throw new CliError(
          message.includes('not installed')
            ? `${shown}: MJML is not installed.`
            : `${shown}: ${message}`,
          message.includes('not installed')
            ? { hint: 'It is an optional peer — `npm i -D mjml`, then push again.' }
            : {},
        )
      }
      compiled.push({
        file: shown,
        slug,
        // MJML runs first and the merge pass runs second, so braces that
        // survived the compile are still variables.
        engine: html.includes('{{') ? 'handlebars' : 'html',
        html,
        variables: extractHandlebarsVariables(html),
      })
      continue
    }

    const result = compileJsxToAst(source, { filename: shown })
    if (!result.ok) {
      reportDiagnostics(shown, result.diagnostics)
      failed++
      continue
    }
    compiled.push({
      file: shown,
      slug,
      engine: 'jsx-ast',
      ast: result.ast,
      variables: result.variables,
    })
  }

  if (failed > 0) throw new CliError(`${failed} of ${files.length} templates did not compile`)

  if (ctx.args.flags.json === true) {
    // `--json` is documented as the compiled AST, and only JSX has one. An
    // `.mjml` or `.hbs` push emits its body instead of a silent `null`.
    const payload = compiled.map((c) => (c.engine === 'jsx-ast' ? c.ast : c.html))
    out(JSON.stringify(payload.length === 1 ? payload[0] : payload, null, 2))
    return
  }

  if (ctx.args.flags.dryRun === true) {
    out()
    table(
      [{ header: 'template' }, { header: 'slug' }, { header: 'engine' }, { header: 'variables' }],
      compiled.map((c) => [
        c.file,
        style.cyan(c.slug),
        c.engine,
        c.variables.length === 0 ? style.dim('none') : c.variables.join(', '),
      ]),
    )
    out()
    note(`${compiled.length} compiled, nothing uploaded (--dry-run).`)
    return
  }

  const client = new ApiClient(await resolveCredentials(ctx.global))
  const existing = new Map<string, TemplateRecord>()
  for await (const page of client.pages<TemplateRecord>('/templates')) {
    for (const record of page) existing.set(record.slug, record)
  }

  const progress = new Progress('Pushing templates', compiled.length)
  const results: string[][] = []

  for (const entry of compiled) {
    const found = existing.get(entry.slug)
    const subject = ctx.args.flags.subject as string | undefined

    const body = entry.engine === 'jsx-ast' ? { ast: entry.ast } : { html: entry.html }

    if (!found) {
      const created = await client.post<TemplateRecord>('/templates', {
        name: basename(entry.file, extname(entry.file)),
        slug: entry.slug,
        engine: entry.engine,
        ...(subject === undefined ? {} : { subject }),
        ...body,
      })
      results.push([
        entry.file,
        style.cyan(entry.slug),
        style.green('created'),
        `v${created.version ?? 1}`,
      ])
    } else {
      // The engine belongs to the template, not the version: the server reads
      // it off the existing row. A file whose extension changed therefore needs
      // a new slug, and says so rather than pushing a body the engine cannot
      // render.
      if (found.engine && found.engine !== entry.engine) {
        throw new CliError(
          `${entry.file}: template \`${entry.slug}\` is a ${found.engine} template; ` +
            'an engine cannot change in place. Push it under a different --slug.',
        )
      }
      const version = await client.post<{ version: number }>(`/templates/${found.id}/versions`, {
        ...(subject === undefined ? {} : { subject }),
        ...body,
      })
      if (ctx.args.flags.publish !== false) {
        await client.post(`/templates/${found.id}/publish`, { version: version.version })
      }
      results.push([entry.file, style.cyan(entry.slug), 'updated', `v${version.version}`])
    }
    progress.tick()
  }

  progress.stop()
  out()
  table(
    [{ header: 'template' }, { header: 'slug' }, { header: 'result' }, { header: 'version' }],
    results,
  )
  out()
  ok(`${compiled.length} template${compiled.length === 1 ? '' : 's'} pushed.`)
}
