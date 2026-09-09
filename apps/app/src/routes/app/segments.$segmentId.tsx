import { Button, Callout, Input, Label, MonoChip, toast } from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Send } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import { num, relativeTime } from '~/components/app/format.ts'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { SegmentEditor } from '~/components/app/segment-editor.tsx'
import { DetailSkeleton, ErrorState } from '~/components/app/states.tsx'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/segments/$segmentId')({
  head: () => appHead('Segment'),
  component: SegmentDetail,
})

function SegmentDetail() {
  const { segmentId } = Route.useParams()
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: Route.fullPath })
  const nameId = useId()

  const [name, setName] = useState<string | null>(null)
  const [expression, setExpression] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const segment = useQuery({
    queryKey: qk.segment(environment, segmentId),
    queryFn: () => api.getSegment(segmentId),
  })

  const saved = segment.data
  // The form is seeded once from the server copy; adopting every refetch would
  // overwrite an edit in progress with a value the reader has already changed.
  useEffect(() => {
    if (!saved) return
    setName((current) => current ?? saved.name)
    setExpression((current) => current ?? saved.expression)
  }, [saved])

  const audiences = useQuery({
    queryKey: qk.audiences(environment),
    queryFn: () => api.listAudiences({ limit: 100 }),
  })

  const save = useMutation({
    mutationFn: (body: { name: string; expression: string }) => api.updateSegment(segmentId, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.segment(environment, segmentId), updated)
      void queryClient.invalidateQueries({ queryKey: qk.segments(environment) })
      toast.success('Segment saved. Membership recomputes in the background.')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteSegment(segmentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.segments(environment) })
      toast.success('Segment deleted')
      void navigate({ to: '/app/segments' })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  if (segment.isLoading) return <DetailSkeleton />
  if (segment.error || !saved) {
    return (
      <ErrorState
        error={segment.error}
        subject="this segment"
        onRetry={() => void segment.refetch()}
      />
    )
  }

  const currentName = name ?? saved.name
  const currentExpression = expression ?? saved.expression
  const audienceName =
    audiences.data?.data.find((audience) => audience.id === saved.audience_id)?.name ??
    saved.audience_id
  const dirty = currentName !== saved.name || currentExpression !== saved.expression

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/app/segments" className="underline-offset-4 hover:underline">
            ← Segments
          </Link>
        }
        title={saved.name}
        description={
          <>
            Over{' '}
            <Link
              to="/app/audiences/$audienceId"
              params={{ audienceId: saved.audience_id }}
              className="underline underline-offset-4"
            >
              {audienceName}
            </Link>
            {saved.member_count === undefined
              ? '. Membership has not been computed yet.'
              : ` · ${num(saved.member_count)} members`}
            {saved.computed_at ? `, last computed ${relativeTime(saved.computed_at)}.` : '.'}
          </>
        }
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link
                to="/app/broadcasts/new"
                search={{ segment_id: saved.id, audience_id: saved.audience_id }}
              >
                <Send aria-hidden="true" />
                Send to this segment
              </Link>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4 rounded-tile border border-line-soft bg-card p-4">
        <div className="flex max-w-[420px] flex-col gap-2">
          <Label htmlFor={nameId}>Segment name</Label>
          <Input
            id={nameId}
            value={currentName}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <SegmentEditor
          audienceId={saved.audience_id}
          audienceName={audienceName}
          expression={currentExpression}
          onChange={setExpression}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={
              !dirty ||
              currentName.trim() === '' ||
              currentExpression.trim() === '' ||
              save.isPending
            }
            onClick={() =>
              save.mutate({ name: currentName.trim(), expression: currentExpression.trim() })
            }
          >
            {save.isPending ? 'Saving…' : 'Save segment'}
          </Button>
          {dirty ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setName(saved.name)
                setExpression(saved.expression)
              }}
            >
              Discard changes
            </Button>
          ) : (
            <span className="text-[12.5px] text-muted-2">Saved.</span>
          )}
        </div>
      </div>

      {dirty ? (
        <Callout variant="info" title="not saved yet">
          The count above is for the expression in the box, not the one that is stored. Anything
          already scheduled against this segment still uses{' '}
          <MonoChip size="sm">{saved.expression}</MonoChip> until you save.
        </Callout>
      ) : null}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${saved.name}`}
        description="The rule is deleted. The contacts it matched are not."
        confirmPhrase={saved.name}
        confirmLabel="Delete segment"
        consequences={
          <p className="m-0">
            Any broadcast or automation still pointing at this segment will fail to resolve its
            recipients. Contacts in <span className="font-mono">{audienceName}</span> are untouched
            — a segment is a rule, not a copy of the list.
          </p>
        }
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}
