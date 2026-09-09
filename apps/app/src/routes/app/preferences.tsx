import { Button, Callout, Input, Label, Switch, Textarea, toast } from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import { num } from '~/components/app/format.ts'
import { PageHeader, PageSection } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { DetailSkeleton, ErrorState } from '~/components/app/states.tsx'
import type { PreferenceCentreRecord, PreferenceTopicRecord } from '~/lib/api-client.ts'
import { qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

/**
 * The editor for the page a recipient lands on from the unsubscribe link.
 *
 * Everything here is a draft until Save: a half-typed topic name is not
 * something to publish to every recipient mid-keystroke, which is why nothing
 * on this screen is optimistic and the preview reads from local state.
 */

export const Route = createFileRoute('/app/preferences')({
  head: () => appHead('Preferences'),
  component: Preferences,
})

function Preferences() {
  const api = useApi()
  const environment = useEnvironment()

  const centre = useQuery({
    queryKey: qk.preferenceCentre(environment),
    queryFn: () => api.getPreferenceCentre(),
  })

  return (
    <>
      <PageHeader
        eyebrow="Preference centre"
        title="What recipients see when they want out"
        description="One page, reached from the unsubscribe link in every message. Topics let someone leave one stream without leaving all of them."
      />

      {centre.isLoading ? (
        <DetailSkeleton />
      ) : centre.error ? (
        <ErrorState
          error={centre.error}
          subject="the preference centre"
          onRetry={() => void centre.refetch()}
        />
      ) : centre.data ? (
        <Editor centre={centre.data} />
      ) : null}
    </>
  )
}

type DraftTopic = PreferenceTopicRecord

let nextLocalId = 0

/** Unsaved topics need a React key and a form id before the server has given them one. */
const localTopicId = (): string => {
  nextLocalId += 1
  return `new-${nextLocalId}`
}

function Editor({ centre }: { centre: PreferenceCentreRecord }) {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()

  const [headline, setHeadline] = useState(centre.headline)
  const [body, setBody] = useState(centre.body)
  const [showAll, setShowAll] = useState(centre.show_unsubscribe_all)
  const [topics, setTopics] = useState<DraftTopic[]>(centre.topics)
  const [removing, setRemoving] = useState<DraftTopic | null>(null)

  const headlineId = useId()
  const bodyId = useId()

  const save = useMutation({
    mutationFn: () =>
      api.updatePreferenceCentre({
        headline,
        body,
        show_unsubscribe_all: showAll,
        topics: topics.map((topic) => ({
          id: topic.id.startsWith('new-') ? undefined : topic.id,
          name: topic.name,
          description: topic.description,
          default_opted_in: topic.default_opted_in,
        })),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.preferenceCentre(environment), updated)
      setTopics(updated.topics)
      toast.success('Preference centre saved.')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const patchTopic = (id: string, patch: Partial<DraftTopic>) =>
    setTopics((current) =>
      current.map((topic) => (topic.id === id ? { ...topic, ...patch } : topic)),
    )

  const dropTopic = (id: string) =>
    setTopics((current) => current.filter((topic) => topic.id !== id))

  const requestRemove = (topic: DraftTopic) => {
    if ((topic.subscriber_count ?? 0) > 0) {
      setRemoving(topic)
      return
    }
    dropTopic(topic.id)
  }

  return (
    <>
      <PageSection
        title="Topics"
        description="Each topic is a separate subscription. A broadcast names one, and anyone opted out of it is skipped."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setTopics((current) => [
                ...current,
                {
                  id: localTopicId(),
                  name: '',
                  description: '',
                  default_opted_in: true,
                  subscriber_count: 0,
                },
              ])
            }
          >
            <Plus aria-hidden="true" />
            Add topic
          </Button>
        }
      >
        {topics.length === 0 ? (
          <p className="m-0 rounded-tile border border-line-soft bg-card px-4 py-3.5 text-[13.5px] text-muted">
            No topics yet. Without one, the page offers only the global unsubscribe — which is
            valid, and also all-or-nothing for the recipient.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {topics.map((topic) => (
              <li
                key={topic.id}
                className="flex flex-col gap-3 rounded-tile border border-line-soft bg-card p-4"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex min-w-[220px] flex-1 flex-col gap-2">
                    <Label htmlFor={`topic-name-${topic.id}`}>Name</Label>
                    <Input
                      id={`topic-name-${topic.id}`}
                      value={topic.name}
                      placeholder="Product updates"
                      onChange={(event) => patchTopic(topic.id, { name: event.target.value })}
                    />
                  </div>
                  <div className="flex min-w-[260px] flex-[2] flex-col gap-2">
                    <Label htmlFor={`topic-desc-${topic.id}`}>Description</Label>
                    <Input
                      id={`topic-desc-${topic.id}`}
                      value={topic.description ?? ''}
                      placeholder="Release notes, roughly monthly."
                      onChange={(event) =>
                        patchTopic(topic.id, { description: event.target.value || null })
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <div className="flex items-center gap-2.5">
                    <Switch
                      id={`topic-default-${topic.id}`}
                      checked={topic.default_opted_in}
                      onCheckedChange={(checked) =>
                        patchTopic(topic.id, { default_opted_in: checked })
                      }
                      aria-label={`New contacts start opted in to ${topic.name || 'this topic'}`}
                    />
                    <Label htmlFor={`topic-default-${topic.id}`} className="text-[13.5px]">
                      New contacts start opted in
                    </Label>
                  </div>

                  <span className="font-mono text-[12px] text-muted-2">
                    {num(topic.subscriber_count ?? 0)} subscribed
                  </span>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => requestRemove(topic)}
                  >
                    <Trash2 aria-hidden="true" />
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection title="Page copy" description="What the recipient reads above the checkboxes.">
        <div className="flex flex-col gap-4 rounded-tile border border-line-soft bg-card p-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor={headlineId}>Headline</Label>
            <Input
              id={headlineId}
              value={headline}
              placeholder="Choose what you hear from us"
              onChange={(event) => setHeadline(event.target.value)}
              className="max-w-[520px]"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={bodyId}>Body</Label>
            <Textarea
              id={bodyId}
              rows={3}
              value={body}
              placeholder="Changes take effect immediately. You can come back to this page from any of our emails."
              onChange={(event) => setBody(event.target.value)}
              className="max-w-[640px]"
            />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-code border border-line bg-tint p-4">
            <div className="min-w-0">
              <Label htmlFor="show-unsubscribe-all">Show “unsubscribe from everything”</Label>
              <p className="m-0 mt-1 max-w-[62ch] text-[13px] leading-[1.6] text-muted">
                The single link that stops all marketing mail, regardless of topic.
              </p>
            </div>
            <Switch
              id="show-unsubscribe-all"
              checked={showAll}
              onCheckedChange={setShowAll}
              aria-label="Show unsubscribe from everything"
            />
          </div>

          {showAll ? null : (
            <Callout variant="warn" title="compliance, not conversion">
              A preference centre with no global unsubscribe is a compliance problem. CAN-SPAM and
              GDPR both expect one clear way out, and mailbox providers read “I could not find the
              unsubscribe” as the spam button. We will not stop you shipping this, but the complaint
              rate is the price, and complaints follow the sending domain rather than the campaign.
            </Callout>
          )}

          <div>
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save preference centre'}
            </Button>
          </div>
        </div>
      </PageSection>

      <PageSection
        title="Preview"
        description="Exactly what the recipient sees, drawn from the form above — unsaved changes included."
      >
        <Preview headline={headline} body={body} showAll={showAll} topics={topics} />
      </PageSection>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title="Remove this topic?"
        description={`${removing?.name || 'This topic'} disappears from the preference centre when you save.`}
        confirmPhrase={removing?.name || undefined}
        confirmLabel="Remove topic"
        consequences={
          <>
            {num(removing?.subscriber_count ?? 0)} contacts have an explicit choice recorded on this
            topic, and that choice is discarded with it. If you create a topic by the same name
            later, everyone starts from the default again — including the people who had opted out.
          </>
        }
        onConfirm={() => {
          if (removing) dropTopic(removing.id)
          setRemoving(null)
        }}
      />
    </>
  )
}

function Preview({
  headline,
  body,
  showAll,
  topics,
}: {
  headline: string
  body: string
  showAll: boolean
  topics: DraftTopic[]
}) {
  return (
    <div className="rounded-tile border border-line bg-tint p-5">
      <p className="m-0 mb-3 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-2">
        recipient view
      </p>
      <div className="mx-auto max-w-[560px] rounded-card border border-line-soft bg-paper p-6">
        <h3 className="m-0 font-display text-[22px] font-medium -tracking-[0.02em]">
          {headline || 'Choose what you hear from us'}
        </h3>
        <p className="m-0 mt-2 text-[14px] leading-[1.65] text-muted">
          {body || 'Changes take effect immediately.'}
        </p>

        <ul className="m-0 mt-5 flex list-none flex-col gap-3 p-0">
          {topics.length === 0 ? (
            <li className="text-[13.5px] text-muted-2">No topics to choose from.</li>
          ) : (
            topics.map((topic) => (
              <li key={topic.id} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={
                    topic.default_opted_in
                      ? 'mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm bg-ink text-[10px] text-paper'
                      : 'mt-0.5 size-4 shrink-0 rounded-sm border border-muted-3'
                  }
                >
                  {topic.default_opted_in ? '✓' : ''}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-ink">
                    {topic.name || 'Untitled topic'}
                  </span>
                  {topic.description ? (
                    <span className="block text-[13px] leading-[1.55] text-muted">
                      {topic.description}
                    </span>
                  ) : null}
                </span>
              </li>
            ))
          )}
        </ul>

        <div className="mt-6 border-t border-line-soft pt-4 text-[13px] text-muted">
          {showAll ? (
            <span className="underline">Unsubscribe from everything</span>
          ) : (
            <span className="text-muted-2">
              No global unsubscribe link on this page. Recipients can only change topics.
            </span>
          )}
        </div>
      </div>
      <p className="m-0 mt-3 text-[12.5px] text-muted-2">
        Checkbox states shown are the defaults for a new contact. A returning recipient sees their
        own recorded choices.
      </p>
    </div>
  )
}
