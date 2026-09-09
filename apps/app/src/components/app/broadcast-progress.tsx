import { BarRow, Button, Callout, Metric, MetricGrid, Progress, toast } from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Pause, Play } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import { num, ratio } from '~/components/app/format.ts'
import { PageSection } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import type { BroadcastRecord } from '~/lib/api-client.ts'
import { qk } from '~/lib/query.ts'

/**
 * A send in flight, and what is known about it — which is deliberately less
 * than a marketing dashboard usually claims. The A/B panel below reports the
 * configured split rather than a winner, because the broadcast record carries
 * no per-variant counters and a leader invented from the overall numbers would
 * be a decision made on nothing.
 */

const ZERO = {
  total: 0,
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  bounced: 0,
  complained: 0,
  unsubscribed: 0,
}

export const BroadcastProgress = ({ broadcast }: { broadcast: BroadcastRecord }) => {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const [confirmCancel, setConfirmCancel] = useState(false)

  const live = useQuery({
    queryKey: qk.broadcast(environment, broadcast.id),
    queryFn: () => api.getBroadcast(broadcast.id),
    initialData: broadcast,
    // Only a send in flight moves. Polling a finished broadcast every five
    // seconds is a request per reader per five seconds for a constant.
    refetchInterval: broadcast.status === 'sending' ? 5_000 : false,
  })

  const current = live.data ?? broadcast
  const stats = current.stats ?? ZERO
  const percent = stats.total === 0 ? 0 : Math.min(100, (stats.sent / stats.total) * 100)
  const rate = current.throttle_per_minute

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.broadcast(environment, current.id) })
    void queryClient.invalidateQueries({ queryKey: qk.broadcasts(environment) })
  }

  const pause = useMutation({
    mutationFn: () => api.pauseBroadcast(current.id),
    onSuccess: () => {
      invalidate()
      toast.success('Paused. Nothing further leaves until you resume.')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const resume = useMutation({
    mutationFn: () => api.resumeBroadcast(current.id),
    onSuccess: () => {
      invalidate()
      toast.success('Resumed.')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const cancel = useMutation({
    mutationFn: () => api.cancelBroadcast(current.id),
    onSuccess: () => {
      invalidate()
      setConfirmCancel(false)
      toast.success('Canceled. What already left is already gone.')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const running = current.status === 'sending'
  const paused = current.status === 'paused'
  const stoppable = running || paused || current.status === 'scheduled'
  const variants = current.variants ?? []
  const weightTotal = variants.reduce((sum, variant) => sum + variant.weight, 0)
  const leaderWeight = Math.max(0, ...variants.map((variant) => variant.weight))

  return (
    <div className="flex flex-col gap-7">
      <PageSection title="Progress">
        <div className="flex flex-col gap-3 rounded-tile border border-line-soft bg-card p-4">
          <Progress
            value={percent}
            tone={running ? 'accent' : 'ink'}
            aria-label="Messages handed to the provider"
          />
          <p className="ms-num m-0 font-mono text-[13px] text-muted">
            {num(stats.sent)} of {num(stats.total)}
            {rate ? ` · ${num(rate)}/min` : ''}
            {running ? ' · pause anytime' : ''}
          </p>
          {stats.total === 0 ? (
            <p className="m-0 text-[13px] text-muted-2">
              No counters yet. They appear once the coordinator has claimed the recipient list.
            </p>
          ) : null}

          {/*
            A finished broadcast can be neither paused, resumed nor cancelled, so
            the row was three permanently disabled buttons and a caveat about a
            control that no longer applies. Both are hidden once it is terminal.
          */}
          {stoppable ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!running || pause.isPending}
                onClick={() => pause.mutate()}
              >
                <Pause aria-hidden="true" />
                Pause
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!paused || resume.isPending}
                onClick={() => resume.mutate()}
              >
                <Play aria-hidden="true" />
                Resume
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!stoppable}
                onClick={() => setConfirmCancel(true)}
              >
                <Ban aria-hidden="true" />
                Cancel
              </Button>
            </div>
          ) : null}
          {stoppable ? (
            <p className="m-0 text-[12.5px] text-muted-2">
              Pausing stops the coordinator minting new send tokens. Messages already handed to the
              provider are out of reach either way.
            </p>
          ) : null}
        </div>
      </PageSection>

      <PageSection
        title="Engagement"
        description="Every rate below names its own denominator, because opens over sent and opens over delivered are different numbers."
      >
        <MetricGrid min={160}>
          <Metric
            size="sm"
            value={ratio(stats.opened, stats.delivered)}
            label={`opened · ${num(stats.opened)} of ${num(stats.delivered)} delivered`}
          />
          <Metric
            size="sm"
            value={ratio(stats.clicked, stats.delivered)}
            label={`clicked · ${num(stats.clicked)} of ${num(stats.delivered)} delivered`}
          />
          <Metric
            size="sm"
            value={ratio(stats.bounced, stats.sent)}
            label={`bounced · ${num(stats.bounced)} of ${num(stats.sent)} sent`}
          />
          <Metric
            size="sm"
            value={ratio(stats.complained, stats.delivered)}
            label={`complained · ${num(stats.complained)} of ${num(stats.delivered)} delivered`}
          />
          <Metric
            size="sm"
            value={ratio(stats.unsubscribed, stats.delivered)}
            label={`unsubscribed · ${num(stats.unsubscribed)} of ${num(stats.delivered)} delivered`}
          />
        </MetricGrid>
        <p className="m-0 max-w-[70ch] text-[12.5px] text-muted-2">
          Opens here are raw: an Apple Mail Privacy Protection prefetch counts as one. The
          privacy-adjusted figure lives on the overview, where the bot and MPP classes are split out
          of both sides of the ratio.
        </p>
      </PageSection>

      {variants.length > 0 ? (
        <PageSection title="A/B test" description="What was configured, and what is known.">
          <div className="flex flex-col gap-3 rounded-tile border border-line-soft bg-card p-4">
            {variants.map((variant) => (
              <BarRow
                key={variant.key}
                layout="stacked"
                label={
                  <span>
                    <span className="font-mono text-[12px] text-muted-2">{variant.key}</span>{' '}
                    {variant.subject}
                    {variant.weight === leaderWeight ? (
                      <span className="ml-2 font-mono text-[11px] text-muted-2">largest share</span>
                    ) : null}
                  </span>
                }
                percent={weightTotal === 0 ? 0 : (variant.weight / weightTotal) * 100}
                value={`${variant.weight}%`}
                series={variant.weight === leaderWeight ? 'accent' : 'neutral'}
              />
            ))}

            <Callout variant="info" title="no winner has been chosen">
              <p className="m-0">
                The bars are the test allocation — the share of the cohort each variant was given —
                not a result. This broadcast reports no per-variant opens or clicks, so nothing here
                says which subject line won, and a variant that is ahead partway through a send is
                not a winner: early opens skew towards the fastest, most engaged readers.
              </p>
              <p className="m-0 mt-1.5">
                {current.holdout_percent
                  ? `${current.holdout_percent}% of the list is held back and gets the winning variant once one is declared on ${current.winner_metric ?? 'opens'}.`
                  : 'The holdout is 0%, so there is no population left to send a winner to — this test can only ever be a report.'}
              </p>
            </Callout>
          </div>
        </PageSection>
      ) : null}

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this broadcast"
        description="The remainder of the list will not be sent."
        confirmPhrase={current.name ?? current.id}
        confirmLabel="Cancel the send"
        pending={cancel.isPending}
        consequences={
          <>
            <p className="m-0">
              {num(stats.sent)} of {num(stats.total)} messages have already been handed to the
              provider and cannot be recalled.
            </p>
            <p className="m-0 mt-1.5">
              A canceled broadcast cannot be resumed. The remaining{' '}
              {num(Math.max(0, stats.total - stats.sent))} recipients get nothing.
            </p>
          </>
        }
        onConfirm={() => cancel.mutate()}
      />
    </div>
  )
}
