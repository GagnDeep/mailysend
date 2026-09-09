import type { Config } from 'drizzle-kit'

export default {
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'sqlite',
  // D1 and node:sqlite are the same engine, so one migration set covers both
  // runtimes. That is a deliberate constraint, not a coincidence: it is what
  // keeps the self-hosted Node deployment from drifting into a second product.
  casing: 'snake_case',
} satisfies Config
