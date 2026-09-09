import type { BroadcastVariant } from '@mailysend/contracts'
import {
  Button,
  Callout,
  Checkbox,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus, Send, Trash2 } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import { bareAddress, num } from '~/components/app/format.ts'
import { PageSection } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import type { BroadcastRecord } from '~/lib/api-client.ts'
import { qk } from '~/lib/query.ts'

/**
 * The composer is the same form whether it is creating a broadcast or editing a
 * draft, because the two are the same object at two moments — a second form
 * would drift from the first the day someone adds a field to one of them.
 */

type BodyMode = 'html' | 'text' | 'template'
type VariantDraft = { id: string; key: string; subject: string; weight: number }

let variantSeq = 0
/** A stable React key: the variant's own `key` is user-editable and may repeat. */
const nextVariantId = (): string => {
  variantSeq += 1
  return `variant-${variantSeq}`
}

/** No segment picked. Radix `Select` refuses an empty-string item value. */
const NO_SEGMENT = '__none__'

const MAX_SCHEDULE_DAYS = 30

const emptyVariants = (subject: string): VariantDraft[] => [
  { id: nextVariantId(), key: 'a', subject, weight: 50 },
  { id: nextVariantId(), key: 'b', subject: '', weight: 50 },
]

/** `2026-01-04T09:30` — what `datetime-local` reads and writes. */
const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const BroadcastComposer = ({ broadcast }: { broadcast?: BroadcastRecord }) => {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const ids = useId()

  const editable = !broadcast || broadcast.status === 'draft'

  const initialFrom = broadcast?.from ? bareAddress(broadcast.from) : ''
  const [localPart, setLocalPart] = useState(initialFrom.split('@')[0] ?? '')
  const [fromDomain, setFromDomain] = useState(initialFrom.split('@')[1] ?? '')

  const [name, setName] = useState(broadcast?.name ?? '')
  const [replyTo, setReplyTo] = useState((broadcast?.reply_to ?? []).join(', '))
  const [subject, setSubject] = useState(broadcast?.subject ?? '')
  const [previewText, setPreviewText] = useState(broadcast?.preview_text ?? '')
  const [audienceId, setAudienceId] = useState(broadcast?.audience_id ?? '')
  const [segmentId, setSegmentId] = useState(broadcast?.segment_id ?? NO_SEGMENT)

  const [bodyMode, setBodyMode] = useState<BodyMode>('html')
  const [html, setHtml] = useState('')
  const [text, setText] = useState('')
  const [templateId, setTemplateId] = useState('')

  const [throttle, setThrottle] = useState(String(broadcast?.throttle_per_minute ?? 5000))

  const [abEnabled, setAbEnabled] = useState((broadcast?.variants?.length ?? 0) > 0)
  const [variants, setVariants] = useState<VariantDraft[]>(
    broadcast?.variants?.map((variant) => ({
      id: nextVariantId(),
      key: variant.key,
      subject: variant.subject,
      weight: variant.weight,
    })) ?? emptyVariants(broadcast?.subject ?? ''),
  )
  const [holdout, setHoldout] = useState(String(broadcast?.holdout_percent ?? 0))
  const [winnerMetric, setWinnerMetric] = useState<'opens' | 'clicks'>(
    broadcast?.winner_metric ?? 'opens',
  )

  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>(
    broadcast?.scheduled_at ? 'later' : 'now',
  )
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(broadcast?.scheduled_at))
  const [confirmSend, setConfirmSend] = useState(false)

  const domains = useQuery({
    queryKey: qk.domains(environment),
    queryFn: () => api.listDomains({ limit: 100 }),
  })
  const audiences = useQuery({
    queryKey: qk.audiences(environment),
    queryFn: () => api.listAudiences({ limit: 100 }),
  })
  const segments = useQuery({
    queryKey: qk.segments(environment),
    queryFn: () => api.listSegments({ limit: 100 }),
  })
  const templates = useQuery({
    queryKey: qk.templates(environment),
    queryFn: () => api.listTemplates({ limit: 100 }),
  })

  const verifiedDomains = (domains.data?.data ?? []).filter(
    (domain) => domain.status === 'verified',
  )
  const audienceList = audiences.data?.data ?? []
  const segmentList = (segments.data?.data ?? []).filter(
    (segment) => segment.audience_id === audienceId,
  )
  const chosenSegment = segmentList.find((segment) => segment.id === segmentId)
  const chosenAudience = audienceList.find((audience) => audience.id === audienceId)

  const recipientCount = chosenSegment
    ? chosenSegment.member_count
    : (chosenAudience?.contact_count ?? undefined)

  const from = localPart && fromDomain ? `${localPart}@${fromDomain}` : ''
  const weightTotal = variants.reduce((sum, variant) => sum + (variant.weight || 0), 0)

  const scheduledIso = useMemo(() => {
    if (scheduleMode !== 'later' || !scheduledAt) return undefined
    const date = new Date(scheduledAt)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }, [scheduleMode, scheduledAt])

  const problems = useMemo(() => {
    const found: string[] = []
    if (!from) found.push('Pick a verified sending domain and a local part for the From address.')
    if (!subject.trim()) found.push('A subject is required.')
    if (!audienceId) found.push('Choose the audience this goes to.')
    if (abEnabled) {
      if (variants.length < 2) found.push('An A/B test needs at least two variants.')
      if (weightTotal !== 100) found.push(`Variant weights add up to ${weightTotal}, not 100.`)
      if (variants.some((variant) => !variant.subject.trim()))
        found.push('Every variant needs its own subject line.')
      if (variants.some((variant) => !variant.key.trim())) found.push('Every variant needs a key.')
    }
    if (scheduleMode === 'later') {
      if (!scheduledIso) {
        found.push('Pick a date and time to send, or switch back to sending now.')
      } else {
        const when = new Date(scheduledIso).getTime()
        if (when <= Date.now()) found.push('The scheduled time has already passed.')
        if (when > Date.now() + MAX_SCHEDULE_DAYS * 86_400_000)
          found.push(`A broadcast can be scheduled at most ${MAX_SCHEDULE_DAYS} days ahead.`)
      }
    }
    return found
  }, [from, subject, audienceId, abEnabled, variants, weightTotal, scheduleMode, scheduledIso])

  const buildBody = (): Record<string, unknown> => {
    const replyList = replyTo
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    const body: Record<string, unknown> = {
      audience_id: audienceId,
      from,
      subject: subject.trim(),
      throttle_per_minute: Number(throttle) || undefined,
    }
    if (name.trim()) body.name = name.trim()
    if (segmentId !== NO_SEGMENT) body.segment_id = segmentId
    if (replyList.length > 0) body.reply_to = replyList
    if (previewText.trim()) body.preview_text = previewText.trim()
    if (bodyMode === 'html' && html) body.html = html
    if (bodyMode === 'text' && text) body.text = text
    if (bodyMode === 'template' && templateId) body.template_id = templateId
    if (abEnabled) {
      body.variants = variants.map<BroadcastVariant>((variant) => ({
        key: variant.key.trim(),
        subject: variant.subject.trim(),
        weight: variant.weight,
      }))
      body.holdout_percent = Number(holdout) || 0
      body.winner_metric = winnerMetric
    }
    return body
  }

  const save = useMutation({
    mutationFn: () =>
      broadcast ? api.updateBroadcast(broadcast.id, buildBody()) : api.createBroadcast(buildBody()),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: qk.broadcasts(environment) })
      void queryClient.invalidateQueries({ queryKey: qk.broadcast(environment, saved.id) })
      toast.success(broadcast ? 'Draft saved.' : 'Draft created.')
      if (!broadcast) {
        void navigate({ to: '/app/broadcasts/$broadcastId', params: { broadcastId: saved.id } })
      }
    },
    onError: (error: Error) => toast.error(error.message),
  })

  // Never optimistic: the rollback for "we already handed 28,700 messages to the
  // coordinator" does not exist.
  const send = useMutation({
    mutationFn: () => {
      if (!broadcast) throw new Error('Save the draft before sending it.')
      return api.sendBroadcast(broadcast.id, scheduledIso ? { scheduled_at: scheduledIso } : {})
    },
    onSuccess: (sent) => {
      void queryClient.invalidateQueries({ queryKey: qk.broadcast(environment, sent.id) })
      void queryClient.invalidateQueries({ queryKey: qk.broadcasts(environment) })
      setConfirmSend(false)
      toast.success(scheduledIso ? 'Broadcast scheduled.' : 'Broadcast handed to the coordinator.')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const previewDoc =
    bodyMode === 'text'
      ? `<pre style="font:13px ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`
      : bodyMode === 'html'
        ? html
        : ''

  const field = (suffix: string) => `${ids}-${suffix}`

  return (
    <form
      className="flex flex-col gap-7"
      onSubmit={(event) => {
        event.preventDefault()
        if (problems.length > 0 || !editable) return
        save.mutate()
      }}
    >
      {!editable ? (
        <Callout variant="info" title="read only">
          This broadcast is <span className="font-mono">{broadcast?.status}</span>, and the API only
          accepts edits while a broadcast is a draft — anything else comes back as{' '}
          <span className="font-mono">broadcast_not_editable</span>. Duplicate it into a new draft
          to change the copy, the audience or the schedule.
        </Callout>
      ) : null}

      <PageSection title="The message" description="Who it comes from and what lands in the list.">
        <div className="grid gap-4 rounded-tile border border-line-soft bg-card p-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={field('name')}>Internal name</Label>
            <Input
              id={field('name')}
              value={name}
              disabled={!editable}
              placeholder="March product update"
              onChange={(event) => setName(event.target.value)}
            />
            <p className="m-0 text-[12.5px] text-muted-2">
              Only ever shown in this dashboard. Recipients see the subject.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={field('local')}>From</Label>
            <div className="flex items-center gap-2">
              <Input
                id={field('local')}
                value={localPart}
                disabled={!editable}
                placeholder="hello"
                aria-describedby={field('from-help')}
                onChange={(event) => setLocalPart(event.target.value)}
              />
              <span aria-hidden="true" className="font-mono text-[15px] text-muted-2">
                @
              </span>
              <Select value={fromDomain} disabled={!editable} onValueChange={setFromDomain}>
                <SelectTrigger aria-label="Sending domain" className="min-w-[180px]">
                  <SelectValue placeholder="domain" />
                </SelectTrigger>
                <SelectContent>
                  {verifiedDomains.map((domain) => (
                    <SelectItem key={domain.id} value={domain.name}>
                      {domain.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p id={field('from-help')} className="m-0 text-[12.5px] text-muted-2">
              {domains.error
                ? 'Could not load domains. The list will fill in once the API answers.'
                : verifiedDomains.length === 0
                  ? 'Only verified domains can send. Verify one in Domains first.'
                  : 'Only verified domains appear here.'}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={field('reply')}>Reply-to</Label>
            <Input
              id={field('reply')}
              value={replyTo}
              disabled={!editable}
              placeholder="replies@example.com"
              onChange={(event) => setReplyTo(event.target.value)}
            />
            <p className="m-0 text-[12.5px] text-muted-2">Comma-separated for more than one.</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={field('subject')}>Subject</Label>
            <Input
              id={field('subject')}
              value={subject}
              required
              disabled={!editable}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor={field('preview')}>Preview text</Label>
            <Input
              id={field('preview')}
              value={previewText}
              disabled={!editable}
              maxLength={200}
              onChange={(event) => setPreviewText(event.target.value)}
            />
            <p className="m-0 text-[12.5px] text-muted-2">
              The line most clients show after the subject. Up to 200 characters.
            </p>
          </div>
        </div>
      </PageSection>

      <PageSection title="Who gets it" description="An audience, optionally narrowed by a segment.">
        <div className="grid gap-4 rounded-tile border border-line-soft bg-card p-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={field('audience')}>Audience</Label>
            <Select
              value={audienceId}
              disabled={!editable}
              onValueChange={(value) => {
                setAudienceId(value)
                setSegmentId(NO_SEGMENT)
              }}
            >
              <SelectTrigger id={field('audience')}>
                <SelectValue placeholder="Choose an audience" />
              </SelectTrigger>
              <SelectContent>
                {audienceList.map((audience) => (
                  <SelectItem key={audience.id} value={audience.id}>
                    {audience.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {audiences.error ? (
              <p className="m-0 text-[12.5px] text-warning">
                Audiences did not load. Try again once the API responds.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={field('segment')}>Segment</Label>
            <Select
              value={segmentId}
              disabled={!editable || !audienceId}
              onValueChange={setSegmentId}
            >
              <SelectTrigger id={field('segment')}>
                <SelectValue placeholder="Everyone in the audience" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SEGMENT}>Everyone in the audience</SelectItem>
                {segmentList.map((segment) => (
                  <SelectItem key={segment.id} value={segment.id}>
                    {segment.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {chosenSegment ? (
              <p className="m-0 font-mono text-[12.5px] text-muted">
                {chosenSegment.member_count === undefined
                  ? 'member count not reported yet'
                  : `${num(chosenSegment.member_count)} members`}
              </p>
            ) : (
              <p className="m-0 text-[12.5px] text-muted-2">
                Segments are listed for the chosen audience only.
              </p>
            )}
          </div>

          <p className="m-0 text-[13.5px] text-muted md:col-span-2">
            {recipientCount === undefined
              ? 'The recipient count appears once the audience or segment reports one.'
              : `${num(recipientCount)} recipients as counted right now. The coordinator recounts at send time, so suppressions and unsubscribes between now and then are removed.`}
          </p>
        </div>
      </PageSection>

      <PageSection title="Body" description="One source of truth for the message content.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-tile border border-line-soft bg-card">
            <Tabs value={bodyMode} onValueChange={(value) => setBodyMode(value as BodyMode)}>
              <TabsList>
                <TabsTrigger value="html">HTML</TabsTrigger>
                <TabsTrigger value="text">Plain text</TabsTrigger>
                <TabsTrigger value="template">Use a template</TabsTrigger>
              </TabsList>
              <div className="p-4">
                <TabsContent value="html">
                  <Label htmlFor={field('html')}>HTML body</Label>
                  <Textarea
                    id={field('html')}
                    value={html}
                    rows={14}
                    disabled={!editable}
                    className="mt-2 font-mono text-[12.5px]"
                    onChange={(event) => setHtml(event.target.value)}
                  />
                </TabsContent>
                <TabsContent value="text">
                  <Label htmlFor={field('text')}>Plain text body</Label>
                  <Textarea
                    id={field('text')}
                    value={text}
                    rows={14}
                    disabled={!editable}
                    className="mt-2 font-mono text-[12.5px]"
                    onChange={(event) => setText(event.target.value)}
                  />
                </TabsContent>
                <TabsContent value="template">
                  <Label htmlFor={field('template')}>Template</Label>
                  <Select value={templateId} disabled={!editable} onValueChange={setTemplateId}>
                    <SelectTrigger id={field('template')} className="mt-2">
                      <SelectValue placeholder="Choose a template" />
                    </SelectTrigger>
                    <SelectContent>
                      {(templates.data?.data ?? []).map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="m-0 mt-2 text-[12.5px] text-muted-2">
                    The template is rendered at send time, so a later template edit changes what has
                    not gone out yet.
                  </p>
                </TabsContent>
              </div>
            </Tabs>
          </div>

          <figure className="m-0 flex flex-col rounded-tile border border-line-soft bg-card p-4">
            <figcaption className="ms-eyebrow text-[10.5px] text-muted-2">preview</figcaption>
            {bodyMode === 'template' ? (
              <p className="m-0 mt-4 text-[13.5px] text-muted">
                A template preview needs the template's own variables, which live on the template
                screen. This composer only records which template to render.
              </p>
            ) : (
              <iframe
                title="Preview"
                sandbox=""
                srcDoc={previewDoc}
                className="mt-3 h-[340px] w-full rounded-md border border-line-soft bg-paper"
              />
            )}
          </figure>
        </div>
        {broadcast ? (
          <p className="m-0 text-[12.5px] text-muted-2">
            The broadcast record the API returns does not carry the stored body, so these boxes
            start empty on an existing draft. Saving replaces whatever body is stored.
          </p>
        ) : null}
      </PageSection>

      <PageSection title="Send rate">
        <div className="flex flex-col gap-3 rounded-tile border border-line-soft bg-card p-4">
          <Label htmlFor={field('throttle')}>Messages per minute</Label>
          <Input
            id={field('throttle')}
            type="number"
            min={1}
            max={1_000_000}
            value={throttle}
            disabled={!editable}
            className="max-w-[200px] font-mono"
            aria-describedby={field('throttle-help')}
            onChange={(event) => setThrottle(event.target.value)}
          />
          <p id={field('throttle-help')} className="m-0 max-w-[70ch] text-[13.5px] text-muted">
            The coordinator mints send tokens at this rate and nothing leaves without one, so this
            is a ceiling rather than a target. A slower rate is how you protect a warming domain:
            receivers judge a new domain on its first few thousand messages, and a sudden burst is
            what gets a whole domain throttled.
          </p>
        </div>
      </PageSection>

      <PageSection title="A/B test" description="Optional. Two to four subject lines.">
        <div className="flex flex-col gap-4 rounded-tile border border-line-soft bg-card p-4">
          <div className="flex items-center gap-2.5">
            <Checkbox
              id={field('ab')}
              checked={abEnabled}
              disabled={!editable}
              onCheckedChange={(checked) => {
                const next = checked === true
                setAbEnabled(next)
                if (next && variants.length < 2) setVariants(emptyVariants(subject))
              }}
            />
            <Label htmlFor={field('ab')}>Split this send across subject-line variants</Label>
          </div>

          {abEnabled ? (
            <>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {variants.map((variant, index) => (
                  <li
                    key={variant.id}
                    className="grid gap-2 rounded-md border border-line-soft p-3 md:grid-cols-[80px_1fr_120px_auto]"
                  >
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={field(`key-${index}`)}>Key</Label>
                      <Input
                        id={field(`key-${index}`)}
                        value={variant.key}
                        maxLength={8}
                        disabled={!editable}
                        className="font-mono"
                        onChange={(event) =>
                          setVariants((current) =>
                            current.map((item, position) =>
                              position === index ? { ...item, key: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={field(`vsubject-${index}`)}>Subject</Label>
                      <Input
                        id={field(`vsubject-${index}`)}
                        value={variant.subject}
                        disabled={!editable}
                        onChange={(event) =>
                          setVariants((current) =>
                            current.map((item, position) =>
                              position === index ? { ...item, subject: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={field(`weight-${index}`)}>Weight %</Label>
                      <Input
                        id={field(`weight-${index}`)}
                        type="number"
                        min={1}
                        max={100}
                        value={variant.weight}
                        disabled={!editable}
                        className="font-mono"
                        onChange={(event) =>
                          setVariants((current) =>
                            current.map((item, position) =>
                              position === index
                                ? { ...item, weight: Number(event.target.value) }
                                : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!editable || variants.length <= 2}
                        onClick={() =>
                          setVariants((current) =>
                            current.filter((_, position) => position !== index),
                          )
                        }
                      >
                        <Trash2 aria-hidden="true" />
                        <span className="sr-only">Remove variant {variant.key || index + 1}</span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!editable || variants.length >= 4}
                  onClick={() =>
                    setVariants((current) => [
                      ...current,
                      {
                        id: nextVariantId(),
                        key: String.fromCharCode(97 + current.length),
                        subject: '',
                        weight: 0,
                      },
                    ])
                  }
                >
                  <Plus aria-hidden="true" />
                  Add variant
                </Button>
                <span
                  className={`font-mono text-[12.5px] ${
                    weightTotal === 100 ? 'text-positive' : 'text-warning'
                  }`}
                >
                  weights total {weightTotal} / 100
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={field('holdout')}>Holdout %</Label>
                  <Input
                    id={field('holdout')}
                    type="number"
                    min={0}
                    max={90}
                    value={holdout}
                    disabled={!editable}
                    className="max-w-[140px] font-mono"
                    onChange={(event) => setHoldout(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={field('metric')}>Winner decided on</Label>
                  <Select
                    value={winnerMetric}
                    disabled={!editable}
                    onValueChange={(value) => setWinnerMetric(value as 'opens' | 'clicks')}
                  >
                    <SelectTrigger id={field('metric')} className="max-w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="opens">Opens</SelectItem>
                      <SelectItem value="clicks">Clicks</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <p className="m-0 max-w-[70ch] text-[13.5px] text-muted">
                The holdout is the part of the list kept back from the test and then sent the
                winning variant, so a test with a holdout of zero has no second act — the variants
                are simply the whole send and the result is a report, not a decision you can act on.
              </p>
            </>
          ) : null}
        </div>
      </PageSection>

      <PageSection title="Schedule">
        <fieldset className="flex flex-col gap-3 rounded-tile border border-line-soft bg-card p-4">
          <legend className="ms-eyebrow px-1 text-[10.5px] text-muted-2">when it goes</legend>
          <RadioGroup
            value={scheduleMode}
            disabled={!editable}
            className="flex flex-col gap-2.5"
            onValueChange={(value) => setScheduleMode(value as 'now' | 'later')}
          >
            <div className="flex items-center gap-2.5">
              <RadioGroupItem value="now" id={field('now')} />
              <Label htmlFor={field('now')}>Send as soon as I confirm</Label>
            </div>
            <div className="flex items-center gap-2.5">
              <RadioGroupItem value="later" id={field('later')} />
              <Label htmlFor={field('later')}>Schedule it</Label>
            </div>
          </RadioGroup>
          {scheduleMode === 'later' ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={field('when')}>Send at</Label>
              <Input
                id={field('when')}
                type="datetime-local"
                value={scheduledAt}
                disabled={!editable}
                className="max-w-[260px] font-mono"
                aria-describedby={field('when-help')}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
              <p id={field('when-help')} className="m-0 text-[13px] text-muted">
                In your own timezone. The API takes a time that is in the future and at most{' '}
                {MAX_SCHEDULE_DAYS} days ahead; anything else is rejected.
              </p>
            </div>
          ) : null}
        </fieldset>
      </PageSection>

      {editable && problems.length > 0 ? (
        <Callout variant="warn" title="not ready yet">
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {editable ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="submit" disabled={problems.length > 0 || save.isPending}>
            {save.isPending ? 'Saving…' : broadcast ? 'Save draft' : 'Create draft'}
          </Button>
          {broadcast ? (
            <Button
              type="button"
              variant="accent"
              disabled={problems.length > 0 || send.isPending}
              onClick={() => setConfirmSend(true)}
            >
              <Send aria-hidden="true" />
              {scheduleMode === 'later' ? 'Schedule…' : 'Send…'}
            </Button>
          ) : (
            <span className="text-[13px] text-muted-2">
              Save the draft first; sending is its own confirmed step.
            </span>
          )}
        </div>
      ) : null}

      {broadcast ? (
        <ConfirmDialog
          open={confirmSend}
          onOpenChange={setConfirmSend}
          title={scheduleMode === 'later' ? 'Schedule this broadcast' : 'Send this broadcast'}
          description="Mail that has left cannot be recalled. Read the numbers once more."
          confirmPhrase={broadcast.name ?? broadcast.id}
          confirmLabel={scheduleMode === 'later' ? 'Schedule it' : 'Send it'}
          pending={send.isPending}
          consequences={
            <>
              <p className="m-0">
                {recipientCount === undefined
                  ? 'The recipient count is not available from the API right now, so this will go to whatever the audience holds at send time.'
                  : `${num(recipientCount)} recipients, from ${
                      chosenSegment
                        ? `segment ${chosenSegment.name}`
                        : (chosenAudience?.name ?? 'the audience')
                    }.`}
              </p>
              <p className="m-0 mt-1.5">
                From {from || '—'} at up to {num(Number(throttle) || 0)} messages per minute
                {scheduledIso ? `, starting ${new Date(scheduledIso).toLocaleString()}` : ''}.
              </p>
              {abEnabled ? (
                <p className="m-0 mt-1.5">
                  {variants.length} variants over the test cohort, {Number(holdout) || 0}% held back
                  for the winner.
                </p>
              ) : null}
            </>
          }
          onConfirm={() => send.mutate()}
        />
      ) : null}
    </form>
  )
}
