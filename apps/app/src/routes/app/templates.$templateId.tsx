import {
  Button,
  Input,
  Label,
  MonoChip,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { History, Save } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { CopyValue } from '~/components/app/copy-value.tsx'
import { shortDate } from '~/components/app/format.ts'
import { PageHeader, PageSection } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { DetailSkeleton, ErrorState } from '~/components/app/states.tsx'
import { TemplateVersions } from '~/components/app/template-versions.tsx'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/templates/$templateId')({
  head: () => appHead('Template'),
  component: TemplateEditor,
})

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * A stand-in for the real engine, which compiles server-side. It substitutes
 * `{{name}}` and nothing else, so a Handlebars helper or an MJML tag renders as
 * itself — a preview that guessed at logic would be confidently wrong.
 */
const interpolate = (body: string, sample: Record<string, string>): string =>
  body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => sample[key] ?? match)

function TemplateEditor() {
  const { templateId } = Route.useParams()
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const subjectId = useId()
  const bodyId = useId()

  const [subject, setSubject] = useState('')
  const [html, setHtml] = useState('')
  const [text, setText] = useState('')
  const [sample, setSample] = useState<Record<string, string>>({})
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null)

  const template = useQuery({
    queryKey: qk.template(environment, templateId),
    queryFn: () => api.getTemplate(templateId),
  })

  const version = template.data?.version
  // The Template record carries metadata only; the body lives on the version.
  const body = useQuery({
    queryKey: [...qk.templateVersions(environment, templateId), version ?? 0] as const,
    queryFn: () => api.getTemplateVersion(templateId, version ?? 0),
    enabled: version !== undefined,
  })

  const loaded = body.data
  useEffect(() => {
    if (!loaded || loadedVersion === loaded.version) return
    setSubject(loaded.subject ?? '')
    setHtml(loaded.html ?? '')
    setText(loaded.text ?? '')
    setLoadedVersion(loaded.version)
  }, [loaded, loadedVersion])

  const variables = template.data?.variables ?? []

  const save = useMutation({
    mutationFn: () => api.updateTemplate(templateId, { subject, html, text }),
    onSuccess: async (updated) => {
      setLoadedVersion(null)
      await queryClient.invalidateQueries({ queryKey: qk.template(environment, templateId) })
      await queryClient.invalidateQueries({
        queryKey: qk.templateVersions(environment, templateId),
      })
      await queryClient.invalidateQueries({ queryKey: qk.templates(environment) })
      toast.success(`Saved as version ${updated.version}.`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const previewHtml = useMemo(() => interpolate(html, sample), [html, sample])
  const previewText = useMemo(() => interpolate(text, sample), [text, sample])

  if (template.isLoading || (version !== undefined && body.isLoading)) return <DetailSkeleton />
  if (template.error) {
    return (
      <ErrorState
        error={template.error}
        subject="this template"
        onRetry={() => void template.refetch()}
      />
    )
  }
  if (!template.data) return <DetailSkeleton />

  const record = template.data

  return (
    <>
      <PageHeader
        eyebrow="Template"
        title={record.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <CopyValue value={record.slug} label={`slug for ${record.name}`} />
            <MonoChip size="sm">{record.engine}</MonoChip>
            <MonoChip size="sm">v{record.version}</MonoChip>
            <span className="text-[13.5px] text-muted">updated {shortDate(record.updated_at)}</span>
          </span>
        }
        actions={
          <>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  <History aria-hidden="true" />
                  Version history
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-[720px]">
                <SheetHeader>
                  <SheetTitle>Version history</SheetTitle>
                  <SheetDescription>
                    Every save is kept. Tick two to diff them; roll back to restore one as a new
                    version.
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-4 overflow-y-auto">
                  <TemplateVersions templateId={templateId} currentVersion={record.version} />
                </div>
              </SheetContent>
            </Sheet>

            <div className="flex items-center gap-2.5">
              <span className="text-[12.5px] text-muted-2">
                Saving creates v{record.version + 1}
              </span>
              <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
                <Save aria-hidden="true" />
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </>
        }
      />

      {body.error ? (
        <ErrorState
          error={body.error}
          subject="the stored body of this version"
          onRetry={() => void body.refetch()}
        />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={subjectId}>Subject</Label>
        <Input
          id={subjectId}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Welcome to {{product}}"
        />
        <p className="m-0 text-[12.5px] text-muted-2">
          Preview: {interpolate(subject, sample) || 'no subject set'}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Tabs defaultValue="html" className="flex min-w-0 flex-col">
          <TabsList aria-label="Body format">
            <TabsTrigger value="html">HTML</TabsTrigger>
            <TabsTrigger value="text">Text</TabsTrigger>
          </TabsList>
          <TabsContent value="html" className="mt-2">
            <Label htmlFor={`${bodyId}-html`} className="sr-only">
              HTML body
            </Label>
            <Textarea
              id={`${bodyId}-html`}
              value={html}
              rows={22}
              spellCheck={false}
              className="font-mono text-[12.5px] leading-[1.6]"
              onChange={(event) => setHtml(event.target.value)}
            />
          </TabsContent>
          <TabsContent value="text" className="mt-2">
            <Label htmlFor={`${bodyId}-text`} className="sr-only">
              Plain text body
            </Label>
            <Textarea
              id={`${bodyId}-text`}
              value={text}
              rows={22}
              spellCheck={false}
              className="font-mono text-[12.5px] leading-[1.6]"
              onChange={(event) => setText(event.target.value)}
            />
            <p className="m-0 mt-2 text-[12.5px] text-muted-2">
              Sent as the text/plain alternative. Clients that refuse HTML show this, and its
              absence is itself a spam signal.
            </p>
          </TabsContent>
        </Tabs>

        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="ms-eyebrow m-0 text-[10.5px] text-muted-2">preview</h2>
          <iframe
            title="Template preview"
            sandbox=""
            srcDoc={previewHtml || `<pre>${escapeHtml(previewText)}</pre>`}
            className="h-[520px] w-full rounded-tile border border-line-soft bg-paper"
          />
          <p className="m-0 text-[12.5px] leading-snug text-muted-2">
            Rendered with scripts, forms and navigation disabled, and with only{' '}
            <span className="font-mono">{'{{variable}}'}</span> substituted. The real engine
            compiles server-side, so helpers and MJML tags appear here as themselves.
          </p>
        </section>
      </div>

      <PageSection
        title="Variables"
        description="Discovered by compiling the body. Fill them in to see the preview with real-looking data."
      >
        {variables.length === 0 ? (
          <p className="m-0 text-[13.5px] text-muted">
            No variables found in the last compiled version. Add one as{' '}
            <span className="font-mono">{'{{first_name}}'}</span> and save to see it here.
          </p>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
          >
            {variables.map((variable) => (
              <div key={variable} className="flex flex-col gap-1.5">
                <Label htmlFor={`${bodyId}-var-${variable}`}>
                  <MonoChip size="sm">{variable}</MonoChip>
                </Label>
                <Input
                  id={`${bodyId}-var-${variable}`}
                  value={sample[variable] ?? ''}
                  placeholder="sample value"
                  onChange={(event) =>
                    setSample((current) => ({ ...current, [variable]: event.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        )}
      </PageSection>
    </>
  )
}
