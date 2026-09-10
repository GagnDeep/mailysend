/**
 * A deployment must never claim a host it was not given.
 *
 * `seo/site.ts` used to read a `VITE_PUBLIC_URL` that is set nowhere in this
 * repository, so every build — including every one-click Cloudflare deploy —
 * fell through to a hardcoded `https://mailysend.com` and shipped canonicals,
 * `og:url`s and JSON-LD `@id`s naming a domain its operator does not own. A
 * canonical pointing at another origin is not cosmetic: it asks every search
 * engine to drop the page in favour of somebody else's.
 *
 * The host now comes from `__MS_SITE_URL__`, compiled in by `vite.config.ts`
 * from the same value that decides the sitemap host — so this file is really
 * asserting that the head, `sitemap.xml` and `robots.txt` cannot disagree.
 */
import { describe, expect, it, vi } from 'vitest'

/** Re-evaluate `seo/site.ts` with a given compiled-in host. */
const withSiteUrl = async (value: string | undefined) => {
  vi.resetModules()
  if (value === undefined) Reflect.deleteProperty(globalThis, '__MS_SITE_URL__')
  else Object.defineProperty(globalThis, '__MS_SITE_URL__', { value, configurable: true })
  try {
    return await import('../src/seo/site.ts')
  } finally {
    Reflect.deleteProperty(globalThis, '__MS_SITE_URL__')
  }
}

describe('a build with no configured host', () => {
  it('has no site URL rather than a borrowed one', async () => {
    for (const value of [undefined, '']) {
      const { SITE_URL } = await withSiteUrl(value)
      expect(SITE_URL).toBe('')
    }
  })

  it('emits site-relative URLs, which resolve to whoever serves the page', async () => {
    const { absoluteUrl } = await withSiteUrl('')
    expect(absoluteUrl('/setup')).toBe('/setup')
    expect(absoluteUrl('/og/default.png')).toBe('/og/default.png')
    expect(absoluteUrl('guides/deploy-to-cloudflare')).toBe('/guides/deploy-to-cloudflare')
  })

  it('never names mailysend.com', async () => {
    const { absoluteUrl, SITE_URL } = await withSiteUrl(undefined)
    expect(`${SITE_URL}${absoluteUrl('/')}${absoluteUrl('/docs')}`).not.toContain('mailysend.com')
  })
})

describe('a build that was told its host', () => {
  it('uses it, with no trailing slash to double up', async () => {
    const { SITE_URL, absoluteUrl } = await withSiteUrl('https://mail.example.dev/')
    expect(SITE_URL).toBe('https://mail.example.dev')
    expect(absoluteUrl('/setup')).toBe('https://mail.example.dev/setup')
  })

  it('leaves an already-absolute URL alone, whatever the host', async () => {
    for (const host of ['', 'https://mail.example.dev']) {
      const { absoluteUrl } = await withSiteUrl(host)
      expect(absoluteUrl('https://cdn.example.dev/card.png')).toBe(
        'https://cdn.example.dev/card.png',
      )
    }
  })
})
