import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { api } from '../src/server/api/index.ts'

/**
 * Every path the dashboard calls, held against the routes the server registers.
 *
 * The dashboard is a client of its own API over HTTP like any other, and
 * nothing in the type system connects the two: a method that calls
 * `/webhooks/${id}/attempts` typechecks forever against a router that only ever
 * registered `/webhooks/:id/deliveries`. Six of these had accumulated — the
 * webhook attempt log and its replay button, the template version the editor
 * loads, the Restore button, the CSV importer and cancelling a scheduled send.
 * Every one of them was a screen that worked in the public demo and 404'd on a
 * real instance, because the demo answers from `src/lib/demo/router.ts`, which
 * is a different router with different paths. The shop window was propping up
 * the broken doors behind it.
 *
 * `inbound.ts` carries two handlers still commented "the route the dashboard has
 * always called and that has never existed". They exist now. This is what makes
 * the seventh impossible.
 */

const SOURCE = new URL('../src/lib/api-client.ts', import.meta.url).pathname

/**
 * `METHOD /path`, with every parameter flattened to `*`.
 *
 * A client path interpolates (`/emails/${id}/cancel`) and a route declares
 * (`/emails/:id/cancel`); which of the two spellings a segment uses is not what
 * this test is about, so both sides lose it.
 */
const flatten = (path: string): string =>
  path
    .replace(/^\/v1/, '')
    .replace(/\$\{[^}]*\}/g, '*')
    .replace(/:[A-Za-z_]\w*/g, '*')

/** The HTTP verb helpers `api-client.ts` is written in terms of. */
const VERBS: Record<string, string> = {
  get: 'GET',
  post: 'POST',
  patch: 'PATCH',
  put: 'PUT',
  del: 'DELETE',
}

const CALL = /\b(get|post|patch|put|del)\(\s*(['"`])([^'"`]+)\2/g

const callsInClient = (): string[] => {
  const source = readFileSync(SOURCE, 'utf8')
  const out = new Set<string>()
  for (const match of source.matchAll(CALL)) {
    const path = match[3]
    // The helpers themselves are declared in this file, and a few `get(` hits
    // are `searchParams.get('cursor')` and friends. A request path starts at
    // the root; nothing else in the file does.
    if (!path.startsWith('/')) continue
    out.add(`${VERBS[match[1]]} ${flatten(path)}`)
  }
  return [...out].sort()
}

const routesInRouter = (): Set<string> => {
  const out = new Set<string>()
  for (const route of api.routes) {
    if (route.method === 'ALL') continue
    out.add(`${route.method} ${flatten(route.path)}`)
  }
  return out
}

describe('the dashboard calls routes that exist', () => {
  it('finds the calls', () => {
    // A regex that matched nothing would pass every assertion below, which is
    // the one way this test could quietly stop working.
    expect(callsInClient().length).toBeGreaterThan(80)
  })

  it('has a registered route behind every call', () => {
    const routes = routesInRouter()
    expect(callsInClient().filter((call) => !routes.has(call))).toEqual([])
  })
})
