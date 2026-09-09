import { describe, expect, it } from 'vitest'
import { cn } from '../src/index.ts'

describe('cn', () => {
  it('joins and de-duplicates conditional class values', () => {
    expect(cn('px-2', false && 'hidden', ['py-1', { 'text-ink': true, 'text-muted': false }])).toBe(
      'px-2 py-1 text-ink',
    )
  })

  it('lets the last class win inside a stock Tailwind group', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('resolves conflicts between our own radius scale', () => {
    expect(cn('rounded-card', 'rounded-pill')).toBe('rounded-pill')
  })

  it('resolves conflicts between our own colour scale', () => {
    expect(cn('bg-paper', 'bg-accent-soft')).toBe('bg-accent-soft')
    expect(cn('text-muted-2', 'text-ink')).toBe('text-ink')
  })

  it('treats the display scale as one group', () => {
    expect(cn('ms-display-1', 'ms-display-3')).toBe('ms-display-3')
  })

  it('leaves unrelated custom utilities alone', () => {
    expect(cn('ms-container', 'ms-eyebrow')).toBe('ms-container ms-eyebrow')
  })
})
