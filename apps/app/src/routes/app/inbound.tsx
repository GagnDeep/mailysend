import {
  Button,
  Callout,
  cn,
  KeyValue,
  KeyValueList,
  MonoChip,
  StatusDot,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, FileText, Inbox, MailWarning } from 'lucide-react'
import { useId, useState } from 'react'
import { bareAddress, bytes, dateTime, num, relativeTime } from '~/components/app/format.ts'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { DetailSkeleton, EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import type { InboundMessageRecord, InboundThreadRecord } from '~/lib/api-client.ts'
import { qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

/**
 * Inbound mail, as a mail client.
 *
 * The selected thread is a search param rather than component state, because
 * "look at this reply" is a link somebody pastes into a ticket. Two things are
 * surfaced that a mail client would normally hide: how confidently a message
 * was attached to its thread, and whether MIME parsing succeeded at all — a
 * message we could not parse is kept in its raw form rather than dropped, and
 * the reader is told which one they are looking at.
 */

interface InboundSearch {
  threadId?: string
}

export const Route = createFileRoute('/app/inbound')({
  head: () => appHead('Inbound'),
  validateSearch: (search: Record<string, unknown>): InboundSearch => ({
    threadId:
      typeof search.threadId === 'string' && search.threadId.trim() !== ''
        ? search.threadId
        : undefined,
  }),
  component: InboundScreen,
})

const MATCH_COPY: Record<string, { label: string; detail: string; certain: boolean }> = {
  reply_token: {
    label: 'reply token',
    detail:
      'Highest confidence. The reply came back to the per-thread address we minted, so the thread is identified, not guessed.',
    certain: true,
  },
  in_reply_to: {
    label: 'in-reply-to',
    detail:
      'High confidence. The sending client echoed the Message-ID of a message in this thread.',
    certain: true,
  },
  references: {
    label: 'references',
    detail:
      'Good confidence. The References header names a message in this thread, though clients rewrite that header more freely than In-Reply-To.',
    certain: true,
  },
  subject_participants: {
    label: 'subject + participants',
    detail:
      'A guess. No threading header survived, so this was attached because the subject and the people match. It can be wrong — two unrelated messages with the same subject between the same people will land together.',
    certain: false,
  },
  new: {
    label: 'new thread',
    detail: 'Nothing matched an existing conversation, so this started one.',
    certain: true,
  },
}

const AUTH_TONE = (value: string | undefined): 'positive' | 'warning' | 'neutral' => {
  if (value === 'pass') return 'positive'
  if (value === 'fail' || value === 'softfail') return 'warning'
  return 'neutral'
}

function InboundScreen() {
  const api = useApi()
  const environment = useEnvironment()
  const { threadId } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()

  const threads = useQuery({
    queryKey: qk.threads(environment, {}),
    queryFn: () => api.listThreads({ limit: 50 }),
    refetchInterval: 60_000,
  })

  const selected = (threads.data?.data ?? []).find((thread) => thread.id === threadId)

  const markRead = useMutation({
    mutationFn: ({ id, unread }: { id: string; unread: boolean }) => api.markThreadRead(id, unread),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.threads(environment, {}) })
    },
    onError: (error: Error) =>
      toast.error('Could not change the read state', { description: error.message }),
  })

  const select = (id: string) => {
    void navigate({ search: { threadId: id } })
  }

  return (
    <>
      <PageHeader
        eyebrow="Inbound"
        title="Replies, in one place"
        description="Mail sent to a routed address on one of your domains, threaded and parsed. Selecting a conversation puts it in the URL, so it can be linked to."
      />

      <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_260px]">
        <section
          aria-label="Conversations"
          className={cn('min-w-0', threadId ? 'hidden lg:block' : 'block')}
        >
          {threads.isLoading ? (
            <TableSkeleton rows={6} columns={2} />
          ) : threads.error ? (
            <ErrorState
              error={threads.error}
              subject="your conversations"
              onRetry={() => void threads.refetch()}
            />
          ) : (threads.data?.data.length ?? 0) === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No inbound mail yet"
              description="Inbound needs an address that routes to us — an MX record on a subdomain of a verified sending domain."
              action={{ label: 'Set up a routed address', href: '/app/domains' }}
            />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {(threads.data?.data ?? []).map((thread) => (
                <li key={thread.id}>
                  <ThreadButton
                    thread={thread}
                    selected={thread.id === threadId}
                    onSelect={() => select(thread.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-label="Conversation"
          className={cn('min-w-0', threadId ? 'block' : 'hidden lg:block')}
        >
          {threadId ? (
            <ThreadPane
              threadId={threadId}
              onBack={() => void navigate({ search: {} })}
              matchedBy={selected?.matched_by}
            />
          ) : (
            <div className="rounded-tile border border-line-soft bg-card px-6 py-12 text-center text-[14.5px] text-muted">
              Pick a conversation to read it.
            </div>
          )}
        </section>

        <aside
          aria-label="Conversation details"
          className={cn('min-w-0', threadId ? 'block' : 'hidden xl:block')}
        >
          {selected ? (
            <div className="flex flex-col gap-3 rounded-tile border border-line-soft bg-card p-4">
              <span className="ms-eyebrow text-[10.5px] text-muted-2">this conversation</span>
              <KeyValueList>
                <KeyValue label="Thread" value={selected.id} mono />
                <KeyValue label="Messages" value={num(selected.message_count)} mono />
                <KeyValue label="Last message" value={dateTime(selected.last_message_at)} mono />
                <KeyValue label="Participants" value={selected.participants.join(', ')} />
              </KeyValueList>
              {selected.matched_by ? <MatchChip matchedBy={selected.matched_by} /> : null}
              <Button
                size="sm"
                variant="outline"
                disabled={markRead.isPending}
                onClick={() => markRead.mutate({ id: selected.id, unread: !selected.unread })}
              >
                {selected.unread ? 'Mark as read' : 'Mark as unread'}
              </Button>
            </div>
          ) : (
            <p className="m-0 px-1 text-[13.5px] text-muted-2">
              Details appear here once a conversation is selected.
            </p>
          )}
        </aside>
      </div>
    </>
  )
}

const ThreadButton = ({
  thread,
  selected,
  onSelect,
}: {
  thread: InboundThreadRecord
  selected: boolean
  onSelect: () => void
}) => (
  <button
    type="button"
    aria-current={selected ? 'true' : undefined}
    onClick={onSelect}
    className={cn(
      'flex w-full flex-col gap-1 rounded-tile border px-3.5 py-3 text-left',
      'transition-colors duration-[0.18s]',
      selected ? 'border-accent-border bg-accent-soft' : 'border-line-soft bg-card hover:bg-tint',
    )}
  >
    <span className="flex items-center gap-2">
      {thread.unread ? <StatusDot tone="accent" size={7} /> : null}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[14px]',
          thread.unread ? 'font-semibold' : 'font-normal',
        )}
      >
        {thread.subject || '(no subject)'}
      </span>
      {thread.unread ? <span className="sr-only">unread</span> : null}
    </span>
    <span className="truncate text-[12.5px] text-muted">
      {thread.participants.map(bareAddress).join(', ')}
    </span>
    <span className="font-mono text-[11.5px] text-muted-2">
      {num(thread.message_count)} messages · {relativeTime(thread.last_message_at)}
    </span>
  </button>
)

const MatchChip = ({ matchedBy }: { matchedBy: string }) => {
  const copy = MATCH_COPY[matchedBy] ?? {
    label: matchedBy,
    detail: 'Unrecognised threading rule. Treat the grouping as unverified.',
    certain: false,
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex w-fit">
          <MonoChip size="sm" tone={copy.certain ? 'neutral' : 'warning'}>
            matched by {copy.label}
            {copy.certain ? '' : ' · guess'}
          </MonoChip>
        </span>
      </TooltipTrigger>
      <TooltipContent>{copy.detail}</TooltipContent>
    </Tooltip>
  )
}

const ThreadPane = ({
  threadId,
  onBack,
  matchedBy,
}: {
  threadId: string
  onBack: () => void
  matchedBy?: string
}) => {
  const api = useApi()
  const environment = useEnvironment()

  const messages = useQuery({
    queryKey: qk.threadMessages(environment, threadId),
    queryFn: () => api.listThreadMessages(threadId),
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 lg:hidden">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          All conversations
        </Button>
        {matchedBy ? <MatchChip matchedBy={matchedBy} /> : null}
      </div>

      {messages.isLoading ? (
        <DetailSkeleton />
      ) : messages.error ? (
        <ErrorState
          error={messages.error}
          subject="this conversation"
          onRetry={() => void messages.refetch()}
        />
      ) : (messages.data?.data.length ?? 0) === 0 ? (
        <EmptyState
          icon={MailWarning}
          title="This conversation is empty"
          description="The thread exists but none of its messages could be loaded. It may still be being written."
          action={{ label: 'Reload', onClick: () => void messages.refetch() }}
        />
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {(messages.data?.data ?? []).map((message) => (
            <li key={message.id}>
              <MessageCard message={message} />
            </li>
          ))}
        </ol>
      )}

      <Composer threadId={threadId} />
    </div>
  )
}

const MessageCard = ({ message }: { message: InboundMessageRecord }) => (
  <article className="rounded-tile border border-line-soft bg-card p-4">
    <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <p className="m-0 truncate text-[14.5px] font-semibold">{message.from}</p>
        <p className="m-0 truncate font-mono text-[12px] text-muted-2">
          to {message.to.join(', ')}
        </p>
      </div>
      <time className="font-mono text-[12px] text-muted-2" dateTime={message.received_at}>
        {dateTime(message.received_at)}
      </time>
    </header>

    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      <MonoChip size="sm" tone={AUTH_TONE(message.spf)}>
        spf {message.spf ?? 'none'}
      </MonoChip>
      <MonoChip size="sm" tone={AUTH_TONE(message.dkim)}>
        dkim {message.dkim ?? 'none'}
      </MonoChip>
      <MonoChip size="sm" tone={AUTH_TONE(message.dmarc)}>
        dmarc {message.dmarc ?? 'none'}
      </MonoChip>
    </div>

    {message.parse_status === 'raw_only' ? (
      <Callout variant="warn" title="raw only" icon={MailWarning} className="mt-3">
        MIME parsing failed on this message. It was kept rather than dropped, so nothing was lost —
        but only the raw form exists, which is why there is no rendered body, no text alternative
        and no attachment list below.
      </Callout>
    ) : null}

    <div className="mt-3">
      {message.html ? (
        <iframe
          srcDoc={message.html}
          sandbox=""
          title="Message"
          className="h-[360px] w-full rounded-sm border border-line-soft bg-paper"
        />
      ) : message.text ? (
        <pre className="m-0 whitespace-pre-wrap break-words rounded-sm bg-tint p-3.5 font-mono text-[13px] leading-relaxed text-ink">
          {message.text}
        </pre>
      ) : (
        <p className="m-0 text-[13.5px] text-muted">
          {message.snippet || 'No body was recovered from this message.'}
        </p>
      )}
    </div>

    {message.attachments && message.attachments.length > 0 ? (
      <div className="mt-3">
        <span className="ms-eyebrow text-[10.5px] text-muted-2">
          {num(message.attachments.length)} attachments
        </span>
        <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
          {message.attachments.map((attachment) => (
            <li
              key={`${attachment.filename}-${attachment.url}`}
              className="flex flex-wrap items-center gap-2 text-[13.5px]"
            >
              <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-2" />
              <a href={attachment.url} className="min-w-0 truncate text-accent">
                {attachment.filename}
              </a>
              <MonoChip size="sm">{attachment.content_type}</MonoChip>
              <span className="font-mono text-[12px] text-muted-2">{bytes(attachment.size)}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null}
  </article>
)

const Composer = ({ threadId }: { threadId: string }) => {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const [body, setBody] = useState('')

  const reply = useMutation({
    mutationFn: () => api.replyToThread(threadId, { text: body }),
    onSuccess: () => {
      setBody('')
      void queryClient.invalidateQueries({ queryKey: qk.threadMessages(environment, threadId) })
      void queryClient.invalidateQueries({ queryKey: qk.threads(environment, {}) })
      toast.success('Reply queued')
    },
    onError: (error: Error) => toast.error('Reply not sent', { description: error.message }),
  })

  return (
    <form
      className="flex flex-col gap-2 rounded-tile border border-line-soft bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (body.trim() !== '') reply.mutate()
      }}
    >
      <label htmlFor={fieldId} className="ms-eyebrow text-[10.5px] text-muted-2">
        reply
      </label>
      <Textarea
        id={fieldId}
        value={body}
        placeholder="Write a reply. It goes out from the address this thread arrived on."
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="submit" size="sm" disabled={body.trim() === '' || reply.isPending}>
          {reply.isPending ? 'Sending…' : 'Send reply'}
        </Button>
      </div>
    </form>
  )
}
