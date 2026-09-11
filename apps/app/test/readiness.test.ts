import { describe, expect, it } from 'vitest'
import { deriveReceiving, deriveSending } from '../src/components/app/readiness.ts'
import type { DomainRecord } from '../src/lib/api-client.ts'

/**
 * The two sentences the domain page leads with.
 *
 * `apps/app/test` is a node environment that collects only `.test.ts`, so no
 * React render test is possible here. That is exactly why the branching lives
 * in a plain module: this file tests the part that can be wrong — which state
 * a domain is in, what the one next action is, and who performs it — without a
 * DOM.
 */

const record = (over: Partial<DomainRecord> = {}): DomainRecord =>
  ({
    object: 'domain',
    id: 'dom_1',
    name: 'acme.dev',
    status: 'not_started',
    region: 'global',
    created_at: '2026-01-01T00:00:00.000Z',
    open_tracking: true,
    click_tracking: true,
    custom_return_path: 'cf-bounce',
    ...over,
  }) as DomainRecord

/** Four records, all published by the transport, which is the Cloudflare shape. */
const managedRecords = (status = 'not_started') =>
  ['TXT', 'TXT', 'MX', 'CNAME'].map((type, index) => ({
    record: type,
    name: index === 0 ? 'acme.dev' : `r${index}.acme.dev`,
    value: 'v',
    provider: 'cloudflare',
    origin: 'observe' as const,
    status,
  })) as DomainRecord['records']

describe('can this domain send', () => {
  it('says nothing is computed rather than that something failed', () => {
    const track = deriveSending(record({ records: [] }))
    expect(track.badge).toBe('not_started')
    expect(track.action).toBe('Set up with this transport')
  })

  it('blames the resolver when no record could be looked up at all', () => {
    // The old page said "records outstanding" here, which sent people to
    // re-check a zone that was already correct.
    const track = deriveSending(
      record({
        provider: 'cloudflare',
        records: managedRecords(),
        checked: { total: 4, resolved: 0, errored: 4, first_error: 'fetch failed' },
      }),
    )
    expect(track.badge).toBe('error')
    expect(track.steps.find((s) => s.key === 'resolving')?.detail).toContain('fetch failed')
    expect(track.actor).toBe('you-here')
  })

  it('sends a managed domain to the transport, not to its own DNS zone', () => {
    // Every record `observe` — the aerocabler.com case, all four published by
    // Cloudflare. Telling this reader to edit their zone is the single most
    // misleading thing the page could say.
    const track = deriveSending(record({ provider: 'cloudflare', records: managedRecords() }))
    expect(track.badge).toBe('not_started')
    expect(track.actor).toBe('cloudflare')
    expect(track.headline).toContain('Cloudflare Email Service')
  })

  it('sends an unmanaged domain to its DNS zone', () => {
    const records = (managedRecords() ?? []).map((r) => ({ ...r, origin: 'copy' as const }))
    const track = deriveSending(record({ provider: 'ses', records }))
    expect(track.actor).toBe('your-dns')
  })

  it('states the working case once, and nominates DMARC as the next thing', () => {
    const track = deriveSending(
      record({
        provider: 'cloudflare',
        status: 'verified',
        sending_ready: true,
        dkim_ready: true,
        spf_ready: true,
        dmarc_policy: 'missing',
        records: managedRecords('verified'),
        checked: { total: 4, resolved: 4, errored: 0 },
      }),
    )
    expect(track.badge).toBe('verified')
    expect(track.headline).toContain('Ready to send')
    expect(track.action).toContain('DMARC')
  })

  it('has no next action left when DMARC is published too', () => {
    const track = deriveSending(
      record({
        provider: 'cloudflare',
        status: 'verified',
        sending_ready: true,
        dkim_ready: true,
        spf_ready: true,
        dmarc_policy: 'none',
        records: managedRecords('verified'),
        checked: { total: 4, resolved: 4, errored: 0 },
      }),
    )
    expect(track.action).toBeNull()
    expect(track.actor).toBe('nobody')
  })

  it('refuses to call a domain ready when the roll-up says verified and DKIM does not resolve', () => {
    // `rollUpStatus` can read `verified` for a record set that predates a
    // transport rebind. `sending_ready` is the narrower answer, and this is the
    // branch that keeps the two from being confused.
    const track = deriveSending(
      record({
        provider: 'cloudflare',
        status: 'verified',
        sending_ready: false,
        dkim_ready: false,
        spf_ready: true,
        records: managedRecords('verified'),
        checked: { total: 4, resolved: 4, errored: 0 },
      }),
    )
    expect(track.badge).not.toBe('verified')
    expect(track.steps.find((s) => s.key === 'aligned')?.state).toBe('blocked')
  })

  it('counts what is outstanding rather than repeating the status word', () => {
    const records = [
      ...(managedRecords('verified') ?? []).slice(0, 3),
      ...(managedRecords('failed') ?? []).slice(3),
    ]
    const track = deriveSending(
      record({
        provider: 'cloudflare',
        status: 'failed',
        records,
        checked: { total: 4, resolved: 4, errored: 0 },
      }),
    )
    expect(track.badge).toBe('failed')
    expect(track.headline).toContain('1 of 4')
  })
})

