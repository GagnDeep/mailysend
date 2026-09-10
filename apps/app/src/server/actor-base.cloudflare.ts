/**
 * The Workers half of the seam in `actor-base.ts`.
 *
 * A Durable Object only answers RPC — `stub.setVerification(…)`, which is how
 * every actor in this codebase is called — if its class extends this exact
 * class. Ours extended a plain `Actor`, so on Workers every actor call came
 * back as "The receiving Durable Object does not support RPC, because its class
 * was not declared with `extends DurableObject`", and a send reported that
 * sentence as its reason for failing.
 *
 * Vite aliases `actor-base.ts` to this file for the Cloudflare build only.
 */
export { DurableObject as ActorBase } from 'cloudflare:workers'
