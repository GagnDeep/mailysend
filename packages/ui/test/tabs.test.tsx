import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../src/index.ts'

const Sample = () => (
  <Tabs defaultValue="node">
    <TabsList>
      <TabsTrigger value="node">node</TabsTrigger>
      <TabsTrigger value="python">python</TabsTrigger>
      <TabsTrigger value="curl">curl</TabsTrigger>
    </TabsList>
    <TabsContent value="node">node sample</TabsContent>
    <TabsContent value="python">python sample</TabsContent>
    <TabsContent value="curl">curl sample</TabsContent>
  </Tabs>
)

describe('Tabs', () => {
  it('emits the tab roles the artboards omit', () => {
    render(<Sample />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('tabpanel')).toHaveTextContent('node sample')
  })

  it('marks exactly one tab selected', () => {
    render(<Sample />)
    expect(screen.getByRole('tab', { name: 'node' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'python' })).toHaveAttribute('aria-selected', 'false')
  })

  it('points each tab at the panel it controls', () => {
    render(<Sample />)
    const tab = screen.getByRole('tab', { name: 'node' })
    const panel = screen.getByRole('tabpanel')
    expect(tab).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveAttribute('aria-labelledby', tab.id)
  })

  it('moves between tabs with the arrow keys and wraps at the end', async () => {
    const user = userEvent.setup()
    render(<Sample />)
    await user.tab()
    expect(screen.getByRole('tab', { name: 'node' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'python' })).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'node' })).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'curl' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('curl sample')
  })

  it('keeps only the active trigger in the tab order', async () => {
    const user = userEvent.setup()
    render(<Sample />)
    await user.tab()
    expect(screen.getByRole('tab', { name: 'node' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('tabpanel')).toHaveFocus()
  })
})
