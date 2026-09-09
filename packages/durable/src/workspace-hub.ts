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

export class WorkspaceHubActor extends Actor {
  #sockets = new Set<{ send(data: string): void; close(): void }>()

  /** Called by the app when a dashboard opens a socket. */
  attach(socket: { send(data: string): void; close(): void }): void {
    this.#sockets.add(socket)
  }

  detach(socket: { send(data: string): void; close(): void }): void {
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

  async recent(): Promise<LiveEvent[]> {
    return this.read('recent', [])
  }

  async connectionCount(): Promise<number> {
    return this.#sockets.size
  }
}
