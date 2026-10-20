import { describe, expect, it } from 'vitest'
import { evaluate, type Facts } from '../src/commands/doctor.ts'

/**
 * `mailysend doctor`, on the four instances it exists for.
 *
 * Everything it reports was already readable through the API, and that was the
 * problem: the reason mail is not leaving a new deployment is almost always one
 * of four things, and each of them lived behind a different screen. What is
 * tested here is the judgement rather than the fetching — in particular, that a
 * request which failed is reported as a question nobody could answer and never
 * as a passing check, because a false green is the exact reassurance somebody
 * runs this command to disbelieve.
 */

const NOW = Date.parse('2026-10-20T12:00:00.000Z')

const healthy = (): Facts => ({
  health: { status: 'operational', version: '1.0.0', database: 'ok', mode: 'cloudflare' },
  instance: { claimed: true, public_url: 'https://mail.acme.dev' },
  providers: { data: [{ provider: 'ses', enabled: true }], default_provider: null },
  domains: { data: [{ name: 'acme.dev', status: 'verified', dkim_ready: true, spf_ready: true }] },
  queue: { queued: 0, sending: 0, scheduled: 0, oldest_waiting_at: null },
  unreachable: {},
})

const find = (facts: Facts, check: string) =>
  evaluate(facts, NOW).find((finding) => finding.check === check)

describe('a deployment that is working', () => {
  it('passes every check and asks for nothing', () => {
    const findings = evaluate(healthy(), NOW)
    expect(findings.every((finding) => finding.level === 'ok')).toBe(true)
    expect(findings.some((finding) => finding.fix)).toBe(false)
  })
})

describe('the four reasons mail does not leave', () => {
  it('calls an unclaimed instance a failure, because anyone can take it', () => {
    const facts = {
      ...healthy(),
      instance: { claimed: false, public_url: 'https://mail.acme.dev' },
    }
    const finding = find(facts, 'ownership')
    expect(finding?.level).toBe('fail')
    expect(finding?.fix).toContain('https://mail.acme.dev/setup')
  })

  it('fails when nothing is configured and the runtime has no transport of its own', () => {
    const facts = { ...healthy(), providers: { data: [], default_provider: null } }
    expect(find(facts, 'transport')?.level).toBe('fail')
  })

  /**
   * On Cloudflare a send leaves through the runtime's own transport with
   * nothing stored, so "no credentials" is not the same statement as "cannot
   * send" — and reporting it as a failure would send somebody to configure SES
   * they do not need.
   */
  it('accepts the runtime transport when nothing is stored', () => {
    const facts = { ...healthy(), providers: { data: [], default_provider: 'cloudflare' } }
    const finding = find(facts, 'transport')
    expect(finding?.level).toBe('ok')
    expect(finding?.detail).toContain('cloudflare')
  })

  it('fails when a domain is added but not verified, and names its status', () => {
    const facts = { ...healthy(), domains: { data: [{ name: 'acme.dev', status: 'pending' }] } }
    const finding = find(facts, 'sending domain')
    expect(finding?.level).toBe('fail')
    expect(finding?.detail).toContain('pending')
  })

  /** Verified is a column. DKIM resolving is what a receiver actually checks. */
  it('warns about a verified domain whose DKIM does not resolve', () => {
    const facts = {
      ...healthy(),
      domains: {
        data: [{ name: 'acme.dev', status: 'verified', dkim_ready: false, spf_ready: true }],
      },
    }
    const finding = find(facts, 'sending domain')
    expect(finding?.level).toBe('warn')
    expect(finding?.detail).toContain('acme.dev')
  })

  it('fails on a queue whose head has not moved in ten minutes', () => {
    const facts: Facts = {
      ...healthy(),
      queue: {
        queued: 12,
        sending: 0,
        scheduled: 0,
        oldest_waiting_at: '2026-10-20T11:00:00.000Z',
      },
    }
    expect(find(facts, 'queue')?.level).toBe('fail')
  })

  /** A queue with work in it is what a queue is for. Depth alone is not an alarm. */
  it('does not call a moving queue stuck', () => {
    const facts: Facts = {
      ...healthy(),
      queue: {
        queued: 400,
        sending: 8,
        scheduled: 0,
        oldest_waiting_at: '2026-10-20T11:59:30.000Z',
      },
    }
    expect(find(facts, 'queue')?.level).toBe('ok')
  })

  it('reports a database the health check calls anything but ok', () => {
    const facts: Facts = {
      ...healthy(),
      health: { status: 'degraded', database: 'no such table: messages' },
    }
    const finding = find(facts, 'database')
    expect(finding?.level).toBe('fail')
    expect(finding?.detail).toContain('no such table')
  })
})

describe('a question that could not be asked', () => {
  it('is unknown, never ok, and says why', () => {
    const facts: Facts = {
      ...healthy(),
      providers: null,
      unreachable: { providers: 'Restricted key: providers:read (403)' },
    }
    const finding = find(facts, 'transport')
    expect(finding?.level).toBe('unknown')
    expect(finding?.detail).toContain('providers:read')
  })

  it('still answers every other check', () => {
    const facts: Facts = { ...healthy(), domains: null, unreachable: { domains: 'timed out' } }
    const levels = evaluate(facts, NOW)
    expect(levels).toHaveLength(5)
    expect(levels.filter((finding) => finding.level === 'ok')).toHaveLength(4)
  })
})
