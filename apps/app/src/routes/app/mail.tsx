import {
  Badge,
  Button,
  cn,
  Input,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Archive,
  ArrowLeft,
  AtSign,
  Clock,
  FileText,
  Inbox,
  Keyboard,
  Mail,
  Paperclip,
  PenSquare,
  Plus,
  Reply,
  ReplyAll,
  Send,
  ShieldBan,
  Star,
  Tag,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { relativeTime } from '~/components/app/format.ts'
import { type ComposerSeed, MailComposer } from '~/components/app/mail-composer.tsx'
import { MailReader } from '~/components/app/mail-reader.tsx'
import { MailShortcuts } from '~/components/app/mail-shortcuts.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import type { MailDraftRecord, MailThreadRecord } from '~/lib/api-client.ts'
import { SEARCH_OPERATORS } from '~/lib/mail-search.ts'
import { qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

/**
 * Mail.
 *
 * One conversation view over both directions, which is the whole point: a
 * message this workspace sent and the reply it earned belong on the same
 * screen, and every other mail surface in this product was one or the other.
 *
 * The folder, the query and the selected thread all live in the URL, because a
 * narrowed view that cannot be pasted into a ticket is a view somebody has to
 * describe in prose instead.
 */

/** The folders the server knows about. `drafts` is not one of them. */
const FOLDERS = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'archive', label: 'Archive', icon: Archive },
  { id: 'spam', label: 'Spam', icon: ShieldBan },
  { id: 'trash', label: 'Trash', icon: Trash2 },
] as const

type ServerFolder = (typeof FOLDERS)[number]['id']

/**
 * `drafts` is a client-side view over `GET /v1/mail/drafts` rather than a
 * folder on `mail_threads` — the endpoint and its client method have existed
 * since the composer was written, with no caller, so every autosaved draft has
 * been write-only storage.
 */
type Folder = ServerFolder | 'drafts'

const isServerFolder = (value: unknown): value is ServerFolder =>
  FOLDERS.some((entry) => entry.id === value)

/**
 * The saved views. Both are filters over the inbox rather than folders, because
 * both fields already exist on the thread and the search grammar already reads
 * them — a snoozed conversation was simply invisible until the cron returned it.
 */
const VIEWS = [
  { id: 'starred', label: 'Starred', icon: Star, q: 'is:starred' },
  { id: 'snoozed', label: 'Snoozed', icon: Clock, q: 'is:snoozed' },
] as const

interface MailSearch {
  threadId?: string
  folder?: Folder
  q?: string
}

export const Route = createFileRoute('/app/mail')({
  head: () => appHead('Mail'),
  // A mail client wants the viewport, not the 1180px reading measure the rest
  // of the dashboard is set in. See `routes/app.tsx`.
  staticData: { fullBleed: true },
  validateSearch: (search: Record<string, unknown>): MailSearch => ({
    threadId: typeof search.threadId === 'string' && search.threadId ? search.threadId : undefined,
    folder:
      isServerFolder(search.folder) || search.folder === 'drafts'
        ? (search.folder as Folder)
        : undefined,
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
  }),
  component: MailScreen,
})

