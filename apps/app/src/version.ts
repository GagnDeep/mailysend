/**
 * The build's version, compiled in from `package.json` by Vite's `define`.
 *
 * The fallback matters: vitest and `tsx` run this module without the define,
 * and a module that throws there would take every server test with it. `dev`
 * is a truthful answer for a build that was never stamped, and an obviously
 * wrong one to ship — which is the point.
 */
declare const __MS_VERSION__: string | undefined

export const VERSION: string = typeof __MS_VERSION__ === 'string' ? __MS_VERSION__ : 'dev'
