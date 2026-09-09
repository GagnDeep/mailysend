import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { name: 'workflows', include: ['test/**/*.test.ts'] },
})
