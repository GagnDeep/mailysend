import { Badge, cn, Input } from '@mailysend/ui'
import { useId, useState } from 'react'
import type { MailIdentityRecord } from '~/lib/api-client.ts'

/**
 * The From control.
 *
 * What it replaces: a `<Select>` whose only options were the string `mail@`
 * concatenated onto each verified domain. Nobody had ever created a mailbox
 * called `mail@`, and the mailboxes people *had* created were not offered at
 * all — the picker was showing a template, not the workspace.
 *
 * So it is a combobox rather than a select: the list is the real identities,
 * and the field is free text, because a person owning a verified domain is
 * entitled to send from any local part on it without creating a mailbox first.
 * Validation is advisory here and enforced on the server — `resolveDomain` in
 * the send path is the real gate, and duplicating it as a hard block in the UI
 * would only mean two rules to keep in step.
 */

export interface IdentityPickerProps {
  id?: string
  value: string
  onChange: (value: string) => void
  identities: MailIdentityRecord[]
  sendableDomains: { id: string; name: string }[]
  /** Test mode accepts any domain, because nothing leaves the process. */
  permissive?: boolean
}

const domainOf = (address: string): string => (address.split('@')[1] ?? '').trim().toLowerCase()

export function IdentityPicker({
  id,
  value,
  onChange,
  identities,
  sendableDomains,
  permissive = false,
}: IdentityPickerProps) {
  const [open, setOpen] = useState(false)
  const listId = useId()

  const typed = domainOf(value)
  const known = sendableDomains.some((domain) => domain.name.toLowerCase() === typed)
  const matched = identities.find(
    (identity) => identity.address.toLowerCase() === value.trim().toLowerCase(),
  )

  const filter = value.trim().toLowerCase()
  const options = identities.filter(
    (identity) =>
      !filter ||
      identity.address.toLowerCase().includes(filter) ||
      identity.address.toLowerCase() === filter,
  )

  return (
    <div className="min-w-0 flex-1">
      <div className="relative">
        <Input
          id={id}
          value={value}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          autoComplete="off"
          placeholder={
            sendableDomains.length > 0
              ? `anything@${sendableDomains[0]?.name}`
              : 'Verify a domain, or switch on Test mode'
          }
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
          }}
        />

        {open && options.length > 0 ? (
          <div
            id={listId}
            role="listbox"
            className="absolute z-30 m-0 mt-1 max-h-60 w-full list-none overflow-y-auto rounded-code border border-line bg-card p-1 shadow-md"
          >
            {options.map((identity) => (
              <div key={`${identity.source}:${identity.address}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={identity.address === value}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left',
                    identity.address === value ? 'bg-tint' : 'hover:bg-tint',
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    onChange(identity.address)
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0 truncate font-mono text-[12.5px]">
                    {identity.address}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {identity.name ? (
                      <span className="text-[12px] text-muted-2">{identity.name}</span>
                    ) : null}
                    <Badge size="sm" variant={identity.can_receive_replies ? 'neutral' : 'outline'}>
                      {identity.source === 'mailbox'
                        ? 'inbox'
                        : identity.source === 'test'
                          ? 'test'
                          : 'send-only'}
                    </Badge>
                  </span>
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Advisory, never blocking. The two things worth saying are "that domain
          is not one of yours" and "that address has no inbox, so a reply to it
          will go nowhere" — and the second one was previously unsayable. */}
      {value.trim() && !permissive && !known ? (
        <p className="m-0 mt-1 text-[12px] text-warning">
          {typed
            ? `${typed} is not a verified domain in this workspace — the send will be rejected.`
            : 'That is not a complete address.'}
        </p>
      ) : value.trim() && known && !matched ? (
        <p className="m-0 mt-1 text-[12px] text-muted-2">
          No mailbox exists at this address, so replies to it will not arrive anywhere. Sending
          works.
        </p>
      ) : null}
    </div>
  )
}
