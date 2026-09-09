import { WebhookEventName } from '@mailysend/contracts'
import {
  Button,
  Callout,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  StatusBadge,
  Textarea,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Braces, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { CopyValue } from '~/components/app/copy-value.tsx'
import type { Column } from '~/components/app/data-table.tsx'
import { DataTable } from '~/components/app/data-table.tsx'
import { shortDate } from '~/components/app/format.ts'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { SecretOnceDialog } from '~/components/app/secret-once.tsx'
import { EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import type { WebhookRecord } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/webhooks/')({
  head: () => appHead('Webhooks'),
  component: Webhooks,
})

export type WebhookEvent = WebhookRecord['events'][number]

const GROUP_LABEL: Record<string, string> = {
  email: 'Email',
  contact: 'Contacts',
  broadcast: 'Broadcasts',
  domain: 'Domains',
  inbound: 'Inbound',
}

/** Grouped by the part before the dot, which is also how the API namespaces them. */
export const EVENT_GROUPS: { prefix: string; events: WebhookEvent[] }[] = (() => {
  const groups = new Map<string, WebhookEvent[]>()
  for (const event of WebhookEventName.options) {
    const prefix = event.split('.')[0] ?? 'other'
    const held = groups.get(prefix)
    if (held) held.push(event)
    else groups.set(prefix, [event])
  }
  return [...groups.entries()].map(([prefix, events]) => ({ prefix, events }))
})()

