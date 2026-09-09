import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TerminalLine } from '../src/index.ts'
import { Terminal } from '../src/index.ts'

/**
 * The artboard writes `dо` with a Cyrillic small o (U+043E) inside the deploy
 * terminal. It looks identical and breaks the command when pasted, so anything
 * outside these ranges must not reach the DOM.
 */
const HOMOGLYPH_RANGES = /[Ͱ-ϿЀ-ӿ -‏＀-￯]/

const DEPLOY_LINES: TerminalLine[] = [
  { kind: 'command', text: 'npx mailysend deploy --domain acme.dev' },
  { kind: 'success', text: '✓ queues · do · d1 · r2 · dns   ready in 48s' },
]

describe('Terminal', () => {
  it('renders the deploy sample with no homoglyphs in its output', () => {
    const { container } = render(<Terminal lines={DEPLOY_LINES} />)
    expect(container.textContent ?? '').not.toMatch(HOMOGLYPH_RANGES)
  })

  it('keeps `do` as two ASCII characters', () => {
    const { container } = render(<Terminal lines={DEPLOY_LINES} />)
    const text = container.textContent ?? ''
    expect(text).toContain('do')
    const at = text.indexOf('do')
    expect(text.charCodeAt(at)).toBe(0x64)
    expect(text.charCodeAt(at + 1)).toBe(0x6f)
  })

  it('prints an ASCII dollar prompt in front of a command line', () => {
    const { container } = render(<Terminal lines={DEPLOY_LINES} />)
    const text = container.textContent ?? ''
    expect(text).toContain('$ npx mailysend deploy')
    expect(text.charCodeAt(text.indexOf('$'))).toBe(0x24)
  })

  it('shows every line at once when typing is off', () => {
    render(<Terminal lines={DEPLOY_LINES} />)
    expect(screen.getByText(/npx mailysend deploy/)).toBeInTheDocument()
    expect(screen.getByText(/ready in 48s/)).toBeInTheDocument()
  })

  it('labels the copy button rather than leaving it an unnamed icon', () => {
    render(<Terminal lines={DEPLOY_LINES} copyable caption="DEPLOY" />)
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument()
  })

  it('skips the typing reveal when the reader asked for reduced motion', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) =>
      ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia
    try {
      render(<Terminal lines={DEPLOY_LINES} typing />)
      expect(screen.getByText(/ready in 48s/)).toBeInTheDocument()
    } finally {
      window.matchMedia = original
    }
  })
})
