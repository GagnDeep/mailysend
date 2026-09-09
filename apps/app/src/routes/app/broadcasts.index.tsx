import { Button, StatusBadge } from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Send } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import type { Column } from '~/components/app/data-table.tsx'
import { CursorPager, DataTable } from '~/components/app/data-table.tsx'
import { dateTime, num } from '~/components/app/format.ts'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import type { BroadcastRecord } from '~/lib/api-client.ts'
import { qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/broadcasts/')({
  head: () => appHead('Broadcasts'),
  component: Broadcasts,
})

const PAGE_SIZE = 20

/** Sorting needs a number; a missing time sorts last rather than as 1970. */
const timeKey = (broadcast: BroadcastRecord): number => {
  const iso = broadcast.sent_at ?? broadcast.scheduled_at
  if (!iso) return Number.POSITIVE_INFINITY
  const value = new Date(iso).getTime()
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value
}

function Broadcasts() {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [cursors, setCursors] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)

  const after = cursors[cursors.length - 1]

  const broadcasts = useQuery({
    queryKey: qk.broadcasts(environment),
    queryFn: () => api.listBroadcasts({ limit: PAGE_SIZE, after }),
  })

  const audiences = useQuery({
    queryKey: qk.audiences(environment),
    queryFn: () => api.listAudiences({ limit: 100 }),
  })

  const rows = broadcasts.data?.data ?? []
  const audienceName = (id: string | null): string => {
    if (!id) return '—'
    return audiences.data?.data.find((audience) => audience.id === id)?.name ?? id
  }

  const selectedRows = rows.filter((row) => selected.includes(row.id))
  const allDrafts = selectedRows.length > 0 && selectedRows.every((row) => row.status === 'draft')

  const deleteDrafts = useMutation({
    mutationFn: async () => {
      for (const row of selectedRows) await api.deleteBroadcast(row.id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.broadcasts(environment) })
      setSelected([])
      setConfirmDelete(false)
    },
  })

  const columns: Column<BroadcastRecord>[] = [
    {
      id: 'name',
      header: 'Name',
      sortBy: (row) => (row.name ?? row.id).toLowerCase(),
      cell: (row) => (
        <span className="font-medium">
          {row.name ?? <span className="text-muted-2">Untitled</span>}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortBy: (row) => row.status,
      cell: (row) => <StatusBadge status={row.status} size="sm" pulse={row.status === 'sending'} />,
    },
    {
      id: 'audience',
      header: 'Audience',
      sortBy: (row) => audienceName(row.audience_id).toLowerCase(),
      cell: (row) => <span className="text-muted">{audienceName(row.audience_id)}</span>,
    },
    {
      id: 'when',
      header: 'Sent / scheduled',
      sortBy: timeKey,
      cell: (row) =>
        row.sent_at ? (
          <span className="font-mono text-[12px]">{dateTime(row.sent_at)}</span>
        ) : row.scheduled_at ? (
          <span className="font-mono text-[12px] text-muted">{dateTime(row.scheduled_at)}</span>
        ) : (
          <span className="text-muted-2">not scheduled</span>
        ),
    },
    {
      id: 'stats',
      header: 'Sent / delivered / opened / clicked',
      align: 'right',
      sortBy: (row) => row.stats?.sent ?? -1,
      cell: (row) =>
        row.stats ? (
          <span className="ms-num font-mono text-[12px] text-muted">
            {num(row.stats.sent)} / {num(row.stats.delivered)} / {num(row.stats.opened)} /{' '}
            {num(row.stats.clicked)}
          </span>
        ) : (
          <span className="font-mono text-[12px] text-muted-2">—</span>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Broadcasts"
        title="One message, one list, one send"
        description="A broadcast is claimed by the coordinator once, so a send that is paused or canceled stops minting tokens rather than racing itself."
        actions={
          <Button asChild size="sm">
            <Link to="/app/broadcasts/new">
              <Send aria-hidden="true" />
              New broadcast
            </Link>
          </Button>
        }
      />

      {broadcasts.isLoading ? (
        <TableSkeleton rows={6} columns={5} />
      ) : broadcasts.error ? (
        <ErrorState
          error={broadcasts.error}
          subject="the broadcast list"
          onRetry={() => void broadcasts.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Send}
          title="No broadcasts yet"
          description="A broadcast goes to an audience or a segment of one, at a rate you set. Drafts are free to keep around."
          action={{ label: 'New broadcast', href: '/app/broadcasts/new' }}
        />
      ) : (
        <>
          <DataTable
            rows={rows}
            columns={columns}
            rowId={(row) => row.id}
            caption="Broadcasts in this workspace and environment"
            defaultSort={{ columnId: 'when', direction: 'desc' }}
            onRowClick={(row) =>
              void navigate({ to: '/app/broadcasts/$broadcastId', params: { broadcastId: row.id } })
            }
            selection={{
              selected,
              onChange: setSelected,
              actions: () => (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!allDrafts}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete drafts
                  </Button>
                  {!allDrafts ? (
                    <span className="text-[12.5px] text-muted">
                      Only drafts can be deleted. Deselect anything that has been sent, scheduled or
                      canceled.
                    </span>
                  ) : null}
                </>
              ),
            }}
          />
          <CursorPager
            count={rows.length}
            hasMore={broadcasts.data?.has_more ?? false}
            hasPrevious={cursors.length > 0}
            onNext={() => {
              const next = broadcasts.data?.next_cursor
              if (next) setCursors((current) => [...current, next])
            }}
            onPrevious={() => setCursors((current) => current.slice(0, -1))}
          />
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${selectedRows.length} draft${selectedRows.length === 1 ? '' : 's'}`}
        description="Drafts are deleted one at a time; if one fails the rest still go."
        confirmPhrase="delete drafts"
        confirmLabel="Delete them"
        pending={deleteDrafts.isPending}
        consequences={
          <p className="m-0">
            The copy, audience, schedule and any A/B variants on{' '}
            {selectedRows.length === 1 ? 'this draft' : 'these drafts'} are gone. Nothing that has
            been sent is affected.
          </p>
        }
        onConfirm={() => deleteDrafts.mutate()}
      />
    </>
  )
}
