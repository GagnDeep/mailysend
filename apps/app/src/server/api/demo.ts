import { apiError } from '@mailysend/contracts'
import { DEFAULT_WORKSPACE, newId } from '@mailysend/core'
import { z } from 'zod'
import { tenancyFor } from '../context.ts'
import { getEnv } from '../env.ts'
import { createRouter, json } from './base.ts'

/**
 * `/v1/demo` — the door into the read-only product tour.
 *
 * Two things happen here and nothing else: an address is filed as a contact,
 * and a cookie is set that lets the visitor reach `/app` without a session.
 *
 * **The cookie is not a credential.** Every screen behind it is served from
 * fixtures that live in the browser bundle — `lib/demo/data.ts` — and every
 * `/v1` call is short-circuited before it reaches the network. A request
 * carrying only this cookie and no session is still anonymous to the API and
 * still gets a 401, which is the property that makes it safe to hand out to
 * anyone who types an email address. All it does is stop `server.ts` from
 * bouncing the SSR render of a shell that contains no data.
 *
 * It only exists on a deployment that is a shop window (`MS_LANDING` is
 * `marketing`). On somebody's own instance the dashboard has their real mail in
 * it, and a second door beside the real one — offering a fake version of the
 * screen they are already looking at — is a door drawn on a wall.
 */

export const demo = createRouter()

/** Named so it reads as what it is in devtools, rather than as a session. */
export const DEMO_COOKIE = 'ms_demo_tour'

/** Long enough to finish looking round, short enough not to be a fixture. */
const DEMO_MAX_AGE = 60 * 60 * 8

const Signup = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  /** Which button they came in through, so the copy can be measured. */
  source: z.string().max(40).optional(),
})

/** The audience demo signups are filed in, created the first time one arrives. */
const AUDIENCE_NAME = 'Demo signups'

const enabled = (): boolean => getEnv().MS_LANDING === 'marketing'

/**
 * One address per IP per minute.
 *
 * The write below is unauthenticated, so the only thing standing between it and
 * a script is this. It throttles the *filing*, never the tour: an office behind
 * one NAT is a single IP, and turning the second visitor of the minute away from
 * a page of sample data would be rationing the thing we are trying to give away.
 * A lead we drop costs us a row; a demo we refuse costs us the reader.
 */
const throttled = async (ip: string): Promise<boolean> => {
  const env = getEnv()
  const key = `demo:signup:${ip}`
  if (await env.CACHE.get(key)) return true
  await env.CACHE.put(key, '1', { expirationTtl: 60 })
  return false
}

demo.post('/', async (c) => {
  if (!enabled()) throw apiError('not_found', { message: 'This deployment has no demo.' })

  const body = Signup.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) {
    throw apiError('validation_error', {
      message: 'That does not look like an email address.',
      param: 'email',
    })
  }

  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'
  if (!(await throttled(ip))) await file(body.data.email, body.data.source)

  const response = json({ object: 'demo', started: true })
  // `SameSite=Lax` so following a link into the tour from anywhere keeps it,
  // and no `HttpOnly`: the client reads this to know it is in the tour, and
  // there is nothing here worth hiding from script.
  response.headers.set(
    'set-cookie',
    `${DEMO_COOKIE}=1; Path=/; Max-Age=${DEMO_MAX_AGE}; SameSite=Lax; Secure`,
  )
  return response
})

/**
 * Record the address.
 *
 * Filed as a contact rather than into a table of its own. A `demo_leads` table
 * would have exactly one writer and no reader, which is the shape of every dead
 * feature in this codebase; a contact shows up in Audiences, can be exported,
 * and can be mailed.
 */
const file = async (email: string, source: string | undefined): Promise<void> => {
  const sql = tenancyFor(getEnv()).db(DEFAULT_WORKSPACE)
  const now = new Date().toISOString()

  let audience = await sql
    .prepare('SELECT id FROM audiences WHERE workspace_id = ? AND name = ?')
    .bind(DEFAULT_WORKSPACE, AUDIENCE_NAME)
    .first<{ id: string }>()
  if (!audience) {
    const id = newId('audience')
    await sql
      .prepare(
        'INSERT INTO audiences (id, workspace_id, name, contact_count, created_at) VALUES (?,?,?,0,?)',
      )
      .bind(id, DEFAULT_WORKSPACE, AUDIENCE_NAME, now)
      .run()
    audience = { id }
  }

  await sql
    .prepare(
      `INSERT INTO contacts (id, workspace_id, audience_id, email, first_name, last_name,
                             unsubscribed, unsubscribed_at, data, created_at, updated_at)
         VALUES (?,?,?,?,NULL,NULL,0,NULL,?,?,?)
         ON CONFLICT (workspace_id, audience_id, email) DO UPDATE SET updated_at = excluded.updated_at`,
    )
    .bind(
      newId('contact'),
      DEFAULT_WORKSPACE,
      audience.id,
      email,
      JSON.stringify({ source: source ?? 'demo', signed_up_at: now }),
      now,
      now,
    )
    .run()

  await sql
    .prepare(
      `UPDATE audiences SET contact_count =
         (SELECT COUNT(*) FROM contacts WHERE workspace_id = ? AND audience_id = ?)
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(DEFAULT_WORKSPACE, audience.id, audience.id, DEFAULT_WORKSPACE)
    .run()
}

/** Leaving is a cookie deletion, and has to work even when the bundle is broken. */
demo.delete('/', () => {
  const response = json({ object: 'demo', started: false })
  response.headers.set('set-cookie', `${DEMO_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`)
  return response
})
