import {
  Button,
  Callout,
  MonoChip,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  StatusBadge,
  Switch,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import { CopyValue } from '~/components/app/copy-value.tsx'
import type { Column } from '~/components/app/data-table.tsx'
import { DataTable } from '~/components/app/data-table.tsx'
import { dateTime, relativeTime } from '~/components/app/format.ts'
import { PageHeader, PageSection } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { DetailSkeleton, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import type { WebhookAttemptRecord } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'
import type { WebhookEvent } from '~/routes/app/webhooks.index.tsx'
import { EventPicker } from '~/routes/app/webhooks.index.tsx'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/webhooks/$webhookId')({
  head: () => appHead('Webhook'),
  component: WebhookDetail,
})

const sameEvents = (left: WebhookEvent[], right: WebhookEvent[]): boolean =>
  left.length === right.length && left.every((event) => right.includes(event))

const Body = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div className="flex flex-col gap-1.5">
    <div className="ms-eyebrow text-[10.5px] text-muted-2">{label}</div>
    {value ? (
      <pre className="m-0 max-h-[280px] overflow-auto rounded-code border border-dark-line bg-dark p-3.5 font-mono text-[12px] leading-relaxed text-on-dark">
        {value}
      </pre>
    ) : (
      <p className="m-0 text-[13.5px] text-muted">
        Nothing recorded — the endpoint returned an empty body, or the request never got that far.
      </p>
    )}
  </div>
)

