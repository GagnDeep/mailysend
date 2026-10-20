import type { EmailStatus } from '@mailysend/contracts'
import type { Status } from '@mailysend/ui'
import {
  Button,
  Callout,
  KeyValue,
  KeyValueList,
  LogRow,
  MonoChip,
  StatTile,
  StatusDot,
} from '@mailysend/ui'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, Send } from 'lucide-react'
import { FirstRunChecklist } from '~/components/app/first-run.tsx'
import { clockTime, logTime, num, pct, ratio, relativeTime } from '~/components/app/format.ts'
import { PrivacyAdjustedOpenRate } from '~/components/app/honesty.tsx'
import { PageHeader, PageSection } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { CardsSkeleton, EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import type { AnalyticsOverviewRecord } from '~/lib/api-client.ts'
import { qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/')({
  head: () => appHead('Overview'),
  component: Overview,
})

/**
 * Every `last_event` the API can return has a badge tone. The badge's union is
 * the wider of the two — it also covers domains and broadcasts — so the mapping
 * is explicit, and `Record<EmailStatus, …>` is what makes a new status a
 * compile error here rather than a silent fallback in the log.
 */
const STATUS_MAP: Record<EmailStatus, Status> = {
  queued: 'queued',
  scheduled: 'scheduled',
  sending: 'sending',
  sent: 'sent',
  delivery_delayed: 'pending',
  delivered: 'delivered',
  opened: 'opened',
  clicked: 'clicked',
  canceled: 'canceled',
  complained: 'complained',
  bounced: 'bounced',
  failed: 'failed',
}

export const toBadgeStatus = (value: string): Status =>
  (STATUS_MAP as Record<string, Status | undefined>)[value] ?? 'queued'

