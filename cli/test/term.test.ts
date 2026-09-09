import { describe, expect, it } from 'vitest'
import { displayWidth, pad, plural, relativeTime } from '../src/term.ts'

describe('displayWidth', () => {
  it('counts characters, not escape sequences', () => {
    const esc = String.fromCharCode(27)
    expect(displayWidth(`${esc}[32mok${esc}[39m`)).toBe(2)
  })

  it('matches length for plain text', () => {
    expect(displayWidth('plain')).toBe(5)
  })
})

describe('pad', () => {
  it('pads to the display width so coloured columns still line up', () => {
    const esc = String.fromCharCode(27)
    const coloured = `${esc}[32mok${esc}[39m`
    expect(pad(coloured, 5)).toBe(`${coloured}   `)
  })

  it('never truncates a value that is already too wide', () => {
    expect(pad('overlong', 3)).toBe('overlong')
  })
})

describe('plural', () => {
  it('picks the singular for exactly one', () => {
    expect(plural(1, 'template')).toBe('1 template')
  })

  it('picks the plural otherwise, with thousands separators', () => {
    expect(plural(0, 'template')).toBe('0 templates')
    expect(plural(12_500, 'contact')).toBe('12,500 contacts')
  })

  it('takes an irregular plural', () => {
    expect(plural(2, 'entry', 'entries')).toBe('2 entries')
  })
})

describe('relativeTime', () => {
  it('reports whole units from the largest that fits', () => {
    const now = Date.now()
    expect(relativeTime(new Date(now - 5000).toISOString())).toBe('5s')
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString())).toBe('3h')
  })

  it('collapses sub-second differences to "now"', () => {
    expect(relativeTime(new Date().toISOString())).toBe('now')
  })
})
