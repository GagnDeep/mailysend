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
  Slider,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import { CopyValue } from '~/components/app/copy-value.tsx'
import { dateTime } from '~/components/app/format.ts'
import { PageHeader, PageSection } from '~/components/app/page.tsx'
import { useApi, useAppScope, useEnvironment } from '~/components/app/scope.tsx'
import { SecurityPanel } from '~/components/app/security-panel.tsx'
import { DetailSkeleton, ErrorState } from '~/components/app/states.tsx'
import type {
  ProviderCatalogRecord,
  ProviderConfigRecord,
  ProviderTestRecord,
  WorkspaceSettingsRecord,
} from '~/lib/api-client.ts'
import { qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

/**
 * Settings is one route with tabs rather than four nested routes, because the
 * draft state is shared — the provider you picked and the retention you dragged
 * are the same unsaved form — but the section still belongs in the URL so
 * "look at the retention setting" is a link and not an instruction.
 */

const SECTIONS = ['workspace', 'sending', 'provider', 'retention', 'security', 'danger'] as const
type Section = (typeof SECTIONS)[number]

const isSection = (value: unknown): value is Section =>
  typeof value === 'string' && (SECTIONS as readonly string[]).includes(value)

export const Route = createFileRoute('/app/settings')({
  head: () => appHead('Settings'),
  validateSearch: (search: Record<string, unknown>): { section: Section } => ({
    section: isSection(search.section) ? search.section : 'workspace',
  }),
  component: Settings,
})

type Provider = WorkspaceSettingsRecord['provider']

const PROVIDERS: { value: Provider; label: string; cost: string }[] = [
  {
    value: 'cloudflare',
    label: 'Cloudflare Email Routing',
    cost: 'Free, and it is already in your account — but it is send-only through a Worker binding, so there is no separate SMTP surface and no provider dashboard to check when a message stalls.',
  },
  {
    value: 'ses',
    label: 'Amazon SES',
    cost: 'Cheapest at volume, but it needs its own verified identity in your AWS account and starts in its own sandbox: until AWS lifts it you can only send to addresses you have verified.',
  },
  {
    value: 'resend',
    label: 'Resend',
    cost: 'A pass-through. Setup is the shortest of the four, and in exchange your deliverability rides on their shared reputation and their IP pools rather than yours.',
  },
  {
    value: 'smtp',
    label: 'SMTP',
    cost: 'Anything else with a hostname and credentials. It always works, and it gives up per-message provider telemetry — bounces arrive as SMTP codes, not as structured events.',
  },
]

const providerLabel = (value: Provider): string =>
  PROVIDERS.find((provider) => provider.value === value)?.label ?? value

function Settings() {
  const api = useApi()
  const environment = useEnvironment()

  const settings = useQuery({
    queryKey: qk.settings(environment),
    queryFn: () => api.getSettings(),
  })

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="How this workspace sends"
        description="Workspace identity, sending defaults, which provider carries the mail, and how long we keep what happened."
      />

      {settings.isLoading ? (
        <DetailSkeleton />
      ) : settings.error ? (
        <ErrorState
          error={settings.error}
          subject="the workspace settings"
          onRetry={() => void settings.refetch()}
        />
      ) : settings.data ? (
        <SettingsTabs settings={settings.data} />
      ) : null}
    </>
  )
}

function SettingsTabs({ settings }: { settings: WorkspaceSettingsRecord }) {
  const { section } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  return (
    <Tabs
      value={section}
      onValueChange={(next) => {
        if (isSection(next)) void navigate({ search: { section: next }, replace: true })
      }}
      className="flex flex-col gap-5"
    >
      <TabsList className="rounded-tile border border-line bg-card" aria-label="Settings sections">
        <TabsTrigger value="workspace">Workspace</TabsTrigger>
        <TabsTrigger value="sending">Sending defaults</TabsTrigger>
        <TabsTrigger value="provider">Transports</TabsTrigger>
        <TabsTrigger value="retention">Log retention</TabsTrigger>
        <TabsTrigger value="security">Access</TabsTrigger>
        <TabsTrigger value="danger">Danger zone</TabsTrigger>
      </TabsList>

      <TabsContent value="workspace">
        <WorkspacePanel settings={settings} />
      </TabsContent>
      <TabsContent value="sending">
        <SendingPanel settings={settings} />
      </TabsContent>
      <TabsContent value="provider">
        <ProviderPanel settings={settings} />
      </TabsContent>
      <TabsContent value="retention">
        <RetentionPanel settings={settings} />
      </TabsContent>
      <TabsContent value="security">
        <SecurityPanel />
      </TabsContent>
      <TabsContent value="danger">
        <DangerPanel />
      </TabsContent>
    </Tabs>
  )
}

