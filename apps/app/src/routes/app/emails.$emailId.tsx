import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  KeyValue,
  KeyValueList,
  Label,
  MonoChip,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Ban, CalendarClock, ShieldMinus } from 'lucide-react'
import { useId, useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import { CopyValue } from '~/components/app/copy-value.tsx'
import { bareAddress, dateTime } from '~/components/app/format.ts'
import { LogDrawer } from '~/components/app/log-drawer.tsx'
import { PageHeader, PageSection } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { DetailSkeleton, ErrorState } from '~/components/app/states.tsx'
import { qk } from '~/lib/query.ts'
import { toBadgeStatus } from '~/routes/app/index.tsx'
import { appHead } from '~/seo'

/**
 * One message, standalone: the same history the log drawer shows, plus the
 * fields and the two actions that are still available while a message has not
 * yet left — cancel and reschedule.
 */

export const Route = createFileRoute('/app/emails/$emailId')({
  head: () => appHead('Message'),
  component: EmailDetail,
})

const CANCELLABLE = new Set(['queued', 'scheduled'])

const addresses = (value: string[] | null | undefined): string =>
  value && value.length > 0 ? value.join(', ') : '—'

/** `datetime-local` wants a local wall clock with no zone, not an ISO instant. */
const toLocalInput = (iso: string | null | undefined): string => {
  const date = iso ? new Date(iso) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function EmailDetail() {
  const { emailId } = Route.useParams()
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const scheduleInputId = useId()

  const [cancelOpen, setCancelOpen] = useState(false)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [suppressOpen, setSuppressOpen] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')

  const email = useQuery({
    queryKey: qk.email(environment, emailId),
    queryFn: () => api.getEmail(emailId),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.email(environment, emailId) })
    void queryClient.invalidateQueries({ queryKey: qk.emailDetail(environment, emailId) })
  }

  const cancel = useMutation({
    mutationFn: () => api.cancelEmail(emailId),
    onSuccess: () => {
      toast.success('Message cancelled. It will not be sent.')
      setCancelOpen(false)
      invalidate()
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not cancel this message.')
    },
  })

  const reschedule = useMutation({
    mutationFn: (value: string) => api.rescheduleEmail(emailId, new Date(value).toISOString()),
    onSuccess: (updated) => {
      toast.success(
        updated.scheduled_at
          ? `Rescheduled for ${dateTime(updated.scheduled_at)}`
          : 'Schedule updated.',
      )
      setRescheduleOpen(false)
      invalidate()
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not reschedule this message.')
    },
  })

  const suppress = useMutation({
    mutationFn: (recipient: string) =>
      api.createSuppression({ email: recipient, reason: 'manual' }),
    onSuccess: (created) => {
      toast.success(`${created.email} suppressed. Future sends to it will be dropped.`)
      setSuppressOpen(false)
      void queryClient.invalidateQueries({ queryKey: qk.suppressions(environment) })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not suppress that recipient.')
    },
  })

  if (email.isLoading) return <DetailSkeleton />
  if (email.error) {
    return (
      <ErrorState error={email.error} subject="this message" onRetry={() => void email.refetch()} />
    )
  }
  if (!email.data) return null

  const message = email.data
  const recipient = bareAddress(message.to[0] ?? '')
  const cancellable = CANCELLABLE.has(message.last_event)

  return (
    <>
      <PageHeader
        eyebrow="Message"
        title={message.subject || '(no subject)'}
        description={
          <span className="flex flex-wrap items-center gap-2.5">
            <StatusBadge status={toBadgeStatus(message.last_event)} size="sm" />
            <MonoChip size="sm">{message.id}</MonoChip>
            <CopyValue value={message.id} label="message id" truncate={false} />
          </span>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setScheduledAt(toLocalInput(message.scheduled_at))
                setRescheduleOpen(true)
              }}
            >
              <CalendarClock aria-hidden="true" />
              Reschedule
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!recipient}
              onClick={() => setSuppressOpen(true)}
            >
              <ShieldMinus aria-hidden="true" />
              Suppress this recipient
            </Button>
            {cancellable ? (
              <Button variant="primary" size="sm" onClick={() => setCancelOpen(true)}>
                <Ban aria-hidden="true" />
                Cancel send
              </Button>
            ) : null}
          </>
        }
      />

      <PageSection title="Envelope">
        <div className="rounded-tile border border-line-soft bg-card px-4 py-2">
          <KeyValueList>
            <KeyValue label="From" value={message.from} mono />
            <KeyValue label="To" value={addresses(message.to)} mono />
            <KeyValue label="Cc" value={addresses(message.cc)} mono />
            <KeyValue label="Bcc" value={addresses(message.bcc)} mono />
            <KeyValue label="Reply-to" value={addresses(message.reply_to)} mono />
            <KeyValue label="Created" value={dateTime(message.created_at)} />
            <KeyValue
              label="Scheduled"
              value={message.scheduled_at ? dateTime(message.scheduled_at) : 'not scheduled'}
            />
            <KeyValue label="Provider" value={message.provider ?? 'unassigned'} mono />
            <KeyValue
              label="Provider message id"
              value={message.provider_message_id ?? 'not assigned yet'}
              mono
            />
            <KeyValue
              label="Tags"
              value={
                message.tags && message.tags.length > 0 ? (
                  <span className="flex flex-wrap gap-1.5">
                    {message.tags.map((tag) => (
                      <MonoChip key={`${tag.name}:${tag.value}`} size="sm">
                        {tag.name}={tag.value || '—'}
                      </MonoChip>
                    ))}
                  </span>
                ) : (
                  'none'
                )
              }
            />
          </KeyValueList>
        </div>
      </PageSection>

      <PageSection
        title="Body"
        description="The HTML is rendered in a sandboxed frame: no scripts, no forms, no network of its own."
      >
        <Tabs defaultValue={message.html ? 'html' : 'text'}>
          <TabsList>
            <TabsTrigger value="html">HTML</TabsTrigger>
            <TabsTrigger value="text">Plain text</TabsTrigger>
          </TabsList>
          <TabsContent value="html">
            {message.html ? (
              <iframe
                srcDoc={message.html}
                sandbox=""
                title="Message body"
                className="h-[520px] w-full rounded-tile border border-line-soft bg-paper"
              />
            ) : (
              <p className="m-0 rounded-tile border border-line-soft bg-card px-4 py-6 text-[14px] text-muted">
                This message was sent without an HTML part.
              </p>
            )}
          </TabsContent>
          <TabsContent value="text">
            {message.text ? (
              <pre className="m-0 max-h-[520px] overflow-auto rounded-tile border border-line-soft bg-card p-4 font-mono text-[12.5px] leading-[1.8] whitespace-pre-wrap">
                {message.text}
              </pre>
            ) : (
              <p className="m-0 rounded-tile border border-line-soft bg-card px-4 py-6 text-[14px] text-muted">
                This message was sent without a plain-text part. Some receivers weigh that against
                the sender.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </PageSection>

      <PageSection title="History">
        <LogDrawer emailId={emailId} />
      </PageSection>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this message"
        description="It is still in the queue, so it can be stopped before it leaves."
        confirmPhrase="cancel"
        confirmLabel="Cancel the send"
        consequences="The message is never delivered and cannot be resumed. Sending it later means creating it again."
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />

      <ConfirmDialog
        open={suppressOpen}
        onOpenChange={setSuppressOpen}
        title={`Suppress ${recipient}`}
        description="Every future send to this address from this workspace is dropped before it reaches a provider."
        confirmPhrase={recipient}
        confirmLabel="Suppress this recipient"
        consequences="Transactional mail to this address stops too, including password resets and receipts, until the suppression is removed."
        pending={suppress.isPending}
        onConfirm={() => suppress.mutate(recipient)}
      />

      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule this message</DialogTitle>
            <DialogDescription>
              A single message leaves at one moment, so this is a time rather than a range. The
              value is your local clock and is sent to the API as UTC.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={scheduleInputId}>Send at</Label>
            <Input
              id={scheduleInputId}
              type="datetime-local"
              value={scheduledAt}
              className="font-mono text-[13.5px]"
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRescheduleOpen(false)}>
              Keep the current time
            </Button>
            <Button
              disabled={!scheduledAt || reschedule.isPending}
              onClick={() => reschedule.mutate(scheduledAt)}
            >
              {reschedule.isPending ? 'Saving…' : 'Reschedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
