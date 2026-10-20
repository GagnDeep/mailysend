import { Button, StatusDot } from '@mailysend/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { qk } from '../../lib/query.ts'
import { useApi, useEnvironment } from './scope.tsx'

/**
 * The four things between a fresh instance and its first delivered message.
 *
 * A deployment that has sent nothing used to land on an Overview of zeroes and
 * an empty log with one generic "send your first message" nudge — and the
 * reason it had sent nothing was almost never that nobody had tried. It was a
 * transport with no credentials, or a domain whose DNS was half published, and
 * none of that was visible from the screen the operator lands on. The
 * readiness rails existed, but only on a domain's own page, which is a page you
 * reach *after* you know to add a domain.
 *
 * Every row here is read from the API rather than remembered: the list is the
 * current state of the instance each time it renders, so a step that was
 * completed elsewhere is already ticked and a step that was undone comes back.
 * Nothing is stored, and the panel disappears on its own once mail is flowing.
 */
export const FirstRunChecklist = ({ enabled }: { enabled: boolean }) => {
  const api = useApi()
  const environment = useEnvironment()

  const domains = useQuery({
    queryKey: qk.domains(environment),
    queryFn: () => api.listDomains(),
    enabled,
  })
  const providers = useQuery({
    queryKey: qk.providers(),
    queryFn: () => api.listProviders(),
    enabled,
  })
  const keys = useQuery({
    queryKey: qk.apiKeys(environment),
    queryFn: () => api.listApiKeys(),
    enabled,
  })

  // Nothing is claimed until all three have answered. A checklist that shows
  // four unticked rows while it loads tells a configured instance it is empty.
  if (!enabled || !domains.data || !providers.data || !keys.data) return null

  const verified = domains.data.data.filter((domain) => domain.status === 'verified')
  // `default_provider` is what a send would leave through with nothing
  // configured here — on Cloudflare that is a real answer, so an instance with
  // no stored transport is not necessarily an instance that cannot send.
  const transport =
    providers.data.data.find((provider) => provider.enabled)?.provider ??
    providers.data.default_provider

  const steps = [
    {
      done: Boolean(transport),
      label: transport ? `Sending through ${transport}` : 'Choose a transport',
      detail: transport
        ? 'Mail leaves through this one until another takes priority.'
        : 'Nothing will leave the building until there is something to hand it to.',
      to: '/app/settings' as const,
      search: { section: 'provider' as const },
      cta: 'Settings → Transports',
    },
    {
      done: verified.length > 0,
      label:
        verified.length > 0
          ? `Sending from ${verified[0]?.name}${verified.length > 1 ? ` and ${verified.length - 1} more` : ''}`
          : 'Verify a sending domain',
      detail:
        verified.length > 0
          ? 'DKIM and SPF resolve, so this domain signs and aligns.'
          : 'Receivers drop unsigned mail long before anybody reads it. The wizard publishes the records or hands you a zone file.',
      to: '/app/domains' as const,
      search: undefined,
      cta: 'Add a domain',
    },
    {
      done: keys.data.data.length > 0,
      label: keys.data.data.length > 0 ? 'An API key exists' : 'Create an API key',
      detail:
        keys.data.data.length > 0
          ? 'Shown once when created, and stored hashed — create another if that one is lost.'
          : 'The dashboard runs on your session; everything else needs a key.',
      to: '/app/api-keys' as const,
      search: undefined,
      cta: 'Create a key',
    },
  ]

  const next = steps.find((step) => !step.done)

  return (
    <section className="rounded-tile border border-line-soft bg-card p-4">
      <h2 className="ms-eyebrow m-0 text-[10.5px] text-muted-2">
        before the first message · {steps.filter((step) => step.done).length} of {steps.length} done
      </h2>
      <ol className="m-0 mt-3.5 flex list-none flex-col gap-2.5 p-0">
        {steps.map((step) => (
          <li key={step.label} className="flex flex-wrap items-baseline gap-2.5 text-[14px]">
            <StatusDot tone={step.done ? 'positive' : 'muted'} size={8} />
            <span className={step.done ? 'text-muted' : 'text-ink'}>{step.label}</span>
            <span className="text-[13px] text-muted-2">{step.detail}</span>
            {step === next ? (
              <Button asChild size="sm" variant="outline" className="ml-auto">
                {step.search ? (
                  <Link to={step.to} search={step.search}>
                    {step.cta}
                  </Link>
                ) : (
                  <Link to={step.to}>{step.cta}</Link>
                )}
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      {next ? null : (
        <p className="m-0 mt-3.5 text-[13.5px] text-muted">
          Everything is in place and nothing has been sent yet. The quickstart has a curl that
          proves it end to end.
        </p>
      )}
    </section>
  )
}
