import { Audience } from '@mailysend/contracts'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  MonoChip,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { MoreHorizontal, Users } from 'lucide-react'
import { useId, useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import { type Column, DataTable } from '~/components/app/data-table.tsx'
import { num, relativeTime, shortDate } from '~/components/app/format.ts'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { EmptyState, QueryState } from '~/components/app/states.tsx'
import type { AudienceRecord } from '~/lib/api-client.ts'
import { request } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/audiences/')({
  head: () => appHead('Audiences'),
  component: Audiences,
})

function Audiences() {
  // Flat routing files nest: `audiences.$audienceId` is a child of this route, so this
  // component is also the outlet the detail screen renders into.
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()

  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<AudienceRecord | null>(null)
  const [deleting, setDeleting] = useState<AudienceRecord | null>(null)

  const audiences = useQuery({
    queryKey: qk.audiences(environment),
    queryFn: () => api.listAudiences({ limit: 100 }),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.audiences(environment) })

  const create = useMutation({
    mutationFn: (name: string) => api.createAudience({ name }),
    onSuccess: (audience) => {
      setCreating(false)
      void invalidate()
      toast.success(`Audience "${audience.name}" created`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      // The generated client has no `updateAudience` yet, and api-client.ts is
      // owned elsewhere; going through `request` keeps the same Zod parse and
      // the same scope headers rather than growing a second fetch path.
      request(`/audiences/${id}`, Audience, {
        method: 'PATCH',
        body: { name },
        scope: api.scope,
      }),
    onSuccess: (audience) => {
      setRenaming(null)
      void invalidate()
      toast.success(`Renamed to "${audience.name}"`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAudience(id),
    onSuccess: () => {
      setDeleting(null)
      void invalidate()
      toast.success('Audience deleted')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const columns: Column<AudienceRecord>[] = [
    {
      id: 'name',
      header: 'Name',
      sortBy: (row) => row.name.toLowerCase(),
      cell: (row) => (
        <Link
          to="/app/audiences/$audienceId"
          params={{ audienceId: row.id }}
          className="font-medium text-ink underline-offset-4 hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      id: 'contacts',
      header: 'Contacts',
      align: 'right',
      sortBy: (row) => row.contact_count ?? -1,
      cell: (row) =>
        row.contact_count === undefined ? (
          <span className="text-muted-2">not counted yet</span>
        ) : (
          <span className="font-mono text-[12.5px]">{num(row.contact_count)}</span>
        ),
    },
    {
      id: 'created',
      header: 'Created',
      sortBy: (row) => row.created_at,
      cell: (row) => (
        <span title={row.created_at} className="text-muted">
          {shortDate(row.created_at)} · {relativeTime(row.created_at)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Row actions',
      srOnlyHeader: true,
      align: 'right',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={`Actions for ${row.name}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenaming(row)}>Rename</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDeleting(row)}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Audiences"
        title="Who you are allowed to email"
        description="An audience is a list of contacts with its own subscription state. Segments are computed over one audience, never across several."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            New audience
          </Button>
        }
      />

      <QueryState
        isLoading={audiences.isLoading}
        error={audiences.error}
        data={audiences.data?.data}
        subject="your audiences"
        onRetry={() => void audiences.refetch()}
        empty={
          <EmptyState
            icon={Users}
            title="No audiences yet"
            description="Contacts live inside an audience, so this is the first thing to make. You can import a CSV into it straight afterwards."
            action={{ label: 'Create an audience', onClick: () => setCreating(true) }}
          />
        }
      >
        {(rows) => (
          <DataTable
            rows={rows}
            columns={columns}
            rowId={(row) => row.id}
            caption="Audiences in this workspace"
            defaultSort={{ columnId: 'created', direction: 'desc' }}
          />
        )}
      </QueryState>

      <NameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New audience"
        description="Name it after where the addresses come from — “Product newsletter”, “Trial signups” — so a broadcast picker is unambiguous a year from now."
        confirmLabel="Create audience"
        pending={create.isPending}
        onSubmit={(name) => create.mutate(name)}
      />

      <NameDialog
        key={renaming?.id ?? 'rename'}
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null)
        }}
        title="Rename audience"
        description="The name is a label only. Contacts, segments and scheduled broadcasts are unaffected."
        confirmLabel="Save name"
        initialValue={renaming?.name ?? ''}
        pending={rename.isPending}
        onSubmit={(name) => {
          if (renaming) rename.mutate({ id: renaming.id, name })
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={`Delete ${deleting?.name ?? 'audience'}`}
        description="The audience and everything computed from it goes away."
        confirmPhrase={deleting?.name}
        confirmLabel="Delete audience"
        consequences={
          <>
            <p className="m-0">
              {deleting?.contact_count === undefined
                ? 'Every contact in this audience'
                : `All ${num(deleting.contact_count)} contacts in this audience`}{' '}
              are deleted with it, along with their opens, clicks and merge data.
            </p>
            <p className="m-0 mt-1.5">
              Segments over this audience stop resolving, and any broadcast still pointing at it
              will fail to send. Suppressions are workspace-wide and are{' '}
              <MonoChip size="sm">not</MonoChip> removed.
            </p>
          </>
        }
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
        }}
      />
    </>
  )
}

const NameDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  initialValue = '',
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  initialValue?: string
  pending: boolean
  onSubmit: (name: string) => void
}) => {
  const [name, setName] = useState(initialValue)
  const inputId = useId()
  const trimmed = name.trim()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setName(initialValue)
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (trimmed) onSubmit(trimmed)
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="my-4 flex flex-col gap-2">
            <Label htmlFor={inputId}>Audience name</Label>
            <Input
              id={inputId}
              value={name}
              maxLength={120}
              autoComplete="off"
              placeholder="Product newsletter"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={trimmed.length === 0 || pending}>
              {pending ? 'Working…' : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
