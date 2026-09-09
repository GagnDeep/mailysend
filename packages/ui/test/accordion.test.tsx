import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../src/index.ts'

const Faq = () => (
  <Accordion type="single" collapsible defaultValue="a">
    <AccordionItem value="a">
      <AccordionTrigger>Do I need a Cloudflare account?</AccordionTrigger>
      <AccordionContent>Yes, that is the model.</AccordionContent>
    </AccordionItem>
    <AccordionItem value="b">
      <AccordionTrigger>Is there an SMTP option?</AccordionTrigger>
      <AccordionContent>Yes, on port 587.</AccordionContent>
    </AccordionItem>
  </Accordion>
)

const glyphOf = (name: string) => screen.getByRole('button', { name }).textContent?.slice(-1)

describe('Accordion', () => {
  it('shows a minus on the open item and a plus on the closed one', () => {
    render(<Faq />)
    expect(glyphOf('Do I need a Cloudflare account?')).toBe('−')
    expect(glyphOf('Is there an SMTP option?')).toBe('+')
  })

  it('flips the glyph when an item opens', async () => {
    const user = userEvent.setup()
    render(<Faq />)
    await user.click(screen.getByRole('button', { name: 'Is there an SMTP option?' }))
    expect(glyphOf('Is there an SMTP option?')).toBe('−')
    expect(glyphOf('Do I need a Cloudflare account?')).toBe('+')
  })

  it('flips the glyph back when the item collapses again', async () => {
    const user = userEvent.setup()
    render(<Faq />)
    await user.click(screen.getByRole('button', { name: 'Do I need a Cloudflare account?' }))
    expect(glyphOf('Do I need a Cloudflare account?')).toBe('+')
  })

  it('tracks the glyph in multiple mode where two items can be open at once', async () => {
    const user = userEvent.setup()
    render(
      <Accordion type="multiple" defaultValue={['a']}>
        <AccordionItem value="a">
          <AccordionTrigger>First</AccordionTrigger>
          <AccordionContent>one</AccordionContent>
        </AccordionItem>
        <AccordionItem value="b">
          <AccordionTrigger>Second</AccordionTrigger>
          <AccordionContent>two</AccordionContent>
        </AccordionItem>
      </Accordion>,
    )
    await user.click(screen.getByRole('button', { name: 'Second' }))
    expect(glyphOf('First')).toBe('−')
    expect(glyphOf('Second')).toBe('−')
  })

  it('carries the disclosure ARIA state', async () => {
    const user = userEvent.setup()
    render(<Faq />)
    const trigger = screen.getByRole('button', { name: 'Is there an SMTP option?' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls')
  })

  it('still reports the change to a controlled parent', async () => {
    const user = userEvent.setup()
    const seen: string[] = []
    render(
      <Accordion type="single" collapsible onValueChange={(v) => seen.push(v)}>
        <AccordionItem value="a">
          <AccordionTrigger>First</AccordionTrigger>
          <AccordionContent>one</AccordionContent>
        </AccordionItem>
      </Accordion>,
    )
    await user.click(screen.getByRole('button', { name: 'First' }))
    expect(seen).toEqual(['a'])
    expect(glyphOf('First')).toBe('−')
  })
})
