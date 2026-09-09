import { ApiCallError } from './api.ts'
import { ArgError, type FlagSpecs, helpFor, parseArgs } from './args.ts'
import { CliError, type CommandContext, type GlobalOptions } from './command.ts'
import { domainsFlags, domainsVerify } from './commands/domains.ts'
import { importResend, importResendFlags } from './commands/import-resend.ts'
import { login, loginFlags } from './commands/login.ts'
import {
  alertsAdd,
  alertsFlags,
  exportData,
  exportFlags,
  rollback,
  rollbackFlags,
  traffic,
  trafficFlags,
  upgrade,
  upgradeFlags,
} from './commands/ops.ts'
import { provision, provisionFlags } from './commands/provision.ts'
import { send, sendFlags } from './commands/send.ts'
import { tail, tailFlags } from './commands/tail.ts'
import { templatesFlags, templatesPush } from './commands/templates.ts'
import { deploy, deployFlags, dev, devFlags } from './commands/wrangler.ts'
import { NotLoggedIn } from './config.ts'
import { err, fail, hint, out, style } from './term.ts'

export const VERSION = '0.1.0'

/**
 * Subcommands are matched on the first one or two positionals, because a few
 * of them read naturally as a phrase (`domains verify`, `import resend`) and
 * flattening those into `domains-verify` would be worse to type and to read.
 */
interface Entry {
  match: string[]
  summary: string
  usage: string
  flags: FlagSpecs
  run(ctx: CommandContext): Promise<void>
}

const ENTRIES: Entry[] = [
  {
    match: ['provision'],
    summary: 'Create the queues and analytics datasets the Deploy button cannot',
    usage: 'mailysend provision',
    flags: provisionFlags,
    run: provision,
  },
  {
    match: ['deploy'],
    summary: 'Deploy the worker to Cloudflare',
    usage: 'mailysend deploy [--env production] [-- <wrangler flags>]',
    flags: deployFlags,
    run: deploy,
  },
  {
    match: ['dev'],
    summary: 'Run the API locally',
    usage: 'mailysend dev [--port 8787] [--remote]',
    flags: devFlags,
    run: dev,
  },
  {
    match: ['tail'],
    summary: 'Stream live events from the workspace',
    usage: 'mailysend tail [--filter email.bounced] [--json]',
    flags: tailFlags,
    run: tail,
  },
  {
    match: ['send'],
    summary: 'Send one message',
    usage:
      'mailysend send --from "Acme <hi@acme.com>" --to you@example.com --subject Hi --text Hello',
    flags: sendFlags,
    run: send,
  },
  {
    match: ['domains', 'verify'],
    summary: 'Check a sending domain’s DNS and verify it',
    usage: 'mailysend domains verify acme.com [--wait]',
    flags: domainsFlags,
    run: domainsVerify,
  },
  {
    match: ['templates', 'push'],
    summary: 'Compile JSX templates and upload them',
    usage: 'mailysend templates push ./emails [--dry-run]',
    flags: templatesFlags,
    run: templatesPush,
  },
  {
    match: ['import', 'resend'],
    summary: 'Migrate a Resend account, resumably',
    usage: 'mailysend import resend --resend-key re_…',
    flags: importResendFlags,
    run: importResend,
  },
  {
    match: ['traffic'],
    summary: 'Show or shift provider traffic',
    usage: 'mailysend traffic [--set ses=80,resend=20]',
    flags: trafficFlags,
    run: traffic,
  },
  {
    match: ['rollback'],
    summary: 'Roll a template back to an earlier version',
    usage: 'mailysend rollback welcome-email [--to 3]',
    flags: rollbackFlags,
    run: rollback,
  },
  {
    match: ['upgrade'],
    summary: 'Check for a newer CLI',
    usage: 'mailysend upgrade [--check]',
    flags: upgradeFlags,
    run: (ctx) => upgrade(ctx, VERSION),
  },
  {
    match: ['export'],
    summary: 'Export contacts, logs or events',
    usage: 'mailysend export --resource contacts -o contacts.csv',
    flags: exportFlags,
    run: exportData,
  },
  {
    match: ['alerts', 'add'],
    summary: 'Create a deliverability alert',
    usage: 'mailysend alerts add --metric bounce_rate --above 0.05 --target ops@acme.com',
    flags: alertsFlags,
    run: alertsAdd,
  },
  {
    match: ['login'],
    summary: 'Sign in and store an API key',
    usage: 'mailysend login [--token ms_live_…] [--profile staging]',
    flags: loginFlags,
    run: login,
  },
]

