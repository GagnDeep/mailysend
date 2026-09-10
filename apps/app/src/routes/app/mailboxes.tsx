import {
  Button,
  Callout,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  Switch,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Inbox, Trash2 } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { PageHeader, PageSection } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

/**
 * Mailboxes, as a place rather than a panel.
 *
 * Mailbox CRUD lived only inside one domain's detail page, which meant a person
 * looking for "where are the inboxes I made" had to already know which domain
 * they were made on. The API has always supported a display name and a forward
 * webhook per mailbox and no screen has ever exposed either; both are here.
 */

export const Route = createFileRoute('/app/mailboxes')({
  head: () => appHead('Mailboxes'),
  component: MailboxesPage,
})

function MailboxesPage() {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const localId = useId()

  const [local, setLocal] = useState('')
  const [domainName, setDomainName] = useState('')

  const mailboxes = useQuery({
    queryKey: qk.mailboxes(environment),
    queryFn: () => api.listMailboxes(),
  })
  const domains = useQuery({
    queryKey: qk.domains(environment),
    queryFn: () => api.listDomains(),
  })
  const webhooks = useQuery({
    queryKey: qk.webhooks(environment),
    queryFn: () => api.listWebhooks(),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.mailboxes(environment) })

  const create = useMutation({
    mutationFn: (address: string) => api.createMailbox({ address }),
    onSuccess: (created) => {
      setLocal('')
      void invalidate()
      toast.success(`${created.address} created.`)
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

  const allDomains = domains.data?.data ?? []
  const chosen = domainName || allDomains[0]?.name || ''
  const rows = mailboxes.data?.data ?? []

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = local.trim().toLowerCase()
    if (!trimmed || !chosen) return
    create.mutate(`${trimmed}@${chosen}`)
  }

  return (
    <>
      <PageHeader
        eyebrow="Receiving"
        title="Mailboxes"
        description="Every address in this workspace that mail can arrive at, and that you can send from."
      />

      <PageSection title="New mailbox">
        {allDomains.length === 0 ? (
          <Callout variant="warn" title="No domains yet">
            A mailbox lives on a domain you control.{' '}
            <Link to="/app/domains" className="text-accent underline-offset-2 hover:underline">
              Add a domain
            </Link>{' '}
            first.
          </Callout>
        ) : (
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={localId}>Address</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id={localId}
                  value={local}
                  onChange={(event) => setLocal(event.target.value)}
                  placeholder="support"
                  className="w-[200px] font-mono"
                  autoComplete="off"
                />
                <span className="font-mono text-[13px] text-muted">@</span>
                <Select value={chosen} onValueChange={setDomainName}>
                  <SelectTrigger className="w-[240px]" aria-label="Domain">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allDomains.map((domain) => (
                      <SelectItem key={domain.id} value={domain.name}>
                        {domain.name}
                        {domain.status === 'verified' ? '' : ` (${domain.status})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={create.isPending || local.trim() === '' || !chosen}
            >
              {create.isPending ? 'Creating…' : 'Create mailbox'}
            </Button>
          </form>
        )}
      </PageSection>

      <PageSection
        title="Mailboxes"
        description="Sending from one of these puts a real inbox behind the reply."
      >
        {mailboxes.isLoading ? (
          <TableSkeleton rows={3} columns={3} />
        ) : mailboxes.error ? (
          <ErrorState
            error={mailboxes.error}
            subject="your mailboxes"
            onRetry={() => void mailboxes.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No mailboxes yet"
            description="Mail to an address that is not a mailbox is refused at the door with a 550 rather than silently dropped — so nothing arrives until one exists."
            action={{
              label: 'Add a domain',
              href: '/app/domains',
            }}
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((mailbox) => {
              const domain = allDomains.find(
                (candidate) => candidate.name === mailbox.address.split('@')[1],
              )
              return (
                <li
                  key={mailbox.id}
                  className="flex flex-col gap-3 rounded-code border border-line bg-paper p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-mono text-[13px] text-ink">
                        {mailbox.address}
                      </span>
                      <span className="flex items-center gap-2 text-[12.5px] text-muted-2">
                        {domain ? (
                          <>
                            <StatusBadge status={domain.status} size="sm" />
                            {domain.status === 'verified'
                              ? 'domain verified'
                              : 'the domain is not verified, so nothing will arrive'}
                          </>
                        ) : (
                          'the domain for this address is not in this workspace'
                        )}
                      </span>
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
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    <span className="flex items-center gap-2">
                      <Label htmlFor={`${mailbox.id}-name`} className="text-[12.5px] text-muted">
                        Display name
                      </Label>
                      <Input
                        id={`${mailbox.id}-name`}
                        defaultValue={mailbox.name ?? ''}
                        placeholder="Support"
                        className="h-8 w-[200px]"
                        // On blur rather than per keystroke: a PATCH per
                        // character is a write amplification nobody asked for.
                        onBlur={(event) => {
                          const next = event.target.value.trim()
                          if (next === (mailbox.name ?? '')) return
                          update.mutate({ id: mailbox.id, body: { name: next || null } })
                        }}
                      />
                    </span>

                    <span className="flex items-center gap-2">
                      <Label htmlFor={`${mailbox.id}-forward`} className="text-[12.5px] text-muted">
                        Forward to
                      </Label>
                      <Select
                        value={mailbox.forward_webhook_id ?? 'none'}
                        onValueChange={(value) =>
                          update.mutate({
                            id: mailbox.id,
                            body: { forward_webhook_id: value === 'none' ? null : value },
                          })
                        }
                      >
                        <SelectTrigger
                          id={`${mailbox.id}-forward`}
                          className="h-8 w-[240px]"
                          aria-label={`Forward ${mailbox.address} to a webhook`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No webhook</SelectItem>
                          {(webhooks.data?.data ?? []).map((endpoint) => (
                            <SelectItem key={endpoint.id} value={endpoint.id}>
                              {endpoint.url}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </span>

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
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </PageSection>

      <Callout variant="info" title="Receiving is separate from sending">
        A verified sending domain does not receive mail. Point the domain's MX at your provider's
        inbound service and bind its catch-all to this instance's Worker — then every address above
        starts arriving in Mail. Nothing here fails until that is done; mail simply never comes.
      </Callout>
    </>
  )
}
