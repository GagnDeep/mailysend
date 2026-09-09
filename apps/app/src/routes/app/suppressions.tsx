import type { MonoChipProps } from '@mailysend/ui'
import {
  Button,
  Callout,
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
import { createFileRoute } from '@tanstack/react-router'
import { ShieldBan } from 'lucide-react'
import { useId, useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import type { Column } from '~/components/app/data-table.tsx'
import { DataTable } from '~/components/app/data-table.tsx'
import type { AppliedFilter } from '~/components/app/filters.tsx'
import { FilterBar } from '~/components/app/filters.tsx'
import { shortDate } from '~/components/app/format.ts'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import type { SuppressionRecord } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/suppressions')({
  head: () => appHead('Suppressions'),
  component: Suppressions,
})

type Reason = SuppressionRecord['reason']

const REASONS: Reason[] = ['hard_bounce', 'complaint', 'unsubscribe', 'manual', 'provider']

const REASON_TONE: Record<Reason, MonoChipProps['tone']> = {
  hard_bounce: 'warning',
  complaint: 'warning',
  unsubscribe: 'neutral',
  manual: 'ink',
  provider: 'accent',
}

const FILTERS = [
  {
    id: 'reason',
    label: 'Reason',
    options: REASONS.map((reason) => ({ value: reason, label: reason.replace(/_/g, ' ') })),
  },
]

