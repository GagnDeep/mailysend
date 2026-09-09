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
  MonoChip,
  Pill,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatTile,
} from '@mailysend/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { num } from '~/components/app/format.ts'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { ErrorState } from '~/components/app/states.tsx'
import type { ImportResultRecord } from '~/lib/api-client.ts'
import { qk } from '~/lib/query.ts'

/**
 * CSV import in three deliberate steps.
 *
 * The middle step exists because a header called `mail` is not an email column
 * until a human says so, and the last step exists because an import that lost
 * 300 of 5,000 rows is not a success — the per-row errors are the product of
 * this dialog, not a footnote to it.
 */

type Target = 'email' | 'first_name' | 'last_name' | 'unsubscribed' | 'custom' | 'ignore'

interface ColumnMapping {
  target: Target
  /** Only meaningful for `custom`; becomes `data.<key>`. */
  key: string
}

interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

const TARGET_LABELS: Record<Target, string> = {
  email: 'email',
  first_name: 'first_name',
  last_name: 'last_name',
  unsubscribed: 'unsubscribed',
  custom: 'custom field (data.…)',
  ignore: 'ignore this column',
}

/** RFC-4180-shaped: quoted fields, doubled quotes inside them, CRLF or LF. */
const parseCsv = (text: string): ParsedCsv => {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let quoted = false

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') endField()
    else if (char === '\n') endRow()
    else if (char !== '\r') field += char
  }
  if (field !== '' || row.length > 0) endRow()

  const [headers = [], ...body] = rows
  return { headers: headers.map((header) => header.trim()), rows: body }
}

const slugKey = (header: string): string =>
  header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'field'

const guessTarget = (header: string): ColumnMapping => {
  const name = slugKey(header)
  if (name.includes('email') || name === 'mail' || name === 'e_mail')
    return { target: 'email', key: '' }
  if (name === 'first_name' || name === 'first' || name === 'given_name')
    return { target: 'first_name', key: '' }
  if (name === 'last_name' || name === 'last' || name === 'surname' || name === 'family_name')
    return { target: 'last_name', key: '' }
  if (name === 'unsubscribed' || name === 'opted_out' || name === 'unsubscribe')
    return { target: 'unsubscribed', key: '' }
  return { target: 'custom', key: name }
}

const csvCell = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

const STEPS = ['Choose a file', 'Map the columns', 'Result'] as const

