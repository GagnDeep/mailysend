import { Button, Input, Label, Switch, toast } from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { Handoff } from '~/components/app/handoff.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import type { DomainRecord } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'

/** The zone's Email Routing screen. `:account` and `:zone` resolve dashboard-side. */
const emailRoutingUrl = (domain: string) =>
  `https://dash.cloudflare.com/?to=/:account/${encodeURIComponent(domain)}/email/routing`

/**
 * The receiving setup: the Cloudflare hand-off, and the mailboxes mail lands in.
 *
 * Mailbox CRUD has existed in the API since inbound was written and has never
 * had a screen, so the only way to create the address that mail arrives at was
 * a curl command.
 *
 * This used to open with a callout explaining that receiving is separate from
 * sending, carry its own Check-receiving button, and close by restating the
 * *sending* status — three things the readiness header now says once, at the
 * top, in order. What is left here is the work: the hand-off nobody here can
 * do, and the addresses only this screen can create.
 */
export function ReceivingPanel({ domain }: { domain: DomainRecord }) {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const [local, setLocal] = useState('')
  const localId = useId()
  const catchAllId = useId()

  const mailboxes = useQuery({
    queryKey: qk.mailboxes(environment),
    queryFn: () => api.listMailboxes(),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.mailboxes(environment) })

  const create = useMutation({
    mutationFn: ({ address, catchAll }: { address: string; catchAll: boolean }) =>
      api.createMailbox({ address, is_catch_all: catchAll }),
    onSuccess: (mailbox) => {
      setLocal('')
      void invalidate()
      void queryClient.invalidateQueries({ queryKey: qk.domain(environment, domain.id) })
      toast.success(
        mailbox.is_catch_all
          ? `${mailbox.address} created, and every address at this domain now lands there.`
          : `${mailbox.address} created. Only that exact address is accepted.`,
      )
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

  /**
   * Catch-all defaults off, because nothing depends on it any more.
   *
   * It used to default on: Cloudflare's rule routes the whole domain here, and
   * a workspace whose only mailbox was `support@` answered 550 to every other
   * address that rule delivered. The handler now accepts every address at a
   * domain this workspace owns and creates the mailbox as the mail lands, so
   * the gap is closed at the source. Somebody typing `support` here means
   * `support`, and silently making it the catch-all for the domain would be the
   * surprising reading.
   */
  const [catchAll, setCatchAll] = useState<boolean | null>(null)
  const catchAllChecked = catchAll ?? false

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = local.trim().toLowerCase()
    if (!trimmed) return
    create.mutate({ address: `${trimmed}@${domain.name}`, catchAll: catchAllChecked })
  }

  return (
    <div className="flex flex-col gap-4">
      <Handoff
        title="One step, and it is in Cloudflare"
        body={
          <>
            Cloudflare dashboard → <strong>Email</strong> → <strong>Email Routing</strong>. Enable
            it and Cloudflare publishes the MX records itself, then under{' '}
            <strong>Routing rules</strong> set the <strong>Catch-all address</strong> to the action{' '}
            <strong>Send to a Worker</strong> and choose this deployment's script. That is the whole
            setup — nothing on this page has to be configured for mail to arrive, and every address
            at {domain.name} is accepted from the first message.
          </>
        }
        href={emailRoutingUrl(domain.name)}
        linkLabel="Open Email Routing"
        // The one step that cannot be checked from here, said where the person
        // is standing when they could check it themselves.
        detail={domain.receiving?.catch_all.detail ?? null}
      />

      <form onSubmit={submit} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-3">
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
          <div className="flex items-center gap-2 pb-2">
            <Switch
              id={catchAllId}
              checked={catchAllChecked}
              onCheckedChange={setCatchAll}
              aria-label="Accept every address at this domain"
            />
            <Label htmlFor={catchAllId} className="text-[13px] text-muted">
              Accept every address at this domain
            </Label>
          </div>
          <Button
            type="submit"
            variant="primary"
            disabled={create.isPending || local.trim() === ''}
          >
            {create.isPending ? 'Creating…' : 'Create mailbox'}
          </Button>
        </div>
        {/*
          Optional, and the copy has to say so in both positions — this form
          used to be the thing standing between a correct Cloudflare rule and a
          bounced test message, and the habit of reading it that way outlives
          the code.
        */}
        <p className="m-0 max-w-[80ch] text-[13px] text-muted">
          {catchAllChecked
            ? `Catch-all: everything at ${domain.name} that no named mailbox claims lands here, instead of in the one created automatically. One catch-all per domain — turning this on takes it off whichever mailbox holds it now.`
            : `Optional. Mail for ${domain.name} already arrives without this; naming ${local.trim() === '' ? 'an address' : `${local.trim().toLowerCase()}@${domain.name}`} gives it its own mailbox to file into, with its own agent and webhook settings.`}
        </p>
      </form>

      {mine.length === 0 ? (
        <p className="m-0 max-w-[80ch] text-[13.5px] text-muted">
          No mailboxes here yet, and none are needed: once the Cloudflare rule points at this
          Worker, every address at {domain.name} is accepted and the first message creates the
          mailbox it lands in. Name one above only when you want an address kept apart — its own
          agent, its own webhook.
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
                  {mailbox.is_catch_all
                    ? `Catch-all — every address @${mailbox.domain ?? domain.name} lands here`
                    : (mailbox.name ?? 'No display name')}
                </span>
              </span>
              <span className="flex items-center gap-4">
                <span className="flex items-center gap-2">
                  <Label htmlFor={`${mailbox.id}-catch-all`} className="text-[12.5px] text-muted">
                    Catch-all
                  </Label>
                  {/*
                    One per domain, and the API enforces that by turning the
                    others off rather than by refusing — so this behaves like a
                    radio group even though each row owns its own switch.
                  */}
                  <Switch
                    id={`${mailbox.id}-catch-all`}
                    checked={mailbox.is_catch_all}
                    onCheckedChange={(checked) =>
                      update.mutate({ id: mailbox.id, body: { is_catch_all: checked } })
                    }
                  />
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
    </div>
  )
}