const GLOBAL_FLAGS: FlagSpecs = {
  'api-key': { kind: 'string', describe: 'Override the stored API key' },
  'base-url': { kind: 'string', describe: 'Point at a different deployment' },
  profile: { kind: 'string', describe: 'Use a named profile from the config file' },
  help: { kind: 'boolean', short: 'h', describe: 'Show help for a command' },
  version: { kind: 'boolean', short: 'v', describe: 'Print the version' },
}

const usage = () => {
  out()
  out(`${style.bold('mailysend')} ${style.dim(VERSION)}`)
  out(style.dim('  Email infrastructure that runs on your own Cloudflare account.'))
  out()
  out(style.bold('Commands'))
  const width = Math.max(...ENTRIES.map((e) => e.match.join(' ').length))
  for (const entry of ENTRIES) {
    out(`  ${entry.match.join(' ').padEnd(width)}  ${style.dim(entry.summary)}`)
  }
  out()
  out(style.bold('Global options'))
  for (const [name, spec] of Object.entries(GLOBAL_FLAGS)) {
    const short = spec.short ? `-${spec.short}, ` : '    '
    out(`  ${`${short}--${name}`.padEnd(width + 2)}  ${style.dim(spec.describe)}`)
  }
  out()
  out(style.dim('  mailysend <command> --help  for details'))
  out()
}

const findEntry = (positionals: string[]): Entry | undefined =>
  // Two-word matches are tried first so `import resend` never resolves to a
  // hypothetical one-word `import`.
  ENTRIES.filter((entry) => entry.match.length === 2).find(
    (entry) => entry.match[0] === positionals[0] && entry.match[1] === positionals[1],
  ) ?? ENTRIES.find((entry) => entry.match.length === 1 && entry.match[0] === positionals[0])

export const main = async (argv: string[]): Promise<number> => {
  if (argv.length === 0) {
    usage()
    return 0
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    out(VERSION)
    return 0
  }
  if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    usage()
    return 0
  }

  const entry = findEntry(argv)
  if (!entry) {
    fail(`Unknown command: ${argv.slice(0, 2).join(' ')}`)
    hint('Run `mailysend` to see what is available.')
    return 2
  }

  const specs: FlagSpecs = { ...entry.flags, ...GLOBAL_FLAGS }

  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs(argv, specs)
  } catch (error) {
    if (!(error instanceof ArgError)) throw error
    fail(error.message)
    err(helpFor(entry.usage, entry.summary, entry.flags))
    return 2
  }

  if (parsed.flags.help === true) {
    out(helpFor(entry.usage, entry.summary, entry.flags))
    return 0
  }

  const global: GlobalOptions = {
    ...(parsed.flags.apiKey === undefined ? {} : { apiKey: String(parsed.flags.apiKey) }),
    ...(parsed.flags.baseUrl === undefined ? {} : { baseUrl: String(parsed.flags.baseUrl) }),
    ...(parsed.flags.profile === undefined ? {} : { profile: String(parsed.flags.profile) }),
  }

  try {
    await entry.run({ args: parsed, global })
    return 0
  } catch (error) {
    return report(error)
  }
}

const report = (error: unknown): number => {
  if (error instanceof CliError) {
    err()
    fail(error.message)
    if (error.hint) hint(`  ${error.hint}`)
    err()
    return error.exitCode
  }

  if (error instanceof NotLoggedIn) {
    err()
    fail(error.message)
    err()
    return 1
  }

  if (error instanceof ApiCallError) {
    err()
    fail(error.message)
    const details = [
      error.body.code ? ['code', error.body.code] : null,
      error.body.param ? ['field', error.body.param] : null,
      error.body.doc_url ? ['docs', error.body.doc_url] : null,
    ].filter((row): row is string[] => row !== null)
    for (const [key, value] of details) hint(`  ${key}: ${value}`)
    err()
    return error.status >= 500 ? 70 : 1
  }

  err()
  fail(error instanceof Error ? error.message : String(error))
  // A stack is noise for a user and the only useful thing for a bug report, so
  // it is available but not in the way.
  if (process.env.MAILYSEND_DEBUG && error instanceof Error) err(style.dim(error.stack ?? ''))
  else hint('  Set MAILYSEND_DEBUG=1 for a stack trace.')
  err()
  return 70
}

const isEntryPoint =
  typeof process !== 'undefined' && process.argv[1] !== undefined && !process.env.VITEST

if (isEntryPoint) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      process.exitCode = report(error)
    },
  )
}
