import { Button, Callout, Input, Label, StatusBadge, Switch, toast } from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Trash2 } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import type { DomainRecord, ReceivingCheckResult } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'

/** The zone's Email Routing screen. `:account` and `:zone` resolve dashboard-side. */
const emailRoutingUrl = (domain: string) =>
  `https://dash.cloudflare.com/?to=/:account/${encodeURIComponent(domain)}/email/routing`

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

  // Observation only — the same DoH resolver the sending checks use, and the
  // same four-word vocabulary, so `error` never launders itself into a pass.
  const check = useMutation({
    mutationFn: (): Promise<ReceivingCheckResult> => api.checkReceiving(domain.id),
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
        A verified sending domain does not receive mail. Two things have to be true, and they are
        configured in different places: Cloudflare Email Routing has to deliver this domain{' '}
        <strong>to this Worker</strong> (its catch-all rule, in the Cloudflare dashboard), and the
        address has to exist <strong>here</strong> — either as a mailbox below, or through the
        catch-all switch on one of them. Routing alone is not enough: an address with nowhere to
        land is answered with a 550, which is why the first test message bounces.
      </Callout>

      <div className="flex flex-col gap-3 rounded-code border border-line bg-tint p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-ink">
              Set up receiving in Cloudflare
            </span>
            <span className="block text-[13px] text-muted">
              Cloudflare dashboard → <strong>Email</strong> → <strong>Email Routing</strong>. Enable
              it and Cloudflare publishes the MX records itself, then add a{' '}
              <strong>catch-all</strong> rule with the action <strong>Send to a Worker</strong> and
              choose this instance's script.
            </span>
          </span>
          <Button asChild variant="primary">
            <a href={emailRoutingUrl(domain.name)} target="_blank" rel="noreferrer">
              Open Email Routing
              <ExternalLink aria-hidden="true" className="size-[15px]" />
            </a>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={check.isPending}
            onClick={() => check.mutate()}
          >
            {check.isPending ? 'Resolving MX…' : 'Check receiving'}
          </Button>
          {check.data ? <ReceivingResult result={check.data} /> : null}
        </div>
      </div>

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
          No mailboxes on this domain yet, so every address on it is answered with a 550 rather than
          silently dropped. Create one — then turn on <strong>Catch-all</strong> if you want the
          rest of the domain to land there too.
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

      <p className="m-0 text-[13.5px] text-muted">
        Sending status: <StatusBadge status={domain.status} size="sm" /> — receiving has its own
        setup and is not covered by that check.
      </p>
    </div>
  )
}

/**
 * The MX answer, said plainly.
 *
 * A verified MX is not a working setup and must not read like one: Cloudflare's
 * catch-all rule lives zone-side and cannot be observed from here, so the most
 * this can honestly report is that mail reaches Cloudflare at all. Everything
 * downstream of that is the mailbox count beside it.
 */
function ReceivingResult({ result }: { result: ReceivingCheckResult }) {
  const tone =
    result.status === 'verified'
      ? 'text-positive'
      : result.status === 'failed'
        ? 'text-warning'
        : 'text-muted'
  return (
    <span className="min-w-0 flex-1 text-[13px] leading-[1.6]">
      <span className={`font-mono text-[12px] uppercase tracking-[0.08em] ${tone}`}>
        MX {result.status}
      </span>
      <span className="block text-muted">{result.detail}</span>
      {result.found ? (
        <span className="mt-0.5 block break-all font-mono text-[11.5px] text-muted-2">
          found: {result.found} · expected: {result.expected}
        </span>
      ) : null}
      <span className="mt-0.5 block text-[12.5px] text-muted-2">
        {result.mailboxes.count === 0
          ? 'No mailbox on this domain — nothing would be accepted even once routing is right.'
          : result.mailboxes.catch_all
            ? `${result.mailboxes.count} mailbox(es), catch-all on ${result.mailboxes.catch_all}.`
            : `${result.mailboxes.count} mailbox(es), no catch-all — anything else is rejected.`}
      </span>
    </span>
  )
}
