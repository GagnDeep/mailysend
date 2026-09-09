import type { DateRange } from '@mailysend/ui'
import {
  BarRow,
  Button,
  DateRangePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatTile,
  ToggleGroup,
  ToggleGroupItem,
} from '@mailysend/ui'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { BarChart3, Target } from 'lucide-react'
import { BreakdownChart, EngagementSplitChart, TimeseriesChart } from '~/components/app/charts.tsx'
import { clockTime, num, ratio, shortDate } from '~/components/app/format.ts'
import { PlacementCard, PrivacyAdjustedOpenRate } from '~/components/app/honesty.tsx'
import { PageHeader, PageSection } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { CardsSkeleton, EmptyState, ErrorState } from '~/components/app/states.tsx'
import type { AnalyticsParams, BreakdownRecord } from '~/lib/api-client.ts'
import { qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

/**
 * Analytics.
 *
 * Every control writes to the URL, because the reason someone narrows this
 * screen is almost always to show the narrowed version to somebody else. The
 * audience class is one of those controls and it defaults to `human`: the
 * product keeps every classified hit, and choosing which population you are
 * looking at is a decision the reader gets to see and change.
 */

const GRANULARITIES = ['hour', 'day', 'week', 'month'] as const
type Granularity = (typeof GRANULARITIES)[number]

const AUDIENCE_CLASSES = ['human', 'all', 'mpp', 'proxy_prefetch', 'scanner', 'bot'] as const
type AudienceFilter = (typeof AUDIENCE_CLASSES)[number]

const AUDIENCE_LABEL: Record<AudienceFilter, string> = {
  human: 'human',
  all: 'all',
  mpp: 'apple mpp',
  proxy_prefetch: 'gmail proxy',
  scanner: 'scanner',
  bot: 'bot',
}

interface AnalyticsSearch {
  from?: string
  to?: string
  granularity: Granularity
  domain_id?: string
  tag?: string
  audience_class: AudienceFilter
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

export const Route = createFileRoute('/app/analytics')({
  head: () => appHead('Analytics'),
  validateSearch: (search: Record<string, unknown>): AnalyticsSearch => ({
    from: text(search.from),
    to: text(search.to),
    granularity: oneOf(GRANULARITIES, search.granularity, 'day'),
    domain_id: text(search.domain_id),
    tag: text(search.tag),
    audience_class: oneOf(AUDIENCE_CLASSES, search.audience_class, 'human'),
  }),
  component: Analytics,
})

/** Local calendar day, not UTC: `toISOString()` moves the boundary for most readers. */
const isoDay = (date: Date): string => {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const parseDay = (value: string | undefined): Date | undefined => {
  if (!value) return undefined
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

const ALL = '__all__'

const share = (rows: BreakdownRecord[], row: BreakdownRecord): number => {
  const peak = Math.max(...rows.map((candidate) => candidate.delivered), 1)
  return (row.delivered / peak) * 100
}

function Analytics() {
  const api = useApi()
  const environment = useEnvironment()
  const search: AnalyticsSearch = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const setSearch = (patch: Partial<AnalyticsSearch>) => {
    void navigate({ search: (previous: AnalyticsSearch) => ({ ...previous, ...patch }) })
  }

  const params: AnalyticsParams = {
    from: search.from,
    to: search.to,
    granularity: search.granularity,
    domain_id: search.domain_id,
    tag: search.tag,
    audience_class: search.audience_class,
  }

  const overview = useQuery({
    queryKey: qk.analytics(environment, params as Record<string, unknown>),
    queryFn: () => api.analytics(params),
  })

  const placement = useQuery({
    queryKey: qk.placement(environment, { domain_id: search.domain_id }),
    queryFn: () => api.placement({ domain_id: search.domain_id }),
  })

  const domains = useQuery({
    queryKey: qk.domains(environment),
    queryFn: () => api.listDomains({ limit: 100 }),
  })

  // The tag list has to come from a request that is not itself filtered by a
  // tag, or picking one would collapse the picker to the tag already chosen.
  const facets = useQuery({
    queryKey: qk.analytics(environment, {
      from: search.from,
      to: search.to,
      granularity: search.granularity,
      facets: true,
    }),
    queryFn: () =>
      api.analytics({ from: search.from, to: search.to, granularity: search.granularity }),
  })

  const totals = overview.data?.totals
  const range: DateRange | undefined = search.from
    ? { from: parseDay(search.from), to: parseDay(search.to) }
    : undefined

  const formatBucket = search.granularity === 'hour' ? clockTime : shortDate

  const tagOptions = Array.from(
    new Set([
      ...(facets.data?.by_tag ?? []).map((row) => row.key),
      ...(search.tag ? [search.tag] : []),
    ]),
  )

  const placementFigures = placement.data?.data ?? overview.data?.placement
  const placementFailed = placement.error && !overview.data?.placement

  return (
    <>
      <PageHeader
        eyebrow="Analytics"
        title="Not just sent. Landed."
        description="Every figure below is for this workspace and this environment, over the range and audience you pick here. The URL carries all of it, so this view is shareable as-is."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to="/app/placement">
              <Target aria-hidden="true" />
              Placement tests
            </Link>
          </Button>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2.5">
            <DateRangePicker
              value={range}
              placeholder="All time"
              onValueChange={(next) =>
                setSearch({
                  from: next?.from ? isoDay(next.from) : undefined,
                  to: next?.to ? isoDay(next.to) : undefined,
                })
              }
            />

            <Select
              value={search.granularity}
              onValueChange={(value) => setSearch({ granularity: value as Granularity })}
            >
              <SelectTrigger
                aria-label="Bucket size"
                className="h-9 w-auto min-w-32 font-mono text-[13px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRANULARITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    per {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={search.domain_id ?? ALL}
              onValueChange={(value) => setSearch({ domain_id: value === ALL ? undefined : value })}
            >
              <SelectTrigger
                aria-label="Sending domain"
                className="h-9 w-auto min-w-40 font-mono text-[13px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>all domains</SelectItem>
                {(domains.data?.data ?? []).map((domain) => (
                  <SelectItem key={domain.id} value={domain.id}>
                    {domain.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={search.tag ?? ALL}
              onValueChange={(value) => setSearch({ tag: value === ALL ? undefined : value })}
            >
              <SelectTrigger aria-label="Tag" className="h-9 w-auto min-w-36 font-mono text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>all tags</SelectItem>
                {tagOptions.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <ToggleGroup
              type="single"
              aria-label="Audience class"
              value={search.audience_class}
              onValueChange={(value) => {
                if (value) setSearch({ audience_class: value as AudienceFilter })
              }}
              className="ml-auto"
            >
              {AUDIENCE_CLASSES.map((value) => (
                <ToggleGroupItem key={value} value={value}>
                  {AUDIENCE_LABEL[value]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        }
      />

      <PageSection
        title="Totals"
        description={`Counted over the selected range, for the ${AUDIENCE_LABEL[search.audience_class]} audience.`}
      >
        {overview.isLoading ? (
          <CardsSkeleton count={6} />
        ) : overview.error ? (
          <ErrorState
            error={overview.error}
            subject="the totals"
            onRetry={() => void overview.refetch()}
          />
        ) : !totals ? (
          <EmptyState
            icon={BarChart3}
            title="Nothing to count yet"
            description="No messages match this range, domain and tag. Widen the range or send something first."
            action={{ label: 'Open the logs', href: '/app/logs' }}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-[3fr_1fr]">
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
            >
              <StatTile label="Sent" value={num(totals.sent)} />
              <StatTile
                label="Delivered"
                value={ratio(totals.delivered, totals.sent)}
                delta={`${num(totals.delivered)} accepted`}
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
                delta={ratio(totals.complained, totals.delivered)}
                intent={totals.complained > 0 ? 'negative' : 'neutral'}
              />
              <StatTile
                label="Opened"
                value={num(totals.opened)}
                delta={ratio(totals.opened, totals.delivered)}
              />
              <StatTile
                label="Clicked"
                value={num(totals.clicked)}
                delta={ratio(totals.clicked, totals.delivered)}
              />
              <StatTile
                label="Unsubscribed"
                value={num(totals.unsubscribed)}
                delta={ratio(totals.unsubscribed, totals.delivered)}
              />
            </div>
            <PrivacyAdjustedOpenRate
              humanOpens={totals.human_opens}
              humanDelivered={totals.human_delivered}
              rawOpens={totals.opened}
              delivered={totals.delivered}
            />
          </div>
        )}
      </PageSection>

      <PageSection title="Over time">
        {overview.isLoading ? (
          <CardsSkeleton count={1} />
        ) : overview.error ? (
          <ErrorState
            error={overview.error}
            subject="the timeseries"
            onRetry={() => void overview.refetch()}
          />
        ) : (
          <TimeseriesChart
            title={`sent · delivered · opened · clicked, per ${search.granularity}`}
            points={overview.data?.timeseries ?? []}
            formatBucket={formatBucket}
          />
        )}
      </PageSection>

      <PageSection
        title="Where it went"
        description="Delivered messages grouped by receiving domain and by the tags you set at send time."
      >
        {overview.isLoading ? (
          <CardsSkeleton count={2} />
        ) : overview.error ? (
          <ErrorState
            error={overview.error}
            subject="the breakdowns"
            onRetry={() => void overview.refetch()}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <BreakdownChart title="by receiving domain" rows={overview.data?.by_domain ?? []} />
              <BreakdownList rows={overview.data?.by_domain ?? []} label="domain" />
            </div>
            <div className="flex flex-col gap-3">
              <BreakdownChart title="by tag" rows={overview.data?.by_tag ?? []} />
              <BreakdownList rows={overview.data?.by_tag ?? []} label="tag" />
            </div>
          </div>
        )}
      </PageSection>

      <PageSection
        title="Engagement split"
        description="Who or what actually generated each open and click."
      >
        {overview.isLoading ? (
          <CardsSkeleton count={1} />
        ) : overview.error ? (
          <ErrorState
            error={overview.error}
            subject="the engagement split"
            onRetry={() => void overview.refetch()}
          />
        ) : (
          <>
            <EngagementSplitChart
              title="opens and clicks by audience class"
              rows={overview.data?.engagement ?? []}
            />
            <p className="m-0 max-w-[80ch] text-[14px] leading-relaxed text-muted">
              Apple Mail Privacy Protection prefetches every tracking pixel whether or not anyone
              opened the message, Gmail's image proxy warms it within seconds of delivery, and
              security scanners click every link in the body to check it. None of that is a person.
              Nothing here is discarded — every hit is stored with the class it was given at the
              edge — and the default view is <code className="font-mono text-[13px]">human</code>{' '}
              for exactly that reason.
            </p>
          </>
        )}
      </PageSection>

      <PageSection
        title="Inbox placement"
        description="Per receiving provider, with the provenance of each number attached to it."
        action={
          <Button asChild variant="link" size="sm">
            <Link to="/app/placement">Run a seed test →</Link>
          </Button>
        }
      >
        <p className="m-0 max-w-[80ch] text-[14px] leading-relaxed text-muted">
          An SMTP <code className="font-mono text-[13px]">250</code> means the receiving MTA
          accepted the bytes, not that anyone will see them. So every figure below names where it
          came from, and anything inferred from delivery events alone is labelled an estimate rather
          than dressed up as a measurement. A seed-list test is the only genuinely measured figure.
        </p>
        {placement.isLoading && overview.isLoading ? (
          <CardsSkeleton count={4} />
        ) : placementFailed ? (
          <ErrorState
            error={placement.error}
            subject="inbox placement"
            onRetry={() => void placement.refetch()}
          />
        ) : !placementFigures || placementFigures.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No placement figures yet"
            description="Placement is measured, not derived. Deliver to a seed list and we can read where each message landed."
            action={{ label: 'Run your first placement test', href: '/app/placement' }}
          />
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
          >
            {placementFigures.map((figure) => (
              <PlacementCard key={`${figure.provider}-${figure.source}`} figure={figure} />
            ))}
          </div>
        )}
      </PageSection>
    </>
  )
}

/** The chart is decorative; this list is the same numbers as readable rows. */
const BreakdownList = ({ rows, label }: { rows: BreakdownRecord[]; label: string }) => {
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-2 rounded-tile border border-line-soft bg-card p-4">
      <span className="ms-eyebrow text-[10.5px] text-muted-2">delivered per {label}</span>
      {rows.map((row) => (
        <BarRow
          key={row.key}
          label={row.key}
          percent={share(rows, row)}
          value={num(row.delivered)}
          series="ink"
          labelWidth={132}
        />
      ))}
    </div>
  )
}
