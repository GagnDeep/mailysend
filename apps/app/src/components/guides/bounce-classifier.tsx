import { classifyBounce, softSuppressionDays } from '@mailysend/events/bounce'
import { Input } from '@mailysend/ui'
import { useId, useState } from 'react'
import { WidgetField, WidgetResult, WidgetShell } from './widget-shell.tsx'

/**
 * The real bounce classifier, in your browser.
 *
 * Imported from `@mailysend/events/bounce` rather than the package barrel: the
 * barrel re-exports `consumer.ts`, which reaches into platform and database
 * code, and dragging that into a marketing page's chunk to classify a string
 * would be absurd. The subpath export exists for this.
 */
const SAMPLES: Array<{ label: string; code: string; diagnostic: string }> = [
  {
    label: 'Unknown user',
    code: '550',
    diagnostic: '550 5.1.1 <ada@example.com>: Recipient address rejected: User unknown',
  },
  {
    label: 'Policy block',
    code: '550',
    diagnostic: '550 5.7.1 Message rejected due to local policy',
  },
  {
    label: 'Mailbox full',
    code: '452',
    diagnostic: '452 4.2.2 The email account that you tried to reach is over quota',
  },
  {
    label: 'Greylisted',
    code: '451',
    diagnostic: '451 4.7.1 Greylisting in effect, please try again later',
  },
  {
    label: 'No such domain',
    code: '550',
    diagnostic: '550 5.1.2 Host unknown: no MX record for example.invalid',
  },
  {
    label: 'Unrecognised',
    code: '',
    diagnostic: 'delivery failed',
  },
]

const CLASS_COPY: Record<string, string> = {
  hard_invalid: 'The address does not exist. Suppress it permanently.',
  hard_domain: 'The receiving domain does not resolve. Suppress permanently.',
  hard_blocked: 'You were refused by policy. The address may be fine; your reputation is not.',
  soft_mailbox_full: 'The mailbox is full. Real person, temporarily unreachable.',
  soft_throttled: 'You are being rate-limited. Slow down rather than retrying harder.',
  soft_content: 'The message was refused on content or authentication grounds.',
  soft_temporary: 'A generic temporary failure. Retry later.',
  unknown: 'Not recognised — and deliberately does not suppress. See below.',
}

export const BounceClassifier = () => {
  const id = useId()
  const first = SAMPLES[0] as (typeof SAMPLES)[number]
  const [code, setCode] = useState(first.code)
  const [diagnostic, setDiagnostic] = useState(first.diagnostic)

  const result = classifyBounce({ smtpCode: code, diagnostic })
  const days = softSuppressionDays(result.class)

  return (
    <WidgetShell
      title="BOUNCE CLASSIFIER"
      source={
        <>
          Runs <code className="font-mono">classifyBounce</code> and{' '}
          <code className="font-mono">softSuppressionDays</code> from{' '}
          <code className="font-mono">@mailysend/events</code>. This is the answer your instance
          would record.
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
          <WidgetField label="SMTP code" htmlFor={`${id}-code`}>
            <Input
              id={`${id}-code`}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="font-mono text-[13px]"
            />
          </WidgetField>
          <WidgetField label="Diagnostic text" htmlFor={`${id}-diag`}>
            <Input
              id={`${id}-diag`}
              value={diagnostic}
              onChange={(event) => setDiagnostic(event.target.value)}
              className="font-mono text-[13px]"
            />
          </WidgetField>
        </div>

        <div className="flex flex-wrap gap-2">
          {SAMPLES.map((sample) => (
            <button
              key={sample.label}
              type="button"
              onClick={() => {
                setCode(sample.code)
                setDiagnostic(sample.diagnostic)
              }}
              className="rounded-chip border border-line bg-tint px-2.5 py-1 text-[12px] text-muted hover:border-ink hover:text-ink"
            >
              {sample.label}
            </button>
          ))}
        </div>

        <WidgetResult tone={result.permanent ? 'warning' : 'neutral'}>
          <div className="font-mono text-[13px] font-semibold text-ink">{result.class}</div>
          <div className="mt-1">{CLASS_COPY[result.class]}</div>
          <div className="mt-2 text-[13px] text-muted-2">
            {result.permanent
              ? 'Permanent — the address is suppressed and will not be retried.'
              : days === null
                ? 'Not permanent, and no suppression window: nothing is written down.'
                : `Not permanent — suppressed for ${days} day${days === 1 ? '' : 's'}, then retried.`}
          </div>
        </WidgetResult>
      </div>
    </WidgetShell>
  )
}