function MailScreen() {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const { threadId, folder = 'inbox', q = '' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const [selection, setSelection] = useState<string[]>([])
  const [draftQuery, setDraftQuery] = useState(q)
  const [composer, setComposer] = useState<ComposerSeed | null>(null)
  const [cursor, setCursor] = useState(0)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [newMailbox, setNewMailbox] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<number | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => setDraftQuery(q), [q])

  const listing = folder === 'drafts' ? 'inbox' : folder
  const filters = useMemo(() => ({ folder, q }), [folder, q])

  const threads = useQuery({
    queryKey: qk.mailThreads(environment, filters),
    queryFn: () => api.listMailThreads({ folder: listing, q, limit: 50 }),
    enabled: folder !== 'drafts',
    // The websocket hook below is the live path; this is the floor under it,
    // because a dropped socket must not mean a silently frozen inbox.
    refetchInterval: 60_000,
  })

  const drafts = useQuery({
    queryKey: qk.mailDrafts(environment),
    queryFn: () => api.listMailDrafts(),
    enabled: folder === 'drafts',
  })

  const mailboxes = useQuery({
    queryKey: qk.mailboxes(environment),
    queryFn: () => api.listMailboxes(),
  })

  const labels = useQuery({
    queryKey: qk.mailLabels(environment),
    queryFn: () => api.listMailLabels(),
  })

  const counts = useQuery({
    queryKey: qk.mailCounts(environment),
    queryFn: () => api.mailCounts(),
    refetchInterval: 60_000,
  })

  const thread = useQuery({
    queryKey: qk.mailThread(environment, threadId ?? ''),
    queryFn: () => api.getMailThread(threadId as string),
    enabled: Boolean(threadId),
  })

  const rows = threads.data?.data ?? []

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [environment, 'mail'] })
  }, [queryClient, environment])

  useMailLiveUpdates(invalidate)

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patchMailThread(id, body),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error('That did not stick', { description: error.message }),
  })

  const bulk = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.bulkMailThreads({ ids: selection, ...body }),
    onSuccess: (result) => {
      setSelection([])
      invalidate()
      toast.success(`${result.updated} conversation${result.updated === 1 ? '' : 's'} updated`)
    },
    onError: (error: Error) => toast.error('Bulk action failed', { description: error.message }),
  })

  const createMailbox = useMutation({
    mutationFn: (address: string) => api.createMailbox({ address }),
    onSuccess: (created) => {
      setNewMailbox(null)
      void queryClient.invalidateQueries({ queryKey: qk.mailboxes(environment) })
      void queryClient.invalidateQueries({ queryKey: qk.mailIdentities(environment) })
      toast.success(`${created.address} created`)
    },
    onError: (error: Error) =>
      toast.error('Could not create that mailbox', {
        description: error.message,
      }),
  })

  const removeDraft = useMutation({
    mutationFn: (id: string) => api.deleteMailDraft(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.mailDrafts(environment) }),
    onError: (error: Error) =>
      toast.error('Could not delete that draft', {
        description: error.message,
      }),
  })

  const select = useCallback(
    (id: string | undefined) => {
      void navigate({ search: (prev: MailSearch) => ({ ...prev, threadId: id }) })
    },
    [navigate],
  )

  const setFolder = (next: Folder) => {
    setSelection([])
    setAnchor(null)
    void navigate({ search: { folder: next, q: q || undefined } })
  }

  const submitSearch = (value: string) => {
    void navigate({ search: (prev: MailSearch) => ({ ...prev, q: value || undefined }) })
  }

  /**
   * A destructive action, and the way back from it.
   *
   * Archive, trash and spam all move a conversation out of the view the reader
   * was looking at, so the only evidence the click landed is that something
   * vanished. The undo restores the folder it came from.
   */
  const actWithUndo = useCallback(
    (thread: { id: string; folder?: string }, next: string, verb: string) => {
      const previous = thread.folder ?? 'inbox'
      patch.mutate({ id: thread.id, body: { folder: next } })
      toast.success(verb, {
        action: {
          label: 'Undo',
          onClick: () => patch.mutate({ id: thread.id, body: { folder: previous } }),
        },
      })
    },
    [patch],
  )

  // Opening a conversation marks it read, the way every mail client does. It is
  // a mutation rather than a server-side side effect of the GET so that the
  // list and the counts invalidate at a moment the client controls.
  const markedRead = useRef<string | null>(null)
  const openedId = thread.data?.id
  const openedUnread = thread.data?.unread ?? false
  const markRead = patch.mutate
  useEffect(() => {
    // Guarded by the id rather than by a narrowed dependency list: the query
    // refetches, and without the guard every refetch of a thread that has not
    // yet been re-read would fire the same mutation again.
    if (!openedId || !openedUnread || markedRead.current === openedId) return
    markedRead.current = openedId
    markRead({ id: openedId, body: { unread: false } })
  }, [openedId, openedUnread, markRead])

  const act = useCallback(
    (id: string, body: Record<string, unknown>) => patch.mutate({ id, body }),
    [patch],
  )

  const openThread = thread.data

  const reply = useCallback(
    (mode: 'reply' | 'reply_all' | 'forward') => {
      if (!openThread || openThread.messages.length === 0) return
      setComposer({ mode, thread: openThread, message: openThread.messages.at(-1) as never })
    },
    [openThread],
  )

  /**
   * The cursor is an index into a list that changes underneath it.
   *
   * Moving to row 40 of the inbox and then switching to a folder with three
   * conversations left `cursor` at 40, where `rows[cursor]` is undefined and
   * every key silently did nothing — the list looked frozen. The selection is
   * cleared on a query change for the same class of reason: bulk-trashing
   * conversations you can no longer see is not something to make possible.
   */
  useEffect(() => {
    setCursor((value) => Math.min(value, Math.max(rows.length - 1, 0)))
  }, [rows.length])

  // A narrowed query can no longer contain what was selected under the old one,
  // and bulk-trashing conversations you can no longer see is not something to
  // make possible. `q` is the trigger here rather than a value read inside.
  // biome-ignore lint/correctness/useExhaustiveDependencies: q is the trigger, not a read
  useEffect(() => {
    setSelection([])
    setAnchor(null)
  }, [q])

  // The cursor has to stay on screen now that the list scrolls on its own.
  useEffect(() => {
    const node = listRef.current?.children[cursor]
    node?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const toggleAll = useCallback(() => {
    setSelection((value) => (value.length === rows.length ? [] : rows.map((row) => row.id)))
  }, [rows])

  // Gmail's chords, because the muscle memory is not ours to redesign.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (target?.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const current = rows[cursor]
      switch (event.key) {
        case 'j':
          setCursor((value) => Math.min(value + 1, Math.max(rows.length - 1, 0)))
          break
        case 'k':
          setCursor((value) => Math.max(value - 1, 0))
          break
        case 'Enter':
          if (current) select(current.id)
          break
        case 'u':
          select(undefined)
          break
        case 'x':
          if (current) {
            setSelection((value) =>
              value.includes(current.id)
                ? value.filter((id) => id !== current.id)
                : [...value, current.id],
            )
          }
          break
        case 'e':
          if (threadId) {
            act(threadId, { folder: 'archive' })
            select(undefined)
          } else if (current) act(current.id, { folder: 'archive' })
          break
        case '#':
          if (threadId) {
            act(threadId, { folder: 'trash' })
            select(undefined)
          } else if (current) act(current.id, { folder: 'trash' })
          break
        case 's': {
          const target_ = threadId ? openThread : current
          if (target_) act(target_.id, { starred: !target_.starred })
          break
        }
        case '!':
          if (threadId) {
            act(threadId, { folder: 'spam' })
            select(undefined)
          } else if (current) act(current.id, { folder: 'spam' })
          break
        case 'U':
          if (!event.shiftKey) return
          if (threadId) {
            act(threadId, { unread: true })
            select(undefined)
          } else if (current) act(current.id, { unread: true })
          break
        case '*':
          toggleAll()
          break
        case '?':
          setShortcutsOpen(true)
          break
        case 'Escape':
          if (threadId) select(undefined)
          else setSelection([])
          break
        case 'r':
          reply('reply')
          break
        case 'a':
          reply('reply_all')
          break
        case 'f':
          reply('forward')
          break
        case 'c':
          setComposer({ mode: 'new' })
          break
        case '/':
          event.preventDefault()
          searchInput.current?.focus()
          break
        default:
          return
      }
      if (event.key !== '/') event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, cursor, threadId, openThread, act, select, reply, toggleAll])

  const folderCounts = counts.data?.folders ?? {}
  const draftRows = drafts.data?.data ?? []
  const activeMailbox = /(?:^|\s)mailbox:(\S+)/.exec(q)?.[1] ?? null
  const activeLabel = /(?:^|\s)label:(\S+)/.exec(q)?.[1] ?? null

  /** A rail entry sets the query rather than a folder: both are search operators. */
  const filterBy = (operator: string, value: string | null) => {
    setSelection([])
    setAnchor(null)
    void navigate({
      search: { folder: 'inbox', q: value ? `${operator}:${value}` : undefined },
    })
  }

  return (
    <>
      {/* Three panes, each scrolling on its own, inside the viewport the shell
          hands over. The old layout had no `overflow` and no height anywhere,
          so the whole client scrolled as one document and the rail scrolled
          away with the list. */}
      <div className="flex h-full min-h-0 flex-col lg:flex-row">
        <nav
          aria-label="Mail"
          className={cn(
            'flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-line p-3 lg:w-[210px] lg:border-r',
            threadId ? 'hidden lg:flex' : 'flex',
          )}
        >
          <Button size="sm" onClick={() => setComposer({ mode: 'new' })}>
            <PenSquare className="size-4" /> Compose
          </Button>

          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {FOLDERS.map((entry) => {
              const Icon = entry.icon
              const count = folderCounts[entry.id]
              const active = folder === entry.id && !q
              return (
                <li key={entry.id}>
                  <RailButton
                    icon={Icon}
                    label={entry.label}
                    active={active}
                    badge={count?.unread ? String(count.unread) : null}
                    onClick={() => setFolder(entry.id)}
                  />
                </li>
              )
            })}
            <li>
              <RailButton
                icon={FileText}
                label="Drafts"
                active={folder === 'drafts'}
                badge={draftRows.length > 0 ? String(draftRows.length) : null}
                onClick={() => setFolder('drafts')}
              />
            </li>
            {VIEWS.map((view) => {
              const Icon = view.icon
              return (
                <li key={view.id}>
                  <RailButton
                    icon={Icon}
                    label={view.label}
                    active={q === view.q}
                    onClick={() => {
                      setSelection([])
                      void navigate({ search: { folder: 'inbox', q: view.q } })
                    }}
                  />
                </li>
              )
            })}
          </ul>

          <RailSection
            title="Mailboxes"
            onAdd={() => setNewMailbox('')}
            empty="No mailboxes yet. Mail to an address that is not one is refused at the door."
          >
            {(mailboxes.data?.data ?? []).map((mailbox) => (
              <li key={mailbox.id}>
                <RailButton
                  icon={AtSign}
                  label={mailbox.name || mailbox.address}
                  title={mailbox.address}
                  active={activeMailbox === mailbox.id}
                  onClick={() =>
                    filterBy('mailbox', activeMailbox === mailbox.id ? null : mailbox.id)
                  }
                />
              </li>
            ))}
          </RailSection>

          {newMailbox !== null ? (
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(event) => {
                event.preventDefault()
                if (newMailbox.trim()) createMailbox.mutate(newMailbox.trim().toLowerCase())
              }}
            >
              <Input
                autoFocus
                value={newMailbox}
                onChange={(event) => setNewMailbox(event.target.value)}
                placeholder="support@yourdomain.com"
                aria-label="New mailbox address"
                className="h-8 font-mono text-[12px]"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setNewMailbox(null)
                }}
              />
              <span className="flex gap-1.5">
                <Button size="sm" type="submit" disabled={createMailbox.isPending}>
                  Create
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNewMailbox(null)}>
                  Cancel
                </Button>
              </span>
            </form>
          ) : null}

          <RailSection title="Labels" empty="No labels yet.">
            {(labels.data?.data ?? []).map((label) => (
              <li key={label.id}>
                <RailButton
                  icon={Tag}
                  label={label.name ?? label.id}
                  active={activeLabel === label.id}
                  onClick={() => filterBy('label', activeLabel === label.id ? null : label.id)}
                />
              </li>
            ))}
          </RailSection>

          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="mt-auto flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[12.5px] text-muted-2 hover:bg-tint"
          >
            <Keyboard className="size-3.5" /> Shortcuts
          </button>
        </nav>

        <section
          aria-label="Conversations"
          className={cn(
            'min-h-0 w-full shrink-0 flex-col gap-2 overflow-hidden border-line p-3 lg:w-[340px] lg:border-r',
            threadId ? 'hidden lg:flex' : 'flex',
          )}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submitSearch(draftQuery.trim())
            }}
          >
            <Input
              ref={searchInput}
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              placeholder="Search — from: to: subject: is:unread has:attachment"
              aria-label="Search mail"
            />
          </form>

          {q ? (
            // What the server actually parsed, not a list of what it could
            // have. A term the parser did not recognise arrives here as a bare
            // word, which is visibly different from an operator and is the
            // whole point of echoing this back.
            <p className="m-0 flex flex-wrap items-center gap-1 px-1 text-[12px] text-muted-2">
              {(threads.data?.query ?? []).length > 0 ? (
                <>
                  Searching for
                  {(threads.data?.query ?? []).map((term) => (
                    <Badge
                      key={`${term.negated ? '-' : ''}${term.operator ?? ''}:${term.value}`}
                      size="sm"
                      variant={term.operator ? 'neutral' : 'outline'}
                    >
                      {term.negated ? '-' : ''}
                      {term.operator ? `${term.operator}:` : ''}
                      {term.value}
                    </Badge>
                  ))}
                </>
              ) : (
                <>Operators understood: {SEARCH_OPERATORS.map((op) => op.operator).join(' ')}</>
              )}
            </p>
          ) : null}

          {rows.length > 0 && folder !== 'drafts' ? (
            <label className="flex items-center gap-2 px-1 text-[12px] text-muted-2">
              <input
                type="checkbox"
                checked={selection.length > 0 && selection.length === rows.length}
                ref={(node) => {
                  // The third state: some but not all. A plain checkbox has no
                  // way to say it, and it is the state a select-all box spends
                  // most of its life in.
                  if (node) {
                    node.indeterminate = selection.length > 0 && selection.length < rows.length
                  }
                }}
                onChange={toggleAll}
                aria-label="Select every conversation in view"
              />
              Select all
            </label>
          ) : null}

          {selection.length > 0 ? (
            <div
              role="toolbar"
              aria-label="Bulk actions"
              className="flex flex-wrap items-center gap-1.5 rounded-sm border border-line-soft bg-tint p-1.5"
            >
              <span className="px-1 text-[12.5px] text-muted">{selection.length} selected</span>
              <Button size="sm" variant="ghost" onClick={() => bulk.mutate({ folder: 'archive' })}>
                <Archive className="size-3.5" /> Archive
              </Button>
              <Button size="sm" variant="ghost" onClick={() => bulk.mutate({ unread: false })}>
                <Mail className="size-3.5" /> Mark read
              </Button>
              <Button size="sm" variant="ghost" onClick={() => bulk.mutate({ folder: 'spam' })}>
                <ShieldBan className="size-3.5" /> Spam
              </Button>
              <Button size="sm" variant="ghost" onClick={() => bulk.mutate({ folder: 'trash' })}>
                <Trash2 className="size-3.5" /> Trash
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelection([])}>
                Clear
              </Button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {folder === 'drafts' ? (
              drafts.isLoading ? (
                <TableSkeleton rows={4} columns={2} />
              ) : draftRows.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No drafts"
                  description="A message you start writing is saved here automatically once it has a recipient or a subject."
                  action={{ label: 'Compose', onClick: () => setComposer({ mode: 'new' }) }}
                />
              ) : (
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {draftRows.map((draft) => (
                    <DraftRow
                      key={draft.id}
                      draft={draft}
                      onOpen={() => setComposer({ mode: 'new', draft })}
                      onDelete={() => removeDraft.mutate(draft.id)}
                    />
                  ))}
                </ul>
              )
            ) : threads.isLoading ? (
              <TableSkeleton rows={8} columns={2} />
            ) : threads.error ? (
              <ErrorState
                error={threads.error}
                subject="your conversations"
                onRetry={() => void threads.refetch()}
              />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={q ? 'Nothing matches that search' : 'Nothing here yet'}
                description={
                  q
                    ? 'Try fewer operators, or drop the quotes — an operator with no value matches nothing rather than everything.'
                    : 'Compose a message and send it in Test mode: it is delivered straight back into this inbox, with no domain, DNS or provider needed.'
                }
                action={{ label: 'Compose', onClick: () => setComposer({ mode: 'new' }) }}
              />
            ) : (
              <ul ref={listRef} className="m-0 flex list-none flex-col gap-1 p-0">
                {rows.map((row, index) => (
                  <ThreadRow
                    key={row.id}
                    thread={row}
                    active={row.id === threadId}
                    cursored={index === cursor}
                    checked={selection.includes(row.id)}
                    onCheck={(checked, range) => {
                      // Shift-click extends from the last box that was touched,
                      // which is the only way to select forty conversations
                      // without forty clicks.
                      if (range && anchor !== null) {
                        const [from, to] = anchor < index ? [anchor, index] : [index, anchor]
                        const span = rows.slice(from, to + 1).map((entry) => entry.id)
                        setSelection((value) =>
                          checked
                            ? [...new Set([...value, ...span])]
                            : value.filter((id) => !span.includes(id)),
                        )
                        return
                      }
                      setAnchor(index)
                      setSelection((value) =>
                        checked ? [...value, row.id] : value.filter((id) => id !== row.id),
                      )
                    }}
                    onOpen={() => {
                      setCursor(index)
                      select(row.id)
                    }}
                    onStar={() => act(row.id, { starred: !row.starred })}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        <section
          aria-label="Conversation"
          className={cn(
            'min-h-0 min-w-0 flex-1 overflow-y-auto p-3',
            threadId ? 'block' : 'hidden lg:block',
          )}
        >
          {!threadId ? (
            <div className="rounded-tile border border-line-soft bg-card px-6 py-12 text-center text-[14.5px] text-muted">
              Select a conversation.
            </div>
          ) : thread.isLoading ? (
            <TableSkeleton rows={4} columns={1} />
          ) : thread.error ? (
            <ErrorState
              error={thread.error}
              subject="this conversation"
              onRetry={() => void thread.refetch()}
            />
          ) : openThread ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="lg:hidden"
                  onClick={() => select(undefined)}
                >
                  <ArrowLeft className="size-4" /> Back
                </Button>
                <h2 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold">
                  {openThread.subject || '(no subject)'}
                </h2>
                <Button size="sm" variant="ghost" onClick={() => reply('reply')}>
                  <Reply className="size-4" /> Reply
                </Button>
                <Button size="sm" variant="ghost" onClick={() => reply('reply_all')}>
                  <ReplyAll className="size-4" /> Reply all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => act(openThread.id, { starred: !openThread.starred })}
                  aria-pressed={openThread.starred}
                  aria-label={openThread.starred ? 'Unstar' : 'Star'}
                >
                  <Star
                    className={cn('size-4', openThread.starred && 'fill-current text-warning')}
                  />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    actWithUndo(openThread, 'archive', 'Archived')
                    select(undefined)
                  }}
                >
                  <Archive className="size-4" /> Archive
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    // Snooze is a timestamp, not a folder: the cron sweeps it
                    // back into the inbox, so nothing is hidden permanently by
                    // a click that meant "later".
                    const until = new Date(Date.now() + 86_400_000).toISOString()
                    act(openThread.id, { snoozed_until: until })
                    select(undefined)
                    toast.success('Snoozed until tomorrow')
                  }}
                >
                  <Clock className="size-4" /> Snooze
                </Button>
              </div>

              {openThread.messages.map((message, index) => (
                <MailReader
                  key={message.id}
                  message={message}
                  defaultOpen={index === openThread.messages.length - 1}
                />
              ))}
            </div>
          ) : null}
        </section>
      </div>

      <MailShortcuts open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {composer ? (
        <MailComposer
          seed={composer}
          onClose={() => setComposer(null)}
          onSent={() => {
            setComposer(null)
            invalidate()
          }}
        />
      ) : null}
    </>
  )
}

