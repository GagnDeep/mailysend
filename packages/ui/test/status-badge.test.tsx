import { statusTone } from '@mailysend/design-tokens'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Status } from '../src/index.ts'
import { humanizeStatus, StatusBadge, statusToTone } from '../src/index.ts'

/** The full vocabulary the product can produce. Keep in sync with the API. */
const ALL_STATUSES: Status[] = [
  'queued',
  'scheduled',
  'sending',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'suppressed',
  'failed',
  'canceled',
  'draft',
  'paused',
  'active',
  'archived',
  'verified',
  'pending',
  'not_started',
  'temporary_failure',
  'revoked',
  'expired',
  'enabled',
  'disabled',
]

describe('StatusBadge', () => {
  it('maps every status to a tone that exists in the token module', () => {
    for (const status of ALL_STATUSES) {
      const tone = statusToTone[status]
      expect(tone, `${status} has no tone`).toBeDefined()
      expect(Object.keys(statusTone)).toContain(tone)
    }
  })

  it('covers the vocabulary exhaustively and adds nothing extra', () => {
    expect(Object.keys(statusToTone).sort()).toEqual([...ALL_STATUSES].sort())
  })

  it('renders every status without throwing and exposes its tone', () => {
    for (const status of ALL_STATUSES) {
      const { unmount } = render(<StatusBadge status={status} />)
      const badge = screen.getByText(humanizeStatus(status))
      expect(badge).toHaveAttribute('data-status', status)
      expect(badge).toHaveAttribute('data-tone', statusToTone[status])
      unmount()
    }
  })

  it('paints from the token palette rather than a literal colour', () => {
    render(<StatusBadge status="delivered" />)
    const badge = screen.getByText('delivered')
    expect(badge.style.color).toBe('rgb(14, 92, 85)')
    expect(badge.style.backgroundColor).toBe('rgb(231, 240, 234)')
  })

  it('humanises the underscored statuses', () => {
    expect(humanizeStatus('temporary_failure')).toBe('temporary failure')
    expect(humanizeStatus('not_started')).toBe('not started')
  })

  it('sorts the failure vocabulary into the same tone', () => {
    for (const status of ['bounced', 'complained', 'failed', 'revoked'] as const) {
      expect(statusToTone[status]).toBe('danger')
    }
  })

  it('accepts an explicit label override', () => {
    render(<StatusBadge status="bounced" label="hard bounce" />)
    expect(screen.getByText('hard bounce')).toBeInTheDocument()
  })
})
