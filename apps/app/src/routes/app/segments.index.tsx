import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  MonoChip,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Filter } from 'lucide-react'
import { useId, useState } from 'react'
import { type Column, DataTable } from '~/components/app/data-table.tsx'
import { num, relativeTime } from '~/components/app/format.ts'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { SegmentEditor } from '~/components/app/segment-editor.tsx'
import { EmptyState, QueryState } from '~/components/app/states.tsx'
import type { SegmentRecord } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/segments/')({
  head: () => appHead('Segments'),
  component: Segments,
})

const truncate = (value: string, max = 52): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`

function Segments() {
  // Flat routing files nest: `segments.$segmentId` is a child of this route, so this
  // component is also the outlet the detail screen renders into.
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: Route.fullPath })
  const [creating, setCreating] = useState(false)

  const segments = useQuery({
    queryKey: qk.segments(environment),
    queryFn: () => api.listSegments({ limit: 100 }),
  })

  const audiences = useQuery({
    queryKey: qk.audiences(environment),
    queryFn: () => api.listAudiences({ limit: 100 }),
  })

  const audienceName = (id: string): string =>
    audiences.data?.data.find((audience) => audience.id === id)?.name ?? id

  const create = useMutation({
    mutationFn: (body: { name: string; audience_id: string; expression: string }) =>
      api.createSegment(body),
    onSuccess: (segment) => {
      setCreating(false)
      void queryClient.invalidateQueries({ queryKey: qk.segments(environment) })
      toast.success(`Segment "${segment.name}" created`)
      void navigate({ to: '/app/segments/$segmentId', params: { segmentId: segment.id } })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const columns: Column<SegmentRecord>[] = [
    {
      id: 'name',
      header: 'Name',
      sortBy: (row) => row.name.toLowerCase(),
      cell: (row) => (
        <Link
          to="/app/segments/$segmentId"
          params={{ segmentId: row.id }}
          className="font-medium text-ink underline-offset-4 hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      id: 'audience',
      header: 'Audience',
      sortBy: (row) => audienceName(row.audience_id).toLowerCase(),
      cell: (row) => (
        <Link
          to="/app/audiences/$audienceId"
          params={{ audienceId: row.audience_id }}
          className="text-muted underline-offset-4 hover:underline"
        >
          {audienceName(row.audience_id)}
        </Link>
      ),
    },
    {
      id: 'expression',
      header: 'Expression',
      cell: (row) => (
        <MonoChip size="sm" title={row.expression}>
          {truncate(row.expression)}
        </MonoChip>
      ),
    },
    {
      id: 'members',
      header: 'Members',
      align: 'right',
      sortBy: (row) => row.member_count ?? -1,
      cell: (row) =>
        row.member_count === undefined ? (
          <span className="text-muted-2">not computed</span>
        ) : (
          <span className="font-mono text-[12.5px]">{num(row.member_count)}</span>
        ),
    },
    {
      id: 'computed',
      header: 'Computed',
      sortBy: (row) => row.computed_at ?? '',
      cell: (row) =>
        row.computed_at ? (
          <span title={row.computed_at} className="text-muted">
            {relativeTime(row.computed_at)}
          </span>
        ) : (
          <span className="text-muted-2">never</span>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Segments"
        title="Rules, not lists"
        description="A segment is an expression evaluated against one audience and recomputed as contacts open, click and unsubscribe. The membership a broadcast sends to is the one at send time."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            New segment
          </Button>
        }
      />

      <QueryState
        isLoading={segments.isLoading}
        error={segments.error}
        data={segments.data?.data}
        subject="your segments"
        onRetry={() => void segments.refetch()}
        empty={
          <EmptyState
            icon={Filter}
            title="No segments yet"
            description="Segments narrow an audience down to the people a message is actually for — everyone who opened in the last 30 days but has not clicked, say."
            action={{ label: 'Create a segment', onClick: () => setCreating(true) }}
            secondaryAction={{ label: 'See your audiences', href: '/app/audiences' }}
          />
        }
      >
        {(rows) => (
          <DataTable
            rows={rows}
            columns={columns}
            rowId={(row) => row.id}
            caption="Segments in this workspace"
            defaultSort={{ columnId: 'name', direction: 'asc' }}
          />
        )}
      </QueryState>

      <NewSegmentDialog
        open={creating}
        onOpenChange={setCreating}
        audiences={(audiences.data?.data ?? []).map((audience) => ({
          id: audience.id,
          name: audience.name,
        }))}
        pending={create.isPending}
        onSubmit={(body) => create.mutate(body)}
      />
    </>
  )
}

const NewSegmentDialog = ({
  open,
  onOpenChange,
  audiences,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  audiences: { id: string; name: string }[]
  pending: boolean
  onSubmit: (body: { name: string; audience_id: string; expression: string }) => void
}) => {
  const [name, setName] = useState('')
  const [audienceId, setAudienceId] = useState('')
  const [expression, setExpression] = useState('')
  const nameId = useId()

  const ready = name.trim() !== '' && audienceId !== '' && expression.trim() !== ''

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName('')
          setAudienceId('')
          setExpression('')
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-[760px]">
        <DialogHeader>
          <DialogTitle>New segment</DialogTitle>
          <DialogDescription>
            Pick the audience first: a segment is computed inside one audience and cannot span
            several.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={nameId}>Segment name</Label>
              <Input
                id={nameId}
                value={name}
                maxLength={120}
                placeholder="Opened, never clicked"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="segment-audience">Audience</Label>
              <Select value={audienceId} onValueChange={setAudienceId}>
                <SelectTrigger id="segment-audience" aria-label="Audience for this segment">
                  <SelectValue placeholder="Choose an audience" />
                </SelectTrigger>
                <SelectContent>
                  {audiences.map((audience) => (
                    <SelectItem key={audience.id} value={audience.id}>
                      {audience.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <SegmentEditor
            audienceId={audienceId}
            audienceName={audiences.find((audience) => audience.id === audienceId)?.name}
            expression={expression}
            onChange={setExpression}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!ready || pending}
            onClick={() =>
              onSubmit({
                name: name.trim(),
                audience_id: audienceId,
                expression: expression.trim(),
              })
            }
          >
            {pending ? 'Creating…' : 'Create segment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
