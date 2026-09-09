import type { Status } from '@mailysend/ui'
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
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { KeyRound, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import type { Column } from '~/components/app/data-table.tsx'
import { DataTable } from '~/components/app/data-table.tsx'
import { relativeTime, shortDate } from '~/components/app/format.ts'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { SecretOnceDialog } from '~/components/app/secret-once.tsx'
import { EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import type { ApiKeyRecord, CreatedApiKeyRecord, Environment } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/api-keys')({
  head: () => appHead('API keys'),
  component: ApiKeys,
})

const NO_DOMAIN = '__all__'

/**
 * A key's state is derived, not stored: the API returns an expiry and, for a
 * key that was revoked but kept for the audit trail, a revocation time. Deriving
 * it here means one rule for the badge and the row rather than two.
 */
const keyStatus = (key: ApiKeyRecord): Status => {
  if ((key as { revoked_at?: string | null }).revoked_at) return 'revoked'
  if (key.expires_at && new Date(key.expires_at).getTime() < Date.now()) return 'expired'
  return 'active'
}

const prefix = (environment: Environment): string => `ms_${environment}_`

function ApiKeys() {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [created, setCreated] = useState<CreatedApiKeyRecord | null>(null)
  const [revoking, setRevoking] = useState<ApiKeyRecord | null>(null)

  const keys = useQuery({
    queryKey: qk.apiKeys(environment),
    queryFn: () => api.listApiKeys({ limit: 100 }),
  })

  const domains = useQuery({
    queryKey: qk.domains(environment),
    queryFn: () => api.listDomains({ limit: 100 }),
  })

  const domainName = (id: string): string =>
    domains.data?.data.find((domain) => domain.id === id)?.name ?? id

  const revoke = useMutation({
    mutationFn: (id: string) => api.deleteApiKey(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.apiKeys(environment) })
      toast.success('Key revoked. Any request using it now fails with 401.')
      setRevoking(null)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const columns: Column<ApiKeyRecord>[] = [
    {
      id: 'name',
      header: 'Name',
      sortBy: (row) => row.name,
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: 'token',
      header: 'Token',
      cell: (row) => (
        <code className="font-mono text-[12.5px] text-muted">{row.token_preview ?? '—'}</code>
      ),
    },
    {
      id: 'permission',
      header: 'Permission',
      sortBy: (row) => row.permission ?? '',
      cell: (row) => (
        <MonoChip size="sm" tone={row.permission === 'sending_access' ? 'neutral' : 'ink'}>
          {row.permission ?? 'full_access'}
        </MonoChip>
      ),
    },
    {
      id: 'scope',
      header: 'Scope',
      cell: (row) => {
        const scoped = (row as { domain_id?: string | null }).domain_id
        return scoped ? (
          <span className="text-[13px]">{domainName(scoped)}</span>
        ) : (
          <span className="text-[13px] text-muted-2">every domain</span>
        )
      },
    },
    {
      id: 'last_used',
      header: 'Last used',
      sortBy: (row) => row.last_used_at ?? '',
      cell: (row) =>
        row.last_used_at ? (
          <span className="text-[13px] text-muted">{relativeTime(row.last_used_at)}</span>
        ) : (
          <span className="text-[13px] text-muted-2">never used</span>
        ),
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
    {
      id: 'status',
      header: 'Status',
      cell: (row) => <StatusBadge status={keyStatus(row)} size="sm" />,
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
        <Button variant="ghost" size="sm" onClick={() => setRevoking(row)}>
          Revoke
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="API keys"
        description={`Keys are scoped to one environment. A key created here carries the ${prefix(environment)} prefix and can only touch ${environment} data.`}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            Create key
          </Button>
        }
      />

      {environment === 'test' ? (
        <Callout variant="info" title="test environment">
          A <code className="font-mono">ms_test_</code> key accepts sends and returns message ids,
          but nothing leaves the building — no mail is delivered and no reputation is earned or
          spent. Switch the environment in the top bar before minting a key for production.
        </Callout>
      ) : null}

      {keys.isLoading ? (
        <TableSkeleton rows={4} columns={6} />
      ) : keys.error ? (
        <ErrorState
          error={keys.error}
          subject="your API keys"
          onRetry={() => void keys.refetch()}
        />
      ) : (keys.data?.data.length ?? 0) === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API keys in this environment"
          description="A key is how the API knows it is you. The token is shown once, at creation, and never again."
          action={{ label: 'Create your first key', onClick: () => setCreateOpen(true) }}
          secondaryAction={{ label: 'Read the quickstart', href: '/docs#quickstart' }}
        />
      ) : (
        <DataTable
          rows={keys.data?.data ?? []}
          columns={columns}
          rowId={(row) => row.id}
          caption="API keys for this workspace and environment"
          defaultSort={{ columnId: 'created', direction: 'desc' }}
        />
      )}

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(key) => {
          setCreateOpen(false)
          setCreated(key)
        }}
      />

      <SecretOnceDialog
        open={created !== null}
        onOpenChange={(next) => {
          if (!next) setCreated(null)
        }}
        title="Your API key"
        secret={created?.token ?? ''}
        description={
          <>
            Send it as <code className="font-mono">Authorization: Bearer …</code>. Put it in your
            server's secret store — anything with this value can send as you.
          </>
        }
        footnote={`This key carries the ${prefix(environment)} prefix, so it addresses ${environment} data only.`}
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(next) => {
          if (!next) setRevoking(null)
        }}
        title={`Revoke ${revoking?.name ?? 'key'}`}
        description="The key stops working immediately. There is no undo and no way to re-issue the same value."
        confirmPhrase={revoking?.name}
        confirmLabel="Revoke key"
        pending={revoke.isPending}
        consequences={
          <>
            Every request still using this key starts failing with 401 the moment you confirm —
            including anything already retrying in a queue on your side. Deploy the replacement key
            first if the caller is production traffic.
          </>
        }
        onConfirm={() => {
          if (revoking) revoke.mutate(revoking.id)
        }}
      />
    </>
  )
}

