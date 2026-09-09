import type { RenderWarning } from './types.ts'
import { warn } from './types.ts'

/**
 * MJML, on Node only.
 *
 * MJML 5 is not Worker-safe: it reads its component registry off disk, pulls in
 * `js-beautify` and a small pile of Node builtins, and weighs more than the
 * entire rest of this package. It is also unnecessary at send time — MJML is a
 * *compile* step, and its output is ordinary HTML.
 *
 * So the intended flow is that `mailysend templates push` compiles MJML in the
 * CLI and stores the resulting HTML in `template_versions.html`, leaving the
 * MJML source as the thing the author edits. This module exists for the two
 * cases that flow does not cover: the self-hosted Node deployment, and a
 * `POST /emails` that passes MJML inline. On a Worker it throws with an
 * instruction rather than failing somewhere deep in a bundler shim.
 *
 * The import is dynamic and behind a runtime check so that a bundler tracing
 * the Worker entrypoint never has to resolve `mjml` at all; it is declared as
 * an optional peer dependency for the same reason. If your bundler follows
 * dynamic imports eagerly, mark `mjml` external in the Worker build.
 */

export const isNodeRuntime = (): boolean => {
  // `navigator.userAgent === 'Cloudflare-Workers'` is the documented Workers
  // signal; the versions check is what distinguishes Node from Deno/Bun shims
  // that also define `process`.
  const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator
  if (nav?.userAgent === 'Cloudflare-Workers') return false
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process
  return typeof proc?.versions?.node === 'string'
}

export class MjmlUnavailableError extends Error {
  override readonly name = 'MjmlUnavailableError'
  constructor(reason: string) {
    super(
      `${reason} Compile MJML before it reaches the send path: run \`mailysend templates push\`, ` +
        'which compiles it locally and uploads the HTML, or add an MJML build step in CI and ' +
        'store the compiled HTML on the template version.',
    )
  }
}

export interface MjmlResult {
  html: string
  warnings: RenderWarning[]
}

interface MjmlOutput {
  html: string
  errors?: { message: string }[]
}

/** MJML 4 returns synchronously, MJML 5 returns a promise. Await covers both. */
type MjmlFn = (input: string, options?: Record<string, unknown>) => MjmlOutput | Promise<MjmlOutput>

interface MjmlModule {
  default: MjmlFn
}

export interface MjmlOptions {
  /** MJML's own validation level. `soft` collects errors instead of throwing. */
  validationLevel?: 'strict' | 'soft' | 'skip'
}

export const renderMjml = async (
  source: string,
  options: MjmlOptions = {},
): Promise<MjmlResult> => {
  if (!isNodeRuntime()) {
    throw new MjmlUnavailableError('MJML cannot be compiled on Cloudflare Workers.')
  }

  let mjml: MjmlFn
  try {
    // Indirected through a variable so bundlers that statically rewrite
    // `import('mjml')` leave it alone in the Worker build.
    const specifier = 'mjml'
    const mod = (await import(/* @vite-ignore */ specifier)) as MjmlModule
    mjml = mod.default ?? (mod as unknown as MjmlFn)
  } catch (error) {
    throw new MjmlUnavailableError(
      `The optional \`mjml\` dependency is not installed (${(error as Error).message}).`,
    )
  }

  const result = await mjml(source, { validationLevel: options.validationLevel ?? 'soft' })
  return {
    html: result.html,
    warnings: (result.errors ?? []).map((e) => warn('unsupported_syntax', `MJML: ${e.message}`)),
  }
}
