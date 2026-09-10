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
  try {
    return await hub.fetch(request)
  } catch (err) {
    // A deploy replaces the script under every live stub, and the next call on
    // one throws "This script has been upgraded. Please send a new request to
    // connect to the new version." There is nothing wrong and nothing to do
    // except connect again, so this answers with a status that says so rather
    // than raising a 500 that shows up at error level in the runtime log — a
    // misleading thing to find while debugging something else entirely.
    const message = err instanceof Error ? err.message : String(err)
    if (/has been upgraded/i.test(message)) {
      return new Response('The instance was upgraded. Reconnect.', {
        status: 503,
        headers: { 'retry-after': '1' },
      })
    }
    throw err
  }
}
