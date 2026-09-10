import { Badge, cn, toast } from '@mailysend/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useAppScope } from '~/components/app/scope.tsx'

/**
 * A recipient field, as a mail client has one.
 *
 * The composer used to hold three bare text inputs split on commas at send
 * time, which meant a typo was invisible until the send failed, a duplicate
 * address sent twice, and a pasted list of forty addresses was one unreadable
 * line. Addresses become chips the moment they are complete — comma, semicolon,
 * Enter, Tab or blur — validated and deduped as they land.
 *
 * Autocomplete comes from the workspace's contacts, but it never gates: a typed
 * address that matches nothing is always allowed, because the alternative is a
 * mail client that refuses to write to somebody new. When it matches nothing,
 * the field offers to file it as a contact instead of insisting first.
 */

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

/** `Ana <ana@acme.dev>` and `ana@acme.dev` both reduce to the address. */
export const bare = (value: string): string => {
  const angled = /<([^>]+)>/.exec(value)
  return (angled?.[1] ?? value).trim().toLowerCase()
}

export const isAddress = (value: string): boolean => EMAIL.test(bare(value))

export interface RecipientFieldProps {
  id?: string
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  'aria-label'?: string
}

export function RecipientField({
  id,
  value,
  onChange,
  placeholder,
  'aria-label': ariaLabel,
}: RecipientFieldProps) {
  const { api } = useAppScope()
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  // Two characters before the first request, and debounced: a suggestion list
  // that fires per keystroke is a query per character on a shared database.
  const [term, setTerm] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setTerm(draft.trim()), 180)
    return () => clearTimeout(timer)
  }, [draft])

  const suggestions = useQuery({
    queryKey: ['contacts', 'search', term],
    queryFn: () => api.searchContacts(term),
    enabled: term.length >= 2,
    staleTime: 30_000,
  })

  const options = (suggestions.data?.data ?? []).filter((row) => !value.includes(row.email))

  /**
   * Quick-add, so a new correspondent can be filed without leaving the message.
   * A contact needs an audience and a person adding one address does not want to
   * be asked which — the first audience is used, and one is created if the
   * workspace has none.
   */
  const quickAdd = useMutation({
    mutationFn: async (address: string) => {
      const audiences = await api.listAudiences({ limit: 1 })
      const audience = audiences.data[0] ?? (await api.createAudience({ name: 'Contacts' }))
      return api.createContact(audience.id, { email: bare(address) })
    },
    onSuccess: (contact) => toast.success(`${contact.email} saved as a contact`),
    onError: (error: Error) =>
      toast.error('Could not save that contact', { description: error.message }),
  })

  const draftIsNewAddress =
    isAddress(draft) && term === draft.trim() && !suggestions.isFetching && options.length === 0

  const commit = (raw: string): boolean => {
    const candidate = raw.trim().replace(/[,;]+$/, '')
    if (!candidate) return false
    // Dedupe on the address alone, so `Ana <a@x>` does not sit next to `a@x`.
    if (value.some((existing) => bare(existing) === bare(candidate))) {
      setDraft('')
      return true
    }
    onChange([...value, candidate])
    setDraft('')
    return true
  }

  /** A paste of forty addresses is one gesture, not forty. */
  const commitMany = (raw: string) => {
    const parts = raw
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
    const next = [...value]
    for (const part of parts) {
      if (!next.some((existing) => bare(existing) === bare(part))) next.push(part)
    }
    onChange(next)
    setDraft('')
  }

  return (
    <div className="min-w-0 flex-1">
      {/* No click handler on the box itself: the input is `flex-1`, so it
          already fills every part of the row that is not a chip and a click on
          blank space lands on it. A handler here would only be a second way to
          do what the input does, and one a keyboard user could not reach. */}
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1 rounded-code border border-line bg-paper px-1.5 py-1',
          'focus-within:border-accent',
        )}
      >
        {value.map((address) => (
          <Badge
            key={address}
            size="sm"
            variant={isAddress(address) ? 'neutral' : 'danger'}
            title={isAddress(address) ? address : `${address} does not look like an address`}
          >
            {address}
            <button
              type="button"
              aria-label={`Remove ${address}`}
              className="ml-0.5 opacity-60 hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                onChange(value.filter((entry) => entry !== address))
              }}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}

        <input
          ref={inputRef}
          id={id}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          className="min-w-[12ch] flex-1 border-0 bg-transparent px-1 py-0.5 text-[13.5px] outline-none"
          placeholder={value.length === 0 ? placeholder : ''}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setOpen(true)
            setHighlight(0)
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text')
            if (!/[,;\n]/.test(pasted)) return
            event.preventDefault()
            commitMany(pasted)
          }}
          onBlur={() => {
            // A half-typed address left in the box when the reader clicks Send
            // is the most common way a recipient goes missing.
            if (draft.trim()) commit(draft)
            setOpen(false)
          }}
          onKeyDown={(event) => {
            const visible = open && options.length > 0
            if (event.key === 'ArrowDown' && visible) {
              event.preventDefault()
              setHighlight((h) => (h + 1) % options.length)
              return
            }
            if (event.key === 'ArrowUp' && visible) {
              event.preventDefault()
              setHighlight((h) => (h - 1 + options.length) % options.length)
              return
            }
            if (
              event.key === 'Enter' ||
              event.key === ',' ||
              event.key === ';' ||
              event.key === 'Tab'
            ) {
              const picked = visible ? options[highlight] : undefined
              if (picked) {
                event.preventDefault()
                commit(picked.email)
                setOpen(false)
                return
              }
              if (!draft.trim()) return
              // Tab still moves on when there is nothing to commit.
              event.preventDefault()
              commit(draft)
              return
            }
            if (event.key === 'Backspace' && draft === '' && value.length > 0) {
              onChange(value.slice(0, -1))
            }
            if (event.key === 'Escape') setOpen(false)
          }}
        />
      </div>

      {open && draftIsNewAddress ? (
        <div className="mt-1 rounded-code border border-line bg-card p-1">
          <button
            type="button"
            className="w-full rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-tint"
            onMouseDown={(event) => {
              event.preventDefault()
              const address = draft
              commit(address)
              quickAdd.mutate(address)
              setOpen(false)
            }}
          >
            Add <span className="font-mono text-[12px]">{bare(draft)}</span> and save as a contact
          </button>
        </div>
      ) : null}

      {open && options.length > 0 ? (
        <div
          id={listId}
          role="listbox"
          className="m-0 mt-1 max-h-56 list-none overflow-y-auto rounded-code border border-line bg-card p-1 shadow-sm"
        >
          {options.map((option, index) => (
            <div key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                className={cn(
                  'flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left text-[13px]',
                  index === highlight ? 'bg-tint' : '',
                )}
                // `mousedown` rather than `click`: the input's blur would have
                // committed the half-typed draft and closed the list first.
                onMouseDown={(event) => {
                  event.preventDefault()
                  commit(option.email)
                  setOpen(false)
                }}
              >
                {option.name ? <span className="font-medium">{option.name}</span> : null}
                <span className="font-mono text-[12px] text-muted">{option.email}</span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Exported for the composer's send guard and its tests. */
export const validRecipients = (value: string[]): string[] => value.filter(isAddress)
