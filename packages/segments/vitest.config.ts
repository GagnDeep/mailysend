import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { name: 'segments', include: ['test/**/*.test.ts'] },
})
