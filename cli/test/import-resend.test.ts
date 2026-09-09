import { describe, expect, it, vi } from 'vitest'
import { accountFingerprint, runImport } from '../src/commands/import-resend.ts'

interface Checkpoint {
  version: 1
  account: string
  startedAt: string
  updatedAt: string
  migrated: Record<'audiences' | 'contacts' | 'domains' | 'templates', Record<string, string>>
  completed: Record<string, boolean>
}

const blank = (): Checkpoint => ({
  version: 1,
  account: 'test',
  startedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  migrated: { audiences: {}, contacts: {}, domains: {}, templates: {} },
  completed: {},
})

const source = {
  audiences: async () => [
    { id: 'aud_a', name: 'Newsletter' },
    { id: 'aud_b', name: 'Beta' },
  ],
  contacts: async (audienceId: string) =>
    audienceId === 'aud_a'
      ? [
          { id: 'c1', email: 'one@x.com', first_name: 'One' },
          { id: 'c2', email: 'two@x.com', unsubscribed: true },
        ]
      : [{ id: 'c3', email: 'three@x.com' }],
  domains: async () => [{ id: 'dom_1', name: 'acme.com' }],
}

type Input = Record<string, unknown>

const destination = () => {
  let n = 0
  return {
    createAudience: vi.fn(async (_input: { name: string }) => ({ id: `ms_aud_${++n}` })),
    createContact: vi.fn(async (_input: Input) => ({ id: `ms_con_${++n}` })),
    createDomain: vi.fn(async (_input: { name: string; region?: string }) => ({
      id: `ms_dom_${++n}`,
    })),
  }
}

const run = (
  checkpoint: Checkpoint,
  dest: ReturnType<typeof destination>,
  save = vi.fn(async () => {}),
) =>
  runImport({
    checkpoint: checkpoint as never,
    save: save as never,
    resources: ['audiences', 'contacts', 'domains'],
    source,
    destination: dest,
  })

describe('a first run migrates everything', () => {
  it('creates each domain, audience and contact once', async () => {
    const dest = destination()
    const summary = await run(blank(), dest)

    expect(summary).toMatchObject({ domains: 1, audiences: 2, contacts: 3, skipped: 0 })
    expect(dest.createContact).toHaveBeenCalledTimes(3)
  })

  it('files contacts under the destination audience, not the Resend one', async () => {
    const dest = destination()
    const checkpoint = blank()
    await run(checkpoint, dest)

    const audienceIds = dest.createContact.mock.calls.map((call) => call[0].audience_id)
    expect(new Set(audienceIds)).toEqual(new Set(Object.values(checkpoint.migrated.audiences)))
  })

  it('carries names and the unsubscribed flag across', async () => {
    const dest = destination()
    await run(blank(), dest)
    expect(dest.createContact.mock.calls[0]?.[0]).toMatchObject({
      email: 'one@x.com',
      first_name: 'One',
    })
    expect(dest.createContact.mock.calls[1]?.[0]).toMatchObject({ unsubscribed: true })
  })
})

/**
 * The property the whole design exists for: an import has no idempotency key,
 * so a re-run that forgets what it did duplicates every contact it moved.
 */
describe('resuming', () => {
  it('writes a checkpoint after every entity, not at the end', async () => {
    const save = vi.fn(async () => {})
    await run(blank(), destination(), save)
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(6)
  })

  it('re-running a completed import creates nothing', async () => {
    const checkpoint = blank()
    await run(checkpoint, destination())

    const second = destination()
    const summary = await run(checkpoint, second)

    expect(summary).toMatchObject({ domains: 0, audiences: 0, contacts: 0 })
    expect(second.createContact).not.toHaveBeenCalled()
    expect(second.createAudience).not.toHaveBeenCalled()
    expect(second.createDomain).not.toHaveBeenCalled()
  })

  it('continues from where a crash left off without redoing work', async () => {
    // Simulate a run that died after the first audience's first contact.
    const checkpoint = blank()
    checkpoint.migrated.domains.dom_1 = 'ms_dom_1'
    checkpoint.migrated.audiences.aud_a = 'ms_aud_1'
    checkpoint.migrated.contacts.c1 = 'ms_con_1'

    const dest = destination()
    const summary = await run(checkpoint, dest)

    expect(summary).toMatchObject({ domains: 0, audiences: 1, contacts: 2 })
    const emails = dest.createContact.mock.calls.map((call) => call[0].email)
    expect(emails).toEqual(['two@x.com', 'three@x.com'])
  })

  it('does not re-walk an audience whose contacts are already complete', async () => {
    const checkpoint = blank()
    checkpoint.migrated.audiences.aud_a = 'ms_aud_1'
    checkpoint.completed.aud_a = true

    const dest = destination()
    await run(checkpoint, dest)

    const emails = dest.createContact.mock.calls.map((call) => call[0].email)
    expect(emails).not.toContain('one@x.com')
    expect(emails).toContain('three@x.com')
  })

  it('records a destination id for every source id it moved', async () => {
    const checkpoint = blank()
    await run(checkpoint, destination())
    expect(Object.keys(checkpoint.migrated.contacts)).toEqual(['c1', 'c2', 'c3'])
    expect(Object.keys(checkpoint.migrated.audiences)).toEqual(['aud_a', 'aud_b'])
  })

  it('marks each audience complete so a later run can skip it', async () => {
    const checkpoint = blank()
    await run(checkpoint, destination())
    expect(checkpoint.completed).toEqual({ aud_a: true, aud_b: true })
  })
})

describe('selective imports', () => {
  it('imports only what was asked for', async () => {
    const dest = destination()
    const summary = await runImport({
      checkpoint: blank() as never,
      save: async () => {},
      resources: ['domains'],
      source,
      destination: dest,
    })
    expect(summary).toMatchObject({ domains: 1, audiences: 0, contacts: 0 })
    expect(dest.createAudience).not.toHaveBeenCalled()
  })

  it('still maps audiences when only contacts were asked for, since contacts need them', async () => {
    const dest = destination()
    const summary = await runImport({
      checkpoint: blank() as never,
      save: async () => {},
      resources: ['contacts'],
      source,
      destination: dest,
    })
    expect(summary.contacts).toBe(3)
  })
})

describe('accountFingerprint', () => {
  it('is stable for a key and different across keys', () => {
    expect(accountFingerprint('re_abc')).toBe(accountFingerprint('re_abc'))
    expect(accountFingerprint('re_abc')).not.toBe(accountFingerprint('re_def'))
  })

  it('never contains the key it fingerprints', () => {
    expect(accountFingerprint('re_secret_value')).not.toContain('secret')
    expect(accountFingerprint('re_secret_value')).toMatch(/^[0-9a-f]{8}$/)
  })
})
