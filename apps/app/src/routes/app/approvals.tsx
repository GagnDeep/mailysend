import type { Status } from '@mailysend/ui'
import { Button, Callout, MonoChip, StatusBadge, toast } from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { BadgeCheck } from 'lucide-react'
import { useState } from 'react'
import { relativeTime } from '~/components/app/format.ts'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import type { McpConfirmationRecord } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/approvals')({
  head: () => appHead('Approvals'),
  component: Approvals,
})

/**
 * The human half of the agent's confirmation gate.
 *
 * An agent's `send_email` never sends on its first call: it mints a token bound
 * to the exact payload and hands its user a "somebody has to approve this".
 * That somebody had nowhere to go — `approve`, `reject` and `pending` were
 * written and had no callers, and the URL the agent quoted was a 404 — so every
 * agent send ever attempted stopped here permanently.
 *
 * Approving is deliberately not something an agent can do over MCP. There is no
 * `approve` method, no alias and no tool argument; it is a person, signed in,
 * on this page. That asymmetry is the whole security property, and it is why
 * this screen has to exist rather than being a convenience.
 */
function Approvals() {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const [showAll, setShowAll] = useState(false)
  const status = showAll ? 'all' : 'pending'

  const confirmations = useQuery({
    queryKey: qk.mcpConfirmations(environment, status),
    queryFn: () => api.listConfirmations(status),
    // These expire in minutes. A page showing a token that timed out three
    // minutes ago is worse than one that says nothing.
    refetchInterval: 15_000,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [environment, 'mcp-confirmations'] })

  const decide = useMutation({
    mutationFn: ({ token, action }: { token: string; action: 'approve' | 'reject' }) =>
      action === 'approve' ? api.approveConfirmation(token) : api.rejectConfirmation(token),
    onSuccess: (_result, variables) => {
      void invalidate()
      toast.success(variables.action === 'approve' ? 'Approved.' : 'Rejected.')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const rows = confirmations.data?.data ?? []

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Approvals"
        description="Actions an agent has asked to take, waiting on a person."
        actions={
          <Button variant="outline" onClick={() => setShowAll((current) => !current)}>
            {showAll ? 'Pending only' : 'Show decided'}
          </Button>
        }
      />

      <Callout variant="info" title="Why this screen exists">
        Read tools answer an agent immediately. The two that send mail —{' '}
        <code className="font-mono text-[13px]">send_email</code> and{' '}
        <code className="font-mono text-[13px]">reply_to_thread</code> — never send on their first
        call: they return a confirmation bound to that exact message. Approving is not something an
        agent can do; there is no MCP method for it, which is precisely why it is here instead.
        Approve one and the agent's next call with the same token, and the identical message, sends.
      </Callout>

      {confirmations.isPending ? (
        <TableSkeleton />
      ) : confirmations.isError ? (
        <ErrorState
          error={confirmations.error}
          subject="the agent approvals queue"
          onRetry={() => void confirmations.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={BadgeCheck}
          title={showAll ? 'Nothing here yet' : 'Nothing waiting'}
          description={
            showAll
              ? 'No agent has asked to send anything through this workspace.'
              : 'No agent is waiting on you. Anything an agent asks to send will appear here within seconds.'
          }
          action={{ label: 'Set up an agent', href: '/app/agents' }}
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {rows.map((row) => (
            <ConfirmationCard
              key={row.token}
              row={row}
              busy={decide.isPending}
              onDecide={(action) => decide.mutate({ token: row.token, action })}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The gate's four words, in the badge's vocabulary.
 *
 * `approved` is not one of the badge's statuses and `active` is the closest
 * honest reading — the token is live and the agent may still redeem it. An
 * expired pending row reads `expired`, not `pending`, because it is over.
 */
const badgeStatus = (row: McpConfirmationRecord): Status => {
  if (row.status === 'pending') return row.expired ? 'expired' : 'pending'
  if (row.status === 'approved') return row.consumed_at ? 'sent' : 'active'
  if (row.status === 'rejected') return 'canceled'
  return 'error'
}

/**
 * What would be sent, verbatim.
 *
 * The point of a confirmation is that the person approving it sees the message,
 * not a description of it — so the summary is rendered field by field rather
 * than as a sentence, and anything the gate adds later appears without this
 * page needing to know about it.
 */
function ConfirmationCard({
  row,
  busy,
  onDecide,
}: {
  row: McpConfirmationRecord
  busy: boolean
  onDecide: (action: 'approve' | 'reject') => void
}) {
  const summary = (row.summary ?? {}) as Record<string, unknown>
  const pending = row.status === 'pending' && !row.expired

  return (
    <li className="flex flex-col gap-3 rounded-card border border-line bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <MonoChip size="sm">{row.tool}</MonoChip>
            <StatusBadge status={badgeStatus(row)} size="sm" />
            {row.consumed_at ? (
              <span className="text-[12.5px] text-muted-2">
                sent {relativeTime(row.consumed_at)}
              </span>
            ) : null}
          </span>
          <span className="mt-1 block text-[12.5px] text-muted-2">
            asked {relativeTime(row.created_at)} · {pending ? 'expires' : 'expired'}{' '}
            {relativeTime(row.expires_at)}
          </span>
        </span>
        {pending ? (
          <span className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onDecide('reject')}>
              Reject
            </Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => onDecide('approve')}>
              Approve
            </Button>
          </span>
        ) : null}
      </div>

      <dl className="m-0 grid grid-cols-[minmax(84px,auto)_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        {Object.entries(summary).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="font-mono text-[12px] uppercase tracking-[0.06em] text-muted-2">
              {key}
            </dt>
            <dd className="m-0 min-w-0 break-words text-ink">
              {typeof value === 'string' ? value : JSON.stringify(value)}
            </dd>
          </div>
        ))}
      </dl>

      {row.decided_by ? (
        <p className="m-0 text-[12.5px] text-muted-2">Decided by {row.decided_by}.</p>
      ) : null}
    </li>
  )
}