function Suppressions() {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()

  const [applied, setApplied] = useState<AppliedFilter[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const reason = applied.find((filter) => filter.id === 'reason')?.value

  const suppressions = useQuery({
    queryKey: qk.suppressions(environment, { reason: reason ?? null }),
    queryFn: () => api.listSuppressions({ limit: 100, ...(reason ? { reason } : {}) }),
  })

  const rows = suppressions.data?.data ?? []

  const remove = useMutation({
    mutationFn: async (emails: string[]) => {
      for (const email of emails) await api.deleteSuppression(email)
    },
    onSuccess: (_result, emails) => {
      void queryClient.invalidateQueries({ queryKey: qk.suppressions(environment, {}) })
      void queryClient.invalidateQueries({ queryKey: [environment, 'suppressions'] })
      setSelected([])
      setConfirmRemove(false)
      toast.success(
        emails.length === 1
          ? `${emails[0]} can be sent to again.`
          : `${emails.length} addresses removed from the suppression list.`,
      )
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const columns: Column<SuppressionRecord>[] = [
    {
      id: 'email',
      header: 'Address',
      sortBy: (row) => row.email,
      cell: (row) => <span className="font-mono text-[12.5px]">{row.email}</span>,
    },
    {
      id: 'reason',
      header: 'Reason',
      sortBy: (row) => row.reason,
      cell: (row) => (
        <MonoChip size="sm" tone={REASON_TONE[row.reason]}>
          {row.reason}
        </MonoChip>
      ),
    },
    {
      id: 'source',
      header: 'Source',
      cell: (row) => (
        <span className="text-[13px] text-muted">{row.source ?? 'this workspace'}</span>
      ),
    },
    {
      id: 'created',
      header: 'Suppressed',
      sortBy: (row) => row.created_at,
      cell: (row) => <span className="text-[13px] text-muted">{shortDate(row.created_at)}</span>,
    },
    {
      id: 'expires',
      header: 'Expires',
      sortBy: (row) => row.expires_at ?? '',
      cell: (row) =>
        row.expires_at ? (
          <span className="text-[13px] text-muted">{shortDate(row.expires_at)}</span>
        ) : (
          <span className="text-[13px] text-muted-2">never</span>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Audience"
        title="Suppressions"
        description="Addresses this workspace will not send to. The list is enforced at send time, so a suppressed recipient is skipped rather than bounced."
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            Add address
          </Button>
        }
        toolbar={<FilterBar definitions={FILTERS} applied={applied} onChange={setApplied} />}
      />

      <Callout variant="info" title="how the list ages">
        Soft-bounce suppressions carry an expiry and drop off on their own — a full mailbox is a
        temporary condition. Hard bounces and complaints never expire, because the address is either
        gone or the person asked not to hear from you. Entries marked{' '}
        <MonoChip size="sm" tone="accent">
          provider
        </MonoChip>{' '}
        were mirrored inward: the sending provider suppressed the address on its own and we copied
        that in, so removing it here does not clear it there.
      </Callout>

      {suppressions.isLoading ? (
        <TableSkeleton rows={6} columns={5} />
      ) : suppressions.error ? (
        <ErrorState
          error={suppressions.error}
          subject="the suppression list"
          onRetry={() => void suppressions.refetch()}
        />
      ) : rows.length === 0 ? (
        reason ? (
          <EmptyState
            icon={ShieldBan}
            title={`Nothing suppressed for ${reason.replace(/_/g, ' ')}`}
            description="No address in this workspace carries that reason."
            action={{ label: 'Clear the filter', onClick: () => setApplied([]) }}
          />
        ) : (
          <EmptyState
            icon={ShieldBan}
            title="Nothing has been suppressed yet"
            description="An empty suppression list is good news: no hard bounce, complaint or unsubscribe has been recorded in this environment."
            action={{ label: 'Read how suppression works', href: '/docs#suppressions' }}
            secondaryAction={{ label: 'Add an address by hand', onClick: () => setAddOpen(true) }}
          />
        )
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowId={(row) => row.email}
          caption="Suppressed addresses in this workspace"
          defaultSort={{ columnId: 'created', direction: 'desc' }}
          selection={{
            selected,
            onChange: setSelected,
            actions: () => (
              <Button size="sm" variant="outline" onClick={() => setConfirmRemove(true)}>
                Remove from suppression list
              </Button>
            ),
          }}
        />
      )}

      <AddSuppressionDialog open={addOpen} onOpenChange={setAddOpen} />

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={
          selected.length === 1
            ? `Remove ${selected[0]} from the suppression list`
            : `Remove ${selected.length} addresses from the suppression list`
        }
        description="These addresses become sendable again immediately."
        confirmPhrase="remove"
        confirmLabel="Remove"
        pending={remove.isPending}
        consequences={
          <>
            A hard bounce is a mailbox that does not exist. Removing it means the next send to that
            address bounces again, and that bounce counts against this domain's reputation with the
            receiver — a handful of them is how a sending domain gets throttled. Only remove an
            address you have independent reason to believe now works.
          </>
        }
        onConfirm={() => remove.mutate(selected)}
      />
    </>
  )
}

const AddSuppressionDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const emailId = useId()

  const [email, setEmail] = useState('')
  const [reason, setReason] = useState<Reason>('manual')
  const [expiresOn, setExpiresOn] = useState('')

  const create = useMutation({
    mutationFn: () =>
      api.createSuppression({
        email: email.trim(),
        reason,
        ...(expiresOn === '' ? {} : { expires_at: new Date(expiresOn).toISOString() }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [environment, 'suppressions'] })
      setEmail('')
      setReason('manual')
      setExpiresOn('')
      onOpenChange(false)
      toast.success('Address suppressed.')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suppress an address</DialogTitle>
          <DialogDescription>
            Nothing from this workspace will be sent to this address until it is removed or expires.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor={emailId}>Email address</Label>
          <Input
            id={emailId}
            type="email"
            value={email}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-[13px]"
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="suppression-reason">Reason</Label>
          <Select value={reason} onValueChange={(value) => setReason(value as Reason)}>
            <SelectTrigger id="suppression-reason" aria-label="Suppression reason">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REASONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="m-0 text-[13px] text-muted">
            The reason is what the log and the API report back later. Use{' '}
            <code className="font-mono">manual</code> for anything you decided yourself.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="suppression-expiry">Expires (optional)</Label>
          <Input
            id="suppression-expiry"
            type="date"
            value={expiresOn}
            className="max-w-[220px]"
            onChange={(event) => setExpiresOn(event.target.value)}
          />
          <p className="m-0 text-[13px] text-muted">
            Leave empty for a permanent entry. An expiry suits a temporary block — a mailbox that
            was full, or a domain that was down.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={email.trim() === '' || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Adding…' : 'Suppress address'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
