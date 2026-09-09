import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { name: 'db', include: ['test/**/*.test.ts'] },
})
