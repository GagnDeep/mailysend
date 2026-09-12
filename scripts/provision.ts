/**
 * `pnpm provision` — the same work `mailysend provision` does.
 *
 * The implementation moved into `cli/src/commands/provision.ts` so that it
 * ships inside the published package: this file is in no `files` array, and the
 * CLI used to spawn it by a path that only resolves inside a checkout. A
 * released `npx mailysend provision` therefore failed with
 * `could not determine executable to run`, which is a confusing way to say
 * "that file was never published".
 *
 * What is left here is the entry point CI and the repo scripts already call.
 */

import { CliError } from '../cli/src/command.ts'
import { runProvision } from '../cli/src/commands/provision.ts'

try {
  await runProvision()
} catch (error) {
  if (error instanceof CliError) {
    console.error(error.message)
    if (error.hint) console.error(error.hint)
    process.exit(error.exitCode)
  }
  throw error
}
