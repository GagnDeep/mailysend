import { kvKey, verifyTrackingToken } from '@mailysend/core'
import { classifyHit, trackingEventId } from '@mailysend/events'

/**
 * The tracking Worker.
 *
 * This exists as a separate deployment for exactly one reason: cold start. It
 * is on the path of every image load in every message ever sent, so it has no
 * database binding, no router, and no framework — the token proves its own
 * authenticity, so a forged pixel costs a single HMAC and nothing else.
 *
 * Everything here is duplicated from `apps/app`'s tracking module by design.
 * They share the token format and the classifier through `@mailysend/core` and
 * `@mailysend/events`; sharing the *handler* would drag the whole application
 * graph into this bundle and defeat its only purpose.
 */

interface Env {
  MS_SECRET: string
  MS_PUBLIC_URL: string
  CACHE: KVNamespace
  EVENTS_QUEUE: Queue
}

const PIXEL = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0),
)

const pixel = () =>
  new Response(PIXEL, {
    headers: {
      'content-type': 'image/gif',
      'cache-control': 'no-store, no-cache, must-revalidate, private',
      'access-control-allow-origin': '*',
    },
  })

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url)

    if (pathname.startsWith('/o/')) {
      const claims = await verifyTrackingToken(
        env.MS_SECRET,
        pathname.slice(3).replace(/\.gif$/, ''),
      )
      // A forged token still gets the pixel. A 403 would tell a probe which ids
      // are real, and the reader would see a broken image for our trouble.
      if (!claims) return pixel()

      const hit = classifyHit({
        userAgent: request.headers.get('user-agent') ?? '',
        ip: request.headers.get('cf-connecting-ip') ?? '',
        method: request.method,
      })

      ctx.waitUntil(
        (async () => {
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
                type: 'opened',
                recipient: String(claims.r ?? 0),
                occurred_at: new Date().toISOString(),
                provider: 'internal',
                provider_message_id: null,
                audience_class: hit.class,
                user_agent: (request.headers.get('user-agent') ?? '').slice(0, 512),
              },
            ],
          })
        })(),
      )
      return pixel()
    }

    if (pathname.startsWith('/c/')) {
      const claims = await verifyTrackingToken(env.MS_SECRET, pathname.slice(3))
      if (!claims?.linkId) return Response.redirect(env.MS_PUBLIC_URL, 302)

      const destination = await env.CACHE.get(kvKey.link(claims.workspaceId, claims.linkId))
      // Never redirect anywhere that came from the request. Honouring a query
      // parameter here would make this an open redirect on a domain whose whole
      // job is to be trusted by spam filters.
      if (!destination) return Response.redirect(env.MS_PUBLIC_URL, 302)

      const hit = classifyHit({
        userAgent: request.headers.get('user-agent') ?? '',
        ip: request.headers.get('cf-connecting-ip') ?? '',
        method: request.method,
      })

      ctx.waitUntil(
        (async () => {
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
                type: 'clicked',
                recipient: String(claims.r ?? 0),
                occurred_at: new Date().toISOString(),
                provider: 'internal',
                provider_message_id: null,
                audience_class: hit.class,
                link_url: destination.slice(0, 2048),
                user_agent: (request.headers.get('user-agent') ?? '').slice(0, 512),
              },
            ],
          })
        })(),
      )
      return Response.redirect(destination, 302)
    }

    // Unsubscribe writes to the database, so it belongs on the app Worker. This
    // one has no database binding, and adding one to serve a rare path would
    // cost every pixel the cold start we built this to avoid.
    if (pathname.startsWith('/u/')) {
      return Response.redirect(`${env.MS_PUBLIC_URL}${pathname}`, 307)
    }

    return new Response('Not found', { status: 404 })
  },
}
