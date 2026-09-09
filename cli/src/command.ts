import type { FlagSpecs, ParsedArgs } from './args.ts'

/** A failure the user can act on. Printed as one line, never as a stack. */
export class CliError extends Error {
  readonly hint?: string
  readonly exitCode: number

  constructor(message: string, options: { hint?: string; exitCode?: number } = {}) {
    super(message)
    this.name = 'CliError'
    this.hint = options.hint
    this.exitCode = options.exitCode ?? 1
  }
}

export interface GlobalOptions {
  apiKey?: string
  baseUrl?: string
  profile?: string
}

export interface CommandContext {
  args: ParsedArgs
  global: GlobalOptions
}

export interface Command {
  name: string
  summary: string
  usage: string
  flags: FlagSpecs
  run(ctx: CommandContext): Promise<void>
}
