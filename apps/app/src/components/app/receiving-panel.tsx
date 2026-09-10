import { Button, Callout, Input, Label, StatusBadge, Switch, toast } from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import type { DomainRecord } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'

/**
 * Receiving, as a first-class part of a domain rather than a footnote.
 *
 * Mailbox CRUD has existed in the API since inbound was written and has never
 * had a screen, so the only way to create the address that mail arrives at was
 * a curl command. Sending and receiving are two halves of one domain, and this
 * is the half that was missing.
 */
export function ReceivingPanel({ domain }: { domain: DomainRecord }) {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const [local, setLocal] = useState('')
  const localId = useId()

  const mailboxes = useQuery({
    queryKey: qk.mailboxes(environment),
    queryFn: () => api.listMailboxes(),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.mailboxes(environment) })

  const create = useMutation({
    mutationFn: (address: string) => api.createMailbox({ address }),
    onSuccess: () => {
      setLocal('')
      void invalidate()
      toast.success('Mailbox created.')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.updateMailbox(id, body),
    onSuccess: () => void invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteMailbox(id),
    onSuccess: () => {
      void invalidate()
      toast.success('Mailbox removed.')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  // Only this domain's mailboxes: a workspace with six domains should not show
  // all of them under each one.
  const mine = (mailboxes.data?.data ?? []).filter((mailbox) =>
    mailbox.address.endsWith(`@${domain.name}`),
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = local.trim().toLowerCase()
    if (!trimmed) return
    create.mutate(`${trimmed}@${domain.name}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <Callout variant="info" title="Receiving is separate from sending">
        A verified sending domain does not receive mail. Point this domain's MX at your provider's
        inbound service and bind its catch-all to this instance's Worker — then every address below
        starts arriving in Mail. Nothing here fails until that is done; mail simply never comes.
      </Callout>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={localId}>New mailbox</Label>
          <div className="flex items-center gap-1.5">
            <Input
              id={localId}
              value={local}
              onChange={(event) => setLocal(event.target.value)}
              placeholder="support"
              className="w-[200px]"
              autoComplete="off"
            />
            <span className="font-mono text-[13px] text-muted">@{domain.name}</span>
          </div>
        </div>
        <Button type="submit" variant="primary" disabled={create.isPending || local.trim() === ''}>
          {create.isPending ? 'Creating…' : 'Create mailbox'}
        </Button>
      </form>

      {mine.length === 0 ? (
        <p className="m-0 text-[13.5px] text-muted">
          No mailboxes on this domain yet. Mail to an address that is not a mailbox is rejected at
          the door with a 550 rather than silently dropped.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {mine.map((mailbox) => (
            <li
              key={mailbox.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-code border border-line bg-paper p-3"
            >
              <span className="min-w-0">
                <span className="block font-mono text-[13px] text-ink">{mailbox.address}</span>
                <span className="block text-[12.5px] text-muted-2">
                  {mailbox.name ?? 'No display name'}
                </span>
              </span>
              <span className="flex items-center gap-4">
                <span className="flex items-center gap-2">
                  <Label htmlFor={`${mailbox.id}-agent`} className="text-[12.5px] text-muted">
                    Agent
                  </Label>
                  <Switch
                    id={`${mailbox.id}-agent`}
                    checked={mailbox.agent_enabled}
                    onCheckedChange={(checked) =>
                      update.mutate({ id: mailbox.id, body: { agent_enabled: checked } })
                    }
                  />
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${mailbox.address}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(mailbox.id)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="m-0 text-[13.5px] text-muted">
        Sending status: <StatusBadge status={domain.status} size="sm" /> — receiving has its own
        setup and is not covered by that check.
      </p>
    </div>
  )
}