/** One place that saves, so every panel gets the same toast and the same invalidation. */
const useSaveSettings = () => {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.updateSettings(body),
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.settings(environment), updated)
      void queryClient.invalidateQueries({ queryKey: qk.settings(environment) })
      toast.success('Settings saved.')
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

const Panel = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col gap-5 rounded-tile border border-line-soft bg-card p-5">
    {children}
  </div>
)

const Field = ({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  htmlFor?: string
}) => (
  <div className="flex flex-col gap-2">
    {htmlFor ? (
      <Label htmlFor={htmlFor}>{label}</Label>
    ) : (
      // No control to point at — the slug and the created date are read-only,
      // and a `for` aimed at nothing is worse than a plain heading.
      <span className="text-[13.5px] font-semibold text-ink">{label}</span>
    )}
    {children}
    {hint ? <p className="m-0 max-w-[70ch] text-[13px] leading-[1.6] text-muted">{hint}</p> : null}
  </div>
)

function WorkspacePanel({ settings }: { settings: WorkspaceSettingsRecord }) {
  const { user, workspaceId } = useAppScope()
  const save = useSaveSettings()
  const [name, setName] = useState(settings.name)
  const nameId = useId()

  const workspace = user?.workspaces.find((candidate) => candidate.id === workspaceId)

  return (
    <PageSection title="Workspace" description="What this workspace is called and when it started.">
      <Panel>
        <Field
          label="Name"
          htmlFor={nameId}
          hint="Shown in the workspace switcher and on invitation emails. Changing it does not change the slug."
        >
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="max-w-[420px]"
          />
        </Field>

        <Field
          label="Slug"
          hint="Fixed at creation. It appears in API error messages and in support conversations, so it is the phrase we ask for when confirming something destructive."
        >
          {workspace ? (
            <CopyValue value={workspace.slug} label="workspace slug" truncate={false} />
          ) : (
            <p className="m-0 text-[13.5px] text-muted">
              Not loaded — the slug comes from your session, not from this screen.
            </p>
          )}
        </Field>

        <Field label="Created">
          <p className="m-0 font-mono text-[12.5px] text-muted">
            {workspace ? dateTime(workspace.created_at) : '—'}
          </p>
        </Field>

        <div>
          <Button
            size="sm"
            disabled={save.isPending || name.trim() === '' || name === settings.name}
            onClick={() => save.mutate({ name: name.trim() })}
          >
            {save.isPending ? 'Saving…' : 'Save workspace'}
          </Button>
        </div>
      </Panel>
    </PageSection>
  )
}