const CreateKeyDialog = ({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (key: CreatedApiKeyRecord) => void
}) => {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const nameId = useId()
  const permissionId = useId()

  const [name, setName] = useState('')
  const [permission, setPermission] = useState('full_access')
  const [domainId, setDomainId] = useState(NO_DOMAIN)
  const [expiresOn, setExpiresOn] = useState('')

  const domains = useQuery({
    queryKey: qk.domains(environment),
    queryFn: () => api.listDomains({ limit: 100 }),
    enabled: open,
  })

  const create = useMutation({
    mutationFn: () =>
      api.createApiKey({
        name: name.trim(),
        permission,
        ...(domainId === NO_DOMAIN ? {} : { domain_id: domainId }),
        ...(expiresOn === '' ? {} : { expires_at: new Date(expiresOn).toISOString() }),
      }),
    onSuccess: (key) => {
      void queryClient.invalidateQueries({ queryKey: qk.apiKeys(environment) })
      setName('')
      setPermission('full_access')
      setDomainId(NO_DOMAIN)
      setExpiresOn('')
      onCreated(key)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create an API key</DialogTitle>
          <DialogDescription>
            This key will be minted in the <strong>{environment}</strong> environment and carry the{' '}
            <code className="font-mono">{prefix(environment)}</code> prefix.
            {environment === 'test'
              ? ' A test key cannot send real mail — sends are accepted and discarded.'
              : ' A live key sends real mail to real people.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            value={name}
            placeholder="production-api"
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
          <p className="m-0 text-[13px] text-muted">
            Names appear in the audit trail. Name it after the thing that holds it, not the person
            who made it.
          </p>
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-[13.5px] font-medium">Permission</legend>
          <RadioGroup
            value={permission}
            onValueChange={setPermission}
            className="flex flex-col gap-2.5"
          >
            <div className="flex items-start gap-2.5">
              <RadioGroupItem value="full_access" id={`${permissionId}-full`} className="mt-1" />
              <Label htmlFor={`${permissionId}-full`} className="flex flex-col items-start gap-1">
                <span>Full access</span>
                <span className="text-[13px] font-normal text-muted">
                  Sends mail and reads or changes everything else — logs, domains, audiences,
                  webhooks and other keys.
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-2.5">
              <RadioGroupItem value="sending_access" id={`${permissionId}-send`} className="mt-1" />
              <Label htmlFor={`${permissionId}-send`} className="flex flex-col items-start gap-1">
                <span>Sending access</span>
                <span className="text-[13px] font-normal text-muted">
                  Sends mail and nothing else. It cannot read the message log, manage domains or
                  mint further keys — which is what you want on an application server.
                </span>
              </Label>
            </div>
          </RadioGroup>
        </fieldset>

        <div className="flex flex-col gap-2">
          <Label htmlFor="key-domain">Domain scope (optional)</Label>
          <Select value={domainId} onValueChange={setDomainId}>
            <SelectTrigger id="key-domain" aria-label="Domain scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_DOMAIN}>Every domain in this workspace</SelectItem>
              {(domains.data?.data ?? []).map((domain) => (
                <SelectItem key={domain.id} value={domain.id}>
                  {domain.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="m-0 text-[13px] text-muted">
            A scoped key can only send from addresses at that domain. A leaked key then cannot be
            used to send as anything else you own.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="key-expiry">Expires (optional)</Label>
          <Input
            id="key-expiry"
            type="date"
            value={expiresOn}
            className="max-w-[220px]"
            onChange={(event) => setExpiresOn(event.target.value)}
          />
          <p className="m-0 text-[13px] text-muted">
            An expiry turns a leaked key from an incident into a deadline. Keys without one live
            until they are revoked.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={name.trim() === '' || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
