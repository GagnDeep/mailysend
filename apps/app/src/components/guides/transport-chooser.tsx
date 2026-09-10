import {
  CLOUDFLARE_LIMITS,
  type ProviderLimits,
  RESEND_LIMITS,
  SES_LIMITS,
  SMTP_LIMITS,
} from '@mailysend/providers'
import { useId, useState } from 'react'
import { WidgetField, WidgetResult, WidgetShell } from './widget-shell.tsx'

/**
 * The four transports, with their real ceilings.
 *
 * The numbers are the adapters' own `*_LIMITS` constants, so this table cannot
 * disagree with what the send path enforces. `reportsEvents` is stated per
 * transport because it is the difference that surprises people after they have
 * already migrated: raw SMTP reports nothing, and SES only reports if you gave
 * it a configuration set.
 */
interface Row {
  key: string
  name: string
  limits: ProviderLimits
  events: string
  bestFor: string
  watchOut: string
}

const ROWS: Row[] = [
  {
    key: 'cloudflare',
    name: 'Cloudflare Email Service',
    limits: CLOUDFLARE_LIMITS,
    events: 'Yes — a Queues subscription per sending domain.',
    bestFor: 'A Cloudflare deployment that wants no third-party account at all.',
    watchOut:
      'Public beta, so pricing and limits can change. The smallest message ceiling of the four.',
  },
  {
    key: 'ses',
    name: 'Amazon SES',
    limits: SES_LIMITS,
    events: 'Only with an SNS configuration set. Without one there are no events.',
    bestFor: 'Large volume, large attachments, and the lowest per-message price.',
    watchOut: 'Sandbox limits until you request production access, and events are opt-in.',
  },
  {
    key: 'resend',
    name: 'Resend',
    limits: RESEND_LIMITS,
    events: 'Yes.',
    bestFor: 'Keeping an existing Resend account while moving everything else in-house.',
    watchOut: 'You are still paying a per-message vendor, which may be the point or may not.',
  },
  {
    key: 'smtp',
    name: 'Raw SMTP relay',
    limits: SMTP_LIMITS,
    events: 'No. A 250 is all you get; bounces arrive later as DSNs.',
    bestFor: 'An existing relay you already operate, or a provider with no HTTP API.',
    watchOut: 'No delivery events means no open, click or bounce data from the transport itself.',
  },
]

const mib = (bytes: number) => {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MiB`
}

export const TransportChooser = () => {
  const id = useId()
  const [selected, setSelected] = useState('cloudflare')

  return (
    <WidgetShell
      title="TRANSPORT COMPARISON"
      source={
        <>
          Ceilings read from <code className="font-mono">CLOUDFLARE_LIMITS</code>,{' '}
          <code className="font-mono">SES_LIMITS</code>,{' '}
          <code className="font-mono">RESEND_LIMITS</code> and{' '}
          <code className="font-mono">SMTP_LIMITS</code> in{' '}
          <code className="font-mono">@mailysend/providers</code>.
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="overflow-x-auto rounded-tile border border-line">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-tint text-left">
                <th className="px-4 py-2.5 text-[12px] font-semibold">Transport</th>
                <th className="px-4 py-2.5 text-[12px] font-semibold">Message</th>
                <th className="px-4 py-2.5 text-[12px] font-semibold">Attachment</th>
                <th className="px-4 py-2.5 text-[12px] font-semibold">Recipients</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.key} className="border-line border-t">
                  <td className="px-4 py-2 font-semibold text-ink">{row.name}</td>
                  <td className="px-4 py-2 font-mono text-[13px]">
                    {mib(row.limits.maxMessageBytes)}
                  </td>
                  <td className="px-4 py-2 font-mono text-[13px]">
                    {mib(row.limits.maxAttachmentBytes)}
                  </td>
                  <td className="px-4 py-2 font-mono text-[13px]">{row.limits.maxRecipients}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <WidgetField label="Tell me about" htmlFor={`${id}-pick`}>
          <div className="flex flex-wrap gap-2" id={`${id}-pick`}>
            {ROWS.map((row) => (
              <button
                key={row.key}
                type="button"
                aria-pressed={selected === row.key}
                onClick={() => setSelected(row.key)}
                className={
                  selected === row.key
                    ? 'rounded-chip border border-ink bg-ink px-3 py-1.5 text-[12.5px] text-paper'
                    : 'rounded-chip border border-line bg-tint px-3 py-1.5 text-[12.5px] text-muted hover:border-ink hover:text-ink'
                }
              >
                {row.name}
              </button>
            ))}
          </div>
        </WidgetField>

        {/*
          Every row renders, not just the selected one. The selection only moves
          the highlight. This is deliberate: the text below is the substance of
          the section, it has to be in the prerendered HTML for a crawler and for
          llms-full.txt, and it has to be readable with JavaScript disabled.
        */}
        <div className="flex flex-col gap-3">
          {ROWS.map((row) => (
            <WidgetResult
              key={row.key}
              tone={selected === row.key ? 'positive' : 'neutral'}
              className={selected === row.key ? '' : 'opacity-75'}
            >
              <div className="font-semibold text-ink">{row.name}</div>
              <dl className="m-0 mt-1.5 grid gap-1 text-[13.5px] sm:grid-cols-[110px_minmax(0,1fr)]">
                <dt className="font-semibold text-muted-2">Events</dt>
                <dd className="m-0 text-muted">{row.events}</dd>
                <dt className="font-semibold text-muted-2">Best for</dt>
                <dd className="m-0 text-muted">{row.bestFor}</dd>
                <dt className="font-semibold text-muted-2">Watch out</dt>
                <dd className="m-0 text-muted">{row.watchOut}</dd>
              </dl>
            </WidgetResult>
          ))}
        </div>
      </div>
    </WidgetShell>
  )
}
