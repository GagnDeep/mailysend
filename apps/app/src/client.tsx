import { StartClient } from '@tanstack/react-start/client'
import { StrictMode, startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'

/**
 * Hydration is wrapped in `startTransition` so React yields between chunks:
 * the marketing pages are already painted from prerendered HTML, and blocking
 * the main thread to attach handlers to them would cost INP for no benefit.
 */
startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  )
})
