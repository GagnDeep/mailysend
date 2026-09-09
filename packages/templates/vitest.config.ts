import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { name: 'templates', include: ['test/**/*.test.ts'] },
})
