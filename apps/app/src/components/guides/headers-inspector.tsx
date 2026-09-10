import { Textarea } from '@mailysend/ui'
import { useId, useState } from 'react'
import { WidgetField, WidgetResult, WidgetShell } from './widget-shell.tsx'

/**
 * Read an `Authentication-Results` header.
 *
 * A pure parse — no product code to import, because this is the receiver's
 * verdict rather than ours. It settles the authentication question in one step,
 * which is why the spam guide starts here instead of with subject lines.
 */
const SAMPLE = `Authentication-Results: mx.google.com;
       dkim=pass header.i=@yourdomain.com header.s=ms1 header.b=Ab3dEf;
       spf=pass (google.com: domain of bounce@yourdomain.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=bounce@yourdomain.com;
       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=yourdomain.com`

interface Verdict {
  method: string
  result: string
  detail: string
}

const parse = (input: string): Verdict[] => {
  const verdicts: Verdict[] = []
  for (const method of ['dkim', 'spf', 'dmarc', 'arc', 'bimi']) {
    const match = new RegExp(`\\b${method}=(\\w+)([^;]*)`, 'i').exec(input)
    if (!match) continue
    verdicts.push({
      method: method.toUpperCase(),
      result: (match[1] ?? '').toLowerCase(),
      detail: (match[2] ?? '').trim(),
    })
  }
  return verdicts
}

const READING: Record<string, string> = {
  pass: 'The check succeeded.',
  fail: 'The check ran and the message failed it.',
  none: 'No policy or no record was published, so nothing was checked.',
  neutral: 'A record exists but expresses no opinion about this sender.',
  softfail: 'Not authorised, but the domain asked receivers not to reject on that alone.',
  permerror: 'The record itself is malformed — a syntax problem in your DNS, not a sender problem.',
  temperror: 'A lookup failed temporarily. Nothing to fix; check again.',
}

export const HeadersInspector = () => {
  const id = useId()
  const [raw, setRaw] = useState(SAMPLE)
  const verdicts = parse(raw)

  return (
    <WidgetShell
      title="AUTHENTICATION-RESULTS"
      source="A local parse. Nothing you paste leaves your browser — this component makes no network request of any kind."
    >
      <div className="flex flex-col gap-4">
        <WidgetField
          label="Paste the header from a message that went to spam"
          htmlFor={`${id}-raw`}
          hint="In Gmail: Show original. In Outlook: View message source."
        >
          <Textarea
            id={`${id}-raw`}
            value={raw}
            rows={5}
            spellCheck={false}
            onChange={(event) => setRaw(event.target.value)}
            className="font-mono text-[12px]"
          />
        </WidgetField>

        {verdicts.length === 0 ? (
          <WidgetResult tone="warning">
            No dkim, spf or dmarc verdict found. Make sure you pasted the whole{' '}
            <code className="font-mono">Authentication-Results</code> header, including the lines
            that are indented under it.
          </WidgetResult>
        ) : (
          <div className="flex flex-col gap-2">
            {verdicts.map((verdict) => (
              <WidgetResult
                key={verdict.method}
                tone={
                  verdict.result === 'pass'
                    ? 'positive'
                    : verdict.result === 'fail' || verdict.result === 'permerror'
                      ? 'warning'
                      : 'neutral'
                }
              >
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <span className="font-mono text-[13px] font-bold text-ink">{verdict.method}</span>
                  <span className="font-mono text-[13px]">{verdict.result}</span>
                </div>
                <div className="mt-1 text-[13.5px] text-muted">
                  {READING[verdict.result] ?? 'An unusual result — read the detail below.'}
                </div>
                {verdict.detail ? (
                  <div className="mt-1 font-mono text-[12px] break-all text-muted-2">
                    {verdict.detail}
                  </div>
                ) : null}
              </WidgetResult>
            ))}
          </div>
        )}

        <p className="m-0 text-[13px] leading-[1.55] text-muted-2">
          DMARC is the one that decides. A message can show{' '}
          <code className="font-mono">spf=pass</code> and still fail DMARC, because DMARC
          additionally requires that the passing domain matches the domain in the From header a
          reader sees.
        </p>
      </div>
    </WidgetShell>
  )
}
