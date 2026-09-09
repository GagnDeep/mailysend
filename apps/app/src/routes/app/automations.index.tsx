import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MonoChip,
  StatusBadge,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Copy, MoreHorizontal, Pause, Play, Trash2, Workflow } from 'lucide-react'
import { useState } from 'react'
import { describeTrigger } from '~/components/app/automation-builder.tsx'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import type { Column } from '~/components/app/data-table.tsx'
import { DataTable } from '~/components/app/data-table.tsx'
import { num, shortDate } from '~/components/app/format.ts'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { EmptyState, QueryState } from '~/components/app/states.tsx'
import type { AutomationRecord, List } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/automations/')({
  head: () => appHead('Automations'),
  component: Automations,
})

const MODE_LABEL: Record<AutomationRecord['mode'], string> = {
  cohort: 'cohort',
  instance: 'instance',
}

function Automations() {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: Route.fullPath })
  // The detail route is a child of this one, so the list stands aside for it.
  const [pendingDelete, setPendingDelete] = useState<AutomationRecord | null>(null)

  const automations = useQuery({
    queryKey: qk.automations(environment),
    queryFn: () => api.listAutomations({ limit: 100 }),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.automations(environment) })

  /**
   * Optimistic because the server's answer is a boolean it confirms in the same
   * round trip, and because the row is the only thing on screen that changes —
   * a rollback puts the badge back exactly where it was.
   */
  const toggle = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'paused' }) =>
      api.updateAutomation(id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: qk.automations(environment) })
      const previous = queryClient.getQueryData<List<AutomationRecord>>(qk.automations(environment))
      queryClient.setQueryData<List<AutomationRecord>>(qk.automations(environment), (current) =>
        current
          ? {
              ...current,
              data: current.data.map((row) => (row.id === id ? { ...row, status } : row)),
            }
          : current,
      )
      return { previous }
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(qk.automations(environment), context.previous)
      }
      toast.error(errorMessage(error))
    },
    onSettled: () => void invalidate(),
  })

  const create = useMutation({
    mutationFn: () =>
      api.createAutomation({
        name: 'Untitled automation',
        status: 'draft',
        mode: 'cohort',
        trigger: { type: 'contact_created', audience_id: '' },
        steps: [{ type: 'wait', duration: '1 day' }],
      }),
    onSuccess: async (created) => {
      await invalidate()
      await navigate({ to: '/app/automations/$automationId', params: { automationId: created.id } })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const duplicate = useMutation({
    mutationFn: (automation: AutomationRecord) =>
      api.createAutomation({
        name: `${automation.name} copy`,
        status: 'draft',
        mode: automation.mode,
        trigger: automation.trigger,
        steps: automation.steps,
      }),
    onSuccess: async (created) => {
      await invalidate()
      toast.success(`Copied to “${created.name}” as a draft.`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAutomation(id),
    onSuccess: async () => {
      setPendingDelete(null)
      await invalidate()
      toast.success('Automation deleted.')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const columns: Column<AutomationRecord>[] = [
    {
      id: 'name',
      header: 'Name',
      sortBy: (row) => row.name.toLowerCase(),
      cell: (row) => (
        <Link
          to="/app/automations/$automationId"
          params={{ automationId: row.id }}
          className="font-medium underline-offset-2 hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortBy: (row) => row.status,
      cell: (row) => <StatusBadge status={row.status} size="sm" />,
    },
    {
      id: 'mode',
      header: 'Mode',
      sortBy: (row) => row.mode,
      cell: (row) => (
        <MonoChip size="sm" tone={row.mode === 'instance' ? 'accent' : 'neutral'}>
          {MODE_LABEL[row.mode]}
        </MonoChip>
      ),
    },
    {
      id: 'trigger',
      header: 'Trigger',
      cell: (row) => (
        <span className="text-[13.5px] text-muted">{describeTrigger(row.trigger)}</span>
      ),
    },
    {
      id: 'enrolled',
      header: 'Enrolled',
      align: 'right',
      sortBy: (row) => row.enrolled_count ?? -1,
      cell: (row) =>
        row.enrolled_count === undefined ? (
          <span className="text-muted-2">—</span>
        ) : (
          <span className="font-mono text-[12.5px]">{num(row.enrolled_count)}</span>
        ),
    },
    {
      id: 'version',
      header: 'Version',
      align: 'right',
      sortBy: (row) => row.version,
      cell: (row) => <span className="font-mono text-[12.5px] text-muted">v{row.version}</span>,
    },
    {
      id: 'created',
      header: 'Created',
      sortBy: (row) => row.created_at,
      cell: (row) => <span className="text-[13px] text-muted">{shortDate(row.created_at)}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
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
            {row.status === 'active' ? (
              <DropdownMenuItem onSelect={() => toggle.mutate({ id: row.id, status: 'paused' })}>
                <Pause aria-hidden="true" />
                Pause
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => toggle.mutate({ id: row.id, status: 'active' })}>
                <Play aria-hidden="true" />
                Activate
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => duplicate.mutate(row)}>
              <Copy aria-hidden="true" />
              Duplicate as draft
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setPendingDelete(row)}>
              <Trash2 aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Automations"
        title="Mail that sends itself"
        description="A trigger, then steps. Each automation runs on Cloudflare Workflows; the execution mode decides whether a run covers one contact or a whole hourly cohort."
        actions={
          <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
            <Workflow aria-hidden="true" />
            {create.isPending ? 'Creating…' : 'New automation'}
          </Button>
        }
      />

      <QueryState
        isLoading={automations.isLoading}
        error={automations.error}
        data={automations.data?.data}
        subject="automations"
        onRetry={() => void automations.refetch()}
        empty={
          <EmptyState
            icon={Workflow}
            title="No automations yet"
            description="A welcome sequence is the usual first one: trigger on contact created, wait a day, send."
            action={{ label: 'New automation', onClick: () => create.mutate() }}
            secondaryAction={{ label: 'Read about the two modes', href: '/docs#automation-modes' }}
          />
        }
      >
        {(rows) => (
          <DataTable
            rows={rows}
            columns={columns}
            rowId={(row) => row.id}
            caption="Automations in this workspace and environment"
            defaultSort={{ columnId: 'created', direction: 'desc' }}
          />
        )}
      </QueryState>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={`Delete ${pendingDelete?.name ?? 'automation'}`}
        description="The automation, all of its versions and its enrollment history go away."
        confirmPhrase={pendingDelete?.name}
        confirmLabel="Delete automation"
        consequences={
          <>
            Contacts currently mid-flight stop where they are and receive nothing further. Sent
            messages stay in the logs; the automation that sent them will not.
          </>
        }
        pending={remove.isPending}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id)
        }}
      />
    </>
  )
}
