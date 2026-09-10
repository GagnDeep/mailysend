import {
  Badge,
  Button,
  cn,
  Input,
  Kbd,
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
  Clock,
  Inbox,
  Mail,
  Paperclip,
  PenSquare,
  Reply,
  ReplyAll,
  Send,
  ShieldBan,
  Star,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { relativeTime } from '~/components/app/format.ts'
import { type ComposerSeed, MailComposer } from '~/components/app/mail-composer.tsx'
import { MailReader } from '~/components/app/mail-reader.tsx'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import type { MailThreadRecord } from '~/lib/api-client.ts'
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

const FOLDERS = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'archive', label: 'Archive', icon: Archive },
  { id: 'spam', label: 'Spam', icon: ShieldBan },
  { id: 'trash', label: 'Trash', icon: Trash2 },
] as const

type Folder = (typeof FOLDERS)[number]['id']

interface MailSearch {
  threadId?: string
  folder?: Folder
  q?: string
}

export const Route = createFileRoute('/app/mail')({
  head: () => appHead('Mail'),
  validateSearch: (search: Record<string, unknown>): MailSearch => ({
    threadId: typeof search.threadId === 'string' && search.threadId ? search.threadId : undefined,
    folder: FOLDERS.some((f) => f.id === search.folder) ? (search.folder as Folder) : undefined,
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
  const searchInput = useRef<HTMLInputElement>(null)

  useEffect(() => setDraftQuery(q), [q])

  const filters = useMemo(() => ({ folder, q }), [folder, q])

  const threads = useQuery({
    queryKey: qk.mailThreads(environment, filters),
    queryFn: () => api.listMailThreads({ folder, q, limit: 50 }),
    // The websocket hook below is the live path; this is the floor under it,
    // because a dropped socket must not mean a silently frozen inbox.
    refetchInterval: 60_000,
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

  const select = useCallback(
    (id: string | undefined) => {
      void navigate({ search: (prev: MailSearch) => ({ ...prev, threadId: id }) })
    },
    [navigate],
  )

  const setFolder = (next: Folder) => {
    setSelection([])
    void navigate({ search: { folder: next, q: q || undefined } })
  }

  const submitSearch = (value: string) => {
    void navigate({ search: (prev: MailSearch) => ({ ...prev, q: value || undefined }) })
  }

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
  }, [rows, cursor, threadId, openThread, act, select, reply])

  const folderCounts = counts.data?.folders ?? {}

  return (
    <>
      <PageHeader
        eyebrow="Mail"
        title="One conversation, both directions"
        description="Everything this workspace sent and everything that came back, threaded together. In Test mode a message you send is delivered straight back into this inbox, so the whole surface works on a fresh instance with no domain and no DNS."
        actions={
          <Button size="sm" onClick={() => setComposer({ mode: 'new' })}>
            <PenSquare className="size-4" /> Compose
          </Button>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[180px_320px_minmax(0,1fr)]">
        <nav aria-label="Folders" className={cn('min-w-0', threadId ? 'hidden lg:block' : 'block')}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {FOLDERS.map((entry) => {
              const Icon = entry.icon
              const count = folderCounts[entry.id]
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => setFolder(entry.id)}
                    aria-current={folder === entry.id ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[13.5px]',
                      folder === entry.id ? 'bg-tint text-ink' : 'text-muted hover:bg-tint',
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-muted-2" />
                    <span className="flex-1 truncate">{entry.label}</span>
                    {count?.unread ? (
                      <Badge variant="accent" size="sm">
                        {count.unread}
                      </Badge>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>

          <p className="m-0 mt-4 px-2.5 text-[12px] text-muted-2">
            <Kbd>?</Kbd> is not wired yet; <Kbd>j</Kbd> <Kbd>k</Kbd> move, <Kbd>Enter</Kbd> opens,{' '}
            <Kbd>e</Kbd> archives, <Kbd>s</Kbd> stars, <Kbd>r</Kbd> replies, <Kbd>c</Kbd> composes.
          </p>
        </nav>

        <section
          aria-label="Conversations"
          className={cn('flex min-w-0 flex-col gap-2', threadId ? 'hidden lg:flex' : 'flex')}
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
            <p className="m-0 px-1 text-[12px] text-muted-2">
              Operators understood: {SEARCH_OPERATORS.map((op) => op.operator).join(' ')}
            </p>
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

          {threads.isLoading ? (
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
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {rows.map((row, index) => (
                <ThreadRow
                  key={row.id}
                  thread={row}
                  active={row.id === threadId}
                  cursored={index === cursor}
                  checked={selection.includes(row.id)}
                  onCheck={(checked) =>
                    setSelection((value) =>
                      checked ? [...value, row.id] : value.filter((id) => id !== row.id),
                    )
                  }
                  onOpen={() => {
                    setCursor(index)
                    select(row.id)
                  }}
                  onStar={() => act(row.id, { starred: !row.starred })}
                />
              ))}
            </ul>
          )}
        </section>

        <section
          aria-label="Conversation"
          className={cn('min-w-0', threadId ? 'block' : 'hidden lg:block')}
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
                    act(openThread.id, { folder: 'archive' })
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

interface ThreadRowProps {
  thread: MailThreadRecord
  active: boolean
  cursored: boolean
  checked: boolean
  onCheck: (checked: boolean) => void
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
          onChange={(event) => onCheck(event.target.checked)}
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
    try {
      socket = new WebSocket(url)
    } catch {
      // No upgrade available (a proxy, an old runtime). Polling covers it.
      return
    }
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as { type?: string }
        if (payload.type?.startsWith('inbound.') || payload.type?.startsWith('email.')) onEvent()
      } catch {
        // A frame we cannot parse is not a reason to tear the socket down.
      }
    }
    return () => socket?.close()
  }, [onEvent])
}
