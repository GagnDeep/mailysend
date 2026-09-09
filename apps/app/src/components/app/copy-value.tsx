import { Button, cn, useCopy } from '@mailysend/ui'
import { Check, Copy } from 'lucide-react'

/** A mono value with a copy affordance — ids, DNS records, endpoints. */
export const CopyValue = ({
  value,
  label,
  className,
  truncate = true,
}: {
  value: string
  /** What is being copied, for the button's accessible name. */
  label: string
  className?: string
  truncate?: boolean
}) => {
  const { copied, copy } = useCopy()

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <code
        className={cn(
          'min-w-0 font-mono text-[12.5px] text-muted',
          truncate ? 'truncate' : 'break-all',
        )}
      >
        {value}
      </code>
      <Button
        variant="ghost"
        size="sm"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className="size-7 shrink-0 p-0"
        onClick={() => copy(value)}
      >
        {copied ? (
          <Check aria-hidden="true" className="text-positive" />
        ) : (
          <Copy aria-hidden="true" />
        )}
      </Button>
    </span>
  )
}