describe('can this domain receive', () => {
  const receiving = (over: Partial<NonNullable<DomainRecord['receiving']>> = {}) =>
    ({
      mx_status: null,
      mx_found: null,
      expected: '*.mx.cloudflare.net',
      checked_at: null,
      mailboxes: { count: 0, catch_all: null },
      catch_all: { observable: false as const, detail: 'not readable' },
      last_inbound_at: null,
      ...over,
    }) as NonNullable<DomainRecord['receiving']>

  it('distinguishes "nobody has looked" from "we looked and found nothing"', () => {
    expect(deriveReceiving(record()).badge).toBe('not_started')
    expect(deriveReceiving(record()).action).toBe('Check receiving')

    const noMx = deriveReceiving(record({ receiving: receiving({ mx_status: 'pending' }) }))
    expect(noMx.headline).toContain('no MX')
    expect(noMx.actor).toBe('cloudflare')
  })

  it('never launders a resolver failure into an answer', () => {
    const track = deriveReceiving(record({ receiving: receiving({ mx_status: 'error' }) }))
    expect(track.badge).toBe('error')
    expect(track.steps[0]?.state).toBe('blocked')
  })

  it('warns that changing the MX moves every message, not just ours', () => {
    const track = deriveReceiving(
      record({
        receiving: receiving({ mx_status: 'failed', mx_found: '1 aspmx.l.google.com.' }),
      }),
    )
    expect(track.badge).toBe('failed')
    expect(track.steps[0]?.detail).toContain('every message')
  })

  /**
   * The inversion this release makes.
   *
   * A domain with the MX pointed at Email Routing and nothing else configured
   * is *finished* on this side: the inbound handler accepts every address at a
   * domain the workspace owns and creates the mailbox on first delivery. The
   * only thing left is proving it, which needs a real message.
   */
  it('asks for nothing on this side when routing is right and no mailbox exists', () => {
    const track = deriveReceiving(record({ receiving: receiving({ mx_status: 'verified' }) }))
    expect(track.action).toBe('Send this domain a test message')
    expect(track.steps.find((s) => s.key === 'mailbox')?.state).toBe('done')
  })

  /** Named mailboxes are a refinement; the rest of the domain still lands. */
  it('does not treat a missing catch-all as a gap', () => {
    const track = deriveReceiving(
      record({
        receiving: receiving({ mx_status: 'verified', mailboxes: { count: 1, catch_all: null } }),
      }),
    )
    expect(track.action).toBe('Send this domain a test message')
    expect(track.steps.find((s) => s.key === 'mailbox')?.state).toBe('done')
    expect(track.steps.find((s) => s.key === 'mailbox')?.detail).not.toContain('550')
  })

  /**
   * The required step is Cloudflare's, and every branch says so.
   *
   * "Guide this setting as required, but from our side nothing needs to be
   * configured" is the whole contract of this track, so it is asserted rather
   * than left to copy review: no branch may ask the reader to create a mailbox
   * or flip a catch-all switch, and every branch must name the routing rule.
   */
  it('names the Cloudflare rule in every branch and never asks for a mailbox', () => {
    const statuses = [null, 'pending', 'verified', 'failed', 'error'] as const
    const boxes = [
      { count: 0, catch_all: null },
      { count: 1, catch_all: null },
      { count: 3, catch_all: 'hello@acme.dev' },
    ]
    for (const mx_status of statuses) {
      for (const mailboxes of boxes) {
        const track = deriveReceiving(record({ receiving: receiving({ mx_status, mailboxes }) }))
        expect(track.action ?? '').not.toMatch(/mailbox|catch-all/i)
        expect(track.steps.find((s) => s.key === 'route')?.detail).toContain('Routing rules')
      }
    }
  })

  it('counts the mailbox step done only once a catch-all accepts the rest', () => {
    const track = deriveReceiving(
      record({
        receiving: receiving({
          mx_status: 'verified',
          mailboxes: { count: 2, catch_all: 'hello@acme.dev' },
        }),
      }),
    )
    expect(track.steps.find((s) => s.key === 'mailbox')?.state).toBe('done')
    expect(track.action).toBe('Send this domain a test message')
  })

  it('treats an arrived message as the only end-to-end proof', () => {
    const track = deriveReceiving(
      record({
        receiving: receiving({
          mx_status: 'verified',
          mailboxes: { count: 1, catch_all: 'hello@acme.dev' },
          last_inbound_at: '2026-02-02T00:00:00.000Z',
        }),
      }),
    )
    expect(track.headline).toContain('arriving')
    expect(track.action).toBeNull()
    expect(track.steps.find((s) => s.key === 'arrived')?.state).toBe('done')
  })

  /**
   * The constraint from the module comment, made structural.
   *
   * Cloudflare's Email Routing catch-all rule is not readable over its API, so
   * no combination of observations justifies telling somebody their domain is
   * ready to receive. A future edit that adds a `verified` branch here breaks
   * this test rather than shipping a claim the product cannot support.
   */
  it('never claims a domain is ready to receive, over every combination of inputs', () => {
    const statuses = [null, 'pending', 'verified', 'failed', 'error'] as const
    const boxes = [
      { count: 0, catch_all: null },
      { count: 1, catch_all: null },
      { count: 3, catch_all: 'hello@acme.dev' },
    ]
    const inbound = [null, '2026-02-02T00:00:00.000Z']

    for (const mx_status of statuses) {
      for (const mailboxes of boxes) {
        for (const last_inbound_at of inbound) {
          const track = deriveReceiving(
            record({ receiving: receiving({ mx_status, mailboxes, last_inbound_at }) }),
          )
          expect(track.badge).not.toBe('verified')
          // And the unobservable step stays unobservable in every branch.
          expect(track.steps.find((s) => s.key === 'route')?.state).toBe('unknowable')
        }
      }
    }
  })
})
