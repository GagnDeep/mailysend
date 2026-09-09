import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  Kbd,
} from '@mailysend/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { BookOpen, CornerDownLeft, FileCode2, Globe, Mail } from 'lucide-react'
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { qk } from '~/lib/query.ts'
import { CHORDS, NAV } from './nav.ts'
import { useApi, useEnvironment } from './scope.tsx'

/**
 * ⌘K and the `g`-prefixed chords.
 *
 * The tour promises both by name, so they are one module: the chord table and
 * the palette's navigation list are the same `NAV` array, and a screen cannot
 * be reachable by one and not the other.
 */

interface PaletteState {
  open: boolean
  setOpen: (open: boolean) => void
  /** Pending first key of a chord, surfaced so the topbar can hint `g …`. */
  pendingChord: boolean
}

const PaletteContext = createContext<PaletteState | null>(null)

const CHORD_TIMEOUT_MS = 1400

/** Typing `g` into a search box must not navigate away from the search box. */
const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export const CommandPaletteProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false)
  const [pendingChord, setPendingChord] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let chordTimer: ReturnType<typeof setTimeout> | undefined
    let awaitingChord = false

    const clearChord = () => {
      awaitingChord = false
      setPendingChord(false)
      if (chordTimer) clearTimeout(chordTimer)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
        clearChord()
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      if (awaitingChord) {
        const destination = CHORDS[event.key.toLowerCase()]
        clearChord()
        if (destination) {
          event.preventDefault()
          void navigate({ to: destination })
        }
        return
      }

      if (event.key.toLowerCase() === 'g') {
        awaitingChord = true
        setPendingChord(true)
        chordTimer = setTimeout(clearChord, CHORD_TIMEOUT_MS)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (chordTimer) clearTimeout(chordTimer)
    }
  }, [navigate])

  const value = useMemo(() => ({ open, setOpen, pendingChord }), [open, pendingChord])

  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandPalette />
    </PaletteContext.Provider>
  )
}

export const useCommandPalette = (): PaletteState => {
  const state = useContext(PaletteContext)
  if (!state) throw new Error('useCommandPalette must be used inside <CommandPaletteProvider>')
  return state
}

const DOC_PAGES = [
  { title: 'Quickstart', href: '/docs#quickstart' },
  { title: 'Send an email', href: '/docs#send' },
  { title: 'Webhooks & signatures', href: '/docs#webhooks' },
  { title: 'Key scoping', href: '/docs#auth' },
  { title: 'Error reference', href: '/docs/errors' },
  { title: 'Migrating from Resend', href: '/docs#migrate' },
]

const CommandPalette = () => {
  const { open, setOpen } = useCommandPalette()
  const navigate = useNavigate()
  const api = useApi()
  const environment = useEnvironment()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 180)
    return () => clearTimeout(timer)
  }, [search])

  const enabled = open && debounced.length >= 2

  const messages = useQuery({
    queryKey: qk.emails(environment, { palette: debounced }),
    queryFn: () => api.listEmails({ limit: 5, q: debounced }),
    enabled,
  })
  const domains = useQuery({
    queryKey: qk.domains(environment),
    queryFn: () => api.listDomains({ limit: 50 }),
    enabled: open,
  })
  const templates = useQuery({
    queryKey: qk.templates(environment),
    queryFn: () => api.listTemplates({ limit: 50 }),
    enabled: open,
  })

  const go = useCallback(
    (to: string) => {
      setOpen(false)
      setSearch('')
      void navigate({ to })
    },
    [navigate, setOpen],
  )

  const matchedDomains = useMemo(
    () =>
      (domains.data?.data ?? []).filter((domain) =>
        debounced ? domain.name.toLowerCase().includes(debounced.toLowerCase()) : false,
      ),
    [domains.data, debounced],
  )

  const matchedTemplates = useMemo(
    () =>
      (templates.data?.data ?? []).filter((template) =>
        debounced ? template.name.toLowerCase().includes(debounced.toLowerCase()) : false,
      ),
    [templates.data, debounced],
  )

  const matchedDocs = useMemo(
    () =>
      debounced
        ? DOC_PAGES.filter((page) => page.title.toLowerCase().includes(debounced.toLowerCase()))
        : [],
    [debounced],
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Jump to any message, domain, template or doc page."
    >
      {/* Every `value` below embeds the words a reader would type, because
          cmdk scores against `value` and not against the rendered children. */}
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search messages, domains, templates, docs…"
      />
      <CommandList>
        <CommandEmpty>
          Nothing matched “{search}”. Try a recipient address, a domain or a template name.
        </CommandEmpty>

        {NAV.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.items.map((item) => (
              <CommandItem
                key={item.to}
                value={`${item.label} ${item.keywords ?? ''}`}
                onSelect={() => go(item.to)}
              >
                <item.icon className="size-4 text-muted-2" />
                <span>{item.label}</span>
                {item.chord ? (
                  <CommandShortcut>
                    <Kbd keys={['G', item.chord.toUpperCase()]} />
                  </CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        {messages.data?.data.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Messages">
              {messages.data.data.map((email) => (
                <CommandItem
                  key={email.id}
                  value={`message ${email.id} ${email.subject} ${email.to.join(' ')}`}
                  onSelect={() => go(`/app/emails/${email.id}`)}
                >
                  <Mail className="size-4 text-muted-2" />
                  <span className="truncate">{email.subject}</span>
                  <span className="ml-auto truncate font-mono text-[11.5px] text-muted-2">
                    {email.to[0]}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {matchedDomains.length ? (
          <CommandGroup heading="Domains">
            {matchedDomains.map((domain) => (
              <CommandItem
                key={domain.id}
                value={`domain ${domain.name}`}
                onSelect={() => go(`/app/domains/${domain.id}`)}
              >
                <Globe className="size-4 text-muted-2" />
                <span>{domain.name}</span>
                <span className="ml-auto font-mono text-[11.5px] text-muted-2">
                  {domain.status}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {matchedTemplates.length ? (
          <CommandGroup heading="Templates">
            {matchedTemplates.map((template) => (
              <CommandItem
                key={template.id}
                value={`template ${template.name} ${template.slug}`}
                onSelect={() => go(`/app/templates/${template.id}`)}
              >
                <FileCode2 className="size-4 text-muted-2" />
                <span>{template.name}</span>
                <span className="ml-auto font-mono text-[11.5px] text-muted-2">
                  {template.slug}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {matchedDocs.length ? (
          <CommandGroup heading="Docs">
            {matchedDocs.map((page) => (
              <CommandItem
                key={page.href}
                value={`docs ${page.title}`}
                onSelect={() => {
                  setOpen(false)
                  window.location.assign(page.href)
                }}
              >
                <BookOpen className="size-4 text-muted-2" />
                <span>{page.title}</span>
                <CommandShortcut>
                  <CornerDownLeft aria-hidden="true" className="size-3.5" />
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