function Overview() {
  const api = useApi()
  const environment = useEnvironment()

  const analytics = useQuery({
    queryKey: qk.analytics(environment, { window: '24h', granularity: 'hour' }),
    queryFn: () => api.analytics({ granularity: 'hour', audience_class: 'human' }),
    // The counters are the one thing on the dashboard that is meant to be live.
    refetchInterval: 30_000,
  })

  const recent = useQuery({
    queryKey: qk.emails(environment, { recent: true }),
    queryFn: () => api.listEmails({ limit: 8 }),
    refetchInterval: 30_000,
  })

  const totals = analytics.data?.totals
  const series = analytics.data?.timeseries ?? []
  const peak = Math.max(1, ...series.map((point) => point.sent))

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Everything that left the building"
        description="The last 24 hours, refreshed every 30 seconds. Numbers are for this workspace and this environment only — Analytics has the 30-day view."
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to="/app/logs">
                Open logs
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/app/broadcasts/new">
                <Send aria-hidden="true" />
                New broadcast
              </Link>
            </Button>
          </>
        }
      />

      {/*
        Only while the instance has nothing to show. It reads the current state
        of the three prerequisites rather than a stored "onboarded" flag, so it
        is accurate on an instance that was set up months ago and has simply
        gone quiet, and it asks for nothing while there is traffic to look at.
      */}
      <FirstRunChecklist enabled={!recent.isLoading && (recent.data?.data.length ?? 0) === 0} />

      {analytics.isLoading ? (
        <CardsSkeleton count={5} />
      ) : analytics.error ? (
        <ErrorState
          error={analytics.error}
          subject="the live counters"
          onRetry={() => void analytics.refetch()}
        />
      ) : totals ? (
        <>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
          >
            <StatTile label="Sent" value={num(totals.sent)} />
            <StatTile
              label="Delivered"
              value={ratio(totals.delivered, totals.sent)}
              delta={`${num(totals.delivered)} messages`}
              intent="positive"
            />
            <StatTile
              label="Bounced"
              value={num(totals.bounced)}
              delta={ratio(totals.bounced, totals.sent)}
              intent={totals.bounced > 0 ? 'negative' : 'neutral'}
              tone={totals.sent > 0 && totals.bounced / totals.sent > 0.02 ? 'alert' : 'paper'}
            />
            <StatTile
              label="Complained"
              value={num(totals.complained)}
              delta={ratio(totals.complained, totals.sent)}
              intent={totals.complained > 0 ? 'negative' : 'neutral'}
            />
            <StatTile
              label="Clicked"
              value={num(totals.clicked)}
              delta={ratio(totals.clicked, totals.delivered)}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <figure className="m-0 rounded-tile border border-line-soft bg-card p-4">
              <figcaption className="ms-eyebrow text-[10.5px] text-muted-2">
                sent per hour · last {series.length} buckets
              </figcaption>
              {series.length === 0 ? (
                <p className="m-0 mt-4 text-[14px] text-muted">No traffic in this window yet.</p>
              ) : (
                <ol className="m-0 mt-4 flex h-[150px] list-none items-end gap-1.5 p-0">
                  {series.map((point) => (
                    <li
                      key={point.bucket}
                      className="flex-1"
                      title={`${clockTime(point.bucket)} · ${num(point.sent)} sent`}
                    >
                      <span className="sr-only">
                        {clockTime(point.bucket)}: {num(point.sent)} sent
                      </span>
                      <span
                        aria-hidden="true"
                        className="block w-full rounded-[5px] bg-ink"
                        style={{ height: `${Math.max(4, (point.sent / peak) * 150)}px` }}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </figure>

            <PrivacyAdjustedOpenRate
              humanOpens={totals.human_opens}
              humanDelivered={totals.human_delivered}
              rawOpens={totals.opened}
              delivered={totals.delivered}
            />
          </div>

          {totals.bounced / Math.max(1, totals.sent) > 0.05 ? (
            <Callout
              variant="warn"
              title="needs attention"
              actions={
                <Button asChild size="sm" variant="outline">
                  <Link to="/app/logs" search={{ status: 'bounced' }}>
                    Show the bounces
                  </Link>
                </Button>
              }
            >
              {pct((totals.bounced / Math.max(1, totals.sent)) * 100)} of this window bounced. Above
              5% most receivers start throttling the whole domain, so the fix is the recipient list
              rather than the send rate.
            </Callout>
          ) : null}
        </>
      ) : null}

      <PageSection
        title="Recent activity"
        description="The last few messages, newest first."
        action={
          <Button asChild variant="link" size="sm">
            <Link to="/app/logs">All logs →</Link>
          </Button>
        }
      >
        {recent.isLoading ? (
          <TableSkeleton rows={5} columns={3} />
        ) : recent.error ? (
          <ErrorState
            error={recent.error}
            subject="recent activity"
            onRetry={() => void recent.refetch()}
          />
        ) : (recent.data?.data.length ?? 0) === 0 ? (
          <EmptyState
            icon={Send}
            title="Nothing sent yet"
            description="Send your first message with an API key, or start with a broadcast to an audience."
            action={{ label: 'Create an API key', href: '/app/api-keys' }}
            secondaryAction={{ label: 'Read the quickstart', href: '/docs#quickstart' }}
          />
        ) : (
          <div className="overflow-hidden rounded-tile border border-line-soft bg-card">
            {recent.data?.data.map((email) => (
              <LogRow
                key={email.id}
                status={toBadgeStatus(email.last_event)}
                timestamp={logTime(email.created_at)}
                recipient={email.to[0] ?? '—'}
                subject={email.subject}
                details={
                  <KeyValueList>
                    <KeyValue label="Message" value={email.id} mono />
                    <KeyValue label="From" value={email.from} mono />
                    <KeyValue label="Created" value={relativeTime(email.created_at)} />
                    <KeyValue label="Provider" value={email.provider ?? 'unassigned'} mono />
                    <KeyValue
                      label=""
                      value={
                        <Button asChild variant="link" size="sm">
                          <Link to="/app/emails/$emailId" params={{ emailId: email.id }}>
                            Open message →
                          </Link>
                        </Button>
                      }
                    />
                  </KeyValueList>
                }
              />
            ))}
          </div>
        )}
      </PageSection>

      <PageSection title="Queue">
        <QueuePanel queue={analytics.data?.queue} loading={analytics.isLoading} />
      </PageSection>
    </>
  )
}

/**
 * What is waiting to go out.
 *
 * This panel used to be four hardcoded facts: a green pulsing dot and the words
 * "Send queue drained", on every load, with no query behind them. On the load
 * where a transport was misconfigured and ten thousand messages were piling up
 * it said exactly the same thing — and this is the panel somebody opens
 * *because* they suspect a backlog, so it was reassuring precisely when it
 * should not have been.
 *
 * Now it reports the counts, and the dot's colour is derived from them rather
 * than written down. A queue with work in it is not an alarm — that is what a
 * queue is for — so depth alone stays neutral and only an old head turns
 * warning: something accepted more than ten minutes ago and still not sent is
 * the shape of a stuck queue rather than a busy one.
 */
const STUCK_AFTER_MS = 10 * 60_000

function QueuePanel({
  queue,
  loading,
}: {
  queue: AnalyticsOverviewRecord['queue']
  loading: boolean
}) {
  const scheduled = (
    <>
      Scheduled messages stay in <MonoChip size="sm">scheduled</MonoChip> until their time, and are
      cancellable until the moment they leave.
    </>
  )

  // An older deployment's `/analytics/dashboard` does not carry `queue`, and a
  // dot with nothing behind it is the thing this panel exists to stop being.
  if (loading || !queue) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-tile border border-line-soft bg-card p-4 text-[14px] text-muted">
        <span>{loading ? 'Reading the queue…' : scheduled}</span>
      </div>
    )
  }

  const waiting = queue.queued + queue.sending
  const stuckSince =
    queue.oldest_waiting_at && Date.now() - Date.parse(queue.oldest_waiting_at) > STUCK_AFTER_MS
      ? queue.oldest_waiting_at
      : null

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-tile border border-line-soft bg-card p-4 text-[14px] text-muted">
      <StatusDot
        tone={stuckSince ? 'warning' : waiting > 0 ? 'accent' : 'positive'}
        size={8}
        pulse={waiting > 0}
      />
      <span>
        {waiting === 0 ? (
          <>Nothing waiting to send. {scheduled}</>
        ) : (
          <>
            {num(queue.queued)} queued, {num(queue.sending)} in flight
            {stuckSince ? (
              <>
                {' '}
                — the oldest was accepted {relativeTime(stuckSince)} and has not left yet, which
                usually means the transport is refusing it.
              </>
            ) : (
              <>, moving.</>
            )}
          </>
        )}
      </span>
      {queue.scheduled > 0 ? (
        <span>
          {num(queue.scheduled)} scheduled
          {queue.next_scheduled_at ? <>, next {relativeTime(queue.next_scheduled_at)}</> : null}.
        </span>
      ) : null}
      <Button asChild variant="link" size="sm" className="ml-auto">
        <Link to="/app/logs" search={{ status: stuckSince ? 'queued' : 'scheduled' }}>
          {stuckSince ? 'Show what is waiting →' : 'Scheduled messages →'}
        </Link>
      </Button>
    </div>
  )
}
