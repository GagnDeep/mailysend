import { kvKey, verifyTrackingToken } from '@mailysend/core'
import { classifyHit, trackingEventId } from '@mailysend/events'
import type { Env } from './env.ts'

/**
 * Open, click and one-click-unsubscribe endpoints.
 *
 * These are also served by `apps/track`, a Worker with no database binding at
 * all — that is why the token is self-validating. A forged pixel is rejected
 * here with zero lookups, which is what keeps the tracking path a ~15 KB
 * bundle and an invisible cold start.
 */

/** 1×1 transparent GIF. Smaller than a PNG and universally rendered. */
const PIXEL = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0),
)

const pixelResponse = () =>
  new Response(PIXEL, {
    headers: {
      'content-type': 'image/gif',
      // Never cached: a cached pixel is an open we never see.
      'cache-control': 'no-store, no-cache, must-revalidate, private',
      pragma: 'no-cache',
    },
  })

export async function handleOpen(request: Request, env: Env, token: string): Promise<Response> {
  const claims = await verifyTrackingToken(env.MS_SECRET, token.replace(/\.gif$/, ''))
  // A forged or tampered token gets the pixel anyway. Returning a 403 would
  // tell a probe which ids are real, and the recipient would see a broken image.
  if (!claims) return pixelResponse()

  const hit = classifyHit({
    userAgent: request.headers.get('user-agent') ?? '',
    ip: request.headers.get('cf-connecting-ip') ?? '',
    method: request.method,
    ...(request.headers.get('cf-ipcountry')
      ? { country: request.headers.get('cf-ipcountry')! }
      : {}),
  })

  await env.EVENTS_QUEUE.send({
    source: 'normalized',
    events: [
      {
        event_id: await trackingEventId({
          emailId: claims.emailId,
          type: 'opened',
          recipient: String(claims.r ?? 0),
          occurredAt: new Date(),
        }),
        workspace_id: claims.workspaceId,
        email_id: claims.emailId,
        type: 'opened' as const,
        recipient: String(claims.r ?? 0),
        occurred_at: new Date().toISOString(),
        provider: 'internal' as const,
        provider_message_id: null,
        audience_class: hit.class,
        user_agent: (request.headers.get('user-agent') ?? '').slice(0, 512),
      },
    ],
  })

  return pixelResponse()
}

export async function handleClick(request: Request, env: Env, token: string): Promise<Response> {
  const claims = await verifyTrackingToken(env.MS_SECRET, token)
  if (!claims?.linkId) return Response.redirect(env.MS_PUBLIC_URL, 302)

  const destination = await env.CACHE.get(kvKey.link(claims.workspaceId, claims.linkId))
  // Without a destination there is nothing safe to redirect to. Sending the
  // reader to the marketing site is better than an error page and better than
  // honouring a query parameter, which would make this an open redirect.
  if (!destination) return Response.redirect(env.MS_PUBLIC_URL, 302)

  const hit = classifyHit({
    userAgent: request.headers.get('user-agent') ?? '',
    ip: request.headers.get('cf-connecting-ip') ?? '',
    method: request.method,
  })

  await env.EVENTS_QUEUE.send({
    source: 'normalized',
    events: [
      {
        event_id: await trackingEventId({
          emailId: claims.emailId,
          type: 'clicked',
          recipient: String(claims.r ?? 0),
          linkId: claims.linkId,
          occurredAt: new Date(),
        }),
        workspace_id: claims.workspaceId,
        email_id: claims.emailId,
        type: 'clicked' as const,
        recipient: String(claims.r ?? 0),
        occurred_at: new Date().toISOString(),
        provider: 'internal' as const,
        provider_message_id: null,
        audience_class: hit.class,
        link_url: destination.slice(0, 2048),
        user_agent: (request.headers.get('user-agent') ?? '').slice(0, 512),
      },
    ],
  })

  return Response.redirect(destination, 302)
}

/**
 * One-click unsubscribe.
 *
 * `POST` is the RFC 8058 path that Gmail and Yahoo call directly; `GET` renders
 * a confirmation page for a human who clicked the footer link. Both must work,
 * and the POST must succeed without any user interaction at all — a
 * one-click endpoint that shows a form fails the requirement it exists for.
 */
export async function handleUnsubscribe(
  request: Request,
  env: Env,
  token: string,
): Promise<Response> {
  const claims = await verifyTrackingToken(env.MS_SECRET, token)
  if (!claims) return new Response('This unsubscribe link is not valid.', { status: 400 })

  if (request.method === 'POST') {
    await unsubscribe(env, claims.workspaceId, claims.emailId)
    return new Response('Unsubscribed.', { status: 200, headers: { 'content-type': 'text/plain' } })
  }

  await unsubscribe(env, claims.workspaceId, claims.emailId)
  return new Response(CONFIRMATION_PAGE, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

async function unsubscribe(env: Env, workspaceId: string, emailId: string): Promise<void> {
  const { tenancyFor } = await import('./context.ts')
  const { normalizeForSuppression } = await import('@mailysend/core')
  const sql = tenancyFor(env).db(workspaceId)

  const message = await sql
    .prepare('SELECT to_addresses, contact_id FROM messages WHERE id = ? AND workspace_id = ?')
    .bind(emailId, workspaceId)
    .first<{ to_addresses: string; contact_id: string | null }>()
  if (!message) return

  const now = new Date().toISOString()
  for (const address of JSON.parse(message.to_addresses) as string[]) {
    const normalized = normalizeForSuppression(address)
    await sql
      .prepare(
        `INSERT INTO suppressions (workspace_id, email, original_email, reason, source, created_at)
         VALUES (?,?,?,'unsubscribe','one_click',?)
         ON CONFLICT (workspace_id, email) DO NOTHING`,
      )
      .bind(workspaceId, normalized, address, now)
      .run()
    await env.SUPPRESSIONS.put(
      kvKey.suppression(workspaceId, normalized),
      JSON.stringify({ reason: 'unsubscribe', at: now }),
    )
  }

  if (message.contact_id) {
    await sql
      .prepare(
        'UPDATE contacts SET unsubscribed = 1, unsubscribed_at = ? WHERE workspace_id = ? AND id = ?',
      )
      .bind(now, workspaceId, message.contact_id)
      .run()
  }
}

const CONFIRMATION_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Unsubscribed</title>
<style>
  :root { color-scheme: light }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#F6F3EC; color:#14120F;
         font:400 16px/1.5 'Instrument Sans', system-ui, -apple-system, sans-serif }
  main { max-width:420px; padding:40px 28px; text-align:center; background:#FDFCFA;
         border:1px solid #E2DCD1; border-radius:16px }
  h1 { font-size:24px; font-weight:500; letter-spacing:-0.02em; margin:0 0 10px }
  p { margin:0; color:#56514A }
</style></head>
<body><main>
  <h1>You're unsubscribed</h1>
  <p>You won't receive further messages from this sender. It can take a few minutes for anything already queued to stop.</p>
</main></body></html>`
