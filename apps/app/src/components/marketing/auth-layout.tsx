import { cn } from '@mailysend/ui'
import type { ReactNode } from 'react'
import { PageShell } from './page-shell.tsx'
import { Wordmark } from './wordmark.tsx'

/**
 * Inline links inside the auth prose. The design has no base `a` rule, so the
 * accent has to be asked for explicitly rather than inherited.
 */
export const AUTH_LINK = 'text-accent no-underline hover:text-ink'
export const AUTH_LINK_STRONG = 'font-semibold text-accent no-underline hover:text-ink'

export interface AuthFooterLink {
  label: string
  href: string
}

export interface AuthLayoutProps {
  children: ReactNode
  /** The dark right-hand column, which differs entirely between the two pages. */
  panel: ReactNode
  footerLinks: AuthFooterLink[]
  /** Sign-in's form column is 400px; the setup wizard needs 430px for its DNS block. */
  formWidth?: string
}

/**
 * The two-column auth shell.
 *
 * `chrome={false}` because the site nav on a sign-in screen is an invitation to
 * leave it, and the artboards omit it deliberately. `auto-fit` rather than a
 * media query so the dark panel drops below the form the moment the columns
 * cannot both hold their 340px minimum.
 */
export const AuthLayout = ({
  children,
  panel,
  footerLinks,
  formWidth = 'max-w-[400px]',
}: AuthLayoutProps) => (
  <PageShell
    chrome={false}
    className="grid min-h-dvh grid-cols-[repeat(auto-fit,minmax(340px,1fr))] bg-paper"
  >
    <div className="flex min-w-0 flex-col p-[clamp(28px,5vw,64px)]">
      <Wordmark size="sm" className="mb-auto" />
      <div className={cn('my-12 w-full', formWidth)}>{children}</div>
      <nav aria-label="Supporting links" className="flex flex-wrap items-center gap-5 text-[13px]">
        {footerLinks.map((link) => (
          <a key={link.href} href={link.href} className="text-muted-2 no-underline hover:text-ink">
            {link.label}
          </a>
        ))}
        <span className="text-muted-2">MIT licensed</span>
      </nav>
    </div>
    <aside className="flex min-w-0 flex-col justify-center gap-6 bg-ink p-[clamp(28px,5vw,64px)] text-paper">
      {panel}
    </aside>
  </PageShell>
)

export interface AuthPreProps {
  children: ReactNode
  /** `dark` sits on the paper column; `panel` sits inside the ink panel. */
  tone?: 'dark' | 'panel' | 'paper'
  className?: string
}

/**
 * The fixed-width record blocks both pages use. A real `<pre>` rather than a
 * flex row per line: the columns only line up because the whitespace is
 * significant, and `whitespace-pre` is the only thing that guarantees it.
 */
export const AuthPre = ({ children, tone = 'panel', className }: AuthPreProps) => (
  <div
    className={cn(
      'overflow-x-auto rounded-md p-4 font-mono text-[12.5px] leading-[1.9]',
      tone === 'panel' && 'rounded-tile border border-dark-line bg-dark p-5 text-on-dark',
      tone === 'dark' && 'bg-ink text-on-dark',
      tone === 'paper' && 'border border-line bg-card text-[12px] text-muted',
      className,
    )}
  >
    <pre className="m-0 whitespace-pre">{children}</pre>
  </div>
)
