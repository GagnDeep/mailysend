import type { Status } from '@mailysend/ui'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  MonoChip,
  Progress,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronDown, Target } from 'lucide-react'
import { useId, useState } from 'react'
import { dateTime, num, relativeTime } from '~/components/app/format.ts'
import { PlacementCard } from '~/components/app/honesty.tsx'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { CardsSkeleton, EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import type { SeedTestRecord } from '~/lib/api-client.ts'
import { qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

/**
 * Seed-list placement testing.
 *
 * This is the only screen in the product that produces a *measured* placement
 * figure, and it is careful about what that means: it delivers to mailboxes we
 * control and reads which folder each one landed in. That is a sample taken on
 * one day, not a statement about the whole audience — so the copy says so, and
 * a `received_count` below `seed_count` is presented as a result rather than
 * quietly hidden.
 */

export const Route = createFileRoute('/app/placement')({
  head: () => appHead('Inbox placement'),
  component: Placement,
})

const PENDING = new Set(['queued', 'sending', 'collecting'])

/**
 * A seed test has one state the badge vocabulary does not: `collecting`, the
 * window in which mailboxes are still reporting in. It borrows `pending`'s
 * colour and keeps its own word, so the reader sees the real state.
 */
const BADGE_STATUS: Record<SeedTestRecord['status'], Status> = {
  queued: 'queued',
  sending: 'sending',
  collecting: 'pending',
  complete: 'delivered',
  failed: 'failed',
}

function Placement() {
  const api = useApi()
  const environment = useEnvironment()
  const [dialogOpen, setDialogOpen] = useState(false)

  const tests = useQuery({
    queryKey: qk.seedTests(environment),
    queryFn: () => api.listSeedTests({ limit: 50 }),
    // A test in flight is the one thing on this screen that changes by itself.
    refetchInterval: (query) =>
      query.state.data?.data.some((test) => PENDING.has(test.status)) ? 15_000 : false,
  })

  return (
    <>
      <PageHeader
        eyebrow="Deliverability"
        title="Seed-list placement testing"
        description="Deliver to mailboxes we control, then read where each one landed. It is the only inbox-placement number on this product that is measured rather than inferred."
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Target aria-hidden="true" />
            Run a test
          </Button>
        }
      />

      {tests.isLoading ? (
        <TableSkeleton rows={4} columns={5} />
      ) : tests.error ? (
        <ErrorState
          error={tests.error}
          subject="your placement tests"
          onRetry={() => void tests.refetch()}
        />
      ) : (tests.data?.data.length ?? 0) === 0 ? (
        <EmptyState
          icon={Target}
          title="No placement tests yet"
          description="A test sends your template to a seed set across Gmail, Outlook, Yahoo and Apple, then reports the folder each copy landed in."
          action={{ label: 'Run your first placement test', onClick: () => setDialogOpen(true) }}
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {(tests.data?.data ?? []).map((test) => (
            <li key={test.id}>
              <TestRow test={test} />
            </li>
          ))}
        </ul>
      )}

      <RunTestDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}

const TestRow = ({ test }: { test: SeedTestRecord }) => {
  const api = useApi()
  const environment = useEnvironment()
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const isComplete = test.status === 'complete'

  const detail = useQuery({
    queryKey: qk.seedTest(environment, test.id),
    queryFn: () => api.getSeedTest(test.id),
    enabled: expanded && isComplete && test.results === undefined,
  })

  const results = test.results ?? detail.data?.results ?? []
  const receivedPercent = test.seed_count === 0 ? 0 : (test.received_count / test.seed_count) * 100

  return (
    <div className="rounded-tile border border-line-soft bg-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          disabled={!isComplete}
          onClick={() => setExpanded((previous) => !previous)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
        >
          <ChevronDown
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-2 transition-transform duration-[0.18s] ${
              expanded ? 'rotate-180' : ''
            } ${isComplete ? '' : 'opacity-0'}`}
          />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold">{test.name}</span>
            <span className="mt-0.5 block font-mono text-[12px] text-muted-2">
              {test.id} · created {relativeTime(test.created_at)}
            </span>
          </span>
        </button>

        <MonoChip size="sm" title={dateTime(test.created_at)}>
          {num(test.received_count)}/{num(test.seed_count)} seeds
        </MonoChip>
        <StatusBadge
          status={BADGE_STATUS[test.status]}
          label={test.status}
          pulse={test.status === 'sending' || test.status === 'collecting'}
        />
      </div>

      {PENDING.has(test.status) ? (
        <div className="border-t border-line-soft px-4 py-3.5">
          <Progress
            value={receivedPercent}
            aria-label={`${num(test.received_count)} of ${num(test.seed_count)} seed mailboxes have received the message`}
            tone="accent"
          />
          <p className="m-0 mt-2 text-[13.5px] leading-snug text-muted">
            {num(test.received_count)} of {num(test.seed_count)} seed mailboxes have reported in.
            Results are partial until collection finishes — providers file a message minutes after
            they accept it, so an early reading understates the inbox share.
          </p>
        </div>
      ) : null}

      {test.status === 'failed' ? (
        <p className="m-0 border-t border-line-soft px-4 py-3.5 text-[13.5px] text-warning">
          This test failed before it could collect results. Nothing was measured, so no placement
          figure is shown rather than a partial one presented as complete.
        </p>
      ) : null}

      <div id={panelId} hidden={!expanded}>
        <div className="border-t border-line-soft p-4">
          {test.received_count < test.seed_count && isComplete ? (
            <p className="m-0 mb-3 text-[13.5px] leading-snug text-warning">
              {num(test.seed_count - test.received_count)} of {num(test.seed_count)} seed mailboxes
              never received the message. That gap is itself the finding: it is mail that was
              accepted and then dropped, and it is counted in the missing share below.
            </p>
          ) : null}

          {detail.isLoading ? (
            <CardsSkeleton count={4} />
          ) : detail.error ? (
            <ErrorState
              error={detail.error}
              subject="this test's results"
              onRetry={() => void detail.refetch()}
            />
          ) : results.length === 0 ? (
            <p className="m-0 text-[13.5px] text-muted">
              This test completed without a per-provider breakdown.
            </p>
          ) : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
            >
              {results.map((figure) => (
                <PlacementCard key={`${figure.provider}-${figure.measured_at}`} figure={figure} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const NONE = '__none__'

const RunTestDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const nameId = useId()
  const subjectId = useId()
  const domainFieldId = useId()
  const [name, setName] = useState('')
  const [subject, setSubject] = useState(NONE)
  const [domainId, setDomainId] = useState(NONE)

  const templates = useQuery({
    queryKey: qk.templates(environment),
    queryFn: () => api.listTemplates({ limit: 100 }),
    enabled: open,
  })

  const broadcasts = useQuery({
    queryKey: qk.broadcasts(environment),
    queryFn: () => api.listBroadcasts({ limit: 100 }),
    enabled: open,
  })

  const domains = useQuery({
    queryKey: qk.domains(environment),
    queryFn: () => api.listDomains({ limit: 100 }),
    enabled: open,
  })

  const create = useMutation({
    mutationFn: () => {
      const [kind, id] = subject.split(':')
      return api.createSeedTest({
        name,
        ...(kind === 'broadcast' ? { broadcast_id: id } : { template_id: id }),
        domain_id: domainId,
      })
    },
    onSuccess: (test) => {
      void queryClient.invalidateQueries({ queryKey: qk.seedTests(environment) })
      toast.success(`Seeding "${test.name}"`, {
        description: `${num(test.seed_count)} mailboxes. Results appear as each one reports in.`,
      })
      onOpenChange(false)
      setName('')
      setSubject(NONE)
      setDomainId(NONE)
    },
    onError: (error: Error) =>
      toast.error('Could not start the test', { description: error.message }),
  })

  const ready = name.trim() !== '' && subject !== NONE && domainId !== NONE

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Run a placement test</DialogTitle>
          <DialogDescription>
            A seed test delivers this message to mailboxes we control at Gmail, Outlook, Yahoo and
            Apple, then reads which folder each copy landed in. That makes it a measurement rather
            than an inference — but it is a measurement of those mailboxes, on this day, for this
            message. It is a sample, not your whole audience, and it cannot tell you where your own
            recipients' filters put the mail. If fewer mailboxes report in than were seeded, that
            gap is a result too: mail accepted and then discarded.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (ready) create.mutate()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameId}>Test name</Label>
            <Input
              id={nameId}
              value={name}
              placeholder="March digest, pre-send"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={subjectId}>What to send</Label>
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger id={subjectId} aria-label="Template or broadcast to test">
                <SelectValue placeholder="Pick a template or broadcast" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} disabled>
                  Pick a template or broadcast
                </SelectItem>
                <SelectGroup>
                  <SelectLabel>Templates</SelectLabel>
                  {(templates.data?.data ?? []).map((template) => (
                    <SelectItem key={template.id} value={`template:${template.id}`}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Broadcasts</SelectLabel>
                  {(broadcasts.data?.data ?? []).map((broadcast) => (
                    <SelectItem key={broadcast.id} value={`broadcast:${broadcast.id}`}>
                      {broadcast.name ?? broadcast.subject ?? broadcast.id}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={domainFieldId}>From domain</Label>
            <Select value={domainId} onValueChange={setDomainId}>
              <SelectTrigger id={domainFieldId} aria-label="From domain">
                <SelectValue placeholder="Pick a sending domain" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} disabled>
                  Pick a sending domain
                </SelectItem>
                {(domains.data?.data ?? []).map((domain) => (
                  <SelectItem key={domain.id} value={domain.id}>
                    {domain.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="m-0 text-[13px] leading-snug text-muted-2">
              Placement is a property of the sending domain's reputation, so the answer changes with
              the domain you send from.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? 'Starting…' : 'Start the test'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
