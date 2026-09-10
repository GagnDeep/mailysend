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
  StatusBadge,
  Switch,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import { DnsRecordTable } from '~/components/app/dns-records.tsx'
import { num, shortDate } from '~/components/app/format.ts'
import { PageHeader, PageSection } from '~/components/app/page.tsx'
import { ReceivingPanel } from '~/components/app/receiving-panel.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { DetailSkeleton, ErrorState } from '~/components/app/states.tsx'
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

const authSentence = (
  ready: boolean | undefined,
  passing: string,
  failing: string,
): { label: string; body: string; tone: 'positive' | 'warn' | 'quiet' } =>
  ready === undefined
    ? {
        label: 'not checked',
        body: 'No check has run yet. Verify the DNS records to find out.',
        tone: 'quiet',
      }
    : ready
      ? { label: 'passing', body: passing, tone: 'positive' }
      : { label: 'failing', body: failing, tone: 'warn' }

const DMARC_SENTENCE: Record<string, string> = {
  none: 'A DMARC record is published at p=none: receivers report failures to you but still deliver them, so it is a monitoring policy rather than a protective one.',
  quarantine:
    'p=quarantine: mail that fails alignment for this domain lands in spam rather than the inbox, which protects your recipients without dropping mail outright.',
  reject:
    'p=reject: mail that fails alignment is refused at the door. This is the strongest setting and it only stays safe while DKIM and SPF keep passing.',
  missing:
    'No DMARC record is published. Mail still sends, but receivers have no instruction about what to do with a forgery of this domain — and some senders get a reputation penalty for the silence.',
}

const AuthRow = ({
  name,
  state,
}: {
  name: string
  state: { label: string; body: string; tone: 'positive' | 'warn' | 'quiet' }
}) => (
  <div className="flex flex-col gap-1 border-b border-line-soft py-3 last:border-0">
    <div className="flex items-center gap-2.5">
      <span className="font-mono text-[12px] uppercase tracking-[0.08em]">{name}</span>
      <span
        className={
          state.tone === 'positive'
            ? 'font-mono text-[11.5px] text-positive'
            : state.tone === 'warn'
              ? 'font-mono text-[11.5px] text-warning'
              : 'font-mono text-[11.5px] text-muted-2'
        }
      >
        {state.label}
      </span>
    </div>
    <p className="m-0 max-w-[80ch] text-[13.5px] leading-relaxed text-muted">{state.body}</p>
  </div>
)

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
      toast[verified.status === 'verified' ? 'success' : 'message'](
        verified.status === 'verified'
          ? 'Every record resolves. This domain can send.'
          : 'Not verified yet — the table shows which records are still outstanding.',
      )
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
      toast.success(result.detail)
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

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/app/domains" className="inline-flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft aria-hidden="true" className="size-3" />
            Domains
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {domain.name}
            <StatusBadge status={domain.status} />
          </span>
        }
        description={`Added ${shortDate(domain.created_at)} · region ${domain.region}`}
      />

      <PageSection
        title="Sending transport"
        description="Which transport carries mail for this domain, and therefore which records it needs."
      >
        <div className="flex flex-col gap-4 rounded-tile border border-line-soft bg-card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={transportId}>Transport</Label>
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
                  <SelectItem value="default">Whatever the workspace routes through</SelectItem>
                  <SelectItem value="cloudflare">Cloudflare Email Service</SelectItem>
                  <SelectItem value="ses">Amazon SES</SelectItem>
                  <SelectItem value="resend">Resend</SelectItem>
                  <SelectItem value="smtp">SMTP relay</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="accent"
              disabled={ensureIdentity.isPending}
              onClick={() => ensureIdentity.mutate()}
            >
              {ensureIdentity.isPending ? 'Asking…' : 'Set up with this transport'}
            </Button>
            <Button
              variant="outline"
              disabled={automate.isPending}
              onClick={() => automate.mutate()}
            >
              {automate.isPending ? 'Writing…' : 'Write records for me'}
            </Button>
          </div>
          <p className="m-0 max-w-[80ch] text-[13.5px] leading-relaxed text-muted">
            Binding a transport is what makes the record list below correct. Left unbound, the
            records are the union across every transport this workspace could fall back to, and two
            transports that each want an apex SPF record cannot both have one — so the includes are
            merged into a single record instead.
          </p>

          {identity ? (
            <Callout
              variant={
                identity.status === 'verified'
                  ? 'success'
                  : identity.status === 'failed'
                    ? 'warn'
                    : 'info'
              }
              title={identity.external ? 'This transport does its own setup' : 'Transport setup'}
            >
              {identity.detail ?? 'No further detail.'}
              {identity.external ? (
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
              ) : null}
            </Callout>
          ) : null}
        </div>
      </PageSection>

      <PageSection
        title="DNS records"
        description="Everything below has to resolve before this domain can send."
      >
        <DnsRecordTable
          domain={domain}
          verifying={verify.isPending}
          onVerify={() => {
            attempt.current = 0
            verify.mutate()
          }}
          zoneFileHref={api.domainZoneFileUrl(domainId)}
        />
      </PageSection>

      <PageSection
        title="Receiving"
        description="Addresses on this domain that accept mail, and what has to be true before any arrives."
      >
        <ReceivingPanel domain={domain} />
      </PageSection>

      <PageSection
        title="Deliverability"
        description="What receivers can currently prove about mail claiming to be from this domain."
      >
        <div className="rounded-tile border border-line-soft bg-card px-4 py-1">
          <AuthRow
            name="DKIM"
            state={authSentence(
              domain.dkim_ready,
              'Mail from this domain is signed with our key and the signature covers the From header, so a receiver can prove the message was not altered in transit.',
              'Nothing is signing this domain yet. Receivers cannot tell your mail from a forgery, and most will treat it accordingly.',
            )}
          />
          <AuthRow
            name="SPF"
            state={authSentence(
              domain.spf_ready,
              'The published SPF record includes our sending hosts, so the envelope sender is authorised.',
              'Our include is missing from the SPF record, so receivers see mail from a host this domain has not authorised.',
            )}
          />
          <AuthRow
            name="DMARC"
            // Null and undefined both mean "nobody has looked yet", which is a
            // different answer from `missing` — read, and not there.
            state={{
              label: domain.dmarc_policy ?? 'not checked',
              body: domain.dmarc_policy
                ? (DMARC_SENTENCE[domain.dmarc_policy] ?? 'Policy published.')
                : 'No check has run yet. Verify the DNS records to read the published policy.',
              tone: !domain.dmarc_policy
                ? 'quiet'
                : domain.dmarc_policy === 'missing'
                  ? 'warn'
                  : 'positive',
            }}
          />
        </div>
        {domain.dmarc_policy === 'missing' ? (
          <Callout variant="warn" title="worth doing, not urgent">
            A missing DMARC record is not an error and does not stop this domain sending. It is the
            next thing to add once DKIM and SPF pass — start at{' '}
            <code className="font-mono">p=none</code> and read the reports for a couple of weeks
            before tightening it.
          </Callout>
        ) : null}
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
              , so changing it republishes the CNAME above and the domain needs verifying again.
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
