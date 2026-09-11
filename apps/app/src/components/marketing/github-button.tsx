import { cn } from '@mailysend/ui'
import { useEffect, useState } from 'react'
import { REPO_URL } from '~/seo'

/** The `owner/repo` the API wants. It is not a label: the button says "GitHub". */
const REPO_PATH = REPO_URL.replace(/^https?:\/\/github\.com\//, '')
const CACHE_KEY = 'ms:gh-stats'

/**
 * GitHub's own mark. Lucide 1.x dropped its brand icons, and a generic "code"
 * glyph would make the destination a guess — this is the one place where the
 * logo *is* the information.
 */
const GitHubMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" className={className}>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
)

const StarMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" className={className}>
    <path d="M8 .25l2.29 4.64 5.12.75-3.7 3.61.87 5.1L8 11.94l-4.58 2.41.87-5.1L.59 5.64l5.12-.75L8 .25Z" />
  </svg>
)

interface RepoStats {
  stars: number
}

/**
 * The repository, as two buttons that do the two different things a visitor
 * wants: open the source, or star it.
 *
 * The count is fetched from GitHub in the visitor's own browser. A star number
 * is the one figure on a marketing page that is a single click from being
 * checked, so a hard-coded or rounded-up one is the most easily caught lie we
 * could tell — this renders the button with its plain "Star" label until a real
 * answer arrives, and keeps that label for a visitor who is offline or
 * rate-limited, rather than showing a zero.
 *
 * Unauthenticated and read-only: the request carries no identity of ours, and
 * GitHub's 60-per-hour limit is per visitor IP, not per site.
 */
export const GitHubButton = ({
  tone = 'ink',
  size = 'lg',
  className,
}: {
  /** `ink` on the paper ground, `dark` inside an ink band. */
  tone?: 'ink' | 'dark'
  size?: 'md' | 'lg'
  className?: string
}) => {
  const [stats, setStats] = useState<RepoStats | null>(null)

  useEffect(() => {
    // Within one session the count cannot have meaningfully moved, and this
    // keeps somebody who reads five pages from spending five of their sixty.
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
        return response.json() as Promise<{ stargazers_count?: number }>
      })
      .then((body) => {
        if (typeof body.stargazers_count !== 'number') return
        const next = { stars: body.stargazers_count }
        setStats(next)
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(next))
        } catch {
          // Not worth a broken render.
        }
      })
      .catch(() => {
        // Offline, rate-limited or unmounted: the button keeps its plain label.
      })
    return () => {
      aborter.abort()
    }
  }, [])

  const dark = tone === 'dark'
  const half =
    'flex items-center no-underline transition-colors duration-[0.18s] ' +
    (dark
      ? 'text-paper hover:bg-paper hover:text-ink'
      : 'text-paper hover:bg-accent hover:text-white')

  return (
    // One pill split in two, so the border is drawn once and the two halves
    // cannot drift apart by a pixel at different font sizes.
    <div
      className={cn(
        'inline-flex items-stretch overflow-hidden rounded-pill border font-semibold',
        size === 'lg' ? 'h-[52px] text-[15.5px]' : 'h-11 text-[15px]',
        dark ? 'border-paper bg-transparent' : 'border-ink bg-ink',
        className,
      )}
    >
      <a href={REPO_URL} className={cn(half, 'gap-2.5', size === 'lg' ? 'px-[22px]' : 'px-[18px]')}>
        <GitHubMark className={size === 'lg' ? 'size-[18px]' : 'size-4'} />
        GitHub
      </a>
      <a
        href={`${REPO_URL}/stargazers`}
        className={cn(
          half,
          'gap-2 border-l px-[18px]',
          dark ? 'border-paper/40' : 'border-paper/25',
        )}
      >
        <StarMark className="size-[15px]" />
        Star
        {stats ? (
          <span className="ms-num font-mono text-[13.5px]">{compact(stats.stars)}</span>
        ) : null}
      </a>
    </div>
  )
}

/** 1200 → 1.2k. `Intl` does this correctly for every locale we render in. */
const compact = (value: number) =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
