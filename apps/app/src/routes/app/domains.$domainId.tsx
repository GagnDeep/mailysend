import {
  Button,
  Callout,
  HairlineRule,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatTile,
  Switch,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { AuthMark } from '~/components/app/auth-mark.tsx'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import { DnsRecordTable } from '~/components/app/dns-records.tsx'
import { num, shortDate } from '~/components/app/format.ts'
import { Handoff } from '~/components/app/handoff.tsx'
import { PageHeader, PageSection } from '~/components/app/page.tsx'
import {
  deriveReceiving,
  deriveSending,
  dmarcState,
  isManaged,
} from '~/components/app/readiness.ts'
import { ReadinessHeader } from '~/components/app/readiness-header.tsx'
import { ReceivingPanel } from '~/components/app/receiving-panel.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { DetailSkeleton, ErrorState } from '~/components/app/states.tsx'
import {
  TRANSPORT_GUIDE,
  TRANSPORT_LABEL,
  TRANSPORT_PREREQ,
  type TransportName,
} from '~/components/app/transports.ts'
import type { DomainIdentityRecord, DomainRecord } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/domains/$domainId')({
  head: () => appHead('Domain'),
  component: DomainDetail,
})

type TlsMode = 'opportunistic' | 'enforced'

/** The API returns `tls`; the contract has not caught up, so it is read loosely. */
const tlsMode = (domain: DomainRecord): TlsMode =>
  (domain as { tls?: string }).tls === 'enforced' ? 'enforced' : 'opportunistic'

const DMARC_SENTENCE: Record<string, string> = {
  none: 'A DMARC record is published at p=none: receivers report failures to you but still deliver them, so it is a monitoring policy rather than a protective one.',
  quarantine:
    'p=quarantine: mail that fails alignment for this domain lands in spam rather than the inbox, which protects your recipients without dropping mail outright.',
  reject:
    'p=reject: mail that fails alignment is refused at the door. This is the strongest setting and it only stays safe while DKIM and SPF keep passing.',
  missing:
    'No DMARC record is published. Mail still sends, but receivers have no instruction about what to do with a forgery of this domain — and some senders get a reputation penalty for the silence.',
}

const AUTH_SENTENCE = {
  dkim: {
    pass: 'Mail from this domain is signed with our key and the signature covers the From header, so a receiver can prove the message was not altered in transit.',
    fail: 'Nothing is signing this domain yet. Receivers cannot tell your mail from a forgery, and most will treat it accordingly.',
  },
  spf: {
    pass: 'The published SPF record includes our sending hosts, so the envelope sender is authorised.',
    fail: 'Our include is missing from the SPF record, so receivers see mail from a host this domain has not authorised.',
  },
} as const

