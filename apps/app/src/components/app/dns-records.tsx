import type { DnsRecord } from '@mailysend/contracts'
import {
  Button,
  Callout,
  MonoChip,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mailysend/ui'
import { RefreshCw } from 'lucide-react'
import { CopyValue } from '~/components/app/copy-value.tsx'
import { relativeTime } from '~/components/app/format.ts'
import type { DomainRecord } from '~/lib/api-client.ts'

/**
 * The DNS half of domain setup.
 *
 * The verifier resolves each record itself, so this table renders what the
 * resolver saw rather than what the customer says they typed. `failed` is
 * reserved for a record that exists and disagrees — that distinction is the
 * difference between "wait" and "fix a typo", so it is spelled out per row.
 */

/**
 * The resolver may return what it found beside what it wanted. Neither field is
 * in the contract yet, so they are read defensively and simply absent when the
 * API has nothing to say.
 */
interface RecordDiagnostics {
  found?: string | string[] | null
  expected?: string | null
  error?: string | null
  last_checked_at?: string | null
}

const diagnose = (record: DnsRecord): RecordDiagnostics => record as DnsRecord & RecordDiagnostics

const foundText = (found: RecordDiagnostics['found']): string | null => {
  if (found === null || found === undefined) return null
  const text = Array.isArray(found) ? found.join(', ') : found
  return text.trim() === '' ? null : text
}

const PROVIDER_LABEL: Record<string, string> = {
  cloudflare: 'Cloudflare',
  ses: 'Amazon SES',
  resend: 'Resend',
  smtp: 'SMTP',
}

const recordKey = (record: DnsRecord): string => `${record.record}:${record.name}:${record.value}`

export const DnsRecordTable = ({
  domain,
  onVerify,
  verifying,
}: {
  domain: DomainRecord
  onVerify: () => void
  verifying: boolean
}) => {
  const records = domain.records ?? []
  const specific = records.some((record) => record.provider !== 'all')
  const lastChecked = records
    .map((record) => diagnose(record).last_checked_at)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort()
    .at(-1)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[13.5px] text-muted">
          {lastChecked
            ? `Last checked ${relativeTime(lastChecked)}.`
            : 'These records have not been checked yet.'}
        </p>
        <Button size="sm" variant="outline" onClick={onVerify} disabled={verifying}>
          <RefreshCw aria-hidden="true" className={verifying ? 'animate-spin' : undefined} />
          {verifying ? 'Checking…' : 'Check records'}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-tile border border-line-soft bg-card">
        <Table>
          <caption className="sr-only">
            DNS records required for {domain.name}, with the result of the last check
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Type</TableHead>
              <TableHead scope="col">Name</TableHead>
              <TableHead scope="col">Value</TableHead>
              <TableHead scope="col">TTL</TableHead>
              <TableHead scope="col">Priority</TableHead>
              {specific ? <TableHead scope="col">Needed by</TableHead> : null}
              <TableHead scope="col">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={specific ? 7 : 6} className="py-8 text-center text-muted">
                  No records yet. They are generated when the domain is created.
                </TableCell>
              </TableRow>
            ) : (
              records.map((record) => {
                const detail = diagnose(record)
                const found = foundText(detail.found)
                return (
                  <TableRow key={recordKey(record)}>
                    <TableCell>
                      <MonoChip size="sm">{record.record}</MonoChip>
                    </TableCell>
                    <TableCell className="min-w-[220px]">
                      <CopyValue value={record.name} label={`${record.record} record name`} />
                      {record.purpose ? (
                        <span className="mt-1 block text-[12.5px] leading-snug text-muted-2">
                          {record.purpose}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="min-w-[280px] max-w-[420px]">
                      <CopyValue
                        value={record.value}
                        label={`${record.record} record value`}
                        truncate={false}
                        className="items-start"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-[12.5px] text-muted">
                      {record.ttl}
                    </TableCell>
                    <TableCell className="font-mono text-[12.5px] text-muted">
                      {record.priority ?? '—'}
                    </TableCell>
                    {specific ? (
                      <TableCell>
                        {record.provider === 'all' ? (
                          <span className="text-[12.5px] text-muted-2">every provider</span>
                        ) : (
                          <MonoChip size="sm" tone="neutral">
                            {PROVIDER_LABEL[record.provider] ?? record.provider}
                          </MonoChip>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="min-w-[240px]">
                      <StatusBadge status={record.status} size="sm" />
                      {record.status === 'failed' ? (
                        <span className="mt-1.5 block text-[12.5px] leading-snug text-muted">
                          {found ? (
                            <>
                              Found <code className="font-mono break-all text-ink">{found}</code>,
                              expected{' '}
                              <code className="font-mono break-all text-ink">
                                {detail.expected ?? record.value}
                              </code>
                              .
                            </>
                          ) : (
                            'A record with this name resolves but does not match. Check for a trailing dot or a registrar that appended the zone name.'
                          )}
                          {detail.error ? ` ${detail.error}` : null}
                        </span>
                      ) : null}
                      {record.status === 'pending' ? (
                        <span className="mt-1.5 block text-[12.5px] leading-snug text-muted">
                          Nothing published at this name yet, or it has not propagated.
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Callout variant="info" title="propagation">
        DNS changes can take up to an hour to reach our resolver, and some registrars are slower
        still. Nothing is queued or charged while you wait — checking again is free and you can do
        it as often as you like.
      </Callout>
    </div>
  )
}