function SendingPanel({ settings }: { settings: WorkspaceSettingsRecord }) {
  const save = useSaveSettings()
  const [from, setFrom] = useState(settings.default_from ?? '')
  const [replyTo, setReplyTo] = useState(settings.default_reply_to ?? '')
  const [openTracking, setOpenTracking] = useState(settings.open_tracking)
  const [clickTracking, setClickTracking] = useState(settings.click_tracking)
  const fromId = useId()
  const replyId = useId()

  const dirty =
    from !== (settings.default_from ?? '') ||
    replyTo !== (settings.default_reply_to ?? '') ||
    openTracking !== settings.open_tracking ||
    clickTracking !== settings.click_tracking

  return (
    <PageSection
      title="Sending defaults"
      description="Applied when a send does not name its own. A per-message value always wins."
    >
      <Panel>
        <Field
          label="Default From"
          htmlFor={fromId}
          hint="Must be on a verified domain, or the send is rejected before it reaches a provider."
        >
          <Input
            id={fromId}
            type="email"
            value={from}
            placeholder="Acme <hello@acme.dev>"
            onChange={(event) => setFrom(event.target.value)}
            className="max-w-[420px]"
          />
        </Field>

        <DefaultSendingDomainField settings={settings} />

        <Field
          label="Default Reply-To"
          htmlFor={replyId}
          hint="Where replies land. Leave it empty and replies go back to the From address."
        >
          <Input
            id={replyId}
            type="email"
            value={replyTo}
            placeholder="support@acme.dev"
            onChange={(event) => setReplyTo(event.target.value)}
            className="max-w-[420px]"
          />
        </Field>

        <div className="flex flex-col gap-4 rounded-code border border-line bg-tint p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="open-tracking">Open tracking</Label>
              <p className="m-0 mt-1 max-w-[62ch] text-[13px] leading-[1.6] text-muted">
                Inserts a 1×1 tracking pixel into the HTML body of every message. The recipient's
                mail client fetches it from us, which is how an open is recorded — and which means
                the recipient's client can see the request, block it, or prefetch it on their
                behalf.
              </p>
            </div>
            <Switch
              id="open-tracking"
              checked={openTracking}
              onCheckedChange={setOpenTracking}
              aria-label="Open tracking"
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="click-tracking">Click tracking</Label>
              <p className="m-0 mt-1 max-w-[62ch] text-[13px] leading-[1.6] text-muted">
                Rewrites every link in the message to point at our redirector before the real
                destination. That is what produces click data, and it is visible to the recipient:
                the URL they see on hover is ours, not yours.
              </p>
            </div>
            <Switch
              id="click-tracking"
              checked={clickTracking}
              onCheckedChange={setClickTracking}
              aria-label="Click tracking"
            />
          </div>

          <p className="m-0 text-[13px] leading-[1.6] text-muted">
            Both are visible to the recipient's mail client. Neither is silent, and neither is
            required to send.
          </p>
        </div>

        <div>
          <Button
            size="sm"
            disabled={save.isPending || !dirty}
            onClick={() =>
              save.mutate({
                default_from: from.trim() || null,
                default_reply_to: replyTo.trim() || null,
                open_tracking: openTracking,
                click_tracking: clickTracking,
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save sending defaults'}
          </Button>
        </div>
      </Panel>
    </PageSection>
  )
}

/**
 * Which verified domain the instance's own mail leaves from.
 *
 * It used to be whichever domain was created first, which is invisible, and in
 * `saas` mode was not even scoped to the workspace. Sign-in codes are the mail
 * that matters here: they are sent by the instance, to you, at the moment you
 * cannot get in.
 */
function DefaultSendingDomainField({ settings }: { settings: WorkspaceSettingsRecord }) {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const selectId = useId()

  const domains = useQuery({
    queryKey: qk.domains(environment),
    queryFn: () => api.listDomains({ limit: 100 }),
  })
  const verified = (domains.data?.data ?? []).filter((domain) => domain.status === 'verified')

  const setDefault = useMutation({
    mutationFn: (domainId: string | null) => api.setDefaultSendingDomain(domainId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.settings(environment) })
      toast.success('Default sending domain saved.')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <Field
      label="Default sending domain"
      htmlFor={selectId}
      hint={
        verified.length === 0
          ? 'No verified domain yet. Until there is one, this instance cannot email a sign-in code and says so instead of pretending it sent one.'
          : 'Sign-in codes and other mail this instance sends itself leave from here. Only verified domains can be chosen.'
      }
    >
      <Select
        value={settings.default_sending_domain ?? 'auto'}
        onValueChange={(value) => setDefault.mutate(value === 'auto' ? null : value)}
        disabled={setDefault.isPending || verified.length === 0}
      >
        <SelectTrigger id={selectId} className="max-w-[420px]">
          <SelectValue placeholder="Oldest verified domain" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Oldest verified domain</SelectItem>
          {verified.map((domain) => (
            <SelectItem key={domain.id} value={domain.id}>
              {domain.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

/**
 * Transports.
 *
 * This panel used to be four radio buttons writing a `provider` column that
 * `buildRouter` never read: `provider_configs` had no write path anywhere, so
 * whatever you picked here, sending went on using the deployment's environment
 * variables. It now edits the rows the router actually reads, and it says which
 * of the two is in force.
 */
function ProviderPanel({ settings }: { settings: WorkspaceSettingsRecord }) {
  const api = useApi()
  const save = useSaveSettings()
  const queryClient = useQueryClient()

  const catalog = useQuery({
    queryKey: qk.providerCatalog(),
    queryFn: () => api.providerCatalog(),
    staleTime: 5 * 60_000,
  })
  const configured = useQuery({ queryKey: qk.providers(), queryFn: () => api.listProviders() })

  const fallback = configured.data?.environment_fallback ?? []

  return (
    <PageSection
      title="Transports"
      description="Who actually carries the mail, what each one needs, and what it will not tell you."
    >
      {fallback.length > 0 ? (
        <Callout variant="info" title="Sending from the deployment's environment">
          Nothing is enabled here, so mail goes out over{' '}
          {fallback.map((name) => providerLabel(name)).join(', ')} using the variables this instance
          was deployed with. That is a working setup, not a broken one — configure a transport below
          only when you want this workspace to differ from the deployment.
        </Callout>
      ) : null}

      {catalog.isLoading ? (
        <DetailSkeleton />
      ) : catalog.error ? (
        <ErrorState
          error={catalog.error}
          subject="the transport catalog"
          onRetry={() => void catalog.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {(catalog.data?.data ?? []).map((entry) => (
            <TransportCard
              key={entry.provider}
              entry={entry}
              config={configured.data?.data.find((row) => row.provider === entry.provider) ?? null}
              onSaved={() => {
                void queryClient.invalidateQueries({ queryKey: qk.providers() })
              }}
            />
          ))}
        </div>
      )}

      <Panel>
        <Field
          label="Failover transport"
          hint="Used only when the primary refuses the handoff. A message already assigned to a transport is never re-routed mid-flight, so a failover changes the next send, not the current queue."
        >
          <Select
            value={settings.failover_provider ?? 'none'}
            onValueChange={(value) =>
              save.mutate({ failover_provider: value === 'none' ? null : value })
            }
          >
            <SelectTrigger className="max-w-[320px]" aria-label="Failover transport">
              <SelectValue placeholder="No failover" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No failover — fail the send instead</SelectItem>
              {PROVIDERS.filter((provider) => provider.value !== settings.provider).map(
                (provider) => (
                  <SelectItem key={provider.value} value={provider.value}>
                    {provider.label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </Field>
      </Panel>
    </PageSection>
  )
}

const bytes = (value: number): string =>
  value >= 1024 * 1024
    ? `${Math.round(value / (1024 * 1024))} MiB`
    : `${Math.round(value / 1024)} KiB`

function TransportCard({
  entry,
  config,
  onSaved,
}: {
  entry: ProviderCatalogRecord
  config: ProviderConfigRecord | null
  onSaved: () => void
}) {
  const api = useApi()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ProviderTestRecord | null>(null)
  const fieldId = useId()

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.saveProvider(entry.provider, body),
    onSuccess: () => {
      // The form never holds a secret longer than the request that carries it.
      setDraft({})
      setResult(null)
      onSaved()
      toast.success(`${entry.label} saved.`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const test = useMutation({
    mutationFn: () => api.testProvider(entry.provider),
    onSuccess: setResult,
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteProvider(entry.provider),
    onSuccess: () => {
      setResult(null)
      onSaved()
      toast.success(`${entry.label} removed.`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const isSet = (key: string) => config?.credentials_set.includes(key) ?? false

  return (
    <div className="flex flex-col gap-4 rounded-tile border border-line-soft bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 text-[14px] font-semibold text-ink">{entry.label}</h3>
          <p className="mt-1 m-0 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-2">
            {bytes(entry.maxMessageBytes)} max
            {entry.reportsEvents ? ' · reports delivery events' : ' · no delivery events'}
            {entry.available_from_environment ? ' · available from the environment' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Label htmlFor={`${fieldId}-enabled`} className="text-[13px] text-muted">
            Enabled
          </Label>
          <Switch
            id={`${fieldId}-enabled`}
            checked={config?.enabled ?? false}
            onCheckedChange={(checked) => save.mutate({ enabled: checked })}
            disabled={save.isPending}
          />
        </div>
      </div>

      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {entry.caveats.map((caveat) => (
          <li key={caveat} className="max-w-[80ch] text-[13px] leading-[1.6] text-muted">
            {caveat}
          </li>
        ))}
      </ul>

      {entry.fields.length > 0 || entry.config.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {entry.fields.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              htmlFor={`${fieldId}-${field.key}`}
              hint={
                field.secret && isSet(field.key)
                  ? 'Stored. Type a new value to replace it, or clear the box and save to remove it.'
                  : field.help
              }
            >
              <Input
                id={`${fieldId}-${field.key}`}
                type={field.secret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={isSet(field.key) ? '•••••••• set' : ''}
                value={draft[field.key] ?? ''}
                onChange={(event) =>
                  setDraft((held) => ({ ...held, [field.key]: event.target.value }))
                }
              />
            </Field>
          ))}
          {entry.config.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              htmlFor={`${fieldId}-cfg-${field.key}`}
              {...(field.help ? { hint: field.help } : {})}
            >
              <Input
                id={`${fieldId}-cfg-${field.key}`}
                value={draft[`cfg:${field.key}`] ?? String(config?.config[field.key] ?? '')}
                onChange={(event) =>
                  setDraft((held) => ({ ...held, [`cfg:${field.key}`]: event.target.value }))
                }
              />
            </Field>
          ))}
        </div>
      ) : null}

      {result ? (
        <Callout
          variant={
            result.status === 'ok' ? 'success' : result.status === 'failed' ? 'warn' : 'info'
          }
          title={
            result.status === 'ok'
              ? 'Reachable'
              : result.status === 'failed'
                ? 'Not reachable'
                : 'Cannot be checked from here'
          }
        >
          {result.detail ?? 'No further detail.'}
        </Callout>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={save.isPending || Object.keys(draft).length === 0}
          onClick={() => {
            const credentials: Record<string, string> = {}
            const configValues: Record<string, string> = {}
            for (const [key, value] of Object.entries(draft)) {
              if (key.startsWith('cfg:')) configValues[key.slice(4)] = value
              else credentials[key] = value
            }
            save.mutate({
              ...(Object.keys(credentials).length > 0 ? { credentials } : {}),
              ...(Object.keys(configValues).length > 0 ? { config: configValues } : {}),
            })
          }}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
          {test.isPending ? 'Checking…' : 'Test connection'}
        </Button>
        {config ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove
          </Button>
        ) : null}
        <a
          className="self-center text-[13px] text-accent underline-offset-2 hover:underline"
          href={entry.docs}
        >
          How this transport is set up
        </a>
      </div>
    </div>
  )
}

function RetentionPanel({ settings }: { settings: WorkspaceSettingsRecord }) {
  const save = useSaveSettings()
  const [logDays, setLogDays] = useState(settings.log_retention_days)
  const [rawDays, setRawDays] = useState(settings.raw_message_retention_days)
  const [confirming, setConfirming] = useState(false)

  const dirty =
    logDays !== settings.log_retention_days || rawDays !== settings.raw_message_retention_days
  const lowering =
    logDays < settings.log_retention_days || rawDays < settings.raw_message_retention_days

  const submit = () =>
    save.mutate({ log_retention_days: logDays, raw_message_retention_days: rawDays })

  return (
    <PageSection
      title="Log retention"
      description="How long events and raw MIME stay readable. This is a bill as well as a policy."
    >
      <Panel>
        <Callout variant="info" title="where the money goes">
          Events are small rows; raw MIME is the whole message, attachments included, sitting in R2.
          Raw storage dominates the bill by an order of magnitude, so the second slider is the one
          that moves the invoice. Shortening either value deletes objects that already exist on the
          next sweep — it is not a rule that only applies to future messages.
        </Callout>

        <Field
          label={`Event log retention — ${logDays} days`}
          hint="Deliveries, bounces, opens and clicks. Analytics can only look back as far as this."
        >
          <Slider
            value={[logDays]}
            min={7}
            max={365}
            step={1}
            aria-label="Event log retention in days"
            className="max-w-[460px]"
            onValueChange={([value]) => setLogDays(value ?? logDays)}
          />
        </Field>

        <Field
          label={`Raw message retention — ${rawDays} days`}
          hint="The verbatim MIME we handed the provider. Needed to re-read a message body or to answer a deliverability question after the fact."
        >
          <Slider
            value={[rawDays]}
            min={0}
            max={180}
            step={1}
            aria-label="Raw message retention in days"
            className="max-w-[460px]"
            onValueChange={([value]) => setRawDays(value ?? rawDays)}
          />
        </Field>

        <div>
          <Button
            size="sm"
            disabled={save.isPending || !dirty}
            onClick={() => (lowering ? setConfirming(true) : submit())}
          >
            {save.isPending ? 'Saving…' : 'Save retention'}
          </Button>
        </div>
      </Panel>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Shorten retention?"
        description="You are lowering at least one retention window."
        confirmLabel="Shorten retention"
        confirmPhrase="delete older data"
        pending={save.isPending}
        consequences={
          <>
            The next sweep deletes everything already older than the new window — events past{' '}
            {logDays} days and raw MIME past {rawDays} days — not just messages sent from now on.
            Deleted raw messages cannot be regenerated: the body is gone, and the log row that
            references it will render without one.
          </>
        }
        onConfirm={() =>
          save.mutate(
            { log_retention_days: logDays, raw_message_retention_days: rawDays },
            { onSettled: () => setConfirming(false) },
          )
        }
      />
    </PageSection>
  )
}

function DangerPanel() {
  const api = useApi()
  const { user, workspaceId } = useAppScope()
  const workspace = user?.workspaces.find((candidate) => candidate.id === workspaceId)
  const [deleting, setDeleting] = useState(false)

  const remove = useMutation({
    mutationFn: () => api.deleteWorkspace(workspaceId ?? ''),
    onSuccess: () => {
      toast.success('Workspace deleted.')
      setDeleting(false)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <PageSection title="Danger zone" description="Two actions with no undo behind them.">
      <div className="flex flex-col gap-4 rounded-tile border border-accent-border bg-accent-soft p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="m-0 text-[15px] font-semibold text-ink">Rotate all API keys</h3>
            <p className="m-0 mt-1 max-w-[62ch] text-[13px] leading-[1.6] text-muted">
              Every key in this workspace would stop working the moment it is rotated — every
              deployed worker, CI job and script using one starts getting 401s until it is
              redeployed with the new value. There is no bulk-rotate endpoint on the API yet, so
              this is not available here; delete and recreate keys one at a time on the API keys
              screen.
            </p>
          </div>
          <Button size="sm" variant="outline" disabled>
            Not available yet
          </Button>
        </div>

        <div className="h-px bg-line-soft" />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="m-0 text-[15px] font-semibold text-ink">Delete this workspace</h3>
            <p className="m-0 mt-1 max-w-[62ch] text-[13px] leading-[1.6] text-muted">
              Removes the workspace and everything addressed by it, in both the live and test
              environments.
            </p>
          </div>
          <Button
            size="sm"
            variant="accent"
            disabled={!workspace}
            onClick={() => setDeleting(true)}
          >
            Delete workspace
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this workspace?"
        description={`Everything under ${workspace?.name ?? 'this workspace'} goes, in live and in test.`}
        confirmPhrase={workspace?.slug}
        confirmLabel="Delete workspace"
        pending={remove.isPending}
        consequences={
          <>
            Verified domains and their DNS-verified sending identities, every API key, every
            audience and every contact in it, all templates, broadcasts and automations, and the
            entire message log including raw message bodies in R2. Members lose access immediately.
            None of it can be restored, and the slug cannot be claimed again.
          </>
        }
        onConfirm={() => remove.mutate()}
      />
    </PageSection>
  )
}
