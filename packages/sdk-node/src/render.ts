/**
 * React Email rendering, on the same terms the `resend` SDK does it.
 *
 * `resend.emails.send({ react: <Welcome /> })` is the canonical call in that
 * ecosystem, and it works because the client renders the element to HTML before
 * it posts — `@react-email/render` is an *optional peer dependency*, imported
 * dynamically at the moment it is needed, and `react` never reaches the wire.
 *
 * This file reproduces that mechanism rather than approximating it, because
 * "compatible" has to mean the same code path. Three consequences follow:
 *
 *   - A caller who never passes `react` never loads the renderer, so the
 *     package still installs with no transitive dependencies and still runs
 *     unchanged on Node, Bun, Deno and Workers.
 *   - There is no `import type { ReactElement }` anywhere in this SDK. The
 *     element is detected structurally, so `@types/react` stays out of the
 *     dependency graph of people who do not use React.
 *   - The server only ever sees `html`. `SendEmailRequest.react` is typed
 *     `unknown` on the client and stays `z.string()` on the wire.
 */

import { MailySendError } from './error.ts'

/** The brand React stamps on every element. Checking it needs no React. */
export const isReactElement = (node: unknown): boolean =>
  typeof node === 'object' && node !== null && '$$typeof' in node

/**
 * Renders a React element to HTML using the caller's own `@react-email/render`.
 *
 * The error text names the two packages that provide it, matching Resend's
 * wording, because that is the string people will paste into a search box.
 */
export const renderReact = async (node: unknown): Promise<string> => {
  let render: (node: unknown) => Promise<string> | string
  try {
    // Indirected through a variable for the same reason `renderMjml` does it:
    // an optional peer must not be something a bundler tracing this file has to
    // resolve, and TypeScript has no declarations for a package that may not be
    // installed.
    const specifier = '@react-email/render'
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      render: (node: unknown) => Promise<string> | string
    }
    render = mod.render
    if (typeof render !== 'function') throw new Error('no `render` export')
  } catch {
    throw new MailySendError({
      message:
        'Failed to render React component. Install `@react-email/render` or `@react-email/components`.',
      name: 'application_error',
      code: 'react_render_unavailable',
      statusCode: 500,
    })
  }
  return await render(node)
}

/**
 * The one transformation every send path applies: a React element in `react`
 * becomes `html`, a string in `react` is already rendered and passes through as
 * `html`, and `react` itself never survives into the request body.
 *
 * Returns the payload untouched when there is nothing to do, so the common case
 * costs one property read.
 */
export const withRenderedReact = async <T extends { html?: string; react?: unknown }>(
  payload: T,
): Promise<Omit<T, 'react'>> => {
  if (payload.react === undefined || payload.react === null) {
    const { react: _react, ...rest } = payload
    return rest
  }
  const { react, ...rest } = payload
  const html = isReactElement(react) ? await renderReact(react) : String(react)
  return { ...rest, html } as Omit<T, 'react'>
}
