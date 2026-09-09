import { Check, Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { cn } from '../lib/cn.ts'
import { useCopy } from '../lib/use-copy.ts'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs.tsx'

export interface CodeTabsItem {
  value: string
  /** The tab label — `node`, `python`, `go`, `curl`. */
  label: string
  code: string
  /** Optional highlighted rendering; falls back to the raw `code` string. */
  children?: ReactNode
}

export interface CodeTabsProps {
  items: CodeTabsItem[]
  defaultValue?: string
  /** The right-hand caption in the tab strip, e.g. `POST /v1/emails`. */
  caption?: ReactNode
  /** Rendered under the code, e.g. the response line on the home hero. */
  footer?: ReactNode
  className?: string
}

/**
 * The tab strip is `role="tablist"` by way of Radix. The artboard version is a
 * row of plain buttons, so a keyboard user has to tab through every language to
 * reach the code — here the arrows move between languages and Tab leaves.
 */
export const CodeTabs = ({ items, defaultValue, caption, footer, className }: CodeTabsProps) => {
  const [value, setValue] = useState(defaultValue ?? items[0]?.value ?? '')
  const { copied, copy } = useCopy()
  const active = items.find((item) => item.value === value)

  return (
    <Tabs
      value={value}
      onValueChange={setValue}
      className={cn('overflow-hidden rounded-block bg-ink', className)}
    >
      <TabsList tone="dark" className="gap-1">
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            tone="dark"
            value={item.value}
            className="rounded-sm font-mono text-[12px]"
          >
            {item.label}
          </TabsTrigger>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {caption ? <span className="font-mono text-[11px] text-on-dark-5">{caption}</span> : null}
          <button
            type="button"
            aria-label={copied ? 'Code copied' : `Copy ${active?.label ?? ''} sample`}
            onClick={() => copy(active?.code ?? '')}
            className={cn(
              'grid size-7 place-items-center rounded-sm text-on-dark-4',
              'transition-colors duration-[0.18s] hover:bg-dark-line-soft hover:text-on-dark',
            )}
          >
            {copied ? (
              <Check className="size-3.5 text-code-green" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        </div>
      </TabsList>
      {items.map((item) => (
        <TabsContent key={item.value} value={item.value}>
          <div className="overflow-x-auto p-[22px] font-mono text-[13px] leading-[1.85] text-on-dark">
            <pre className="m-0 whitespace-pre">{item.children ?? item.code}</pre>
          </div>
        </TabsContent>
      ))}
      {footer ? (
        <div className="border-t border-dark-line-soft px-[22px] py-4">{footer}</div>
      ) : null}
    </Tabs>
  )
}
