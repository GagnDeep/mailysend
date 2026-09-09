import { afterEach, describe, expect, it, vi } from 'vitest'
import { isNodeRuntime, MjmlUnavailableError, renderMjml } from '../src/mjml.ts'
import { renderTemplate } from '../src/render.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mjml', () => {
  it('detects the Node runtime', () => {
    expect(isNodeRuntime()).toBe(true)
  })

  it('refuses to compile on Workers, with an actionable message', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' })
    expect(isNodeRuntime()).toBe(false)
    await expect(renderMjml('<mjml></mjml>')).rejects.toBeInstanceOf(MjmlUnavailableError)
    await expect(renderMjml('<mjml></mjml>')).rejects.toThrow(/mailysend templates push/)
  })

  it('compiles on Node and then interpolates the result', async () => {
    const result = await renderTemplate({
      engine: 'mjml',
      subject: 'Hi',
      html:
        '<mjml><mj-body><mj-section><mj-column>' +
        '<mj-text>Hello {{first_name}}</mj-text>' +
        '</mj-column></mj-section></mj-body></mjml>',
      data: { first_name: 'Jane' },
    })
    expect(result.html).toContain('Hello Jane')
    expect(result.html).toContain('<table')
    expect(result.text).toContain('Hello Jane')
  })
})
