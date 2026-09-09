import { Button, Callout, Checkbox, cn, MonoChip, toast } from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import type { Column } from '~/components/app/data-table.tsx'
import { DataTable } from '~/components/app/data-table.tsx'
import { dateTime } from '~/components/app/format.ts'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { EmptyState, QueryState } from '~/components/app/states.tsx'
import type { TemplateVersionRecord } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'

type DiffKind = 'context' | 'add' | 'remove'
interface DiffRow {
  kind: DiffKind
  text: string
}

/**
 * Above this the quadratic table costs more memory than the diff is worth, so
 * the fallback compares line n to line n — cruder, but it renders.
 */
const LCS_CELL_LIMIT = 4_000_000

const positionalDiff = (before: string[], after: string[]): DiffRow[] => {
  const rows: DiffRow[] = []
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    const left = before[index]
    const right = after[index]
    if (left === right && left !== undefined) {
      rows.push({ kind: 'context', text: left })
      continue
    }
    if (left !== undefined) rows.push({ kind: 'remove', text: left })
    if (right !== undefined) rows.push({ kind: 'add', text: right })
  }
  return rows
}

const diffLines = (beforeText: string, afterText: string): DiffRow[] => {
  const before = beforeText.split('\n')
  const after = afterText.split('\n')
  if (before.length * after.length > LCS_CELL_LIMIT) return positionalDiff(before, after)

  // Classic LCS table, then walked backwards to emit the edit script.
  const table: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  )
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      const row = table[i]
      const next = table[i + 1]
      if (!row || !next) continue
      row[j] =
        before[i] === after[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0)
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      rows.push({ kind: 'context', text: before[i] ?? '' })
      i += 1
      j += 1
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      rows.push({ kind: 'remove', text: before[i] ?? '' })
      i += 1
    } else {
      rows.push({ kind: 'add', text: after[j] ?? '' })
      j += 1
    }
  }
  while (i < before.length) {
    rows.push({ kind: 'remove', text: before[i] ?? '' })
    i += 1
  }
  while (j < after.length) {
    rows.push({ kind: 'add', text: after[j] ?? '' })
    j += 1
  }
  return rows
}

const GUTTER: Record<DiffKind, string> = { context: ' ', add: '+', remove: '−' }

