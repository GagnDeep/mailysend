import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FlowConnector,
  FlowNode,
  Input,
  Label,
  MonoChip,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@mailysend/ui'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { cloneElement, useId, useState } from 'react'
import { num } from '~/components/app/format.ts'
import type { AutomationRecord } from '~/lib/api-client.ts'

export type AutomationStepRecord = AutomationRecord['steps'][number]
export type AutomationTriggerRecord = AutomationRecord['trigger']
type StepType = AutomationStepRecord['type']
type TriggerType = AutomationTriggerRecord['type']

/**
 * `then` and `otherwise` are `unknown[]` in the contract because a zod
 * discriminated union cannot refer to itself. The recursion is real at runtime,
 * so it is asserted here — once — rather than at every read site.
 */
const armOf = (step: AutomationStepRecord, arm: 'then' | 'otherwise'): AutomationStepRecord[] =>
  step.type === 'branch' ? ((step[arm] ?? []) as AutomationStepRecord[]) : []

const STEP_LABELS: Record<StepType, string> = {
  send: 'Send',
  wait: 'Wait',
  wait_until: 'Wait until',
  branch: 'Branch',
  tag: 'Tag',
  webhook: 'Webhook',
  exit: 'Exit',
}

const TRIGGER_LABELS: Record<TriggerType, string> = {
  contact_created: 'Contact created',
  segment_entered: 'Segment entered',
  segment_exited: 'Segment exited',
  event: 'Event received',
  api: 'API enrollment',
  schedule: 'Schedule',
}

export const describeTrigger = (trigger: AutomationTriggerRecord): string => {
  switch (trigger.type) {
    case 'contact_created':
      return `When a contact is added to audience ${trigger.audience_id}`
    case 'segment_entered':
      return `When a contact enters segment ${trigger.segment_id}`
    case 'segment_exited':
      return `When a contact leaves segment ${trigger.segment_id}`
    case 'event':
      return `When the event “${trigger.name}” arrives`
    case 'api':
      return `When enrolled through the API as “${trigger.name}”`
    case 'schedule':
      return `On the schedule ${trigger.cron}`
  }
}

export const describeStep = (step: AutomationStepRecord): string => {
  switch (step.type) {
    case 'send':
      return step.template_id
        ? `Send template ${step.template_id}`
        : `Send “${step.subject?.trim() || 'untitled'}”`
    case 'wait':
      return `Wait ${step.duration}`
    case 'wait_until':
      return `Wait for “${step.event}”, giving up after ${step.timeout}`
    case 'branch':
      return `If ${step.condition}`
    case 'tag': {
      const parts: string[] = []
      if (step.add?.length) parts.push(`add ${step.add.join(', ')}`)
      if (step.remove?.length) parts.push(`remove ${step.remove.join(', ')}`)
      return parts.length ? `Tag: ${parts.join(' · ')}` : 'Tag: nothing set'
    }
    case 'webhook':
      return `POST to ${step.url}`
    case 'exit':
      return 'Leave the automation'
  }
}

const blankStep = (type: StepType): AutomationStepRecord => {
  switch (type) {
    case 'send':
      return { type: 'send', subject: '', html: '' }
    case 'wait':
      return { type: 'wait', duration: '1 day' }
    case 'wait_until':
      return { type: 'wait_until', event: '', timeout: '7 days' }
    case 'branch':
      // biome-ignore lint/suspicious/noThenProperty: `then` is the branch arm's name in the contract.
      return { type: 'branch', condition: '', then: [], otherwise: [] }
    case 'tag':
      return { type: 'tag', add: [], remove: [] }
    case 'webhook':
      return { type: 'webhook', url: '' }
    case 'exit':
      return { type: 'exit' }
  }
}

const blankTrigger = (type: TriggerType): AutomationTriggerRecord => {
  switch (type) {
    case 'contact_created':
      return { type: 'contact_created', audience_id: '' }
    case 'segment_entered':
      return { type: 'segment_entered', segment_id: '' }
    case 'segment_exited':
      return { type: 'segment_exited', segment_id: '' }
    case 'event':
      return { type: 'event', name: '' }
    case 'api':
      return { type: 'api', name: '' }
    case 'schedule':
      return { type: 'schedule', cron: '0 9 * * *' }
  }
}

const commaList = (value: string[] | undefined): string => (value ?? []).join(', ')
const parseCommaList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

/**
 * The id is generated here and cloned onto the control, because `Label`
 * requires `htmlFor` and threading a dozen hand-written ids through these
 * dialogs is how one of them ends up unlabelled.
 */
