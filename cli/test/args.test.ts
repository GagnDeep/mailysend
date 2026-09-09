import { describe, expect, it } from 'vitest'
import { ArgError, type FlagSpecs, helpFor, parseArgs } from '../src/args.ts'

const specs: FlagSpecs = {
  from: { kind: 'string', short: 'f', describe: 'Sender' },
  to: { kind: 'list', short: 't', describe: 'Recipients' },
  count: { kind: 'number', short: 'c', describe: 'How many' },
  json: { kind: 'boolean', short: 'j', describe: 'JSON output' },
  publish: { kind: 'boolean', describe: 'Publish', default: true },
  'dry-run': { kind: 'boolean', short: 'n', describe: 'Do nothing' },
}

describe('parseArgs', () => {
  it('collects positionals in order', () => {
    expect(parseArgs(['templates', 'push', './emails'], specs).positionals).toEqual([
      'templates',
      'push',
      './emails',
    ])
  })

  it('reads --flag value and --flag=value the same way', () => {
    expect(parseArgs(['--from', 'a@b.c'], specs).flags.from).toBe('a@b.c')
    expect(parseArgs(['--from=a@b.c'], specs).flags.from).toBe('a@b.c')
  })

  it('camel-cases dashed flag names', () => {
    expect(parseArgs(['--dry-run'], specs).flags.dryRun).toBe(true)
  })

  it('accumulates a list flag across repeats and commas', () => {
    expect(parseArgs(['--to', 'a@x.com', '--to', 'b@x.com,c@x.com'], specs).flags.to).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
    ])
  })

  it('coerces a number flag', () => {
    expect(parseArgs(['--count', '12'], specs).flags.count).toBe(12)
  })

  it('rejects a number flag that is not a number', () => {
    expect(() => parseArgs(['--count', 'many'], specs)).toThrow(ArgError)
  })

  it('applies declared defaults', () => {
    expect(parseArgs([], specs).flags.publish).toBe(true)
    expect(parseArgs([], specs).flags.json).toBe(false)
    expect(parseArgs([], specs).flags.to).toEqual([])
  })

  it('turns a boolean off with --no-<flag>', () => {
    expect(parseArgs(['--no-publish'], specs).flags.publish).toBe(false)
  })

  it('expands a short flag cluster', () => {
    const parsed = parseArgs(['-jn'], specs)
    expect(parsed.flags.json).toBe(true)
    expect(parsed.flags.dryRun).toBe(true)
  })

  it('takes the rest of a cluster as the value of a value-taking short flag', () => {
    expect(parseArgs(['-fa@b.c'], specs).flags.from).toBe('a@b.c')
  })

  it('hands everything after -- to the caller untouched', () => {
    const parsed = parseArgs(['deploy', '--', '--env', 'prod', '-x'], specs)
    expect(parsed.passthrough).toEqual(['--env', 'prod', '-x'])
    expect(parsed.positionals).toEqual(['deploy'])
  })

  /**
   * The regression this guards: inferring "takes a value" from whether the
   * next token looks like a flag turns a leading-dash value into a silent
   * boolean plus a stray positional.
   */
  it('lets a value-taking flag consume a value that starts with a dash', () => {
    expect(parseArgs(['--from', '-weird'], specs).flags.from).toBe('-weird')
  })

  it('never lets a switch consume the next token', () => {
    const parsed = parseArgs(['--json', 'push'], specs)
    expect(parsed.flags.json).toBe(true)
    expect(parsed.positionals).toEqual(['push'])
  })

  it('refuses an unknown flag rather than ignoring it', () => {
    expect(() => parseArgs(['--nope'], specs)).toThrow(/Unknown flag --nope/)
    expect(() => parseArgs(['-z'], specs)).toThrow(/Unknown flag -z/)
  })

  it('refuses a value-taking flag with nothing after it', () => {
    expect(() => parseArgs(['--from'], specs)).toThrow(/needs a value/)
  })

  it('refuses a value handed to a switch', () => {
    expect(() => parseArgs(['--json=loud'], specs)).toThrow(/takes no value/)
  })
})

describe('helpFor', () => {
  it('lists every flag with its short form and placeholder', () => {
    const help = helpFor('mailysend send', 'Send one message', specs)
    expect(help).toContain('mailysend send')
    expect(help).toContain('-f, --from <string>')
    expect(help).toContain('--json')
    expect(help).not.toContain('--json <boolean>')
  })
})
