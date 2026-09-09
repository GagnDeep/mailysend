import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { name: 'mcp', include: ['test/**/*.test.ts'] },
})