const DiffView = ({
  before,
  after,
}: {
  before: TemplateVersionRecord
  after: TemplateVersionRecord
}) => {
  const rows = useMemo(
    () => diffLines(before.html ?? '', after.html ?? ''),
    [before.html, after.html],
  )
  const added = rows.filter((row) => row.kind === 'add').length
  const removed = rows.filter((row) => row.kind === 'remove').length

  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <MonoChip size="sm">v{before.version}</MonoChip>
        <span aria-hidden="true">→</span>
        <MonoChip size="sm">v{after.version}</MonoChip>
        <span>
          {added} added, {removed} removed
        </span>
      </figcaption>

      {added === 0 && removed === 0 ? (
        <p className="m-0 text-[13.5px] text-muted">
          The HTML is identical in both versions. The change was somewhere else — the subject, the
          text part, or nothing at all.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-tile border border-line-soft bg-card">
          <table className="w-full border-collapse font-mono text-[12.5px]">
            <caption className="sr-only">
              Line diff of the HTML body from version {before.version} to version {after.version}
            </caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Change</th>
                <th scope="col">Line</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  // biome-ignore lint/suspicious/noArrayIndexKey: a diff line's identity is its position.
                  key={`${row.kind}-${index}`}
                  className={cn(
                    row.kind === 'remove' && 'bg-accent-soft',
                    row.kind === 'add' && 'bg-positive-bg',
                  )}
                >
                  <td
                    className={cn(
                      'w-6 select-none px-2 text-center align-top',
                      row.kind === 'remove' && 'text-warning',
                      row.kind === 'add' && 'text-positive',
                      row.kind === 'context' && 'text-muted-3',
                    )}
                  >
                    <span className="sr-only">
                      {row.kind === 'add'
                        ? 'added'
                        : row.kind === 'remove'
                          ? 'removed'
                          : 'unchanged'}
                    </span>
                    <span aria-hidden="true">{GUTTER[row.kind]}</span>
                  </td>
                  <td className="whitespace-pre px-2 py-px align-top">{row.text || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  )
}

export interface TemplateVersionsProps {
  templateId: string
  currentVersion: number
}

export const TemplateVersions = ({ templateId, currentVersion }: TemplateVersionsProps) => {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<number[]>([])
  const [rollingBackTo, setRollingBackTo] = useState<number | null>(null)

  const versions = useQuery({
    queryKey: qk.templateVersions(environment, templateId),
    queryFn: () => api.listTemplateVersions(templateId),
  })

  const rollback = useMutation({
    mutationFn: (version: number) => api.rollbackTemplate(templateId, version),
    onSuccess: async (template) => {
      setRollingBackTo(null)
      await queryClient.invalidateQueries({
        queryKey: qk.templateVersions(environment, templateId),
      })
      await queryClient.invalidateQueries({ queryKey: qk.template(environment, templateId) })
      await queryClient.invalidateQueries({ queryKey: qk.templates(environment) })
      toast.success(`Restored as version ${template.version}.`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const rows = versions.data?.data ?? []
  const pair = useMemo(() => {
    if (selected.length !== 2) return null
    const [a, b] = [...selected].sort((left, right) => left - right)
    const before = rows.find((row) => row.version === a)
    const after = rows.find((row) => row.version === b)
    return before && after ? { before, after } : null
  }, [selected, rows])

  const toggleSelected = (version: number) =>
    setSelected((current) =>
      current.includes(version)
        ? current.filter((entry) => entry !== version)
        : // Two at a time: a third click replaces the older of the pair rather
          // than silently doing nothing.
          [...current.slice(-1), version],
    )

  const columns: Column<TemplateVersionRecord>[] = [
    {
      id: 'compare',
      header: 'Compare',
      srOnlyHeader: true,
      className: 'w-10',
      cell: (row) => (
        <Checkbox
          aria-label={`Compare version ${row.version}`}
          checked={selected.includes(row.version)}
          onCheckedChange={() => toggleSelected(row.version)}
        />
      ),
    },
    {
      id: 'version',
      header: 'Version',
      sortBy: (row) => row.version,
      cell: (row) => (
        <span className="flex items-center gap-2">
          <span className="font-mono text-[12.5px]">v{row.version}</span>
          {row.version === currentVersion ? (
            <MonoChip size="sm" tone="positive">
              current
            </MonoChip>
          ) : null}
        </span>
      ),
    },
    {
      id: 'created',
      header: 'Created',
      sortBy: (row) => row.created_at,
      cell: (row) => <span className="text-[13px] text-muted">{dateTime(row.created_at)}</span>,
    },
    {
      id: 'author',
      header: 'Author',
      cell: (row) => <span className="text-[13px] text-muted">{row.author ?? 'unattributed'}</span>,
    },
    {
      id: 'note',
      header: 'Note',
      cell: (row) =>
        row.note ? (
          <span className="text-[13px] text-muted">{row.note}</span>
        ) : (
          <span className="text-[13px] text-muted-2">—</span>
        ),
    },
    {
      id: 'rollback',
      header: 'Roll back',
      srOnlyHeader: true,
      align: 'right',
      cell: (row) =>
        row.version === currentVersion ? null : (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Roll back to version ${row.version}`}
            onClick={() => setRollingBackTo(row.version)}
          >
            <Undo2 aria-hidden="true" />
            Roll back to v{row.version}
          </Button>
        ),
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <QueryState
        isLoading={versions.isLoading}
        error={versions.error}
        data={rows}
        subject="the version history"
        onRetry={() => void versions.refetch()}
        empty={
          <EmptyState
            icon={History}
            title="No stored versions"
            description="A version is written every time the body is saved, so the history starts with the first save."
            action={{ label: 'Reload the history', onClick: () => void versions.refetch() }}
          />
        }
      >
        {(data) => (
          <>
            <DataTable
              rows={data}
              columns={columns}
              rowId={(row) => String(row.version)}
              caption="Stored versions of this template"
              defaultSort={{ columnId: 'version', direction: 'desc' }}
            />
            {pair ? (
              <DiffView before={pair.before} after={pair.after} />
            ) : (
              <p className="m-0 text-[13.5px] text-muted-2">
                Tick two versions to see a line diff of the HTML.
              </p>
            )}
          </>
        )}
      </QueryState>

      {rollback.isError ? (
        <Callout variant="warn" title="rollback failed">
          {errorMessage(rollback.error)}
        </Callout>
      ) : null}

      <ConfirmDialog
        open={rollingBackTo !== null}
        onOpenChange={(open) => {
          if (!open) setRollingBackTo(null)
        }}
        title={`Roll back to v${rollingBackTo ?? ''}`}
        description="The stored body and subject of that version become the template's newest version."
        confirmPhrase={`v${rollingBackTo ?? ''}`}
        confirmLabel="Roll back"
        consequences={
          <>
            This creates version {currentVersion + 1} holding v{rollingBackTo}'s content. Nothing
            between them is deleted — v{currentVersion} stays in this list, and anything already
            sent from it is unaffected.
          </>
        }
        pending={rollback.isPending}
        onConfirm={() => {
          if (rollingBackTo !== null) rollback.mutate(rollingBackTo)
        }}
      />
    </div>
  )
}
