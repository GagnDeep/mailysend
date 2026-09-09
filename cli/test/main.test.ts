import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main, VERSION } from '../src/main.ts'

let stdout = ''
let stderr = ''

beforeEach(() => {
  stdout = ''
  stderr = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk)
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk)
    return true
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('dispatch', () => {
  it('prints usage with no arguments and exits cleanly', async () => {
    expect(await main([])).toBe(0)
    expect(stdout).toContain('templates push')
    expect(stdout).toContain('import resend')
  })

  it('prints the version', async () => {
    expect(await main(['--version'])).toBe(0)
    expect(stdout.trim()).toBe(VERSION)
  })

  it('exits 2 on an unknown command rather than doing something else', async () => {
    expect(await main(['frobnicate'])).toBe(2)
    expect(stderr).toContain('Unknown command')
  })

  /**
   * `import resend` must not resolve through a one-word `import`, which is why
   * two-word matches are tried first.
   */
  it('routes a two-word command to its own entry', async () => {
    expect(await main(['import', 'resend', '--help'])).toBe(0)
    expect(stdout).toContain('--resend-key')
    expect(stdout).not.toContain('--dir')
  })

  it('shows per-command help without touching the network', async () => {
    expect(await main(['templates', 'push', '--help'])).toBe(0)
    expect(stdout).toContain('mailysend templates push')
    expect(stdout).toContain('--dry-run')
  })

  it('reports a bad flag with the command help and exit 2', async () => {
    expect(await main(['send', '--nonsense'])).toBe(2)
    expect(stderr).toContain('Unknown flag --nonsense')
    expect(stderr).toContain('mailysend send')
  })

  it('turns a missing argument into one actionable line, never a stack', async () => {
    expect(await main(['send', '--from', 'a@b.c'])).toBe(1)
    expect(stderr).toContain('No recipients')
    expect(stderr).not.toContain('at Object')
  })

  it('surfaces a command hint when there is one', async () => {
    expect(await main(['import', 'resend'])).toBe(1)
    expect(stderr).toContain('RESEND_API_KEY')
  })
})
