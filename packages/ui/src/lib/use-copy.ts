import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Copy-to-clipboard with a self-clearing "copied" flag.
 *
 * The timeout is held in a ref and cleared on unmount because the copy buttons
 * live inside terminals and code tabs that get unmounted by tab switches while
 * the flag is still pending.
 */
export const useCopy = (resetAfterMs = 1600) => {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        // A denied clipboard permission is not worth a thrown error in a UI
        // component; the button simply does not flip to "copied".
        return
      }
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), resetAfterMs)
    },
    [resetAfterMs],
  )

  return { copied, copy }
}