/** One rail entry: an icon, a label, an optional count. */
function RailButton({
  icon: Icon,
  label,
  active,
  badge,
  title,
  onClick,
}: {
  icon: typeof Inbox
  label: string
  active: boolean
  badge?: string | null
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[13px]',
        active ? 'bg-tint text-ink' : 'text-muted hover:bg-tint',
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-2" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <Badge variant="accent" size="sm">
          {badge}
        </Badge>
      ) : null}
    </button>
  )
}

function RailSection({
  title,
  onAdd,
  empty,
  children,
}: {
  title: string
  onAdd?: () => void
  empty: string
  children: React.ReactNode[]
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-2.5 pb-1.5">
        <h2 className="ms-eyebrow m-0 text-[10.5px] text-muted-2">{title}</h2>
        {onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            aria-label={`Add to ${title}`}
            className="text-muted-2 hover:text-ink"
          >
            <Plus className="size-3.5" />
          </button>
        ) : null}
      </div>
      {children.length === 0 ? (
        <p className="m-0 px-2.5 text-[12px] leading-snug text-muted-2">{empty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{children}</ul>
      )}
    </div>
  )
}

function DraftRow({
  draft,
  onOpen,
  onDelete,
}: {
  draft: MailDraftRecord
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <li className="flex items-start gap-2 rounded-sm border border-transparent px-2 py-2 hover:border-line-soft">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-[13.5px]">
            {(draft.to ?? []).join(', ') || 'No recipient'}
          </span>
          {draft.updated_at ? (
            <span className="shrink-0 font-mono text-[11.5px] text-muted-2">
              {relativeTime(draft.updated_at)}
            </span>
          ) : null}
        </div>
        <p className="m-0 truncate text-[13.5px] text-muted">{draft.subject || '(no subject)'}</p>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete this draft"
        className="mt-0.5 text-muted-2 hover:text-ink"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  )
}

