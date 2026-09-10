import type { StatusDotTone, TerminalLine } from '@mailysend/ui'
import {
  Button,
  MonoChip,
  StatusDot,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Terminal,
  toast,
  useCopy,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { CopyValue } from '~/components/app/copy-value.tsx'
import type { Column } from '~/components/app/data-table.tsx'
import { DataTable } from '~/components/app/data-table.tsx'
import { dateTime, duration } from '~/components/app/format.ts'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { DetailSkeleton, ErrorState } from '~/components/app/states.tsx'
import type { EmailTimelineEventRecord, WebhookDeliveryRecord } from '~/lib/api-client.ts'
import { qk } from '~/lib/query.ts'

/**
 * Everything that happened to one message: the event timeline, the SMTP
 * conversation the receiver actually held, the webhooks we fired about it, and
 * the MIME we handed the provider.
 *
 * It mounts only when a log row is expanded, so the query has no `enabled`
 * guard — mounting *is* the intent to read.
 */

const EVENT_TONE: Record<string, StatusDotTone> = {
  queued: 'muted',
  scheduled: 'muted',
  sending: 'accent',
  sent: 'accent',
  delivered: 'positive',
  delivery_delayed: 'amber',
  opened: 'accent',
  clicked: 'accent',
  bounced: 'warning',
  complained: 'warning',
  failed: 'warning',
  canceled: 'muted',
}

const eventTone = (type: string): StatusDotTone => EVENT_TONE[type] ?? 'muted'

const ENGAGEMENT_EVENTS = new Set(['opened', 'clicked'])

/**
 * Apple Mail Privacy Protection fetches the pixel for every message it
 * receives, whether or not a human ever looked. Rendering that as an open is
 * the single most common way an email dashboard lies to its reader, so the
 * class is spelled out on the row rather than folded into the count.
 */
const AUDIENCE_LABEL: Record<string, string> = {
  human: 'human',
  mpp: 'mpp — prefetch, not a read',
  bot: 'bot',
  scanner: 'scanner',
  proxy_prefetch: 'proxy prefetch, not a read',
}

const TimelineRow = ({ event }: { event: EmailTimelineEventRecord }) => {
  const audience = event.audience_class
  const isPrefetch = audience === 'mpp' || audience === 'proxy_prefetch'

  return (
    <li className="flex flex-col gap-1.5 border-b border-line-soft px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2.5">
        <StatusDot tone={eventTone(event.type)} size={8} />
        <span className="font-mono text-[12.5px] text-ink">{event.type.replace(/_/g, ' ')}</span>
        <time dateTime={event.occurred_at} className="font-mono text-[11.5px] text-muted-2">
          {dateTime(event.occurred_at)}
        </time>
        {event.provider ? (
          <span className="font-mono text-[11.5px] text-muted-2">via {event.provider}</span>
        ) : null}
        {audience && ENGAGEMENT_EVENTS.has(event.type) ? (
          <MonoChip size="sm" tone={isPrefetch ? 'warning' : 'neutral'}>
            {AUDIENCE_LABEL[audience] ?? audience}
          </MonoChip>
        ) : null}
      </div>

      {/* A failure explains itself here for the same reason a bounce does: the
          timeline is where a reader looks after seeing a status they did not
          expect. `failed` used to be the one event type that arrived with a
          diagnostic and rendered none of it. */}
      {(event.type === 'bounced' || event.type === 'failed') &&
      (event.bounce_class || event.diagnostic) ? (
        <div className="flex flex-col gap-1 pl-[18px]">
          {event.bounce_class ? (
            <span className="font-mono text-[11.5px] text-warning">class {event.bounce_class}</span>
          ) : null}
          {event.diagnostic ? (
            <p className="m-0 font-mono text-[11.5px] leading-relaxed text-muted break-all">
              {event.diagnostic}
            </p>
          ) : null}
        </div>
      ) : null}

      {event.link_url ? (
        <p className="m-0 pl-[18px] font-mono text-[11.5px] text-muted break-all">
          {event.link_url}
        </p>
      ) : null}
    </li>
  )
}

const NotAvailable = ({ children }: { children: string }) => (
  <p className="m-0 rounded-tile border border-line-soft bg-card px-4 py-6 text-[14px] text-muted">
    {children}
  </p>
)

/** The dark "remote response" block: the receiver's own last word, verbatim. */
const RemoteResponse = ({ code, response }: { code: string | null; response: string | null }) => (
  <div className="rounded-tile bg-ink p-4">
    <p className="ms-eyebrow m-0 text-on-dark-5">remote response</p>
    <p className="m-0 mt-2.5 font-mono text-[12.5px] leading-relaxed text-on-dark break-all">
      <span className="text-code-green">{code ?? '—'}</span>
      {response ? ` ${response}` : null}
    </p>
  </div>
)

const RawMessage = ({ raw }: { raw: string }) => {
  const { copied, copy } = useCopy()

  return (
    <div className="relative overflow-hidden rounded-tile bg-ink">
      <div className="flex items-center gap-3 border-b border-dark-line px-4 py-2.5">
        <span className="ms-eyebrow text-on-dark-5">raw mime</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto size-8 p-0 text-on-dark-3 hover:text-on-dark"
          aria-label={copied ? 'Raw message copied' : 'Copy raw message'}
          onClick={() => copy(raw)}
        >
          {copied ? (
            <Check aria-hidden="true" className="text-code-green" />
          ) : (
            <Copy aria-hidden="true" />
          )}
        </Button>
      </div>
      <div className="max-h-[420px] overflow-auto p-4">
        <pre className="m-0 font-mono text-[12px] leading-[1.8] text-on-dark-2 whitespace-pre-wrap">
          {raw}
        </pre>
      </div>
    </div>
  )
}

export const LogDrawer = ({ emailId }: { emailId: string }) => {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const { copied, copy } = useCopy()

  const detail = useQuery({
    queryKey: qk.emailDetail(environment, emailId),
    queryFn: () => api.getEmailDetail(emailId),
    enabled: true,
  })

  const replay = useMutation({
    mutationFn: ({ webhookId, attemptId }: { webhookId: string; attemptId: string }) =>
      api.replayWebhookAttempt(webhookId, attemptId),
    onSuccess: (attempt) => {
      toast.success(
        attempt.succeeded
          ? `Replayed — endpoint answered ${attempt.status_code ?? 'with no status'}`
          : `Replayed — endpoint still failing (${attempt.status_code ?? 'no response'})`,
      )
      void queryClient.invalidateQueries({ queryKey: qk.emailDetail(environment, emailId) })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not replay that attempt.')
    },
  })

  if (detail.isLoading) return <DetailSkeleton />
  if (detail.error) {
    return (
      <ErrorState
        error={detail.error}
        subject="this message's history"
        onRetry={() => void detail.refetch()}
      />
    )
  }
  if (!detail.data) return null

  const message = detail.data
  const { events, smtp, webhook_deliveries } = message
  const raw = typeof message.raw === 'string' ? message.raw : null

  const lastDelivery = [...smtp].reverse()[0] ?? null

  /**
   * The receiver's side of the conversation, one line per response. A `2xx` is
   * the only line rendered as a success, because it is the only one that means
   * the receiver took the message.
   */
  const conversation: TerminalLine[] = smtp.map((line) => ({
    text: [line.code, line.response].filter(Boolean).join(' ') || line.source,
    kind: /^2\d\d/.test(String(line.code ?? '')) ? 'success' : 'output',
  }))

  // A delivery counts as succeeded on a 2xx and nothing else; the endpoint's own
  // status is the only thing that decides it, so it is derived here rather than
  // stored twice.
  const succeeded = (row: WebhookDeliveryRecord): boolean =>
    row.response_status != null && row.response_status >= 200 && row.response_status < 300

  const attemptColumns: Column<WebhookDeliveryRecord>[] = [
    {
      id: 'url',
      header: 'Endpoint',
      cell: (row) => (
        <span className="font-mono text-[12px] break-all">{row.url ?? row.endpoint_id}</span>
      ),
      sortBy: (row) => row.url ?? row.endpoint_id,
    },
    {
      id: 'event',
      header: 'Event',
      cell: (row) => <MonoChip size="sm">{row.event_type}</MonoChip>,
      sortBy: (row) => row.event_type,
    },
    {
      id: 'status',
      header: 'Status',
      align: 'right',
      sortBy: (row) => row.response_status ?? 0,
      cell: (row) => (
        <div className="flex flex-col items-end gap-1">
          <span
            className={`font-mono text-[12px] ${succeeded(row) ? 'text-positive' : 'text-warning'}`}
          >
            {row.response_status ?? 'no response'}
          </span>
          {!succeeded(row) && row.response_body ? (
            <span className="font-mono text-[11px] text-muted-2 break-all">
              {row.response_body.slice(0, 120)}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'duration',
      header: 'Duration',
      align: 'right',
      cell: (row) => <span className="font-mono text-[12px]">{duration(row.duration_ms)}</span>,
      sortBy: (row) => row.duration_ms ?? 0,
    },
    {
      id: 'attempt',
      header: 'Attempt',
      align: 'right',
      cell: (row) => <span className="font-mono text-[12px]">#{row.attempt}</span>,
      sortBy: (row) => row.attempt,
    },
    {
      id: 'created',
      header: 'Time',
      cell: (row) => (
        <time dateTime={row.created_at} className="font-mono text-[11.5px] text-muted-2">
          {dateTime(row.created_at)}
        </time>
      ),
      sortBy: (row) => row.created_at,
    },
    {
      id: 'replay',
      header: 'Replay',
      srOnlyHeader: true,
      align: 'right',
      cell: (row) => (
        <Button
          variant="outline"
          size="sm"
          disabled={replay.isPending}
          onClick={() => replay.mutate({ webhookId: row.endpoint_id, attemptId: row.id })}
        >
          <RefreshCw aria-hidden="true" />
          Replay
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="ms-eyebrow text-muted-2">message id</span>
        <CopyValue value={message.id} label="message id" truncate={false} />
      </div>

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="smtp">SMTP</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="raw">Raw</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline">
          {events.length === 0 ? (
            <NotAvailable>
              No events have been recorded for this message yet. Queued messages get their first
              event when a provider accepts them.
            </NotAvailable>
          ) : (
            <ol className="m-0 list-none overflow-hidden rounded-tile border border-line-soft bg-card p-0">
              {events.map((event) => (
                <TimelineRow key={event.event_id} event={event} />
              ))}
            </ol>
          )}
        </TabsContent>

        <TabsContent value="smtp" className="flex flex-col gap-3">
          {conversation.length > 0 ? (
            <Terminal lines={conversation} caption="smtp conversation" copyable />
          ) : (
            <NotAvailable>
              The provider did not return an SMTP conversation for this message. Cloudflare Email
              and the HTTP providers hand back a result rather than a transcript.
            </NotAvailable>
          )}

          {lastDelivery ? (
            <RemoteResponse
              code={lastDelivery.code ?? null}
              response={lastDelivery.response ?? null}
            />
          ) : (
            <NotAvailable>No receiver response has been recorded for this message.</NotAvailable>
          )}
        </TabsContent>

        <TabsContent value="webhooks">
          {webhook_deliveries.length === 0 ? (
            <NotAvailable>
              No webhook was fired for this message — either no endpoint subscribes to its events,
              or none have fired yet.
            </NotAvailable>
          ) : (
            <DataTable
              rows={webhook_deliveries}
              columns={attemptColumns}
              rowId={(row) => row.id}
              caption={`Webhook delivery attempts for message ${message.id}`}
              defaultSort={{ columnId: 'created', direction: 'desc' }}
            />
          )}
        </TabsContent>

        <TabsContent value="raw" className="flex flex-col gap-3">
          {raw ? (
            <RawMessage raw={raw} />
          ) : (
            <NotAvailable>
              The raw MIME is no longer stored for this message. Raw retention is set per workspace
              and expires separately from the log itself.
            </NotAvailable>
          )}
          {message.provider_message_id ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="ms-eyebrow text-muted-2">provider message id</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={copied ? 'Provider message id copied' : 'Copy provider message id'}
                onClick={() => copy(message.provider_message_id ?? '')}
              >
                <span className="font-mono text-[12px]">{message.provider_message_id}</span>
                {copied ? (
                  <Check aria-hidden="true" className="text-positive" />
                ) : (
                  <Copy aria-hidden="true" />
                )}
              </Button>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}
