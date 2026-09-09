import { Check, Copy } from 'lucide-react'
import { cn } from '../lib/cn.ts'
import { useCopy } from '../lib/use-copy.ts'
import { MonoChip } from './mono-chip.tsx'

export interface CommandStripProps {
  command: string
  /** The trailing `48s` pill on the hero strip. */
  note?: string
  tone?: 'paper' | 'dark'
  className?: string
}

/** One line, one command, one button. The `$` is never part of what gets copied. */
export const CommandStrip = ({ command, note, tone = 'paper', className }: CommandStripProps) => {
  const { copied, copy } = useCopy()

  return (
    <div
      className={cn(
        'flex items-center gap-3 overflow-x-auto rounded-code border px-3.5 py-2.5 font-mono text-[13px]',
        tone === 'paper'
          ? 'border-line bg-card text-ink'
          : 'border-dark-line bg-dark text-on-dark-2',
        className,
      )}
    >
      <span aria-hidden="true" className={tone === 'paper' ? 'text-muted-2' : 'text-on-dark-5'}>
        $
      </span>
      <code className="whitespace-nowrap">{command}</code>
      {note ? (
        <MonoChip tone="positive" size="sm" className="tracking-[0.1em]">
          {note}
        </MonoChip>
      ) : null}
      <button
        type="button"
        aria-label={copied ? `Copied ${command}` : `Copy ${command}`}
        onClick={() => copy(command)}
        className={cn(
          'ml-auto grid size-7 shrink-0 place-items-center rounded-chip transition-colors duration-[0.18s]',
          tone === 'paper'
            ? 'text-muted-2 hover:bg-tint hover:text-ink'
            : 'text-on-dark-4 hover:bg-dark-line-soft hover:text-on-dark',
        )}
      >
        {copied ? <Check className="size-3.5 text-positive" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}
