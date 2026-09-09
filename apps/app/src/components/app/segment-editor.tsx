import { Callout, cn, Metric, MonoChip, Textarea } from '@mailysend/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { num, relativeTime } from '~/components/app/format.ts'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { errorMessage, qk } from '~/lib/query.ts'

/**
 * The expression box, its plain-English reading, and the count it produces.
 *
 * `describe` is the parser's own `describe()` output rather than anything this
 * component reconstructs: a marketer who reads back "has not clicked in the
 * last 30 days" has been told how NULLs were handled, which is the difference
 * between a broadcast to 40 people and one to 40,000.
 */

const DEBOUNCE_MS = 350

interface Predicate {
  insert: string
  label: string
  hint: string
}

const PALETTE: Predicate[] = [
  { insert: 'opened_last_30d', label: 'opened_last_30d', hint: 'opened in the last 30 days' },
  { insert: 'clicked_last_30d', label: 'clicked_last_30d', hint: 'clicked in the last 30 days' },
  { insert: 'never_opened', label: 'never_opened', hint: 'has never opened' },
  { insert: 'subscribed', label: 'subscribed', hint: 'is still subscribed' },
  { insert: 'and', label: 'and', hint: 'both sides must hold' },
  { insert: 'or', label: 'or', hint: 'either side may hold' },
  { insert: 'not', label: 'not', hint: 'negates what follows' },
  { insert: "data.plan = 'pro'", label: "data.plan = 'pro'", hint: 'compare a custom field' },
  {
    insert: "data.country in ['DE', 'FR']",
    label: 'data.country in […]',
    hint: 'one of a list of values',
  },
  { insert: 'last_open_at > 30d', label: 'last_open_at > 30d', hint: 'a relative time window' },
]

export const SegmentEditor = ({
  audienceId,
  expression,
  onChange,
  audienceName,
}: {
  audienceId: string
  expression: string
  onChange: (expression: string) => void
  /** Named in the count's caption, so the reader knows what was counted. */
  audienceName?: string
}) => {
  const api = useApi()
  const environment = useEnvironment()
  const fieldId = useId()
  const messageId = useId()
  const textarea = useRef<HTMLTextAreaElement>(null)

  const [debounced, setDebounced] = useState(expression)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(expression), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [expression])

  const ready = audienceId !== '' && debounced.trim() !== ''

  const preview = useQuery({
    queryKey: qk.segmentPreview(environment, audienceId, debounced),
    queryFn: () => api.previewSegment({ audience_id: audienceId, expression: debounced }),
    enabled: ready,
    // The count is a snapshot of a moving list; refetching it in the background
    // would make the number change under the reader with no explanation.
    staleTime: 60_000,
    retry: false,
  })

  const insert = (fragment: string) => {
    const base = expression.trimEnd()
    onChange(base === '' ? fragment : `${base} ${fragment}`)
    textarea.current?.focus()
  }

  const data = preview.data
  const invalid = data?.valid === false
  const requestFailed = preview.error !== null && preview.error !== undefined
  const settling = expression !== debounced || preview.isFetching

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <label htmlFor={fieldId} className="text-[13px] font-medium text-ink">
          Expression
        </label>
        <Textarea
          id={fieldId}
          ref={textarea}
          value={expression}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          aria-describedby={messageId}
          aria-invalid={invalid || undefined}
          placeholder="opened_last_30d and not clicked_last_30d"
          className={cn('font-mono text-[13px] leading-relaxed', invalid && 'border-accent-border')}
          onChange={(event) => onChange(event.target.value)}
        />

        <p
          id={messageId}
          role={invalid || requestFailed ? 'alert' : 'status'}
          className={cn(
            'm-0 text-[13px]',
            invalid || requestFailed ? 'text-warning' : 'text-muted',
          )}
        >
          {expression.trim() === ''
            ? 'Empty for now. Click a predicate below, or type one — every field name is checked against the contact schema before it can run.'
            : audienceId === ''
              ? 'Pick an audience before this can be checked: a segment is always computed inside one audience.'
              : requestFailed
                ? `Could not check this expression. ${errorMessage(preview.error)}`
                : invalid
                  ? (data?.error ?? 'This expression could not be parsed.')
                  : settling
                    ? 'Checking…'
                    : 'Parses cleanly.'}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="ms-eyebrow text-[10.5px] text-muted-2">insert a predicate</span>
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {PALETTE.map((predicate) => (
            <li key={predicate.label}>
              <button
                type="button"
                title={predicate.hint}
                className="rounded-[7px]"
                onClick={() => insert(predicate.insert)}
              >
                <MonoChip size="sm" tone="neutral" className="hover:bg-ink hover:text-paper">
                  {predicate.label}
                </MonoChip>
                <span className="sr-only"> — {predicate.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {data?.valid && data.describe ? (
        <Callout variant="info" title="this segment means">
          <p className="m-0 text-[14.5px] text-ink">{data.describe}</p>
        </Callout>
      ) : null}

      {data?.valid ? (
        <div className="flex flex-wrap items-end gap-6 rounded-tile border border-line-soft bg-card p-4">
          <Metric
            size="lg"
            value={data.match_count === null ? '—' : num(data.match_count)}
            label={`contacts match right now${audienceName ? ` in ${audienceName}` : ''}`}
          />
          <p className="m-0 max-w-[46ch] text-[13px] text-muted">
            Counted against this audience at this moment, not against a saved list. Once saved the
            segment is recomputed continuously as contacts open, click and unsubscribe, so the
            number a broadcast sends to is the one at send time — not this one.
          </p>
        </div>
      ) : null}

      {data?.valid && data.sample.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="ms-eyebrow text-[10.5px] text-muted-2">
            sample · {data.sample.length} of {num(data.match_count)}
          </span>
          <ul className="m-0 flex list-none flex-col gap-0 overflow-hidden rounded-tile border border-line-soft bg-card p-0">
            {data.sample.map((contact) => (
              <li
                key={contact.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line-soft px-3.5 py-2.5 last:border-0"
              >
                <span className="font-mono text-[12.5px] text-ink">{contact.email}</span>
                <span className="text-[12.5px] text-muted">
                  {[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'}
                </span>
                <span className="ml-auto text-[12px] text-muted-2">
                  {contact.last_open_at
                    ? `last open ${relativeTime(contact.last_open_at)}`
                    : 'never opened'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
