import { useEffect, useState } from 'react'
import { REPO_URL } from '~/seo'

/** `GagnDeep/mailysend` — the API path, derived rather than written twice. */
const REPO_PATH = REPO_URL.replace(/^https?:\/\/github\.com\//, '')
const CACHE_KEY = 'ms:gh-stats'

interface RepoStats {
  stars: number
  forks: number
}

/**
 * A number that is either real or absent.
 *
 * Star counts are the one stat on a marketing page a visitor can check in a
 * single click, so a hard-coded or rounded-up figure is the most easily caught
 * lie we could tell. This asks GitHub from the visitor's own browser and
 * renders nothing until an answer arrives — so the prerendered HTML never ships
 * a stale count, and a rate-limited or offline visitor sees the line without a
 * number rather than seeing a zero.
 *
 * Unauthenticated and read-only: the request carries no identity of ours, and
 * GitHub's 60-per-hour limit is per visitor IP, not per site.
 */
export const GitHubStats = ({ className }: { className?: string }) => {
  const [stats, setStats] = useState<RepoStats | null>(null)

  useEffect(() => {
    // Within one session the count cannot have meaningfully moved, and this
    // keeps a visitor who reads five pages from spending five of their sixty.
    try {
      const cached = sessionStorage.getItem(CACHE_KEY)
      if (cached) {
        setStats(JSON.parse(cached) as RepoStats)
        return
      }
    } catch {
      // Private mode, or storage disabled. The fetch below still works.
    }

    const aborter = new AbortController()
    fetch(`https://api.github.com/repos/${REPO_PATH}`, { signal: aborter.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<{ stargazers_count?: number; forks_count?: number }>
      })
      .then((body) => {
        if (typeof body.stargazers_count !== 'number') return
        const next = { stars: body.stargazers_count, forks: body.forks_count ?? 0 }
        setStats(next)
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(next))
        } catch {
          // Not worth a broken render.
        }
      })
      .catch(() => {
        // Offline, rate-limited, or aborted on unmount: the line renders without
        // a number, which is the honest state.
      })
    return () => {
      aborter.abort()
    }
  }, [])

  if (!stats) return null

  return (
    <>
      <span aria-hidden="true">·</span>
      <a href={`${REPO_URL}/stargazers`} className={className}>
        ★ {compact(stats.stars)} STARS
      </a>
    </>
  )
}

/** 1200 → 1.2K. `Intl` does this correctly for every locale we render in. */
const compact = (value: number) =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
    .format(value)
    .toUpperCase()
