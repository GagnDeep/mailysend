import { cn, MonoChip } from '@mailysend/ui'
import type { ReactNode } from 'react'

/**
 * The prose primitives, shared by /docs and every guide.
 *
 * These lived inside docs.tsx as file-private components, which was right while
 * /docs was the only long-form page on the site. The guides are the same kind
 * of document and must look identical — a code block or an endpoint line that
 * renders one way on /docs and another way on /guides is the sort of drift a
 * reader notices without being able to name.
 *
 * They belong here rather than in `@mailysend/ui` because `methodTone` is a
 * documentation concept, not a design primitive: the UI package scopes itself
 * to shadcn-shaped primitives and the design's own vocabulary, and "the colour
 * a PATCH verb is" is neither.
 */

/* Syntax colouring for the dark samples. Three roles is all the artboard uses. */
export const Str = ({ children }: { children: ReactNode }) => (
  <span className="text-code-green">{children}</span>
)
export const Key = ({ children }: { children: ReactNode }) => (
  <span className="text-accent-on-dark">{children}</span>
)
export const Com = ({ children }: { children: ReactNode }) => (
  <span className="text-on-dark-5">{children}</span>
)

/** The plain dark code block — `Terminal` is for `$` commands, this is for source. */
export const Code = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('overflow-x-auto rounded-tile bg-ink p-[18px]', className)}>
    <pre className="m-0 whitespace-pre font-mono text-[12.5px] leading-[1.8] text-on-dark">
      {children}
    </pre>
  </div>
)

export const Mono = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-[0.92em] text-ink">{children}</span>
)

export const Lede = ({ children }: { children: ReactNode }) => (
  <p className="mt-0 mb-4 text-[16.5px] leading-[1.7] text-muted">{children}</p>
)

export const methodTone = {
  POST: 'text-positive',
  GET: 'text-accent',
  PATCH: 'text-muted',
  DEL: 'text-warning',
} as const

export const Endpoint = ({
  method,
  path,
  note,
  tone,
}: {
  method: string
  path: string
  note?: ReactNode
  tone?: keyof typeof methodTone
}) => (
  <div className="flex flex-wrap items-baseline gap-3 font-mono text-[13px]">
    <span className={cn('min-w-[48px] font-bold', methodTone[tone ?? (method as 'POST')])}>
      {method}
    </span>
    <span>{path}</span>
    {note ? <span className="font-sans text-[14px] text-muted-2">{note}</span> : null}
  </div>
)

/**
 * A section heading plus its `<section>` wrapper, so every anchor is uniform.
 *
 * Named `AnchorSection` rather than `DocSectionShell` now that guides use it
 * too. `heading` is a ReactNode rather than a string because a guide puts a
 * step number chip inside the heading, and `scroll-mt` matches the sticky
 * header height so an anchor never lands underneath it.
 */
export const AnchorSection = ({
  anchor,
  heading,
  badge,
  children,
}: {
  anchor: string
  heading: ReactNode
  badge?: string
  children: ReactNode
}) => (
  <section id={anchor} className="min-w-0 scroll-mt-[92px]">
    <h2 className="ms-display-3 mt-0 mb-5 flex flex-wrap items-center gap-3">
      {heading}
      {badge ? (
        <MonoChip tone="accent" size="sm" className="tracking-[0.1em]">
          {badge}
        </MonoChip>
      ) : null}
    </h2>
    {/*
      `ms-prose` is what puts air between the blocks below and holds the text
      to a readable measure — see the rule in design-tokens/theme.css. Without
      it the body of a section is whatever margins its individual blocks happen
      to carry, which for a plain <p> is none.
    */}
    <div className="ms-prose">{children}</div>
  </section>
)
