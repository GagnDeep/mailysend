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
import { Check, Globe, Minus, Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import type { Column } from '~/components/app/data-table.tsx'
import { DataTable } from '~/components/app/data-table.tsx'
import { DnsRecordTable } from '~/components/app/dns-records.tsx'
import { num, shortDate } from '~/components/app/format.ts'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import type { DomainIdentityRecord, DomainRecord } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/domains/')({
  head: () => appHead('Domains'),
  component: Domains,
})

/**
 * The three authentication marks.
 *
 * `undefined` is its own state and is drawn as such: the list endpoint does not
 * report DKIM and SPF until a domain has been checked, and a hollow dash is
 * honest where a red cross would be an accusation.
 */
const AuthMark = ({ label, state }: { label: string; state: boolean | undefined }) => {
  const text =
    state === undefined
      ? `${label} not checked yet`
      : state
        ? `${label} passing`
        : `${label} failing`
  return (
    <span className="inline-flex items-center gap-1" title={text}>
      <span className="sr-only">{text}</span>
      {state === undefined ? (
        <Minus aria-hidden="true" className="size-3 text-muted-3" />
      ) : state ? (
        <Check aria-hidden="true" className="size-3 text-positive" />
      ) : (
        <X aria-hidden="true" className="size-3 text-warning" />
      )}
      <span aria-hidden="true" className="font-mono text-[11px] text-muted-2">
        {label}
      </span>
    </span>
  )
}

/**
 * Three states, not two. Null and undefined both mean nobody has read DNS for
 * this domain yet, which must not render as a tick — a domain that has never
 * been checked would otherwise claim a DMARC policy it may not have.
 */
const dmarcState = (domain: DomainRecord): boolean | undefined => {
  if (domain.dmarc_policy === undefined || domain.dmarc_policy === null) return undefined
  return domain.dmarc_policy !== 'missing'
}

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
            <p className="m-0 text-[14px] text-muted">
              {managed
                ? `${domain.name} is set up by the transport itself — there is nothing for you to copy here. The records below are listed because we check them.`
                : step === 1
                  ? `Add these records to the DNS zone for ${domain.name}. Leave them in place — removing one later stops the domain sending.`
                  : 'We resolve each record ourselves. Anything still pending has simply not reached our resolver yet.'}
            </p>

            {/* For an `observe`-only transport the hand-off is the primary
                action, not a footnote under an empty table. */}
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
            {step === 2 ? (
              <p className="m-0 flex items-center gap-2 text-[13.5px] text-muted">
                Current state: <StatusBadge status={domain.status} size="sm" />
              </p>
            ) : null}
            <DnsRecordTable
              domain={domain}
              verifying={verify.isPending}
              // The sentence above already says who publishes these, and
              // saying it twice above one four-row table is most of what made
              // this screen unreadable.
              managedNote={!managed}
              onVerify={() => {
                setStep(2)
                verify.mutate(domain.id)
              }}
            />
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