interface ThreadRowProps {
  thread: MailThreadRecord
  active: boolean
  cursored: boolean
  checked: boolean
  /** `range` is a shift-click: extend from the last box touched to this one. */
  onCheck: (checked: boolean, range: boolean) => void
  onOpen: () => void
  onStar: () => void
}

function ThreadRow({ thread, active, cursored, checked, onCheck, onOpen, onStar }: ThreadRowProps) {
  return (
    <li>
      <div
        className={cn(
          'flex items-start gap-2 rounded-sm border border-transparent px-2 py-2',
          active && 'border-line-soft bg-tint',
          cursored && !active && 'border-line-soft',
          thread.unread ? 'text-ink' : 'text-muted',
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            onCheck(
              event.target.checked,
              (event.nativeEvent as MouseEvent | undefined)?.shiftKey ?? false,
            )
          }
          aria-label={`Select ${thread.subject || 'conversation'}`}
          className="mt-1"
        />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={cn('min-w-0 truncate text-[13.5px]', thread.unread && 'font-semibold')}
            >
              {thread.participants.join(', ') || '—'}
            </span>
            <span className="shrink-0 font-mono text-[11.5px] text-muted-2">
              {relativeTime(thread.last_message_at)}
            </span>
          </div>
          <p className={cn('m-0 truncate text-[13.5px]', thread.unread && 'font-semibold')}>
            {thread.subject || '(no subject)'}
            {thread.message_count > 1 ? (
              <span className="ml-1 text-muted-2">({thread.message_count})</span>
            ) : null}
          </p>
          <p className="m-0 truncate text-[12.5px] text-muted-2">{thread.snippet}</p>
          {thread.labels.length > 0 ? (
            <span className="mt-1 flex flex-wrap gap-1">
              {thread.labels.map((label) => (
                <Badge key={label} variant="neutral" size="sm">
                  {label}
                </Badge>
              ))}
            </span>
          ) : null}
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={onStar}
            aria-label={thread.starred ? 'Unstar' : 'Star'}
            aria-pressed={thread.starred}
          >
            <Star
              className={cn(
                'size-3.5',
                thread.starred ? 'fill-current text-warning' : 'text-muted-2',
              )}
            />
          </button>
          {thread.has_attachments ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Paperclip className="size-3.5 text-muted-2" />
              </TooltipTrigger>
              <TooltipContent>Has attachments</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </li>
  )
}

/**
 * Live updates.
 *
 * `WorkspaceHubActor` has been written, wired to the events consumer and never
 * once attached to — this is its first caller. The socket is an accelerator
 * only: every query it touches also polls, so a proxy that eats WebSocket
 * upgrades costs freshness, not correctness.
 */
function useMailLiveUpdates(onEvent: () => void) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/v1/live`
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let closed = false

    const connect = () => {
      if (closed) return
      try {
        socket = new WebSocket(url)
      } catch {
        // No upgrade available (a proxy, an old runtime). Polling covers it.
        return
      }
      socket.onopen = () => {
        attempt = 0
      }
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string }
          if (payload.type?.startsWith('inbound.') || payload.type?.startsWith('email.')) onEvent()
        } catch {
          // A frame we cannot parse is not a reason to tear the socket down.
        }
      }
      // Every deploy drops every socket — the runtime replaces the script under
      // the Durable Object holding it — so a connection made once and never
      // remade means live updates die at the first release and stay dead for
      // the life of the page. Backoff, capped, because the socket is an
      // accelerator: if it never comes back, polling still has it covered.
      socket.onclose = () => {
        if (closed) return
        const delay = Math.min(1000 * 2 ** attempt++, 30_000)
        timer = setTimeout(connect, delay)
      }
    }
    connect()

    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      socket?.close()
    }
  }, [onEvent])
}
