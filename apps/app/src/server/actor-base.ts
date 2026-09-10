/**
 * What an exported Durable Object class extends — on every runtime but Workers.
 *
 * On Workers this module is replaced at build time by `actor-base.cloudflare.ts`,
 * which re-exports the real `DurableObject` from `cloudflare:workers`. That
 * import cannot appear in code Node also loads, and `packages/durable` must stay
 * free of it so the actors can run in-process and under test — so the seam is
 * here, in a file whose whole job is to be swapped.
 *
 * The shape is the part that matters: `DurableObject`'s constructor takes
 * `(ctx, env)` and keeps both, and so does this.
 */
export class ActorBase {
  protected ctx: unknown
  protected env: unknown

  constructor(ctx: unknown, env: unknown) {
    this.ctx = ctx
    this.env = env
  }
}
