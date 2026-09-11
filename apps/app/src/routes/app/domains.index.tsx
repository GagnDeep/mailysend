import { CreateDomainRequest } from '@mailysend/contracts'
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
  Pill,
  StatusBadge,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Globe, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { AuthMark } from '~/components/app/auth-mark.tsx'
import type { Column } from '~/components/app/data-table.tsx'
import { DataTable } from '~/components/app/data-table.tsx'
import { DnsRecordTable } from '~/components/app/dns-records.tsx'
import { num, shortDate } from '~/components/app/format.ts'
import { Handoff } from '~/components/app/handoff.tsx'
import { PageHeader } from '~/components/app/page.tsx'
import { dmarcState } from '~/components/app/readiness.ts'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import { transportLabel } from '~/components/app/transports.ts'
import type { DomainIdentityRecord, DomainRecord } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/domains/')({
  head: () => appHead('Domains'),
  component: Domains,
})

function Domains() {
  const api = useApi()
  const environment = useEnvironment()
  const [wizardOpen, setWizardOpen] = useState(false)

  const domains = useQuery({
    queryKey: qk.domains(environment),
    queryFn: () => api.listDomains({ limit: 100 }),
  })

  const columns: Column<DomainRecord>[] = [
    {
      id: 'name',
      header: 'Domain',
      sortBy: (row) => row.name,
      cell: (row) => (
        <Link
          to="/app/domains/$domainId"
          params={{ domainId: row.id }}
          className="font-medium text-ink hover:text-accent"
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
      id: 'auth',
      header: 'Authentication',
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2.5">
          <AuthMark label="DKIM" state={row.dkim_ready} />
          <AuthMark label="SPF" state={row.spf_ready} />
          <AuthMark label="DMARC" state={dmarcState(row)} />
        </span>
      ),
    },
    {
      id: 'quota',
      header: 'Daily quota',
      align: 'right',
      sortBy: (row) => row.daily_quota ?? -1,
      cell: (row) =>
        row.daily_quota === null || row.daily_quota === undefined ? (
          <span className="text-[13px] text-muted-2">not learned yet</span>
        ) : (
          <span className="font-mono text-[13px]">{num(row.daily_quota)}</span>
        ),
    },
    {
      id: 'created',
      header: 'Added',
      sortBy: (row) => row.created_at,
      cell: (row) => <span className="text-[13px] text-muted">{shortDate(row.created_at)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Deliverability"
        title="Sending domains"
        description="A domain sends once its DNS records resolve to what we published. Verification reads DNS from our side, so it is the receiver's view rather than yours."
        actions={
          <Button size="sm" onClick={() => setWizardOpen(true)}>
            <Plus aria-hidden="true" />
            Add domain
          </Button>
        }
      />

      {domains.isLoading ? (
        <TableSkeleton rows={4} columns={5} />
      ) : domains.error ? (
        <ErrorState
          error={domains.error}
          subject="your sending domains"
          onRetry={() => void domains.refetch()}
        />
      ) : (domains.data?.data.length ?? 0) === 0 ? (
        <EmptyState
          icon={Globe}
          title="No sending domains yet"
          description="Mail needs a domain you control, signed with DKIM and aligned with SPF. Setup is three DNS records and a check."
          action={{ label: 'Add your first domain', onClick: () => setWizardOpen(true) }}
          secondaryAction={{ label: 'How verification works', href: '/docs#domains' }}
        />
      ) : (
        <DataTable
          rows={domains.data?.data ?? []}
          columns={columns}
          rowId={(row) => row.id}
          caption="Sending domains in this workspace"
          defaultSort={{ columnId: 'created', direction: 'desc' }}
        />
      )}

      <AddDomainWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </>
  )
}

const STEPS = ['Name the domain', 'Publish the records', 'Verify'] as const

const AddDomainWizard = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const nameId = useId()

  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)
  const [domain, setDomain] = useState<DomainRecord | null>(null)
  const [identity, setIdentity] = useState<DomainIdentityRecord | null>(null)

  const reset = () => {
    setStep(0)
    setName('')
    setInvalid(null)
    setDomain(null)
    setIdentity(null)
  }

  /**
   * Ask the transport to register the domain, the moment it exists.
   *
   * The wizard never called this, so a Cloudflare-routed domain reached step 2
   * with an empty record table under the words "Add these records to the DNS
   * zone" — instructions for a list that was not there, and no sign of the
   * hand-off link that is the actual next step. Best-effort: the records we
   * compute stand on their own if the transport will not answer.
   */
  const ensureIdentity = useMutation({
    mutationFn: (id: string) => api.ensureDomainIdentity(id),
    onSuccess: (state) => setIdentity(state),
    onError: () => setIdentity(null),
  })

  const create = useMutation({
    mutationFn: (value: string) => api.createDomain({ name: value }),
    onSuccess: (created) => {
      setDomain(created)
      setStep(1)
      ensureIdentity.mutate(created.id)
      void queryClient.invalidateQueries({ queryKey: qk.domains(environment) })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const verify = useMutation({
    mutationFn: (id: string) => api.verifyDomain(id),
    onSuccess: (verified) => {
      setDomain(verified)
      void queryClient.invalidateQueries({ queryKey: qk.domains(environment) })
      toast[verified.status === 'verified' ? 'success' : 'message'](
        verified.status === 'verified'
          ? `${verified.name} is verified.`
          : `${verified.name} is not verified yet.`,
      )
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  /**
   * Whether every record here is one the transport publishes itself.
   *
   * The old test was "are there no records at all", which stopped being true
   * the moment Cloudflare's records were derived whether or not its credentials
   * were present — so a Cloudflare domain got the copy-these-records
   * instructions, the nothing-to-copy callout, and a per-row "do not add this
   * by hand" on all four rows, all at once.
   */
  const records = domain?.records ?? []
  const managed = records.length > 0 && records.every((record) => record.origin === 'observe')

  const submitName = () => {
    const candidate = name.trim().toLowerCase()
    // The API validates this too; doing it here as well means the reader is
    // told which character is wrong before a round trip, in the API's words.
    const parsed = CreateDomainRequest.safeParse({ name: candidate })
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]?.message ?? 'That is not a domain we can send from.')
      return
    }
    setInvalid(null)
    create.mutate(candidate)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[85dvh] max-w-[860px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a sending domain</DialogTitle>
          <DialogDescription>
            Three steps. The middle one happens at your DNS provider, not here.
          </DialogDescription>
        </DialogHeader>

        <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
          {STEPS.map((label, index) => (
            <li key={label}>
              <Pill
                tone={index === step ? 'ink' : index < step ? 'positive' : 'outline'}
                size="sm"
                aria-current={index === step ? 'step' : undefined}
              >
                {index + 1}. {label}
              </Pill>
            </li>
          ))}
        </ol>

        {step === 0 ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={nameId}>Domain</Label>
            <Input
              id={nameId}
              value={name}
              placeholder="example.com"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={`${nameId}-help`}
              className="font-mono"
              onChange={(event) => {
                setName(event.target.value)
                setInvalid(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitName()
              }}
            />
            <p id={`${nameId}-help`} className="m-0 text-[13px] text-muted">
              {invalid ? (
                <span className="text-warning">{invalid}</span>
              ) : (
                'The bare domain — no https://, no www, no trailing slash. Subdomains such as mail.example.com are allowed and are usually the better choice.'
              )}
            </p>
          </div>
        ) : null}

        {step > 0 && domain ? (
          <div className="flex flex-col gap-3">
            {/*
              The easy path first.
              
              When the transport publishes its own records — every row
              `observe`, which is every Cloudflare domain — copying is not the
              job and never was. Leading with a table of values nobody types
              made a two-click hand-off read like fifteen minutes of DNS work,
              so the hand-off is the affordance and the records fold away
              beneath it as "what we will check".
            */}
            {managed && identity?.external ? (
              <Handoff
                title={`${transportLabel(domain.provider)} sets ${domain.name} up for you`}
                body={
                  <>
                    In its dashboard, onboard this domain. It writes every DNS record itself — there
                    is nothing here to copy, and nothing to paste. Come back and press{' '}
                    <strong>Check records</strong> when it is done.
                  </>
                }
                href={identity.external.url}
                linkLabel={identity.external.label}
                detail={identity.detail ?? null}
              >
                <Button
                  variant="outline"
                  disabled={verify.isPending}
                  onClick={() => {
                    setStep(2)
                    verify.mutate(domain.id)
                  }}
                >
                  {verify.isPending ? 'Checking…' : 'Check records'}
                </Button>
              </Handoff>
            ) : (
              <>
                <p className="m-0 text-[14px] text-muted">
                  {step === 1
                    ? `Add these records to the DNS zone for ${domain.name}. Leave them in place — removing one later stops the domain sending.`
                    : 'We resolve each record ourselves. Anything still pending has simply not reached our resolver yet.'}
                </p>
                {identity?.external ? (
                  <Callout variant="info" title="This transport does its own setup">
                    {identity.detail ?? 'The records below are checked, not copied.'}
                    <span className="mt-2 block">
                      <a
                        className="text-accent underline-offset-2 hover:underline"
                        href={identity.external.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {identity.external.label} →
                      </a>
                    </span>
                  </Callout>
                ) : null}
              </>
            )}

            {/*
              The binding is decided at create time now, so say what it decided.
              A domain created unbound published records authorising every
              transport the router could fall back to; leaving that implicit is
              how somebody ends up reading a record list they cannot account
              for.
            */}
            <p className="m-0 flex flex-wrap items-center gap-2 text-[13.5px] text-muted">
              {step === 2 ? (
                <>
                  Current state: <StatusBadge status={domain.status} size="sm" /> ·{' '}
                </>
              ) : null}
              <span>
                Sends through <strong>{transportLabel(domain.provider)}</strong>, which is what the
                records below are for.
              </span>
            </p>

            {managed ? (
              <details className="rounded-code border border-line bg-paper p-3">
                <summary className="cursor-pointer list-none text-[13.5px] font-semibold text-muted hover:text-ink">
                  Records we will check ({records.length})
                </summary>
                <div className="mt-3">
                  <DnsRecordTable
                    domain={domain}
                    verifying={verify.isPending}
                    managedNote={false}
                    onVerify={() => {
                      setStep(2)
                      verify.mutate(domain.id)
                    }}
                  />
                </div>
              </details>
            ) : (
              <DnsRecordTable
                domain={domain}
                verifying={verify.isPending}
                // The sentence above already says who publishes these, and
                // saying it twice above one four-row table is most of what made
                // this screen unreadable.
                managedNote={true}
                onVerify={() => {
                  setStep(2)
                  verify.mutate(domain.id)
                }}
              />
            )}
          </div>
        ) : null}

        <DialogFooter>
          {step === 0 ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={create.isPending || name.trim() === ''} onClick={submitName}>
                {create.isPending ? 'Creating…' : 'Continue'}
              </Button>
            </>
          ) : step === 1 ? (
            // "I've added the records" is a lie for a domain whose records
            // nobody adds by hand. The table's own Check records is the single
            // verify control; this one only advances.
            <Button onClick={() => setStep(2)}>
              {managed ? 'Continue' : "I've added the records"}
            </Button>
          ) : (
            <>
              {domain ? (
                <Button asChild variant="ghost">
                  <Link to="/app/domains/$domainId" params={{ domainId: domain.id }}>
                    Open the domain
                  </Link>
                </Button>
              ) : null}
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