const Field = ({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactElement<{ id?: string }>
}) => {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, { id })}
      {hint ? <p className="m-0 text-[12.5px] leading-snug text-muted-2">{hint}</p> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

const TriggerDialog = ({
  open,
  onOpenChange,
  trigger,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: AutomationTriggerRecord
  onSave: (next: AutomationTriggerRecord) => void
}) => {
  const [draft, setDraft] = useState<AutomationTriggerRecord>(trigger)
  const selectId = useId()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(trigger)
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit trigger</DialogTitle>
          <DialogDescription>
            What puts a contact into this automation. One trigger per automation.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={selectId}>Trigger type</Label>
            <Select
              value={draft.type}
              onValueChange={(next) => setDraft(blankTrigger(next as TriggerType))}
            >
              <SelectTrigger id={selectId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((type) => (
                  <SelectItem key={type} value={type}>
                    {TRIGGER_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {draft.type === 'contact_created' ? (
            <Field label="Audience id" hint="The aud_ id whose new contacts enroll.">
              <Input
                value={draft.audience_id}
                className="font-mono text-[13px]"
                placeholder="aud_…"
                onChange={(event) => setDraft({ ...draft, audience_id: event.target.value })}
              />
            </Field>
          ) : null}

          {draft.type === 'segment_entered' || draft.type === 'segment_exited' ? (
            <Field label="Segment id" hint="Membership is re-evaluated when contact data changes.">
              <Input
                value={draft.segment_id}
                className="font-mono text-[13px]"
                placeholder="seg_…"
                onChange={(event) => setDraft({ ...draft, segment_id: event.target.value })}
              />
            </Field>
          ) : null}

          {draft.type === 'event' || draft.type === 'api' ? (
            <Field
              label="Event name"
              hint={
                draft.type === 'api'
                  ? 'The name callers pass to POST /v1/automations/:id/enroll.'
                  : 'Matched exactly against the event’s name.'
              }
            >
              <Input
                value={draft.name}
                className="font-mono text-[13px]"
                placeholder="signup.completed"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </Field>
          ) : null}

          {draft.type === 'schedule' ? (
            <Field
              label="Cron expression"
              hint="Five fields, UTC. Minimum granularity is one hour."
            >
              <Input
                value={draft.cron}
                className="font-mono text-[13px]"
                placeholder="0 9 * * *"
                onChange={(event) => setDraft({ ...draft, cron: event.target.value })}
              />
            </Field>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(draft)
              onOpenChange(false)
            }}
          >
            Save trigger
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Step editor
// ---------------------------------------------------------------------------

const StepDialog = ({
  open,
  onOpenChange,
  step,
  stepId,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  step: AutomationStepRecord
  stepId: string
  onSave: (next: AutomationStepRecord) => void
}) => {
  const [draft, setDraft] = useState<AutomationStepRecord>(step)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(step)
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {STEP_LABELS[step.type].toLowerCase()} step</DialogTitle>
          <DialogDescription>
            Step <span className="font-mono">{stepId}</span>. The id is its position, so saving a
            change to a published automation publishes a new version.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          {draft.type === 'send' ? (
            <>
              <Field
                label="Template id"
                hint="Leave empty to write the message inline below. A template keeps one copy for every automation that sends it."
              >
                <Input
                  value={draft.template_id ?? ''}
                  className="font-mono text-[13px]"
                  placeholder="tpl_…"
                  onChange={(event) =>
                    setDraft({ ...draft, template_id: event.target.value || undefined })
                  }
                />
              </Field>
              {draft.template_id ? null : (
                <>
                  <Field label="Subject">
                    <Input
                      value={draft.subject ?? ''}
                      onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
                    />
                  </Field>
                  <Field label="HTML body">
                    <Textarea
                      value={draft.html ?? ''}
                      rows={7}
                      spellCheck={false}
                      className="font-mono text-[12.5px]"
                      onChange={(event) => setDraft({ ...draft, html: event.target.value })}
                    />
                  </Field>
                  <Field label="Plain text body" hint="Sent as the text/plain alternative.">
                    <Textarea
                      value={draft.text ?? ''}
                      rows={4}
                      className="font-mono text-[12.5px]"
                      onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                    />
                  </Field>
                </>
              )}
              <Field label="From" hint="Optional. Falls back to the workspace default sender.">
                <Input
                  value={draft.from ?? ''}
                  placeholder="Team <team@example.com>"
                  onChange={(event) =>
                    setDraft({ ...draft, from: event.target.value || undefined })
                  }
                />
              </Field>
            </>
          ) : null}

          {draft.type === 'wait' ? (
            <Field
              label="Duration"
              hint="Plain English: “2 days”, “30 minutes”, “1 week”. In cohort mode the wait ends on the next hourly tick after this."
            >
              <Input
                value={draft.duration}
                className="font-mono text-[13px]"
                onChange={(event) => setDraft({ ...draft, duration: event.target.value })}
              />
            </Field>
          ) : null}

          {draft.type === 'wait_until' ? (
            <>
              <Field
                label="Event name"
                hint="Per-contact mode only — a cohort cannot watch one contact."
              >
                <Input
                  value={draft.event}
                  className="font-mono text-[13px]"
                  placeholder="order.placed"
                  onChange={(event) => setDraft({ ...draft, event: event.target.value })}
                />
              </Field>
              <Field
                label="Timeout"
                hint="After this the contact continues to the next step anyway."
              >
                <Input
                  value={draft.timeout}
                  className="font-mono text-[13px]"
                  onChange={(event) => setDraft({ ...draft, timeout: event.target.value })}
                />
              </Field>
            </>
          ) : null}

          {draft.type === 'branch' ? (
            <Field
              label="Condition"
              hint="Segment expression syntax. Contacts it matches take the “then” arm."
            >
              <Textarea
                value={draft.condition}
                rows={3}
                spellCheck={false}
                className="font-mono text-[12.5px]"
                placeholder="opened_last_30d = true"
                onChange={(event) => setDraft({ ...draft, condition: event.target.value })}
              />
            </Field>
          ) : null}

          {draft.type === 'tag' ? (
            <>
              <Field label="Add tags" hint="Comma separated.">
                <Input
                  value={commaList(draft.add)}
                  className="font-mono text-[13px]"
                  onChange={(event) =>
                    setDraft({ ...draft, add: parseCommaList(event.target.value) })
                  }
                />
              </Field>
              <Field label="Remove tags" hint="Comma separated.">
                <Input
                  value={commaList(draft.remove)}
                  className="font-mono text-[13px]"
                  onChange={(event) =>
                    setDraft({ ...draft, remove: parseCommaList(event.target.value) })
                  }
                />
              </Field>
            </>
          ) : null}

          {draft.type === 'webhook' ? (
            <Field
              label="URL"
              hint="POSTed with the contact and the automation's context. Retried on 5xx."
            >
              <Input
                value={draft.url}
                className="font-mono text-[13px]"
                placeholder="https://example.com/hooks/automation"
                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              />
            </Field>
          ) : null}

          {draft.type === 'exit' ? (
            <p className="m-0 text-[14px] leading-relaxed text-muted">
              The contact leaves here and is not enrolled again unless the trigger fires afresh.
              Nothing to configure.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(draft)
              onOpenChange(false)
            }}
          >
            Save step
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Add-step menu
// ---------------------------------------------------------------------------

const AddStepMenu = ({
  onAdd,
  label,
}: {
  onAdd: (type: StepType) => void
  /** Names the insertion point, e.g. "after s1.wait". */
  label: string
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm" aria-label={`Add a step ${label}`}>
        <Plus aria-hidden="true" />
        Add step
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      {(Object.keys(STEP_LABELS) as StepType[]).map((type) => (
        <DropdownMenuItem key={type} onSelect={() => onAdd(type)}>
          {STEP_LABELS[type]}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
)

// ---------------------------------------------------------------------------
// The recursive step list
// ---------------------------------------------------------------------------

interface StepFlowProps {
  steps: AutomationStepRecord[]
  onChange: (steps: AutomationStepRecord[]) => void
  /** Prefix for the positional step id: `''` at the top, `s2.branch.then.` inside an arm. */
  prefix: string
  counts?: Record<string, number>
  emptyLabel: string
}

const StepFlow = ({ steps, onChange, prefix, counts, emptyLabel }: StepFlowProps) => {
  const [editing, setEditing] = useState<number | null>(null)

  const replace = (index: number, step: AutomationStepRecord) =>
    onChange(steps.map((current, position) => (position === index ? step : current)))

  const insert = (index: number, type: StepType) =>
    onChange([...steps.slice(0, index), blankStep(type), ...steps.slice(index)])

  const remove = (index: number) => onChange(steps.filter((_, position) => position !== index))

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= steps.length) return
    const next = [...steps]
    const [moved] = next.splice(index, 1)
    if (moved) next.splice(target, 0, moved)
    onChange(next)
  }

  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {steps.length === 0 ? (
        <li className="flex flex-col gap-2.5">
          <p className="m-0 text-[13.5px] text-muted-2">{emptyLabel}</p>
          <AddStepMenu label={emptyLabel} onAdd={(type) => insert(0, type)} />
        </li>
      ) : null}

      {steps.map((step, index) => {
        const id = `${prefix}s${index}.${step.type}`
        const waiting = counts?.[id]
        return (
          <li key={id} className="flex flex-col">
            <FlowNode
              kicker={STEP_LABELS[step.type].toUpperCase()}
              tone={step.type === 'exit' ? 'danger' : 'paper'}
              title={describeStep(step)}
              meta={
                <span className="flex flex-wrap items-center gap-2">
                  <MonoChip size="sm">{id}</MonoChip>
                  {waiting === undefined ? null : (
                    <span className="text-[13px] text-muted">{num(waiting)} waiting now</span>
                  )}
                </span>
              }
            />

            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Edit step ${id}`}
                onClick={() => setEditing(index)}
              >
                <Pencil aria-hidden="true" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Move step ${id} earlier`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp aria-hidden="true" />
                Up
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Move step ${id} later`}
                disabled={index === steps.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown aria-hidden="true" />
                Down
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete step ${id}`}
                onClick={() => remove(index)}
              >
                <Trash2 aria-hidden="true" />
                Delete
              </Button>
            </div>

            {editing === index ? (
              <StepDialog
                open
                onOpenChange={(open) => {
                  if (!open) setEditing(null)
                }}
                step={step}
                stepId={id}
                onSave={(next) => replace(index, next)}
              />
            ) : null}

            {step.type === 'branch' ? (
              <div className="mt-3 flex flex-col gap-4 border-l-2 border-line pl-4">
                {(['then', 'otherwise'] as const).map((arm) => (
                  <section key={arm} className="flex flex-col gap-2">
                    <h4 className="ms-eyebrow m-0 text-[10.5px] text-muted-2">
                      {arm === 'then' ? 'then · condition matched' : 'otherwise · everyone else'}
                    </h4>
                    <StepFlow
                      steps={armOf(step, arm)}
                      prefix={`${id}.${arm}.`}
                      counts={counts}
                      emptyLabel={`No steps in the ${arm} arm of ${id} yet.`}
                      onChange={(armSteps) =>
                        replace(
                          index,
                          arm === 'then'
                            ? // biome-ignore lint/suspicious/noThenProperty: as above — the contract names the arm `then`.
                              { ...step, then: armSteps }
                            : { ...step, otherwise: armSteps },
                        )
                      }
                    />
                  </section>
                ))}
              </div>
            ) : null}

            <div className="flex flex-col items-start gap-2 py-3">
              <FlowConnector arrow />
              <AddStepMenu label={`after ${id}`} onAdd={(type) => insert(index + 1, type)} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export interface AutomationBuilderProps {
  automation: AutomationRecord
  onChange: (automation: AutomationRecord) => void
  /**
   * Live per-step counts keyed by positional step id. Absent keys render no
   * number at all: "0 waiting" and "we do not know" are different claims.
   */
  counts?: Record<string, number>
}

export const AutomationBuilder = ({ automation, onChange, counts }: AutomationBuilderProps) => {
  const [editingTrigger, setEditingTrigger] = useState(false)

  return (
    <div className="flex flex-col gap-3">
      {automation.status === 'active' ? (
        <Callout variant="warn" title="editing publishes a new version">
          Step ids are positional (<span className="font-mono">s0.send</span>) and Workflows replay
          by step id, so reordering, inserting or deleting a step would corrupt runs already in
          flight. Saving therefore writes version {automation.version + 1} and leaves the{' '}
          {num(automation.enrolled_count ?? 0)} contacts already enrolled to finish on version{' '}
          {automation.version}.
        </Callout>
      ) : null}

      <div className="flex flex-col">
        <FlowNode
          kicker="TRIGGER"
          tone="dark"
          title={TRIGGER_LABELS[automation.trigger.type]}
          meta={describeTrigger(automation.trigger)}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Edit the trigger"
            onClick={() => setEditingTrigger(true)}
          >
            <Pencil aria-hidden="true" />
            Edit trigger
          </Button>
        </div>
        {editingTrigger ? (
          <TriggerDialog
            open
            onOpenChange={setEditingTrigger}
            trigger={automation.trigger}
            onSave={(trigger) => onChange({ ...automation, trigger })}
          />
        ) : null}

        <div className="flex flex-col items-start gap-2 py-3">
          <FlowConnector arrow />
          <AddStepMenu
            label="as the first step"
            onAdd={(type) =>
              onChange({ ...automation, steps: [blankStep(type), ...automation.steps] })
            }
          />
        </div>

        <StepFlow
          steps={automation.steps}
          prefix=""
          counts={counts}
          emptyLabel="No steps yet. An automation needs at least one before it can be activated."
          onChange={(steps) => onChange({ ...automation, steps })}
        />
      </div>
    </div>
  )
}

/** True when any step, at any branch depth, is a `wait_until`. */
export const hasWaitUntilStep = (steps: AutomationStepRecord[]): boolean =>
  steps.some(
    (step) =>
      step.type === 'wait_until' ||
      (step.type === 'branch' &&
        (hasWaitUntilStep(armOf(step, 'then')) || hasWaitUntilStep(armOf(step, 'otherwise')))),
  )
