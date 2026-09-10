import { doName } from '@mailysend/core'
import { actorFromSession } from './auth.ts'
import { tenancyFor } from './context.ts'
import type { Env } from './env.ts'

/**
 * `GET /v1/live` — the dashboard's live socket.
 *
 * It sits here rather than in the Hono router because an upgrade is not a JSON
 * response: the 101 has to come back from the Durable Object that will own the
 * socket, and every layer in between can only pass it along.
 *
 * `WorkspaceHubActor` has been written, wired to the events consumer and never
 * once connected to — `attach()` had no caller until this route existed.
 */
export async function handleLiveSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected a WebSocket upgrade.', { status: 426 })
  }

  // A socket is a subscription to a workspace's activity, so it is exactly as
  // privileged as the dashboard itself. Session cookie only: an API key has no
  // business holding one open, and a query-string token would end up in logs.
  const sql = tenancyFor(env).db('')
  const actor = await actorFromSession(request, sql)
  if (!actor) return new Response('Not signed in.', { status: 401 })

  const hub = env.WORKSPACE_HUB.get(doName('WorkspaceHub', actor.workspaceId))
  return hub.fetch(request)
}
