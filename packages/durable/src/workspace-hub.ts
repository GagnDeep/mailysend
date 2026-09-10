import { Actor } from './base.ts'

/**
 * The live dashboard fan-out.
 *
 * One actor per workspace, holding the open WebSocket connections for that
 * workspace's dashboard sessions. The event consumer pushes here after it
 * commits, which is what makes the logs view update as mail moves rather than
 * on a poll.
 *
 * Hibernation matters more than it looks: without it, every open dashboard tab
 * would keep an actor resident, and a workspace with a dashboard left open
 * overnight would bill for the whole night. With hibernation the actor
 * evaporates between events and the sockets survive.
 */

export interface LiveEvent {
  type: string
  at: string
  data: Record<string, unknown>
}

const RECENT_BUFFER = 50

interface WebSocketLike {
  send(data: string): void
  close(): void
  accept?(): void
  addEventListener?(type: string, handler: () => void): void
}

export class WorkspaceHubActor extends Actor {
  #sockets = new Set<WebSocketLike>()

  /** Called by the app when a dashboard opens a socket. */
  attach(socket: WebSocketLike): void {
    this.#sockets.add(socket)
  }

  detach(socket: WebSocketLike): void {
    this.#sockets.delete(socket)
  }

  async publish(events: LiveEvent[]): Promise<void> {
    if (events.length === 0) return

    // A short ring buffer so a dashboard that connects a second late still sees
    // what just happened, instead of an empty pane until the next event.
    const recent = await this.read<LiveEvent[]>('recent', [])
    const next = [...recent, ...events].slice(-RECENT_BUFFER)
    await this.storage.put('recent', next)

    const payload = JSON.stringify({ type: 'events', events })
    for (const socket of this.#sockets) {
      try {
        socket.send(payload)
      } catch {
        // A dead socket is expected — tabs close without a clean handshake all
        // the time — and must not interrupt delivery to the others.
        this.#sockets.delete(socket)
      }
    }
  }

  /**
   * The upgrade, handled inside the actor.
   *
   * It has to be here rather than in the app: a WebSocket cannot cross an RPC
   * boundary, so the only way `attach()` can ever be called with a live socket
   * is for the actor itself to be the thing that creates it. The app forwards
   * the upgrade request to this stub and hands back whatever comes out.
   *
   * `WebSocketPair` is read off the global rather than imported, because
   * nothing in this package may import `cloudflare:workers` — on Node the
   * global is absent and this answers honestly instead of pretending.
   */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 })
    }

    const Pair = (globalThis as { WebSocketPair?: new () => Record<string, WebSocketLike> })
      .WebSocketPair
    if (!Pair) {
      // The Node runtime has no WebSocket server here. Every screen that reads
      // this socket also polls, so the honest 501 costs freshness and nothing
      // else — which is better than a socket that connects and never speaks.
      return new Response('Live updates are only available on the Workers runtime.', {
        status: 501,
      })
    }

    const sockets = Object.values(new Pair())
    const client = sockets[0]
    const server = sockets[1]
    if (!client || !server) return new Response('Could not create a socket pair.', { status: 500 })
    server.accept?.()
    this.attach(server)
    server.addEventListener?.('close', () => this.detach(server))
    server.addEventListener?.('error', () => this.detach(server))

    // The ring buffer, replayed immediately: a dashboard that connects a second
    // after an event still shows it.
    const recent = await this.read<LiveEvent[]>('recent', [])
    if (recent.length > 0) {
      try {
        server.send(JSON.stringify({ type: 'events', events: recent.slice(-10) }))
      } catch {
        this.detach(server)
      }
    }

    return new Response(null, { status: 101, webSocket: client } as ResponseInit)
  }

  async recent(): Promise<LiveEvent[]> {
    return this.read('recent', [])
  }

  async connectionCount(): Promise<number> {
    return this.#sockets.size
  }
}
