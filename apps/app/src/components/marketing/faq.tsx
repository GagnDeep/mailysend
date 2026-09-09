import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@mailysend/ui'
import type { ReactNode } from 'react'
import type { FaqEntry } from '~/seo'

export interface FaqItem extends FaqEntry {
  /** The rendered answer, when it needs a link the plain-text version can't carry. */
  body?: ReactNode
}

/**
 * The FAQ accordion.
 *
 * `items` is the single source for both the visible copy and the `FAQPage`
 * JSON-LD — structured data that disagrees with the page it describes is the
 * one kind of markup that is worse than none.
 *
 * The `+`/`−` glyph is handled inside the `Accordion` primitive; the artboard's
 * version drew `+` on every row including the open one.
 */
export const Faq = ({ items, defaultOpen }: { items: FaqItem[]; defaultOpen?: string }) => (
  <Accordion type="multiple" defaultValue={defaultOpen ? [defaultOpen] : []}>
    {items.map((item) => (
      <AccordionItem key={item.question} value={item.question}>
        <AccordionTrigger>{item.question}</AccordionTrigger>
        <AccordionContent>{item.body ?? item.answer}</AccordionContent>
      </AccordionItem>
    ))}
  </Accordion>
)

/** Strips the render-only fields so the schema builder gets exactly Q and A. */
export const toFaqEntries = (items: FaqItem[]): FaqEntry[] =>
  items.map(({ question, answer }) => ({ question, answer }))
