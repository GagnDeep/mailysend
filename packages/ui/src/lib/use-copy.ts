import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Copy-to-clipboard with a self-clearing "copied" flag.
 *
 * The timeout is held in a ref and cleared on unmount because the copy buttons
 * live inside terminals and code tabs that get unmounted by tab switches while
 * the flag is still pending.
 *
 * `navigator.clipboard` exists only in a secure context, and a MailySend
 * instance is reachable over plain HTTP more often than it looks — a worker on
 * an internal hostname, a reverse proxy terminating TLS somewhere else, a
 * colleague on `http://localhost:8787` from another machine. There, the whole
 * API is `undefined`, so every copy button on every screen did nothing at all
 * and said nothing about it: the one-time API key, the DNS records, the
 * recovery codes. This falls back to the old `execCommand` path, and when that
 * fails too it says so through `failed` rather than failing silently, because a
 * button that quietly does nothing is the worst of the three outcomes — the
 * reader walks away believing they have the key.
 */
export const useCopy = (resetAfterMs = 1600) => {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const copy = useCallback(
    async (text: string) => {
      const ok = (await writeClipboard(text)) || selectionFallback(text)

      setCopied(ok)
      setFailed(!ok)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        setCopied(false)
        setFailed(false)
      }, resetAfterMs)
      return ok
    },
    [resetAfterMs],
  )

  return { copied, failed, copy }
}

/** The modern path. Absent outside a secure context, and refusable inside one. */
const writeClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * The deprecated path, which is the only one that works over plain HTTP.
 *
 * Off-screen rather than hidden: `display: none` and `visibility: hidden` make
 * the selection uncopyable, and a focused textarea that is on screen for a
 * frame is a visible flicker. `readOnly` keeps a mobile keyboard from opening.
 */
const selectionFallback = (text: string): boolean => {
  if (typeof document === 'undefined') return false
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0'
  document.body.appendChild(area)

  const restore = document.activeElement
  try {
    area.select()
    area.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    if (restore instanceof HTMLElement) restore.focus()
  }
}
