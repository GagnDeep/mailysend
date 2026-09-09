import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState } from '../src/index.ts'

describe('EmptyState', () => {
  it('renders the title, the one sentence and the single next action', () => {
    render(
      <EmptyState
        title="No messages yet"
        description="Send your first email and it will appear here within a second."
        action={{ label: 'Send a test email' }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'No messages yet' })).toBeInTheDocument()
    expect(screen.getByText(/Send your first email/)).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('invokes the action', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <EmptyState
        title="No domains"
        description="Add a domain to start sending."
        action={{ label: 'Add a domain', onClick }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Add a domain' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('renders an href action as a link so it can be opened in a new tab', () => {
    render(
      <EmptyState
        title="No API keys"
        description="Create a key to authenticate your first request."
        action={{ label: 'Create a key', href: '/keys/new' }}
      />,
    )
    expect(screen.getByRole('link', { name: 'Create a key' })).toHaveAttribute('href', '/keys/new')
  })

  it('keeps the primary action first when a secondary one is present', () => {
    render(
      <EmptyState
        title="No automations"
        description="Automations send follow-ups without you."
        action={{ label: 'Create an automation' }}
        secondaryAction={{ label: 'Read the guide', href: '/docs' }}
      />,
    )
    const actions = screen.getAllByRole('button').concat(screen.getAllByRole('link'))
    expect(actions[0]).toHaveTextContent('Create an automation')
    expect(screen.getByRole('link', { name: 'Read the guide' })).toBeInTheDocument()
  })

  it('gives the icon no accessible name of its own', () => {
    const Icon = (props: { className?: string }) => <svg {...props} data-testid="icon" />
    render(
      <EmptyState
        icon={Icon}
        title="Nothing here"
        description="Not yet, anyway."
        action={{ label: 'Do the thing' }}
      />,
    )
    expect(screen.getByTestId('icon')).toHaveAttribute('aria-hidden', 'true')
  })
})
