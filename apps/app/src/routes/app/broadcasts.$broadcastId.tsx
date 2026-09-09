import { KeyValue, KeyValueList, StatusBadge } from '@mailysend/ui'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { BroadcastComposer } from '~/components/app/broadcast-composer.tsx'
import { BroadcastProgress } from '~/components/app/broadcast-progress.tsx'
import { dateTime, num } from '~/components/app/format.ts'
import { PageHeader, PageSection } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { DetailSkeleton, ErrorState } from '~/components/app/states.tsx'
import { qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/broadcasts/$broadcastId')({
  head: () => appHead('Broadcast'),
  component: BroadcastDetail,
})

function BroadcastDetail() {
  const { broadcastId } = Route.useParams()
  const api = useApi()
  const environment = useEnvironment()

  const broadcast = useQuery({
    queryKey: qk.broadcast(environment, broadcastId),
    queryFn: () => api.getBroadcast(broadcastId),
  })

  if (broadcast.isLoading) return <DetailSkeleton />
  if (broadcast.error)
    return (
      <ErrorState
        error={broadcast.error}
        subject="this broadcast"
        onRetry={() => void broadcast.refetch()}
      />
    )
  if (!broadcast.data) return null

  const record = broadcast.data
  const draft = record.status === 'draft'

  return (
    <>
      <PageHeader
        eyebrow={<span className="font-mono">{record.id}</span>}
        title={record.name ?? 'Untitled broadcast'}
        description={
          draft
            ? 'A draft. Everything here is editable until the moment you send it.'
            : 'Sent or in flight. The record below is what the coordinator is working from.'
        }
        actions={<StatusBadge status={record.status} pulse={record.status === 'sending'} />}
      />

      {draft ? (
        <BroadcastComposer broadcast={record} />
      ) : (
        <>
          <BroadcastProgress broadcast={record} />
          <PageSection
            title="Summary"
            description="Read-only: a broadcast is frozen once it is sent."
          >
            <div className="rounded-tile border border-line-soft bg-card p-4">
              <KeyValueList>
                <KeyValue label="From" value={record.from ?? '—'} mono />
                <KeyValue label="Subject" value={record.subject ?? '—'} />
                <KeyValue label="Preview text" value={record.preview_text ?? '—'} />
                <KeyValue label="Reply-to" value={(record.reply_to ?? []).join(', ') || '—'} mono />
                <KeyValue label="Audience" value={record.audience_id ?? '—'} mono />
                <KeyValue label="Segment" value={record.segment_id ?? 'whole audience'} mono />
                <KeyValue
                  label="Rate"
                  value={
                    record.throttle_per_minute
                      ? `${num(record.throttle_per_minute)} per minute`
                      : 'provider default'
                  }
                />
                <KeyValue label="Created" value={dateTime(record.created_at)} />
                <KeyValue
                  label="Scheduled"
                  value={record.scheduled_at ? dateTime(record.scheduled_at) : '—'}
                />
                <KeyValue label="Sent" value={record.sent_at ? dateTime(record.sent_at) : '—'} />
              </KeyValueList>
            </div>
          </PageSection>
        </>
      )}
    </>
  )
}
