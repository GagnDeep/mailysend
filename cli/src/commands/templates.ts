import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import { ApiClient } from '../api.ts'
import type { FlagSpecs } from '../args.ts'
import { CliError, type CommandContext } from '../command.ts'
import { compileJsxToAst } from '../compile/jsx.ts'
import { reportDiagnostics } from '../compile/report.ts'
import { resolveCredentials } from '../config.ts'
import { note, ok, out, Progress, style, table } from '../term.ts'

export const templatesFlags: FlagSpecs = {
  dir: { kind: 'string', describe: 'Directory to scan for .tsx templates', default: 'emails' },
  subject: { kind: 'string', describe: 'Subject line for the pushed version' },
  slug: { kind: 'string', describe: 'Slug to publish under (single-file pushes only)' },
  'dry-run': { kind: 'boolean', short: 'n', describe: 'Compile and print, upload nothing' },
  json: { kind: 'boolean', describe: 'Emit the compiled AST as JSON' },
  publish: { kind: 'boolean', describe: 'Publish the new version immediately', default: true },
}

interface TemplateRecord {
  id: string
  slug: string
  name: string
  version: number
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
      if (/\.(tsx|jsx)$/.test(entry.name)) found.push(path)
    }
  }
  await walk(target)
  return found.sort()
}

export const templatesPush = async (ctx: CommandContext) => {
  const target = resolve(ctx.args.positionals[1] ?? String(ctx.args.flags.dir ?? 'emails'))
  const files = await collect(target)
  if (files.length === 0) throw new CliError(`No .tsx or .jsx templates under ${target}`)

  const slugOverride = ctx.args.flags.slug as string | undefined
  if (slugOverride !== undefined && files.length > 1) {
    throw new CliError('--slug applies to a single file; drop it to push a directory')
  }

  // Compile everything before uploading anything. A half-pushed directory
  // leaves the workspace in a state no one asked for, and the compiler is
  // fast enough that there is no reason to interleave.
  const compiled: { file: string; slug: string; ast: unknown; variables: string[] }[] = []
  let failed = 0

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const shown = relative(process.cwd(), file)
    const result = compileJsxToAst(source, { filename: shown })
    if (!result.ok) {
      reportDiagnostics(shown, result.diagnostics)
      failed++
      continue
    }
    compiled.push({
      file: shown,
      slug: slugOverride ?? slugify(file),
      ast: result.ast,
      variables: result.variables,
    })
  }

  if (failed > 0) throw new CliError(`${failed} of ${files.length} templates did not compile`)

  if (ctx.args.flags.json === true) {
    out(
      JSON.stringify(
        compiled.length === 1 ? compiled[0]?.ast : compiled.map((c) => c.ast),
        null,
        2,
      ),
    )
    return
  }

  if (ctx.args.flags.dryRun === true) {
    out()
    table(
      [{ header: 'template' }, { header: 'slug' }, { header: 'variables' }],
      compiled.map((c) => [
        c.file,
        style.cyan(c.slug),
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

    if (!found) {
      const created = await client.post<TemplateRecord>('/templates', {
        name: basename(entry.file, extname(entry.file)),
        slug: entry.slug,
        engine: 'jsx-ast',
        ...(subject === undefined ? {} : { subject }),
        ast: entry.ast,
      })
      results.push([
        entry.file,
        style.cyan(entry.slug),
        style.green('created'),
        `v${created.version ?? 1}`,
      ])
    } else {
      const version = await client.post<{ version: number }>(`/templates/${found.id}/versions`, {
        engine: 'jsx-ast',
        ...(subject === undefined ? {} : { subject }),
        ast: entry.ast,
        variables: entry.variables,
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