function DomainDetail() {
  const { domainId } = Route.useParams()
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const returnPathId = useId()
  const transportId = useId()

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [returnPath, setReturnPath] = useState<string | null>(null)
  const [identity, setIdentity] = useState<DomainIdentityRecord | null>(null)

  const domainQuery = useQuery({
    queryKey: qk.domain(environment, domainId),
    queryFn: () => api.getDomain(domainId),
  })

  const domain = domainQuery.data

  useEffect(() => {
    if (domain) setReturnPath((current) => current ?? domain.custom_return_path)
  }, [domain])

  const verify = useMutation({
    mutationFn: () => api.verifyDomain(domainId),
    onSuccess: (verified) => {
      queryClient.setQueryData(qk.domain(environment, domainId), verified)
      const errored = verified.checked?.errored ?? 0
      if (verified.status === 'verified') {
        toast.success('Every record resolves. This domain can send.')
      } else if (errored > 0) {
        // A resolver that would not answer is not a customer who got it wrong,
        // and reporting it as "records outstanding" sent people to re-check a
        // zone that was already correct.
        toast.message(
          `${errored} of ${verified.checked?.total ?? errored} records could not be checked`,
          {
            description:
              verified.checked?.first_error ??
              'The DNS resolver did not answer. Nothing here says your zone is wrong.',
          },
        )
      } else {
        toast.message('Not verified yet — the header says what is still outstanding.')
      }
      // The transport's own view of the domain, now that verify asks for it.
      // The hand-off link used to appear only after pressing "Set up with this
      // transport", which is the one button a reader stuck on an empty record
      // table has no reason to press.
      if (verified.identity) {
        setIdentity(
          (current) =>
            ({
              object: 'domain_identity' as const,
              provider: current?.provider ?? domain?.provider ?? null,
              records: current?.records ?? [],
              ...verified.identity,
            }) as DomainIdentityRecord,
        )
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.domain(environment, domainId) })
      void queryClient.invalidateQueries({ queryKey: qk.domains(environment) })
    },
  })

  /**
   * Re-checks on its own, more slowly each time.
   *
   * DNS propagation is measured in minutes and a "Check records" button asks
   * the customer to sit there pressing it. This polls while the domain is not
   * verified and backs off — 15s, 30s, 60s, up to five minutes — so an
   * unattended tab settles into one request every five minutes instead of
   * hammering a resolver that will not have news.
   */
  const attempt = useRef(0)
  const verifying = verify.isPending
  const settled = domain?.status === 'verified'
  const runVerify = verify.mutate
  useEffect(() => {
    if (settled || verifying) {
      if (settled) attempt.current = 0
      return
    }
    const delay = Math.min(15_000 * 2 ** attempt.current, 300_000)
    const timer = setTimeout(() => {
      attempt.current += 1
      runVerify()
    }, delay)
    return () => clearTimeout(timer)
  }, [settled, verifying, runVerify])

  /**
   * The accelerator, offered rather than assumed. It only works for a zone on a
   * Cloudflare account whose token this workspace has, and it says so plainly
   * when it does not.
   */
  const automate = useMutation({
    mutationFn: () => api.automateDomainDns(domainId),
    onSuccess: (result) => {
      // Writing nothing is not a success. This transport publishes its own
      // records, and the old copy — "Every record was written" — was a green
      // toast for a no-op.
      if (result.nothing_to_write) toast.message(result.detail)
      else toast.success(result.detail)
      attempt.current = 0
      verify.mutate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const ensureIdentity = useMutation({
    mutationFn: () => api.ensureDomainIdentity(domainId),
    onSuccess: (state) => {
      setIdentity(state)
      void queryClient.invalidateQueries({ queryKey: qk.domain(environment, domainId) })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const checkReceiving = useMutation({
    mutationFn: () => api.checkReceiving(domainId),
    onSuccess: () => {
      // The observation is stored now, so the page re-reads it rather than
      // holding an answer that disappears on the next navigation.
      void queryClient.invalidateQueries({ queryKey: qk.domain(environment, domainId) })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  /**
   * Optimistic on purpose: these are booleans and a string the server echoes
   * back, so a rejected write rolls back to a value that was correct a moment
   * ago. Nothing has been sent on the strength of the optimistic state.
   */
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.updateDomain(domainId, body),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: qk.domain(environment, domainId) })
      const previous = queryClient.getQueryData<DomainRecord>(qk.domain(environment, domainId))
      if (previous) {
        queryClient.setQueryData<DomainRecord>(qk.domain(environment, domainId), {
          ...previous,
          ...body,
        } as DomainRecord)
      }
      return { previous }
    },
    onError: (error, _body, context) => {
      if (context?.previous) {
        queryClient.setQueryData(qk.domain(environment, domainId), context.previous)
      }
      toast.error(errorMessage(error))
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.domain(environment, domainId) })
      void queryClient.invalidateQueries({ queryKey: qk.domains(environment) })
    },
  })

  const remove = useMutation({
    mutationFn: () => api.deleteDomain(domainId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.domains(environment) })
      toast.success('Domain deleted.')
      void navigate({ to: '/app/domains' })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  if (domainQuery.isLoading) return <DetailSkeleton />
  if (domainQuery.error || !domain) {
    return (
      <ErrorState
        error={domainQuery.error}
        subject="this domain"
        onRetry={() => void domainQuery.refetch()}
      />
    )
  }

  const quota = domain.daily_quota
  const sending = deriveSending(domain)
  const receiving = deriveReceiving(domain)
  const managed = isManaged(domain)
  const transport = (domain.provider ?? null) as TransportName | null
  const records = domain.records ?? []

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/app/domains" className="inline-flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft aria-hidden="true" className="size-3" />
            Domains
          </Link>
        }
        title={<span className="flex flex-wrap items-center gap-3">{domain.name}</span>}
        description={`Added ${shortDate(domain.created_at)} · region ${domain.region} · sends through ${
          transport ? TRANSPORT_LABEL[transport] : 'whatever the workspace routes through'
        }`}
      />

      {/*
        The answer first.

        The two questions a person opening this page has are "can I send from
        this domain yet" and "can I receive on it". Seven co-equal sections
        answered neither — and put the two contradictory signals (Cloudflare
        publishes these records / DKIM is failing) in different sections with
        nothing relating them. Everything below is now evidence for one of these
        two claims.
      */}
      <ReadinessHeader
        sending={sending}
        receiving={receiving}
        sendingAction={
          <Button
            size="sm"
            variant="accent"
            disabled={verify.isPending}
            onClick={() => {
              attempt.current = 0
              verify.mutate()
            }}
          >
            {verify.isPending ? 'Checking…' : 'Check records'}
          </Button>
        }
        receivingAction={
          <Button
            size="sm"
            variant="outline"
            disabled={checkReceiving.isPending}
            onClick={() => checkReceiving.mutate()}
          >
            {checkReceiving.isPending ? 'Resolving MX…' : 'Check receiving'}
          </Button>
        }
      />

      {/*
        A send that failed permanently is otherwise invisible until somebody
        reads a log — including "this domain is bound to a transport you have
        not configured", whose whole point is that a setting has to change.
      */}
      {domain.last_send_error ? (
        <Callout variant="warn" title="The last send from this domain failed">
          {domain.last_send_error.error}
          <span className="mt-2 block text-[12.5px] text-muted-2">
            {shortDate(domain.last_send_error.at)}
            {domain.last_send_error.provider ? ` · ${domain.last_send_error.provider}` : ''} ·{' '}
            {domain.last_send_error.email_id}
          </span>
        </Callout>
      ) : null}

      {/*
        The hand-off, where there is one. Every record `observe` means the
        transport publishes its own and there is nothing here to copy — so the
        link is the affordance, not the table.
      */}
      {managed && identity?.external ? (
        <Handoff
          title={`${transport ? TRANSPORT_LABEL[transport] : 'This transport'} sets ${domain.name} up for you`}
          body={
            <>
              It writes every DNS record itself — there is nothing here to copy, and nothing to
              paste. Finish the onboarding there, then press <strong>Check records</strong>.
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
              attempt.current = 0
              verify.mutate()
            }}
          >
            {verify.isPending ? 'Checking…' : 'Check records'}
          </Button>
        </Handoff>
      ) : null}

      <PageSection
        title="Receiving setup"
        description="Addresses on this domain that accept mail, and the one step only you can confirm."
      >
        <ReceivingPanel domain={domain} />
      </PageSection>

      <PageSection
        title="Evidence"
        description="What receivers can currently prove about mail claiming to be from this domain, and the records behind it."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4 rounded-tile border border-line-soft bg-card px-4 py-3">
            <AuthMark label="DKIM" state={domain.dkim_ready} />
            <AuthMark label="SPF" state={domain.spf_ready} />
            <AuthMark label="DMARC" state={dmarcState(domain)} />
            <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.08em] text-muted-3">
              {domain.checked
                ? `${domain.checked.resolved} of ${domain.checked.total} records resolve`
                : `${records.length} records`}
            </span>
          </div>

          <dl className="m-0 grid gap-3 sm:grid-cols-3">
            <AuthFact
              term="DKIM"
              state={domain.dkim_ready}
              body={
                domain.dkim_ready === undefined
                  ? 'No check has run yet.'
                  : domain.dkim_ready
                    ? AUTH_SENTENCE.dkim.pass
                    : AUTH_SENTENCE.dkim.fail
              }
            />
            <AuthFact
              term="SPF"
              state={domain.spf_ready}
              body={
                domain.spf_ready === undefined
                  ? 'No check has run yet.'
                  : domain.spf_ready
                    ? AUTH_SENTENCE.spf.pass
                    : AUTH_SENTENCE.spf.fail
              }
            />
            <AuthFact
              term={`DMARC${domain.dmarc_policy ? ` · ${domain.dmarc_policy}` : ''}`}
              state={dmarcState(domain)}
              body={
                domain.dmarc_policy
                  ? (DMARC_SENTENCE[domain.dmarc_policy] ?? 'Policy published.')
                  : 'No check has run yet. Check the records to read the published policy.'
              }
            />
          </dl>

          {/*
            Folded, because a four-row table every row of which says "do not add
            this by hand" is not the first thing a reader needs. It is still one
            click away, and it is still what the check is against.
          */}
          <details
            className="rounded-code border border-line bg-paper p-3"
            open={!managed && domain.status !== 'verified'}
          >
            <summary className="cursor-pointer list-none text-[13.5px] font-semibold text-muted hover:text-ink">
              {managed
                ? `Records we will check (${records.length})`
                : `Records to publish (${records.length})`}
            </summary>
            <div className="mt-3">
              <DnsRecordTable
                domain={domain}
                verifying={verify.isPending}
                managedNote={!managed}
                onVerify={() => {
                  attempt.current = 0
                  verify.mutate()
                }}
                zoneFileHref={api.domainZoneFileUrl(domainId)}
              />
            </div>
          </details>
        </div>
      </PageSection>

      <PageSection
        title="Daily quota"
        description="What the provider actually lets this domain send in a day."
      >
        <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
          <StatTile
            label="Learned daily quota"
            value={quota === null || quota === undefined ? 'not learned yet' : num(quota)}
            unit={quota === null || quota === undefined ? undefined : 'messages/day'}
          />
          <div className="rounded-tile border border-line-soft bg-card p-4 text-[14px] leading-relaxed text-muted">
            <p className="m-0">
              This number is observed, not configured. Providers ramp a new domain without
              publishing the ceiling, so the sending actor watches for rate rejections and records
              the level at which they start. You cannot raise it here — it rises on its own as the
              domain builds a sending history.
            </p>
            {quota === null || quota === undefined ? (
              <p className="m-0 mt-2">
                Nothing has been rejected for rate yet, so there is no observed ceiling. That is not
                the same as unlimited: it means we have not been told where the limit is.
              </p>
            ) : null}
          </div>
        </div>
      </PageSection>

      <PageSection title="Settings">
        <div className="flex flex-col gap-4 rounded-tile border border-line-soft bg-card p-4">
          {/*
            The binding lives here now, because it is a configuration decision
            rather than a status. It is also no longer decorative: a bound
            domain's sends are pinned to that transport and are not failed over,
            since the records published for it authorise that transport and no
            other.
          */}
          <div className="flex flex-col gap-2">
            <Label htmlFor={transportId}>Sending transport</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={domain.provider ?? 'default'}
                onValueChange={(value) =>
                  update.mutate({ provider: value === 'default' ? null : value })
                }
              >
                <SelectTrigger id={transportId} className="w-[260px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cloudflare">{TRANSPORT_LABEL.cloudflare}</SelectItem>
                  <SelectItem value="ses">{TRANSPORT_LABEL.ses}</SelectItem>
                  <SelectItem value="resend">{TRANSPORT_LABEL.resend}</SelectItem>
                  <SelectItem value="smtp">{TRANSPORT_LABEL.smtp}</SelectItem>
                  <SelectItem value="default">Whatever the workspace routes through</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                disabled={ensureIdentity.isPending}
                onClick={() => ensureIdentity.mutate()}
              >
                {ensureIdentity.isPending ? 'Asking…' : 'Set up with this transport'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                // Nothing to write is not a job to offer. Every Cloudflare
                // record is `observe`, so this button had no work to do and
                // still toasted "Every record was written".
                disabled={automate.isPending || managed}
                title={
                  managed
                    ? 'This transport publishes its own records, so there is nothing for us to write.'
                    : undefined
                }
                onClick={() => automate.mutate()}
              >
                {automate.isPending ? 'Writing…' : 'Write records for me'}
              </Button>
            </div>
            <p className="m-0 max-w-[80ch] text-[13.5px] leading-relaxed text-muted">
              {transport ? TRANSPORT_PREREQ[transport] : null}
              {transport ? ' ' : null}
              {transport ? (
                <a
                  className="text-accent underline-offset-2 hover:underline"
                  href={TRANSPORT_GUIDE[transport]}
                >
                  How this transport is set up →
                </a>
              ) : (
                <>
                  Unbound, the records are the union across every transport this workspace could
                  fall back to — so this domain publishes SPF includes authorising transports its
                  mail will never leave through. Naming one is what makes the record list correct.
                </>
              )}
            </p>
            {managed ? (
              <p className="m-0 max-w-[80ch] text-[13px] text-muted-2">
                Every record for this domain is published by the transport, so there is nothing for
                us to write into your zone — we only resolve them and report what we find.
              </p>
            ) : null}
          </div>

          <HairlineRule soft />

          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="text-[14.5px] font-medium">Open tracking</div>
              <p className="m-0 mt-1 max-w-[70ch] text-[13.5px] text-muted">
                Adds a tracking pixel to HTML mail from this domain. Mailbox-provider prefetching
                inflates raw opens, which is why the dashboard reports the human figure by default.
              </p>
            </div>
            <Switch
              checked={domain.open_tracking}
              aria-label="Open tracking"
              onCheckedChange={(checked) => update.mutate({ open_tracking: checked })}
            />
          </div>

          <HairlineRule soft />

          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="text-[14.5px] font-medium">Click tracking</div>
              <p className="m-0 mt-1 max-w-[70ch] text-[13.5px] text-muted">
                Rewrites links so clicks are attributable. Rewritten links change what the recipient
                sees on hover, so some senders leave this off for transactional mail.
              </p>
            </div>
            <Switch
              checked={domain.click_tracking}
              aria-label="Click tracking"
              onCheckedChange={(checked) => update.mutate({ click_tracking: checked })}
            />
          </div>

          <HairlineRule soft />

          <div className="flex flex-col gap-2">
            <Label htmlFor={returnPathId}>Custom return path</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={returnPathId}
                value={returnPath ?? ''}
                spellCheck={false}
                autoComplete="off"
                className="max-w-[260px] font-mono"
                onChange={(event) => setReturnPath(event.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={
                  update.isPending ||
                  returnPath === null ||
                  returnPath === domain.custom_return_path
                }
                onClick={() => update.mutate({ custom_return_path: returnPath })}
              >
                Save return path
              </Button>
            </div>
            <p className="m-0 max-w-[80ch] text-[13.5px] text-muted">
              One DNS label. Bounces come back to{' '}
              <code className="font-mono text-ink">
                {returnPath ?? domain.custom_return_path}.{domain.name}
              </code>
              , so changing it republishes the CNAME and the domain needs checking again.
            </p>
          </div>

          <HairlineRule soft />

          <div className="flex flex-col gap-2">
            <Label htmlFor="tls-mode">TLS</Label>
            <Select
              value={tlsMode(domain)}
              onValueChange={(value) => update.mutate({ tls: value })}
            >
              <SelectTrigger id="tls-mode" className="max-w-[260px]" aria-label="TLS mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="opportunistic">Opportunistic</SelectItem>
                <SelectItem value="enforced">Enforced</SelectItem>
              </SelectContent>
            </Select>
            <p className="m-0 max-w-[80ch] text-[13.5px] text-muted">
              Opportunistic encrypts whenever the receiving server offers STARTTLS and delivers in
              the clear when it does not. Enforced refuses to deliver without TLS — safer, and it
              will bounce mail to the small number of receivers that still cannot negotiate it.
            </p>
          </div>
        </div>
      </PageSection>

      <PageSection title="Danger zone">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-tile border border-line bg-tint p-4">
          <p className="m-0 max-w-[70ch] text-[13.5px] text-muted">
            Deleting removes the domain, its DKIM key and its record set from this workspace.
          </p>
          <Button variant="accent" size="sm" onClick={() => setConfirmDelete(true)}>
            Delete domain
          </Button>
        </div>
      </PageSection>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${domain.name}`}
        description="The domain, its signing key and its DNS record set are removed from this workspace."
        confirmPhrase={domain.name}
        confirmLabel="Delete domain"
        pending={remove.isPending}
        consequences={
          <>
            Mail already queued or scheduled from an address at {domain.name} will fail rather than
            send: the send path looks the domain up at delivery time and there will be nothing to
            find. Any API key scoped to this domain stops working, and re-adding the domain later
            mints a new DKIM key, so the DNS records have to be published again from scratch.
          </>
        }
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}

/** One authentication fact, stated in a sentence rather than a status word. */
const AuthFact = ({
  term,
  state,
  body,
}: {
  term: string
  state: boolean | undefined
  body: string
}) => (
  <div className="rounded-tile border border-line-soft bg-card p-3.5">
    <dt className="flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.08em]">
      <span>{term}</span>
      <span
        className={state === undefined ? 'text-muted-3' : state ? 'text-positive' : 'text-warning'}
      >
        {state === undefined ? 'not checked' : state ? 'passing' : 'failing'}
      </span>
    </dt>
    <dd className="m-0 mt-1.5 text-[13px] leading-[1.6] text-muted">{body}</dd>
  </div>
)
