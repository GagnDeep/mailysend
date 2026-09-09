// biome-ignore-all lint/suspicious/noArrayIndexKey: a terminal line is identified by its position.

import { Check, Copy } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '../lib/cn.ts'
import { useCopy } from '../lib/use-copy.ts'

export type TerminalLineKind = 'command' | 'success' | 'comment' | 'output'

export interface TerminalLine {
  text: string
  kind?: TerminalLineKind
}

export interface TerminalProps {
  lines: TerminalLine[]
  /** Shown in the top-right of the block, e.g. `POST /v1/emails`. */
  caption?: string
  copyable?: boolean
  /**
   * Reveals one line at a time. Off by default: a terminal that types is a
   * hero flourish, and every other placement in the design shows the finished
   * output immediately.
   */
  typing?: boolean
  typingMs?: number
  className?: string
}

const lineClass: Record<TerminalLineKind, string> = {
  command: 'text-on-dark',
  success: 'text-code-green',
  comment: 'text-on-dark-5',
  output: 'text-on-dark-3',
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The dark command block. `$` is ASCII 0x24 and every glyph below is either
 * ASCII or an intentional symbol (`✓`, `·`) — the source artboard smuggled a
 * Cyrillic `о` into the word `do` in the deploy sample, which breaks copy-paste
 * of the command it is advertising.
 */
export const Terminal = ({
  lines,
  caption,
  copyable = false,
  typing = false,
  typingMs = 420,
  className,
}: TerminalProps) => {
  const { copied, copy } = useCopy()
  const [revealed, setRevealed] = useState(() => (typing ? 0 : lines.length))

  useEffect(() => {
    if (!typing || prefersReducedMotion()) {
      setRevealed(lines.length)
      return
    }
    setRevealed(0)
    let i = 0
    const id = setInterval(() => {
      i += 1
      setRevealed(i)
      if (i >= lines.length) clearInterval(id)
    }, typingMs)
    return () => clearInterval(id)
  }, [typing, typingMs, lines.length])

  const plainText = useMemo(
    () => lines.map((l) => (l.kind === 'command' ? `$ ${l.text}` : l.text)).join('\n'),
    [lines],
  )

  return (
    <div className={cn('relative overflow-hidden rounded-block bg-ink', className)}>
      {caption || copyable ? (
        <div className="flex items-center gap-3 border-b border-dark-line-soft px-5 py-3">
          {caption ? <span className="ms-eyebrow text-on-dark-5">{caption}</span> : null}
          {copyable ? (
            <button
              type="button"
              aria-label={copied ? 'Command copied' : 'Copy command'}
              onClick={() => copy(plainText)}
              className={cn(
                'ml-auto grid size-8 place-items-center rounded-md text-on-dark-4',
                'transition-colors duration-[0.18s] hover:bg-dark-line-soft hover:text-on-dark',
              )}
            >
              {copied ? <Check className="size-4 text-code-green" /> : <Copy className="size-4" />}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="overflow-x-auto p-5 font-mono text-[12.5px] leading-[1.9]">
        <pre className="m-0 whitespace-pre">
          {lines.slice(0, revealed).map((line, i) => (
            <div key={`${i}-${line.text}`} className={lineClass[line.kind ?? 'output']}>
              {line.kind === 'command' ? <span className="text-on-dark-5">{'$ '}</span> : null}
              {line.text}
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}
