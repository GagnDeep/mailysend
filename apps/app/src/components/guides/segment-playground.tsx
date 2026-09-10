import { COLUMNS, compile, describe, parse, SegmentError } from '@mailysend/segments'
import { Textarea } from '@mailysend/ui'
import { useId, useState } from 'react'
import { Code } from '~/components/marketing/prose.tsx'
import { WidgetField, WidgetResult, WidgetShell } from './widget-shell.tsx'

/**
 * The segment DSL, running in your browser.
 *
 * This imports `parse`, `describe` and `compile` from `@mailysend/segments` —
 * the same three functions the API calls — so the plain-English reading and the
 * SQL shown here are the ones your instance would produce, down to the
 * character offset in an error. A guide that restated the grammar in prose
 * would be correct on the day it was written and wrong thereafter.
 *
 * `@mailysend/segments`' barrel is safe to import from a browser chunk: the
 * only thing it takes from `@mailysend/platform` is a type, which erases.
 */
const EXAMPLES = [
  'subscribed and opened_last_30d',
  'subscribed and never_clicked and send_count > 3',
  'email ends_with "@example.com" or first_name = "Ada"',
  'bounced_last_30d',
  'last_open_at > 90d and not unsubscribed',
]

interface Outcome {
  english?: string
  sql?: string
  params?: unknown[]
  error?: { message: string; offset: number; kind: string }
}

const evaluate = (source: string): Outcome => {
  try {
    const ast = parse(source)
    const compiled = compile(ast)
    return { english: describe(ast), sql: compiled.sql, params: compiled.params }
  } catch (error) {
    if (error instanceof SegmentError) {
      return { error: { message: error.message, offset: error.offset, kind: error.kind } }
    }
    return { error: { message: String(error), offset: 0, kind: 'syntax' } }
  }
}

export const SegmentPlayground = () => {
  const id = useId()
  // A literal, not a random pick: the prerendered HTML has to be identical on
  // every build, and this is also the string the surrounding prose discusses.
  const [source, setSource] = useState(EXAMPLES[0] as string)
  const outcome = evaluate(source)

  return (
    <WidgetShell
      title="SEGMENT PLAYGROUND"
      source={
        <>
          Runs <code className="font-mono">parse</code>, <code className="font-mono">describe</code>{' '}
          and <code className="font-mono">compile</code> from{' '}
          <code className="font-mono">@mailysend/segments</code> — the same functions the API calls.
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <WidgetField
          label="Expression"
          htmlFor={`${id}-expr`}
          hint="Identifiers must be one of the twelve registered columns; everything else is a bound parameter."
        >
          <Textarea
            id={`${id}-expr`}
            value={source}
            spellCheck={false}
            rows={2}
            onChange={(event) => setSource(event.target.value)}
            className="font-mono text-[13px]"
          />
        </WidgetField>

        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setSource(example)}
              className="rounded-chip border border-line bg-tint px-2.5 py-1 font-mono text-[11.5px] text-muted hover:border-ink hover:text-ink"
            >
              {example}
            </button>
          ))}
        </div>

        {outcome.error ? (
          <WidgetResult tone="warning">
            <div className="font-semibold">
              {outcome.error.kind === 'type' ? 'Type error' : 'Syntax error'} at character{' '}
              {outcome.error.offset}
            </div>
            <div className="mt-1">{outcome.error.message}</div>
            {/* The caret is what makes an offset useful; the product shows the
                same one in the expression editor. */}
            <pre className="mt-2 mb-0 overflow-x-auto font-mono text-[12.5px] text-muted">
              {source}
              {'\n'}
              {`${' '.repeat(Math.max(0, outcome.error.offset))}^`}
            </pre>
          </WidgetResult>
        ) : (
          <div className="flex flex-col gap-3">
            <WidgetResult tone="positive">
              <span className="font-semibold">In English: </span>
              {outcome.english}
            </WidgetResult>
            <div>
              <div className="ms-eyebrow mb-1.5 text-[10.5px]">COMPILED SQL</div>
              <Code>{outcome.sql}</Code>
              <p className="mt-2 mb-0 text-[13px] text-muted-2">
                Bound parameters:{' '}
                <code className="font-mono">{JSON.stringify(outcome.params)}</code>. Every value you
                typed is a parameter; the only identifiers in that fragment came from the column
                registry, which is why there is no expression you can write that becomes SQL.
              </p>
            </div>
          </div>
        )}
      </div>
    </WidgetShell>
  )
}

/** The registry, rendered — the whole vocabulary of the language on one screen. */
export const SegmentColumns = () => (
  <div className="overflow-x-auto rounded-card border border-line">
    <table className="w-full border-collapse text-[14px]">
      <thead>
        <tr className="bg-tint text-left">
          <th className="px-4 py-2.5 font-mono text-[12px] font-semibold">column</th>
          <th className="px-4 py-2.5 font-mono text-[12px] font-semibold">type</th>
          <th className="px-4 py-2.5 font-mono text-[12px] font-semibold">nullable</th>
          <th className="px-4 py-2.5 text-[12px] font-semibold">reads as</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(COLUMNS).map(([name, def]) => (
          <tr key={name} className="border-line border-t">
            <td className="px-4 py-2 font-mono text-[13px] text-ink">{name}</td>
            <td className="px-4 py-2 font-mono text-[12.5px] text-muted-2">{def.type}</td>
            <td className="px-4 py-2 font-mono text-[12.5px] text-muted-2">
              {def.nullable ? 'yes' : 'no'}
            </td>
            <td className="px-4 py-2 text-muted">{def.label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)