export const EventPicker = ({
  selected,
  onChange,
  idPrefix,
}: {
  selected: WebhookEvent[]
  onChange: (next: WebhookEvent[]) => void
  idPrefix: string
}) => {
  const toggle = (event: WebhookEvent, checked: boolean) =>
    onChange(checked ? [...selected, event] : selected.filter((held) => held !== event))

  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
      <legend className="mb-1 text-[13.5px] font-medium">Events</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        {EVENT_GROUPS.map((group) => (
          <div key={group.prefix} className="flex flex-col gap-2">
            <div className="ms-eyebrow text-[10.5px] text-muted-2">
              {GROUP_LABEL[group.prefix] ?? group.prefix}
            </div>
            {group.events.map((event) => {
              const id = `${idPrefix}-${event}`
              return (
                <div key={event} className="flex items-center gap-2.5">
                  <Checkbox
                    id={id}
                    checked={selected.includes(event)}
                    onCheckedChange={(checked) => toggle(event, checked === true)}
                  />
                  <Label htmlFor={id} className="font-mono text-[12.5px] font-normal">
                    {event}
                  </Label>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange([...WebhookEventName.options])}
        >
          Select all
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
          Clear
        </Button>
      </div>
    </fieldset>
  )
}

// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal bytes that get signed, not an interpolation.
const SIGNED_PAYLOAD = '${t}.${rawBody}'

export const SIGNATURE_EXPLAINER = (
  <>
    Every delivery carries a{' '}
    <code className="font-mono">MailySend-Signature: t=&lt;unix&gt;,v1=&lt;hex hmac&gt;</code>{' '}
    header. Compute HMAC-SHA256 over the exact string{' '}
    <code className="font-mono">{SIGNED_PAYLOAD}</code> using this secret and compare it to{' '}
    <code className="font-mono">v1</code> in constant time — over the raw bytes, before any JSON
    parse, because re-serialising changes them.
  </>
)

export const SIGNATURE_FOOTNOTE =
  'Reject anything whose timestamp is more than 300 seconds from your clock. The timestamp is inside the signed payload, so a delivery captured off the wire cannot be replayed at you later: changing t breaks the signature, and keeping it puts the request outside the tolerance window.'

function Webhooks() {
  const api = useApi()
  const environment = useEnvironment()
  const [createOpen, setCreateOpen] = useState(false)
  const [created, setCreated] = useState<WebhookRecord | null>(null)

  const webhooks = useQuery({
    queryKey: qk.webhooks(environment),
    queryFn: () => api.listWebhooks({ limit: 100 }),
  })

  const rows = webhooks.data?.data ?? []
  const failing = rows.filter((row) => (row.consecutive_failures ?? 0) > 0)

  const columns: Column<WebhookRecord>[] = [
    {
      id: 'url',
      header: 'Endpoint',
      sortBy: (row) => row.url,
      cell: (row) => <CopyValue value={row.url} label="endpoint URL" className="max-w-[340px]" />,
    },
    {
      id: 'events',
      header: 'Events',
      align: 'right',
      sortBy: (row) => row.events.length,
      cell: (row) => (
        <span className="font-mono text-[12.5px] text-muted">{row.events.length}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortBy: (row) => row.status,
      cell: (row) => <StatusBadge status={row.status} size="sm" />,
    },
    {
      id: 'failures',
      header: 'Consecutive failures',
      align: 'right',
      sortBy: (row) => row.consecutive_failures ?? 0,
      cell: (row) => (
        <span
          className={
            (row.consecutive_failures ?? 0) > 0
              ? 'font-mono text-[12.5px] text-warning'
              : 'font-mono text-[12.5px] text-muted-2'
          }
        >
          {row.consecutive_failures ?? 0}
        </span>
      ),
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
      align: 'right',
      srOnlyHeader: true,
      cell: (row) => (
        <Button asChild variant="link" size="sm">
          <Link to="/app/webhooks/$webhookId" params={{ webhookId: row.id }}>
            Open
          </Link>
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Webhooks"
        description="Every event we record can be pushed to an endpoint you control. Deliveries are signed, retried with backoff, and every attempt is kept."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            Add endpoint
          </Button>
        }
      />

      {failing.length > 0 ? (
        <Callout variant="warn" title="endpoints failing">
          {failing.length === 1
            ? `${failing[0]?.url} has failed ${failing[0]?.consecutive_failures} deliveries in a row.`
            : `${failing.length} endpoints are failing deliveries in a row.`}{' '}
          Retries back off and then stop, so events that fire while an endpoint is down are not
          re-sent once it recovers. Open the endpoint to read the response bodies we got back.
        </Callout>
      ) : null}

      {webhooks.isLoading ? (
        <TableSkeleton rows={3} columns={5} />
      ) : webhooks.error ? (
        <ErrorState
          error={webhooks.error}
          subject="your webhook endpoints"
          onRetry={() => void webhooks.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Braces}
          title="No webhook endpoints"
          description="Point one at your app to get delivery, bounce and complaint events as they happen rather than polling the log."
          action={{ label: 'Add your first endpoint', onClick: () => setCreateOpen(true) }}
          secondaryAction={{ label: 'Event reference', href: '/docs#webhooks' }}
        />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowId={(row) => row.id}
          caption="Webhook endpoints in this workspace"
          defaultSort={{ columnId: 'created', direction: 'desc' }}
        />
      )}

      <AddEndpointDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(webhook) => {
          setCreateOpen(false)
          setCreated(webhook)
        }}
      />

      <SecretOnceDialog
        open={created !== null}
        onOpenChange={(next) => {
          if (!next) setCreated(null)
        }}
        title="Your signing secret"
        secret={created?.secret ?? ''}
        description={SIGNATURE_EXPLAINER}
        footnote={SIGNATURE_FOOTNOTE}
      />
    </>
  )
}

const AddEndpointDialog = ({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (webhook: WebhookRecord) => void
}) => {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const urlId = useId()
  const descriptionId = useId()
  const pickerId = useId()

  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [description, setDescription] = useState('')

  const create = useMutation({
    mutationFn: () =>
      api.createWebhook({
        url: url.trim(),
        events,
        ...(description.trim() === '' ? {} : { description: description.trim() }),
      }),
    onSuccess: (webhook) => {
      void queryClient.invalidateQueries({ queryKey: qk.webhooks(environment) })
      setUrl('')
      setEvents([])
      setDescription('')
      onCreated(webhook)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Add a webhook endpoint</DialogTitle>
          <DialogDescription>
            We POST JSON to this URL and expect a 2xx within ten seconds. Anything else is a failure
            and is retried with backoff.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor={urlId}>Endpoint URL</Label>
          <Input
            id={urlId}
            value={url}
            type="url"
            placeholder="https://example.com/hooks/mailysend"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-[13px]"
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>

        <EventPicker selected={events} onChange={setEvents} idPrefix={pickerId} />

        <div className="flex flex-col gap-2">
          <Label htmlFor={descriptionId}>Description (optional)</Label>
          <Textarea
            id={descriptionId}
            value={description}
            rows={2}
            placeholder="What this endpoint does with the events."
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={url.trim() === '' || events.length === 0 || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Creating…' : 'Add endpoint'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
