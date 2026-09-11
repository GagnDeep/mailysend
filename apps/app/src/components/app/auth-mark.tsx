import { Check, Minus, X } from 'lucide-react'

/**
 * One authentication mark — DKIM, SPF or DMARC.
 *
 * `undefined` is its own state and is drawn as such: nothing reports DKIM and
 * SPF until a domain has been checked, and a hollow dash is honest where a red
 * cross would be an accusation.
 *
 * Lifted out of the domains list so the detail page draws the same three marks
 * rather than a second vocabulary for the same three facts.
 */
export const AuthMark = ({ label, state }: { label: string; state: boolean | undefined }) => {
  const text =
    state === undefined
      ? `${label} not checked yet`
      : state
        ? `${label} passing`
        : `${label} failing`
  return (
    <span className="inline-flex items-center gap-1" title={text}>
      <span className="sr-only">{text}</span>
      {state === undefined ? (
        <Minus aria-hidden="true" className="size-3 text-muted-3" />
      ) : state ? (
        <Check aria-hidden="true" className="size-3 text-positive" />
      ) : (
        <X aria-hidden="true" className="size-3 text-warning" />
      )}
      <span aria-hidden="true" className="font-mono text-[11px] text-muted-2">
        {label}
      </span>
    </span>
  )
}
