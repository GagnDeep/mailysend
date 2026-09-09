import { cn } from '@mailysend/ui'

export interface WordmarkProps {
  size?: 'sm' | 'md'
  tone?: 'paper' | 'dark'
  className?: string
}

/**
 * The logo lockup. The `M` is a real character rather than an image so it
 * inherits the mono face and needs no dimensions, no second request and no
 * decorative `alt` that a screen reader has to skip.
 */
export const Wordmark = ({ size = 'md', tone = 'paper', className }: WordmarkProps) => (
  <a
    href="/"
    aria-label="MailySend home"
    className={cn('flex items-center gap-2.5 no-underline', className)}
  >
    <span
      aria-hidden="true"
      className={cn(
        'grid place-items-center rounded-sm bg-accent font-mono font-bold text-white shadow-accent',
        size === 'sm' ? 'size-[26px] text-[13px]' : 'size-[27px] text-[13px]',
      )}
    >
      M
    </span>
    <span
      className={cn(
        'font-display font-semibold -tracking-[0.03em]',
        size === 'sm' ? 'text-[18px]' : 'text-[17px]',
        tone === 'dark' ? 'text-paper' : 'text-ink',
      )}
    >
      MailySend
    </span>
  </a>
)
