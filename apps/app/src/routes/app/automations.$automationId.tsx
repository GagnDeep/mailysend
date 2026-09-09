import { Button, Callout, Input, MonoChip, StatusBadge, toast } from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Archive, Check, Pause, Pencil, Play, Save, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { AutomationBuilder, hasWaitUntilStep } from '~/components/app/automation-builder.tsx'
import { AutomationModePicker } from '~/components/app/automation-mode.tsx'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import { num } from '~/components/app/format.ts'
import { PageHeader, PageSection } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { DetailSkeleton, ErrorState } from '~/components/app/states.tsx'
import type { AutomationRecord } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/automations/$automationId')({
  head: () => appHead('Automation'),
  component: AutomationDetail,
})

const NameField = ({ value, onChange }: { value: string; onChange: (name: string) => void }) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputId = useId()

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        {value}
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Rename ${value}`}
          onClick={() => {
            setDraft(value)
            setEditing(true)
          }}
        >
          <Pencil aria-hidden="true" />
        </Button>
      </span>
    )
  }

  const commit = () => {
    const next = draft.trim()
    if (next) onChange(next)
    setEditing(false)
  }

  return (
    <span className="inline-flex items-center gap-2">
      <label className="sr-only" htmlFor={inputId}>
        Automation name
      </label>
      <Input
        id={inputId}
        value={draft}
        autoFocus
        className="h-9 w-[22ch] text-[20px]"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setEditing(false)
        }}
      />
      <Button variant="ghost" size="sm" aria-label="Save the name" onClick={commit}>
        <Check aria-hidden="true" />
      </Button>
    </span>
  )
}

function AutomationDetail() {
  const { automationId } = Route.useParams()
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: Route.fullPath })
  const [draft, setDraft] = useState<AutomationRecord | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const automation = useQuery({
    queryKey: qk.automation(environment, automationId),
    queryFn: () => api.getAutomation(automationId),
  })

  const server = automation.data
  // The builder edits a local copy so an in-progress edit is not thrown away by
  // a background refetch; the server's version wins only when its id changes.
  useEffect(() => {
    setDraft((current) => (current && current.id === server?.id ? current : (server ?? null)))
  }, [server])

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.automation(environment, automationId) })
    await queryClient.invalidateQueries({ queryKey: qk.automations(environment) })
  }

  const save = useMutation({
    mutationFn: (next: AutomationRecord) =>
      api.updateAutomation(automationId, {
        name: next.name,
        mode: next.mode,
        trigger: next.trigger,
        steps: next.steps,
      }),
    onSuccess: async (updated) => {
      setDraft(updated)
      await invalidate()
      toast.success(`Saved as version ${updated.version}.`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const setStatus = useMutation({
    mutationFn: (status: AutomationRecord['status']) =>
      api.updateAutomation(automationId, { status }),
    onSuccess: async (updated) => {
      setDraft((current) => (current ? { ...current, status: updated.status } : updated))
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteAutomation(automationId),
    onSuccess: async () => {
      await invalidate()
      await navigate({ to: '/app/automations' })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  if (automation.isLoading) return <DetailSkeleton />
  if (automation.error) {
    return (
      <ErrorState
        error={automation.error}
        subject="this automation"
        onRetry={() => void automation.refetch()}
      />
    )
  }
  if (!draft) return <DetailSkeleton />

  const dirty =
    server !== undefined &&
    (draft.name !== server.name ||
      draft.mode !== server.mode ||
      JSON.stringify(draft.trigger) !== JSON.stringify(server.trigger) ||
      JSON.stringify(draft.steps) !== JSON.stringify(server.steps))

  const waitUntil = hasWaitUntilStep(draft.steps)

  return (
    <>
      <PageHeader
        eyebrow="Automation"
        title={<NameField value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={draft.status} size="sm" />
            <MonoChip size="sm">v{draft.version}</MonoChip>
            <MonoChip size="sm" tone={draft.mode === 'instance' ? 'accent' : 'neutral'}>
              {draft.mode}
            </MonoChip>
            {draft.enrolled_count === undefined ? null : (
              <span className="text-[13.5px] text-muted">{num(draft.enrolled_count)} enrolled</span>
            )}
          </span>
        }
        actions={
          <>
            {draft.status === 'active' ? (
              <Button
                variant="outline"
                size="sm"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate('paused')}
              >
                <Pause aria-hidden="true" />
                Pause
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={setStatus.isPending || draft.status === 'archived'}
                onClick={() => setStatus.mutate('active')}
              >
                <Play aria-hidden="true" />
                Activate
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={setStatus.isPending || draft.status === 'archived'}
              onClick={() => setStatus.mutate('archived')}
            >
              <Archive aria-hidden="true" />
              Archive
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </>
        }
      />

      <PageSection
        title="Execution mode"
        description="Two ways to run the same steps. The difference is timing precision against audience size."
      >
        <AutomationModePicker
          value={draft.mode}
          onChange={(mode) => setDraft({ ...draft, mode })}
          enrolledCount={draft.enrolled_count}
          hasWaitUntil={waitUntil}
        />
      </PageSection>

      <PageSection
        title="Steps"
        description="Read top to bottom. Every contact walks the same list."
        action={
          <div className="flex items-center gap-2.5">
            {dirty ? <span className="font-mono text-[11.5px] text-warning">unsaved</span> : null}
            <Button
              size="sm"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate(draft)}
            >
              <Save aria-hidden="true" />
              {save.isPending ? 'Saving…' : `Save as v${draft.version + 1}`}
            </Button>
          </div>
        }
      >
        {draft.status === 'draft' ? (
          <Callout variant="info" title="draft">
            Nothing enrolls until this is activated. Saving a draft overwrites it in place rather
            than cutting a version, because no instance is replaying it yet.
          </Callout>
        ) : null}

        <AutomationBuilder automation={draft} onChange={setDraft} />
      </PageSection>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete ${draft.name}`}
        description="The automation, all of its versions and its enrollment history go away."
        confirmPhrase={draft.name}
        confirmLabel="Delete automation"
        consequences={
          <>
            {num(draft.enrolled_count ?? 0)} contacts are enrolled right now. They stop where they
            are and receive nothing further. Messages already sent stay in the logs.
          </>
        }
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}