function WebhookDetail() {
  const { webhookId } = Route.useParams()
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const pickerId = useId()

  const [events, setEvents] = useState<WebhookEvent[] | null>(null)
  const [inspecting, setInspecting] = useState<WebhookAttemptRecord | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const webhookQuery = useQuery({
    queryKey: qk.webhook(environment, webhookId),
    queryFn: () => api.getWebhook(webhookId),
  })

  const attempts = useQuery({
    queryKey: qk.webhookAttempts(environment, webhookId),
    queryFn: () => api.listWebhookAttempts(webhookId, { limit: 50 }),
  })

  const webhook = webhookQuery.data

  useEffect(() => {
    if (webhook) setEvents((current) => current ?? webhook.events)
  }, [webhook])

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.updateWebhook(webhookId, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.webhook(environment, webhookId), updated)
      void queryClient.invalidateQueries({ queryKey: qk.webhooks(environment) })
      toast.success('Endpoint updated.')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const replay = useMutation({
    mutationFn: (attemptId: string) => api.replayWebhookAttempt(webhookId, attemptId),
    onSuccess: (attempt) => {
      void queryClient.invalidateQueries({ queryKey: qk.webhookAttempts(environment, webhookId) })
      toast[attempt.succeeded ? 'success' : 'error'](
        attempt.succeeded
          ? `Replayed — the endpoint answered ${attempt.status_code ?? 'OK'}.`
          : `Replay failed with ${attempt.status_code ?? 'no response'}.`,
      )
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteWebhook(webhookId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.webhooks(environment) })
      toast.success('Endpoint deleted.')
      void navigate({ to: '/app/webhooks' })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  if (webhookQuery.isLoading) return <DetailSkeleton />
  if (webhookQuery.error || !webhook) {
    return (
      <ErrorState
        error={webhookQuery.error}
        subject="this webhook endpoint"
        onRetry={() => void webhookQuery.refetch()}
      />
    )
  }

  const columns: Column<WebhookAttemptRecord>[] = [
    {
      id: 'event',
      header: 'Event',
      sortBy: (row) => row.event,
      cell: (row) => <MonoChip size="sm">{row.event}</MonoChip>,
    },
    {
      id: 'code',
      header: 'Status',
      align: 'right',
      sortBy: (row) => row.status_code ?? 0,
      cell: (row) => (
        <span
          className={
            row.succeeded
              ? 'font-mono text-[12.5px] text-positive'
              : 'font-mono text-[12.5px] text-warning'
          }
        >
          {row.status_code ?? 'no response'}
        </span>
      ),
    },
    {
      id: 'duration',
      header: 'Duration',
      align: 'right',
      sortBy: (row) => row.duration_ms ?? 0,
      cell: (row) => (
        <span className="font-mono text-[12.5px] text-muted">
          {row.duration_ms === null ? '—' : `${row.duration_ms} ms`}
        </span>
      ),
    },
    {
      id: 'attempt',
      header: 'Attempt',
      align: 'right',
      sortBy: (row) => row.attempt,
      cell: (row) => <span className="font-mono text-[12.5px] text-muted">#{row.attempt}</span>,
    },
    {
      id: 'time',
      header: 'When',
      sortBy: (row) => row.created_at,
      cell: (row) => (
        <span className="text-[13px] text-muted" title={dateTime(row.created_at)}>
          {relativeTime(row.created_at)}
        </span>
      ),
    },
    {
      id: 'result',
      header: 'Result',
      cell: (row) => <StatusBadge status={row.succeeded ? 'delivered' : 'failed'} size="sm" />,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      srOnlyHeader: true,
      cell: (row) => (
        <Button
          variant="ghost"
          size="sm"
          disabled={replay.isPending}
          onClick={(event) => {
            event.stopPropagation()
            replay.mutate(row.id)
          }}
        >
          <RotateCcw aria-hidden="true" />
          Replay
        </Button>
      ),
    },
  ]

  const pending = events ?? webhook.events

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/app/webhooks" className="inline-flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft aria-hidden="true" className="size-3" />
            Webhooks
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="break-all font-mono text-[20px]">{webhook.url}</span>
            <StatusBadge status={webhook.status} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <CopyValue value={webhook.url} label="endpoint URL" />
          </span>
        }
      />

      {(webhook.consecutive_failures ?? 0) > 0 ? (
        <Callout variant="warn" title="failing">
          The last {webhook.consecutive_failures} deliveries to this endpoint failed. Retries back
          off and eventually stop; the attempt log below has the response bodies we got back.
        </Callout>
      ) : null}

      <PageSection title="Settings">
        <div className="flex flex-col gap-4 rounded-tile border border-line-soft bg-card p-4">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="text-[14.5px] font-medium">Enabled</div>
              <p className="m-0 mt-1 max-w-[70ch] text-[13.5px] text-muted">
                A disabled endpoint receives nothing. Events that fire while it is off are not
                queued for later — disable it while you deploy a fix, not as a pause button.
              </p>
            </div>
            <Switch
              checked={webhook.status === 'enabled'}
              aria-label="Endpoint enabled"
              disabled={update.isPending}
              onCheckedChange={(checked) =>
                update.mutate({ status: checked ? 'enabled' : 'disabled' })
              }
            />
          </div>

          <EventPicker selected={pending} onChange={setEvents} idPrefix={pickerId} />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={
                update.isPending || pending.length === 0 || sameEvents(pending, webhook.events)
              }
              onClick={() => update.mutate({ events: pending })}
            >
              Save events
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={sameEvents(pending, webhook.events)}
              onClick={() => setEvents(webhook.events)}
            >
              Reset
            </Button>
          </div>
        </div>
      </PageSection>

      <PageSection
        title="Attempt log"
        description="Every delivery we made, including retries. Open a row to see exactly what was sent and what came back."
      >
        {attempts.isLoading ? (
          <TableSkeleton rows={5} columns={6} />
        ) : attempts.error ? (
          <ErrorState
            error={attempts.error}
            subject="the attempt log"
            onRetry={() => void attempts.refetch()}
          />
        ) : (
          <DataTable
            rows={attempts.data?.data ?? []}
            columns={columns}
            rowId={(row) => row.id}
            caption="Delivery attempts for this endpoint"
            defaultSort={{ columnId: 'time', direction: 'desc' }}
            onRowClick={(row) => setInspecting(row)}
            emptyMessage="No deliveries yet. The first matching event will appear here."
          />
        )}
      </PageSection>

      <PageSection title="Danger zone">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-tile border border-line bg-tint p-4">
          <p className="m-0 max-w-[70ch] text-[13.5px] text-muted">
            Deleting removes the endpoint, its signing secret and its attempt history.
          </p>
          <Button variant="accent" size="sm" onClick={() => setConfirmDelete(true)}>
            Delete endpoint
          </Button>
        </div>
      </PageSection>

      <Sheet
        open={inspecting !== null}
        onOpenChange={(next) => {
          if (!next) setInspecting(null)
        }}
      >
        <SheetContent side="right" className="w-full max-w-[720px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {inspecting?.event} · attempt #{inspecting?.attempt}
            </SheetTitle>
            <SheetDescription>
              {inspecting
                ? `${dateTime(inspecting.created_at)} · ${inspecting.status_code ?? 'no response'} · ${
                    inspecting.duration_ms === null ? 'no timing' : `${inspecting.duration_ms} ms`
                  }`
                : null}
            </SheetDescription>
          </SheetHeader>

          {inspecting ? (
            <div className="mt-4 flex flex-col gap-4">
              {inspecting.error ? (
                <Callout variant="warn" title="transport error">
                  {inspecting.error}
                </Callout>
              ) : null}
              <Body label="request body" value={inspecting.request_body} />
              <Body label="response body" value={inspecting.response_body} />
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={replay.isPending}
                  onClick={() => replay.mutate(inspecting.id)}
                >
                  <RotateCcw aria-hidden="true" />
                  Replay this delivery
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this endpoint"
        description="The endpoint stops receiving events immediately."
        confirmPhrase={webhook.url}
        confirmLabel="Delete endpoint"
        pending={remove.isPending}
        consequences={
          <>
            The signing secret is destroyed with the endpoint, so re-adding the same URL later means
            a new secret and a deploy on your side. The attempt history goes too, and events that
            fire after this are not stored for replay.
          </>
        }
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}
