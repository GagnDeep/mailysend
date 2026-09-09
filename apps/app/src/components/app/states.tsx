// biome-ignore-all lint/suspicious/noArrayIndexKey: a skeleton row has no identity to key by.

import { Button, Callout, cn, EmptyState, Skeleton } from '@mailysend/ui'
import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { ApiClientError } from '~/lib/api-client.ts'
import { errorMessage } from '~/lib/query.ts'

/**
 * Loading, error and empty — the three states every screen owes the reader.
 *
 * `EmptyState` already forces a next action through its type; the error state
 * matches it by always offering retry plus, when the API sent one, the doc link
 * for the specific code. Neither ends in "contact support".
 */

export const TableSkeleton = ({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) => (
  <div
    role="status"
    aria-live="polite"
    aria-busy="true"
    className="overflow-hidden rounded-tile border border-line bg-card"
  >
    <span className="sr-only">Loading…</span>
    {Array.from({ length: rows }, (_, row) => (
      <div
        key={row}
        className="flex items-center gap-4 border-b border-line-soft px-4 py-3.5 last:border-0"
      >
        {Array.from({ length: columns }, (_, column) => (
          <Skeleton key={column} className={cn('h-4', column === 0 ? 'w-40' : 'flex-1')} />
        ))}
      </div>
    ))}
  </div>
)

export const CardsSkeleton = ({ count = 4 }: { count?: number }) => (
  <div
    role="status"
    aria-busy="true"
    className="grid gap-3"
    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
  >
    <span className="sr-only">Loading…</span>
    {Array.from({ length: count }, (_, index) => (
      <Skeleton key={`tile-${index}`} className="h-[92px] rounded-tile" />
    ))}
  </div>
)

export const DetailSkeleton = () => (
  <div role="status" aria-busy="true" className="flex flex-col gap-3">
    <span className="sr-only">Loading…</span>
    <Skeleton className="h-8 w-64" />
    <Skeleton className="h-4 w-96" />
    <Skeleton className="h-48 rounded-tile" />
  </div>
)

export interface ErrorStateProps {
  error: unknown
  /** What the reader was trying to see, in a noun phrase: "the message log". */
  subject: string
  onRetry?: () => void
}

export const ErrorState = ({ error, subject, onRetry }: ErrorStateProps) => {
  const api = error instanceof ApiClientError ? error : null
  const code = api?.code

  return (
    <Callout
      variant="warn"
      title={code ? `error · ${code}` : 'error'}
      icon={AlertTriangle}
      actions={
        <>
          {onRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          {api?.docUrl ? (
            <Button asChild size="sm" variant="ghost">
              <a href={api.docUrl}>What this error means</a>
            </Button>
          ) : null}
          {api?.status === 401 ? (
            <Button asChild size="sm" variant="ghost">
              <a href="/sign-in">Sign in again</a>
            </Button>
          ) : null}
        </>
      }
    >
      <p className="m-0">
        Could not load {subject}. {errorMessage(error)}
      </p>
      {api?.param ? <p className="m-0 mt-1.5 font-mono text-[12.5px]">field: {api.param}</p> : null}
    </Callout>
  )
}

/**
 * The one wrapper the screens use, so the ordering of the three states — busy,
 * then failed, then empty, then data — is decided once instead of per-screen.
 */
export interface QueryStateProps<T> {
  isLoading: boolean
  error: unknown
  data: T[] | undefined
  subject: string
  onRetry?: () => void
  empty: ReactNode
  loading?: ReactNode
  children: (data: T[]) => ReactNode
}

export function QueryState<T>({
  isLoading,
  error,
  data,
  subject,
  onRetry,
  empty,
  loading,
  children,
}: QueryStateProps<T>) {
  if (isLoading) return <>{loading ?? <TableSkeleton />}</>
  if (error) return <ErrorState error={error} subject={subject} onRetry={onRetry} />
  if (!data || data.length === 0) return <>{empty}</>
  return <>{children(data)}</>
}

export { EmptyState }
