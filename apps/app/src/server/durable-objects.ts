import {
  AutomationCohortActor,
  AutomationRunActor,
  BroadcastActor,
  BroadcastCounterActor,
  MailboxActor,
  ScheduleShardActor,
  SegmentActor,
  SendingDomainActor,
  WebhookEndpointActor,
  WorkspaceHubActor,
} from '@mailysend/durable'
// Imported through the `~` alias, not relatively: the Cloudflare build swaps
// this exact specifier for the `cloudflare:workers` base class.
import { ActorBase } from '~/server/actor-base.ts'

/**
 * The actors, wearing the one costume Cloudflare insists on.
 *
 * Every actor is written against `ActorContext` so the same class runs
 * in-process on Node and as a Durable Object on Workers — and a
 * `DurableObjectState` satisfies that interface exactly, so the actor needs no
 * adaptation at all. What it does need is the declaration: Workers refuses RPC
 * to any class that does not extend `DurableObject`, and refuses it at call
 * time, with a message about the class rather than about the call. Exporting
 * the actors directly therefore produced a deployment where every actor
 * existed, every binding resolved, and no method could be called.
 *
 * So each export below is a real Durable Object that holds an actor and
 * forwards to it. The methods are copied onto the prototype because that is
 * what the RPC layer looks at — `alarm()` and `fetch()` included, which is how
 * a schedule shard wakes up and how the dashboard's live socket gets its 101.
 */

/** Actors, kept beside their wrapper rather than inside it: `#private` fields are not reachable from a method installed after the class body closes. */
const impls = new WeakMap<object, Record<string, (...args: unknown[]) => unknown>>()

type ActorClass = new (ctx: never, env: never) => object

function asDurableObject(Impl: ActorClass, name: string) {
  class Exported extends ActorBase {
    constructor(ctx: never, env: never) {
      super(ctx, env)
      impls.set(this, new Impl(ctx, env) as never)
    }
  }

  for (const method of Object.getOwnPropertyNames(Impl.prototype)) {
    if (method === 'constructor') continue
    const descriptor = Object.getOwnPropertyDescriptor(Impl.prototype, method)
    if (typeof descriptor?.value !== 'function') continue
    Object.defineProperty(Exported.prototype, method, {
      value: function (this: object, ...args: unknown[]) {
        const held = impls.get(this)
        if (!held) throw new Error(`${name} was called before it was constructed.`)
        return held[method]?.(...args)
      },
      writable: true,
      configurable: true,
      enumerable: false,
    })
  }

  // Only cosmetic — the binding is by export name — but a stack trace that says
  // `Exported` ten times is a stack trace nobody can read.
  Object.defineProperty(Exported, 'name', { value: name, configurable: true })
  return Exported
}

export const SendingDomainDO = asDurableObject(SendingDomainActor, 'SendingDomainDO')
export const BroadcastDO = asDurableObject(BroadcastActor, 'BroadcastDO')
export const BroadcastCounterDO = asDurableObject(BroadcastCounterActor, 'BroadcastCounterDO')
export const WebhookEndpointDO = asDurableObject(WebhookEndpointActor, 'WebhookEndpointDO')
export const ScheduleShardDO = asDurableObject(ScheduleShardActor, 'ScheduleShardDO')
export const MailboxDO = asDurableObject(MailboxActor, 'MailboxDO')
export const SegmentDO = asDurableObject(SegmentActor, 'SegmentDO')
export const AutomationCohortDO = asDurableObject(AutomationCohortActor, 'AutomationCohortDO')
export const AutomationRunDO = asDurableObject(AutomationRunActor, 'AutomationRunDO')
export const WorkspaceHubDO = asDurableObject(WorkspaceHubActor, 'WorkspaceHubDO')