export const ContactImport = ({
  audienceId,
  open,
  onOpenChange,
}: {
  audienceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const fileId = useId()
  const mappingErrorId = useId()

  const [step, setStep] = useState(0)
  const [fileName, setFileName] = useState('')
  const [csv, setCsv] = useState('')
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping[]>([])

  useEffect(() => {
    if (open) return
    setStep(0)
    setFileName('')
    setCsv('')
    setParsed(null)
    setParseError(null)
    setMapping([])
  }, [open])

  const runImport = useMutation({
    mutationFn: () => {
      const wire: Record<string, string> = {}
      parsed?.headers.forEach((header, index) => {
        const column = mapping[index]
        if (!column || column.target === 'ignore') return
        wire[header] =
          column.target === 'custom' ? `data.${column.key || slugKey(header)}` : column.target
      })
      return api.importContacts(audienceId, { csv, mapping: wire })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.audiences(environment) })
      void queryClient.invalidateQueries({
        queryKey: [environment, 'audience', audienceId, 'contacts'],
      })
    },
  })

  const emailMapped = mapping.some((column) => column.target === 'email')
  const emailMappedTwice = mapping.filter((column) => column.target === 'email').length > 1
  const mappingProblem = !emailMapped
    ? 'One column has to be mapped to email — a contact without an address cannot be imported, so nothing will be sent until you pick one.'
    : emailMappedTwice
      ? 'Two columns are mapped to email. Pick the one that holds the address and ignore the other.'
      : null

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    setParseError(null)
    try {
      const text = await file.text()
      const next = parseCsv(text)
      if (next.headers.length === 0 || next.rows.length === 0) {
        setParsed(null)
        setParseError('That file has no header row and no data rows. Export it again with headers.')
        return
      }
      setCsv(text)
      setParsed(next)
      setMapping(next.headers.map(guessTarget))
    } catch {
      setParsed(null)
      setParseError('That file could not be read as text. CSV only — not .xlsx.')
    }
  }

  const downloadFailedRows = (result: ImportResultRecord) => {
    const lines = [
      ['row', 'email', 'code', 'message'].join(','),
      ...result.errors.map((error) =>
        [String(error.row), error.email ?? '', error.code, error.message].map(csvCell).join(','),
      ),
    ]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${fileName.replace(/\.csv$/i, '') || 'import'}-failed-rows.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const result = runImport.data

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[820px]">
        <DialogHeader>
          <DialogTitle>Import contacts from CSV</DialogTitle>
          <DialogDescription>
            The file is parsed in your browser so you can see it before anything is uploaded.
          </DialogDescription>
        </DialogHeader>

        <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
          {STEPS.map((label, index) => (
            <li key={label}>
              <Pill
                tone={index === step ? 'ink' : 'outline'}
                size="sm"
                aria-current={index === step ? 'step' : undefined}
              >
                {index + 1}. {label}
              </Pill>
            </li>
          ))}
        </ol>

        {step === 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={fileId}>CSV file</Label>
              <Input
                id={fileId}
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void onFile(event.target.files?.[0])}
              />
              <p className="m-0 text-[13px] text-muted">
                First row is treated as the header. Addresses already suppressed in this workspace
                are skipped rather than imported.
              </p>
            </div>

            {parseError ? (
              <Callout variant="warn" title="cannot read this file">
                {parseError}
              </Callout>
            ) : null}

            {parsed ? (
              <div className="flex flex-col gap-2">
                <p className="m-0 text-[13px] text-muted">
                  <span className="font-mono text-ink">{fileName}</span> · {num(parsed.rows.length)}{' '}
                  data rows · {parsed.headers.length} columns. First five rows:
                </p>
                <div className="overflow-x-auto rounded-tile border border-line-soft bg-card">
                  <table className="w-full border-collapse text-[12.5px]">
                    <caption className="sr-only">
                      Preview of the first five rows of {fileName}
                    </caption>
                    <thead>
                      <tr>
                        {parsed.headers.map((header) => (
                          <th
                            key={header}
                            scope="col"
                            className="border-b border-line-soft px-3 py-2 text-left font-mono text-[11.5px] text-muted-2"
                          >
                            {header || '(unnamed)'}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rows.slice(0, 5).map((row, rowIndex) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: CSV rows have no id yet.
                        <tr key={rowIndex}>
                          {parsed.headers.map((header, cellIndex) => (
                            <td
                              key={header}
                              className="border-b border-line-soft px-3 py-2 last:border-0"
                            >
                              {row[cellIndex] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 1 && parsed ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-[13px] text-muted">
              Anything mapped to a custom field lands in the contact’s{' '}
              <MonoChip size="sm">data</MonoChip> record and can be used in a segment as{' '}
              <MonoChip size="sm">data.key</MonoChip>.
            </p>

            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {parsed.headers.map((header, index) => {
                const column = mapping[index] ?? { target: 'ignore', key: '' }
                const sample = parsed.rows.find((row) => (row[index] ?? '').trim() !== '')?.[index]
                return (
                  <li
                    key={header}
                    className="flex flex-wrap items-center gap-3 rounded-tile border border-line-soft bg-card px-3.5 py-2.5"
                  >
                    <div className="min-w-[180px] flex-1">
                      <span className="font-mono text-[12.5px] text-ink">
                        {header || '(unnamed)'}
                      </span>
                      {sample ? (
                        <span className="ml-2 text-[12px] text-muted-2">e.g. {sample}</span>
                      ) : null}
                    </div>
                    <Select
                      value={column.target}
                      onValueChange={(value) =>
                        setMapping((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? {
                                  target: value as Target,
                                  key: value === 'custom' ? entry.key || slugKey(header) : '',
                                }
                              : entry,
                          ),
                        )
                      }
                    >
                      <SelectTrigger
                        className="w-[220px]"
                        aria-label={`Map column ${header || 'unnamed'}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(TARGET_LABELS) as Target[]).map((target) => (
                          <SelectItem key={target} value={target}>
                            {TARGET_LABELS[target]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {column.target === 'custom' ? (
                      <Input
                        className="w-[180px] font-mono text-[12.5px]"
                        value={column.key}
                        aria-label={`Custom field key for ${header || 'unnamed'}`}
                        placeholder="plan"
                        onChange={(event) =>
                          setMapping((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, key: slugKey(event.target.value) }
                                : entry,
                            ),
                          )
                        }
                      />
                    ) : null}
                  </li>
                )
              })}
            </ul>

            {mappingProblem ? (
              <p id={mappingErrorId} role="alert" className="m-0 text-[13px] text-warning">
                {mappingProblem}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-3">
            {runImport.isPending ? (
              <p role="status" className="m-0 text-[14px] text-muted">
                Importing {num(parsed?.rows.length ?? 0)} rows…
              </p>
            ) : runImport.error ? (
              <ErrorState
                error={runImport.error}
                subject="the import"
                onRetry={() => runImport.mutate()}
              />
            ) : result ? (
              <>
                {result.failed > 0 || result.skipped > 0 ? (
                  <Callout variant="warn" title="partial import">
                    {num(result.imported)} of {num(result.total_rows)} rows were imported.{' '}
                    {num(result.skipped)} were skipped and {num(result.failed)} failed. The rows
                    below were not imported; fixing and re-importing only those is safe, because a
                    repeated address updates the existing contact rather than duplicating it.
                  </Callout>
                ) : (
                  <Callout variant="success" title="import complete">
                    All {num(result.imported)} rows were imported.
                  </Callout>
                )}

                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
                >
                  <StatTile label="Imported" value={num(result.imported)} intent="positive" />
                  <StatTile
                    label="Skipped"
                    value={num(result.skipped)}
                    delta="already present or suppressed"
                  />
                  <StatTile
                    label="Failed"
                    value={num(result.failed)}
                    intent={result.failed > 0 ? 'negative' : 'neutral'}
                    tone={result.failed > 0 ? 'alert' : 'paper'}
                  />
                </div>

                {result.errors.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="m-0 font-display text-[15px] font-medium">
                        Rows that did not import
                      </h3>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadFailedRows(result)}
                      >
                        Download failed rows as CSV
                      </Button>
                    </div>
                    <div className="max-h-[280px] overflow-auto rounded-tile border border-line-soft bg-card">
                      <table className="w-full border-collapse text-[12.5px]">
                        <caption className="sr-only">
                          Every row the import rejected, with its reason
                        </caption>
                        <thead>
                          <tr>
                            <th
                              scope="col"
                              className="border-b border-line-soft px-3 py-2 text-left font-mono text-[11.5px] text-muted-2"
                            >
                              row
                            </th>
                            <th
                              scope="col"
                              className="border-b border-line-soft px-3 py-2 text-left font-mono text-[11.5px] text-muted-2"
                            >
                              email
                            </th>
                            <th
                              scope="col"
                              className="border-b border-line-soft px-3 py-2 text-left font-mono text-[11.5px] text-muted-2"
                            >
                              code
                            </th>
                            <th
                              scope="col"
                              className="border-b border-line-soft px-3 py-2 text-left font-mono text-[11.5px] text-muted-2"
                            >
                              message
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.errors.map((error) => (
                            <tr key={`${error.row}-${error.code}`}>
                              <td className="border-b border-line-soft px-3 py-2 font-mono">
                                {error.row}
                              </td>
                              <td className="border-b border-line-soft px-3 py-2 font-mono">
                                {error.email ?? '—'}
                              </td>
                              <td className="border-b border-line-soft px-3 py-2">
                                <MonoChip size="sm" tone="warning">
                                  {error.code}
                                </MonoChip>
                              </td>
                              <td className="border-b border-line-soft px-3 py-2 text-muted">
                                {error.message}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          {step > 0 && !runImport.isPending ? (
            <Button variant="ghost" onClick={() => setStep((current) => current - 1)}>
              Back
            </Button>
          ) : null}
          {step === 0 ? (
            <Button disabled={!parsed} onClick={() => setStep(1)}>
              Map the columns
            </Button>
          ) : null}
          {step === 1 ? (
            <Button
              disabled={mappingProblem !== null}
              aria-describedby={mappingProblem ? mappingErrorId : undefined}
              onClick={() => {
                setStep(2)
                runImport.mutate()
              }}
            >
              Import {num(parsed?.rows.length ?? 0)} rows
            </Button>
          ) : null}
          {step === 2 ? (
            <Button onClick={() => onOpenChange(false)} disabled={runImport.isPending}>
              Done
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
