import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The same `~` the application resolves. Without it a test that reaches any
  // module importing `~/…` fails to load rather than to assert, which is a
  // confusing way to learn that the entry point imports the whole server.
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { name: 'app', environment: 'node', include: ['test/**/*.test.ts'] },
})
