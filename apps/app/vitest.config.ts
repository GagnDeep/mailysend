import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { name: 'app', environment: 'node', include: ['test/**/*.test.ts'] },
})
