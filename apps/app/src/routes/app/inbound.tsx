import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * `/app/inbound` is now `/app/mail`.
 *
 * The old screen showed received mail only, and could not show it: nothing ever
 * wrote the thread rows it read from. Its replacement carries both directions,
 * so the link keeps working and lands somewhere that does.
 */
export const Route = createFileRoute('/app/inbound')({
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/app/mail', search: search as Record<string, unknown> })
  },
})
