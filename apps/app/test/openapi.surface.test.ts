import { describe, expect, it } from 'vitest'
import { api } from '../src/server/api/index.ts'
import { openApiDocument } from '../src/server/api/openapi.ts'

/**
 * The OpenAPI document and the router, held together.
 *
 * This document is not a description of the API — it *is* the API as far as
 * every generated SDK and the reference page are concerned, and a document that
 * has drifted from the router is worse than no document: it fails at the
 * customer's runtime instead of at ours. It had drifted. `GET /suppressions/
 * {email}` was declared, every generated client carried the method, and the
 * router had never registered it, so the one question worth asking before a
 * send — may I mail this person? — 404'd for everyone who asked it the way we
 * told them to.
 *
 * Nothing about that was findable by reading either file. So it is a test.
 */

const METHODS = ['get', 'post', 'patch', 'put', 'delete'] as const

/** `METHOD /path`, with `:id` written the way OpenAPI writes it. */
const operationsInSpec = async () => {
  const doc = (await openApiDocument()) as { paths: Record<string, Record<string, unknown>> }
  const out = new Set<string>()
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      if (item[method]) out.add(`${method.toUpperCase()} ${path}`)
    }
  }
  return out
}

const routesInRouter = () => {
  const out = new Set<string>()
  for (const route of api.routes) {
    // `ALL` is middleware — `withContext()` and the CORS layer, not endpoints.
    if (route.method === 'ALL') continue
    out.add(`${route.method} ${route.path.replace(/^\/v1/, '').replace(/:(\w+)/g, '{$1}')}`)
  }
  return out
}

/**
 * The surface that is deliberately undocumented, and why.
 *
 * Each of these is something the dashboard or the sign-in flow calls and no
 * customer should build against — either because it is free to change with the
 * screen that consumes it, or because it is not an API at all but a step in
 * authenticating. Adding a route under one of these prefixes is a decision
 * nobody has to make; adding one anywhere else fails this test, which is the
 * point: shipping a public endpoint should take documenting it.
 */
const INTERNAL = [
  // Authentication is a flow, not a resource: these exist to turn a passkey, a
  // one-time code or a device grant into a session.
  '/auth/',
  '/setup/',
  '/instance',
  '/demo',
  // Who the caller is and what the deployment can do — read by the dashboard on
  // every load, and shaped for it.
  '/me',
  // A load balancer cannot hold an API key, and the document describes itself.
  '/health',
  '/openapi.json',
  // The webmail screens. One screen, one endpoint, changing together.
  '/mail/',
  '/preference-centre',
  // Operator configuration: transports, members, invites, the instance domain.
  // Real surfaces, but they configure the deployment rather than send mail, and
  // documenting them as API would invite automation of the one thing that can
  // lock an operator out of their own instance.
  '/providers',
  '/workspace/',
  // The confirmation queue the MCP server writes to and a human answers.
  '/mcp/',
  // Signed, expiring download links handed out by the endpoints that create an
  // export; there is nothing to construct by hand.
  '/exports/',
  // Six panels from one parsed range, so a chart and a total on one screen
  // cannot disagree. The per-resource analytics endpoints are the documented
  // ones; this is explicitly the dashboard's shape.
  '/analytics/dashboard',
]

const isInternal = (route: string) => {
  const path = route.slice(route.indexOf(' ') + 1)
  return INTERNAL.some((prefix) =>
    prefix.endsWith('/')
      ? path.startsWith(prefix)
      : path === prefix || path.startsWith(`${prefix}/`),
  )
}

describe('the documented API and the registered one', () => {
  it('registers every operation the document declares', async () => {
    const router = routesInRouter()
    const missing = [...(await operationsInSpec())].filter((op) => !router.has(op))
    expect(missing, 'declared in openapi.ts with no handler behind it').toEqual([])
  })

  it('documents every public route, or says in the test why it is internal', async () => {
    const spec = await operationsInSpec()
    const undocumented = [...routesInRouter()]
      .filter((route) => !spec.has(route) && !isInternal(route))
      .sort()
    expect(undocumented, 'registered, public, and absent from the document').toEqual([])
  })

  /** A prefix left behind after the routes it covered were removed. */
  it('keeps the internal list honest', () => {
    const router = [...routesInRouter()]
    const unused = INTERNAL.filter(
      (prefix) =>
        !router.some(
          (route) =>
            isInternal(route) &&
            route.slice(route.indexOf(' ') + 1).startsWith(prefix.replace(/\/$/, '')),
        ),
    )
    expect(unused, 'listed as internal with no route under it').toEqual([])
  })
})
