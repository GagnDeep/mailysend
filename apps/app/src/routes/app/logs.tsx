import type { DateRange } from '@mailysend/ui'
import { Button, DateRangePicker, Input, LogRow } from '@mailysend/ui'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { KeyRound, Search, SearchX } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { CursorPager } from '~/components/app/data-table.tsx'
import type { AppliedFilter, FilterDefinition } from '~/components/app/filters.tsx'
import { FilterBar } from '~/components/app/filters.tsx'
import { clockTime } from '~/components/app/format.ts'
import { LogDrawer } from '~/components/app/log-drawer.tsx'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import { qk } from '~/lib/query.ts'
import { toBadgeStatus } from '~/routes/app/index.tsx'
import { appHead } from '~/seo'

/**
 * The message log.
 *
 * Every filter lives in the URL rather than in component state, because the
 * thing a reader most wants to do with a narrowed log — "look at this, it's
 * bouncing" — is paste it to someone else.
 */

interface LogsSearch {
  status?: string
  tag?: string
  domain_id?: string
  provider?: string
  q?: string
  from?: string
  to?: string
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

export const Route = createFileRoute('/app/logs')({
  head: () => appHead('Logs'),
  validateSearch: (search: Record<string, unknown>): LogsSearch => ({
    status: text(search.status),
    tag: text(search.tag),
    domain_id: text(search.domain_id),
    provider: text(search.provider),
    q: text(search.q),
    from: text(search.from),
    to: text(search.to),
  }),
  component: Logs,
})

const PAGE_SIZE = 50

const STATUS_OPTIONS = [
  'queued',
  'scheduled',
  'sending',
  'sent',
  'delivered',
  'delivery_delayed',
  'bounced',
  'complained',
  'failed',
  'canceled',
].map((value) => ({ value, label: value.replace(/_/g, ' ') }))

const PROVIDER_OPTIONS = ['cloudflare', 'ses', 'resend', 'smtp'].map((value) => ({
  value,
  label: value,
}))

/** Local calendar day, not UTC: `toISOString()` would move the boundary for most readers. */
const isoDay = (date: Date): string => {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const parseDay = (value: string | undefined): Date | undefined => {
  if (!value) return undefined
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const FILTER_IDS = ['status', 'provider', 'tag', 'domain_id'] as const

function Logs() {
  const api = useApi()
  const environment = useEnvironment()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const [draftQuery, setDraftQuery] = useState(search.q ?? '')
  const searchInputId = useId()

  // A cursor is only meaningful for the filter set it was issued against, so
  // the stack carries the filters it belongs to and is discarded the moment
  // they change, rather than paging into a window that no longer exists.
  const filterKey = JSON.stringify(search)
  const [walk, setWalk] = useState<{ key: string; stack: string[] }>({
    key: filterKey,
    stack: [],
  })
  const cursors = walk.key === filterKey ? walk.stack : []
  const setCursors = (next: (stack: string[]) => string[]) =>
    setWalk({ key: filterKey, stack: next(cursors) })

  useEffect(() => {
    if (draftQuery === (search.q ?? '')) return
    const id = setTimeout(() => {
      void navigate({
        search: (previous: LogsSearch) => ({ ...previous, q: draftQuery.trim() || undefined }),
        replace: true,
      })
    }, 250)
    return () => clearTimeout(id)
  }, [draftQuery, search.q, navigate])

  const domains = useQuery({
    queryKey: qk.domains(environment),
    queryFn: () => api.listDomains({ limit: 100 }),
    staleTime: 5 * 60_000,
  })

  // The only honest source of tag options: the tags that actually carry traffic.
  const tags = useQuery({
    queryKey: qk.analytics(environment, { facet: 'tags' }),
    queryFn: () => api.analytics({ granularity: 'day' }),
    staleTime: 5 * 60_000,
  })

  const after = cursors[cursors.length - 1]

  const filtersApplied = FILTER_IDS.some((id) => search[id] !== undefined)
  const anyNarrowing =
    filtersApplied || search.q !== undefined || search.from !== undefined || search.to !== undefined

  const emails = useQuery({
    queryKey: qk.emails(environment, { ...search, after }),
    queryFn: () =>
      api.listEmails({
        limit: PAGE_SIZE,
        after,
        status: search.status,
        tag: search.tag,
        domain_id: search.domain_id,
        provider: search.provider,
        q: search.q,
        from: search.from,
        to: search.to,
      }),
    // Live only while the reader is watching the whole stream. Refetching under
    // someone who is inspecting one filtered slice moves rows out from under them.
    refetchInterval: anyNarrowing ? false : 15_000,
  })

  const definitions: FilterDefinition[] = useMemo(
    () => [
      { id: 'status', label: 'status', options: STATUS_OPTIONS },
      { id: 'provider', label: 'provider', options: PROVIDER_OPTIONS },
      {
        id: 'tag',
        label: 'tag',
        options: (tags.data?.by_tag ?? []).map((row) => ({ value: row.key, label: row.key })),
      },
      {
        id: 'domain_id',
        label: 'domain',
        options: (domains.data?.data ?? []).map((domain) => ({
          value: domain.id,
          label: domain.name,
        })),
      },
    ],
    [tags.data, domains.data],
  )

  const applied: AppliedFilter[] = FILTER_IDS.flatMap((id) => {
    const value = search[id]
    return value ? [{ id, value }] : []
  })

  const onFiltersChange = (next: AppliedFilter[]) => {
    void navigate({
      search: (previous: LogsSearch) => ({
        ...previous,
        status: next.find((filter) => filter.id === 'status')?.value,
        provider: next.find((filter) => filter.id === 'provider')?.value,
        tag: next.find((filter) => filter.id === 'tag')?.value,
        domain_id: next.find((filter) => filter.id === 'domain_id')?.value,
      }),
    })
  }

  const clearEverything = () => {
    setDraftQuery('')
    void navigate({ search: {} })
  }

  const range: DateRange | undefined = search.from
    ? { from: parseDay(search.from), to: parseDay(search.to) }
    : undefined

  const rows = emails.data?.data ?? []
  const nextCursor = emails.data?.next_cursor ?? undefined

  return (
    <>
      <PageHeader
        eyebrow="Logs"
        title="Every message, and what happened to it"
        description="Filters live in the URL, so a narrowed log is a link you can send to someone else. The list refreshes every 15 seconds while it is unfiltered."
        toolbar={
          <FilterBar
            definitions={definitions}
            applied={applied}
            onChange={onFiltersChange}
            extra={
              <>
                <div className="relative flex min-w-[240px] items-center">
                  <label htmlFor={searchInputId} className="sr-only">
                    Search recipient or subject
                  </label>
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 size-4 text-muted-2"
                  />
                  <Input
                    id={searchInputId}
                    type="search"
                    value={draftQuery}
                    placeholder="recipient or subject"
                    className="pl-9 font-mono text-[12.5px]"
                    onChange={(event) => setDraftQuery(event.target.value)}
                  />
                </div>
                <DateRangePicker
                  value={range}
                  placeholder="Any date"
                  onValueChange={(next) => {
                    void navigate({
                      search: (previous: LogsSearch) => ({
                        ...previous,
                        from: next?.from ? isoDay(next.from) : undefined,
                        to: next?.to ? isoDay(next.to) : undefined,
                      }),
                    })
                  }}
                />
              </>
            }
          />
        }
      />

      {emails.isLoading ? (
        <TableSkeleton rows={8} columns={4} />
      ) : emails.error ? (
        <ErrorState
          error={emails.error}
          subject="the message log"
          onRetry={() => void emails.refetch()}
        />
      ) : rows.length === 0 ? (
        anyNarrowing ? (
          <EmptyState
            icon={SearchX}
            title="No messages match these filters"
            description="Nothing in this workspace and environment matches the current filter set and date range."
            action={{ label: 'Clear filters', onClick: clearEverything }}
          />
        ) : (
          <EmptyState
            icon={KeyRound}
            title="Nothing has been sent yet"
            description="Messages appear here the moment the API accepts them, so the first step is a key to send with."
            action={{ label: 'Create an API key', href: '/app/api-keys' }}
            secondaryAction={{ label: 'Read the quickstart', href: '/docs#quickstart' }}
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-tile border border-line-soft bg-card">
            {rows.map((email) => (
              <LogRow
                key={email.id}
                showBadge
                status={toBadgeStatus(email.last_event)}
                timestamp={clockTime(email.created_at)}
                recipient={email.to[0] ?? '—'}
                subject={email.subject}
                details={
                  <div className="flex flex-col gap-3">
                    <LogDrawer emailId={email.id} />
                    <Button asChild variant="link" size="sm" className="self-start">
                      <Link to="/app/emails/$emailId" params={{ emailId: email.id }}>
                        Open the full message →
                      </Link>
                    </Button>
                  </div>
                }
              />
            ))}
          </div>

          <CursorPager
            count={rows.length}
            hasMore={Boolean(emails.data?.has_more && nextCursor)}
            hasPrevious={cursors.length > 0}
            onNext={() => {
              if (nextCursor) setCursors((stack) => [...stack, nextCursor])
            }}
            onPrevious={() => setCursors((stack) => stack.slice(0, -1))}
          />
        </div>
      )}
    </>
  )
}
