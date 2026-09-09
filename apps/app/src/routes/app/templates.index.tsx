import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  MonoChip,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Copy, FileCode2, MoreHorizontal, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import { CopyValue } from '~/components/app/copy-value.tsx'
import type { Column } from '~/components/app/data-table.tsx'
import { DataTable } from '~/components/app/data-table.tsx'
import { shortDate } from '~/components/app/format.ts'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { EmptyState, QueryState } from '~/components/app/states.tsx'
import type { TemplateRecord } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/templates/')({
  head: () => appHead('Templates'),
  component: Templates,
})

type Engine = TemplateRecord['engine']

const ENGINES: { value: Engine; note: string }[] = [
  { value: 'handlebars', note: '{{variable}} substitution, no logic beyond helpers.' },
  { value: 'mjml', note: 'Responsive email markup, compiled to table HTML on save.' },
  { value: 'jsx-ast', note: 'A serialised component tree rendered server-side.' },
  { value: 'html', note: 'Verbatim. Nothing is compiled, nothing is escaped for you.' },
]

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

function Templates() {
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: Route.fullPath })
  // The detail route is a child of this one, so the list stands aside for it.
  const nameId = useId()
  const slugId = useId()
  const engineId = useId()

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [engine, setEngine] = useState<Engine>('handlebars')
  const [pendingDelete, setPendingDelete] = useState<TemplateRecord | null>(null)

  const templates = useQuery({
    queryKey: qk.templates(environment),
    queryFn: () => api.listTemplates({ limit: 100 }),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.templates(environment) })

  const create = useMutation({
    mutationFn: () =>
      api.createTemplate({ name: name.trim(), slug: slug.trim() || slugify(name), engine }),
    onSuccess: async (created) => {
      setCreating(false)
      setName('')
      setSlug('')
      setSlugTouched(false)
      await invalidate()
      await navigate({ to: '/app/templates/$templateId', params: { templateId: created.id } })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const duplicate = useMutation({
    mutationFn: (template: TemplateRecord) =>
      api.createTemplate({
        name: `${template.name} copy`,
        slug: `${template.slug}-copy`,
        engine: template.engine,
        subject: template.subject ?? undefined,
      }),
    onSuccess: async () => {
      await invalidate()
      toast.success('Duplicated. The copy starts at version 1 with an empty body.')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTemplate(id),
    onSuccess: async () => {
      setPendingDelete(null)
      await invalidate()
      toast.success('Template deleted.')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const columns: Column<TemplateRecord>[] = [
    {
      id: 'name',
      header: 'Name',
      sortBy: (row) => row.name.toLowerCase(),
      cell: (row) => (
        <Link
          to="/app/templates/$templateId"
          params={{ templateId: row.id }}
          className="font-medium underline-offset-2 hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      id: 'slug',
      header: 'Slug',
      sortBy: (row) => row.slug,
      cell: (row) => <CopyValue value={row.slug} label={`slug for ${row.name}`} />,
    },
    {
      id: 'engine',
      header: 'Engine',
      sortBy: (row) => row.engine,
      cell: (row) => <MonoChip size="sm">{row.engine}</MonoChip>,
    },
    {
      id: 'subject',
      header: 'Subject',
      cell: (row) =>
        row.subject ? (
          <span className="text-[13.5px] text-muted">{row.subject}</span>
        ) : (
          <span className="text-[13.5px] text-muted-2">not set</span>
        ),
    },
    {
      id: 'version',
      header: 'Version',
      align: 'right',
      sortBy: (row) => row.version,
      cell: (row) => <span className="font-mono text-[12.5px] text-muted">v{row.version}</span>,
    },
    {
      id: 'updated',
      header: 'Updated',
      sortBy: (row) => row.updated_at,
      cell: (row) => <span className="text-[13px] text-muted">{shortDate(row.updated_at)}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      srOnlyHeader: true,
      align: 'right',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={`Actions for ${row.name}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => duplicate.mutate(row)}>
              <Copy aria-hidden="true" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setPendingDelete(row)}>
              <Trash2 aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Templates"
        title="One body, many sends"
        description="Broadcasts and automations reference a template by id, so editing here changes what they send next — never what they have already sent."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <FileCode2 aria-hidden="true" />
            New template
          </Button>
        }
      />

      <QueryState
        isLoading={templates.isLoading}
        error={templates.error}
        data={templates.data?.data}
        subject="templates"
        onRetry={() => void templates.refetch()}
        empty={
          <EmptyState
            icon={FileCode2}
            title="No templates yet"
            description="A template holds the subject and body, and every version of both, so a send can always be traced back to the exact markup that produced it."
            action={{ label: 'Create a template', onClick: () => setCreating(true) }}
          />
        }
      >
        {(rows) => (
          <DataTable
            rows={rows}
            columns={columns}
            rowId={(row) => row.id}
            caption="Templates in this workspace and environment"
            defaultSort={{ columnId: 'updated', direction: 'desc' }}
          />
        )}
      </QueryState>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New template</DialogTitle>
            <DialogDescription>
              The engine is fixed once the template exists: changing it later would reinterpret
              every stored version.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={nameId}>Name</Label>
              <Input
                id={nameId}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  if (!slugTouched) setSlug(slugify(event.target.value))
                }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={slugId}>Slug</Label>
              <Input
                id={slugId}
                value={slug}
                className="font-mono text-[13px]"
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(slugify(event.target.value))
                }}
              />
              <p className="m-0 text-[12.5px] text-muted-2">
                How the API addresses it instead of the id. Unique per workspace.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={engineId}>Engine</Label>
              <Select value={engine} onValueChange={(next) => setEngine(next as Engine)}>
                <SelectTrigger id={engineId} aria-label="Template engine">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENGINES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="m-0 text-[12.5px] text-muted-2">
                {ENGINES.find((option) => option.value === engine)?.note}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Creating…' : 'Create template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={`Delete ${pendingDelete?.name ?? 'template'}`}
        description="The template and every stored version of its body are removed."
        confirmPhrase={pendingDelete?.slug}
        confirmLabel="Delete template"
        consequences={
          <>
            Any broadcast or automation step still pointing at{' '}
            <span className="font-mono">{pendingDelete?.slug}</span> will fail at send time rather
            than silently sending an empty message.
          </>
        }
        pending={remove.isPending}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id)
        }}
      />
    </>
  )
}
