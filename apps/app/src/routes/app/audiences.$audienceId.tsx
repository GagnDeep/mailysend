import {
  Button,
  Callout,
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { UserPlus } from 'lucide-react'
import { useId, useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import { ContactImport } from '~/components/app/contact-import.tsx'
import { type Column, CursorPager, DataTable } from '~/components/app/data-table.tsx'
import { dateTime, num, relativeTime } from '~/components/app/format.ts'
import { PageHeader } from '~/components/app/page.tsx'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import { DetailSkeleton, EmptyState, QueryState } from '~/components/app/states.tsx'
import type { ContactRecord, List } from '~/lib/api-client.ts'
import { errorMessage, qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

export const Route = createFileRoute('/app/audiences/$audienceId')({
  head: () => appHead('Audience'),
  component: AudienceDetail,
})

const PAGE_SIZE = 50

const fullName = (contact: ContactRecord): string =>
  [contact.first_name, contact.last_name].filter(Boolean).join(' ')

const csvCell = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

function AudienceDetail() {
  const { audienceId } = Route.useParams()
  const api = useApi()
  const environment = useEnvironment()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [cursors, setCursors] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [open, setOpen] = useState<ContactRecord | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [deletingSelection, setDeletingSelection] = useState(false)
  const searchId = useId()

  const after = cursors.at(-1)
  const filters = { search, after: after ?? null, limit: PAGE_SIZE }
  const contactsKey = qk.contacts(environment, audienceId, filters)

  const audience = useQuery({
    queryKey: qk.audience(environment, audienceId),
    queryFn: () => api.getAudience(audienceId),
  })

  const contacts = useQuery({
    queryKey: contactsKey,
    queryFn: () => api.listContacts(audienceId, { limit: PAGE_SIZE, after, search }),
  })

  const invalidateContacts = () =>
    queryClient.invalidateQueries({ queryKey: [environment, 'audience', audienceId, 'contacts'] })

  // The API is asked to filter, but the same predicate runs over the page that
  // came back: an API build that has not learned `search` yet would otherwise
  // silently show an unfiltered list to someone who typed into a search box.
  const needle = search.trim().toLowerCase()
  const rows = (contacts.data?.data ?? []).filter((contact) =>
    needle === '' ? true : contact.email.toLowerCase().includes(needle),
  )

  const setSubscribed = useMutation({
    mutationFn: ({ id, unsubscribed }: { id: string; unsubscribed: boolean }) =>
      api.updateContact(audienceId, id, { unsubscribed }),
    // Safe to apply before the server answers: the only thing a failure can do
    // is put the switch back to the value this page was just handed.
    onMutate: async ({ id, unsubscribed }) => {
      await queryClient.cancelQueries({ queryKey: contactsKey })
      const previous = queryClient.getQueryData<List<ContactRecord>>(contactsKey)
      queryClient.setQueryData<List<ContactRecord>>(contactsKey, (current) =>
        current
          ? {
              ...current,
              data: current.data.map((contact) =>
                contact.id === id ? { ...contact, unsubscribed } : contact,
              ),
            }
          : current,
      )
      setOpen((current) => (current && current.id === id ? { ...current, unsubscribed } : current))
      return { previous }
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(contactsKey, context.previous)
      toast.error(`Subscription unchanged. ${errorMessage(error)}`)
    },
    onSettled: () => void invalidateContacts(),
  })

  const saveContact = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.updateContact(audienceId, id, body),
    onSuccess: (contact) => {
      setOpen(contact)
      void invalidateContacts()
      toast.success('Contact saved')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const addContact = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.createContact(audienceId, body),
    onSuccess: () => {
      setAdding(false)
      void invalidateContacts()
      void queryClient.invalidateQueries({ queryKey: qk.audience(environment, audienceId) })
      toast.success('Contact added')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const bulkUnsubscribe = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id) => api.updateContact(audienceId, id, { unsubscribed: true }))),
    onSuccess: (updated) => {
      setSelected([])
      void invalidateContacts()
      toast.success(`${num(updated.length)} contacts unsubscribed`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.deleteContact(audienceId, id))),
    onSuccess: (removed) => {
      setSelected([])
      setDeletingSelection(false)
      void invalidateContacts()
      void queryClient.invalidateQueries({ queryKey: qk.audience(environment, audienceId) })
      toast.success(`${num(removed.length)} contacts deleted`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const exportPage = () => {
    const header = [
      'email',
      'first_name',
      'last_name',
      'unsubscribed',
      'opens',
      'clicks',
      'created_at',
    ]
    const lines = [
      header.join(','),
      ...rows.map((contact) =>
        [
          contact.email,
          contact.first_name ?? '',
          contact.last_name ?? '',
          String(contact.unsubscribed),
          String(contact.open_count ?? 0),
          String(contact.click_count ?? 0),
          contact.created_at,
        ]
          .map(csvCell)
          .join(','),
      ),
    ]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${audience.data?.name ?? 'audience'}-contacts.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported the ${num(rows.length)} contacts on this page`)
  }

  const columns: Column<ContactRecord>[] = [
    {
      id: 'email',
      header: 'Email',
      sortBy: (row) => row.email.toLowerCase(),
      cell: (row) => <span className="font-mono text-[12.5px] text-ink">{row.email}</span>,
    },
    {
      id: 'name',
      header: 'Name',
      sortBy: (row) => fullName(row).toLowerCase(),
      cell: (row) => fullName(row) || <span className="text-muted-2">—</span>,
    },
    {
      id: 'subscribed',
      header: 'Subscribed',
      sortBy: (row) => (row.unsubscribed ? 1 : 0),
      cell: (row) => (
        <Switch
          checked={!row.unsubscribed}
          aria-label={`${row.unsubscribed ? 'Resubscribe' : 'Unsubscribe'} ${row.email}`}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={(checked) =>
            setSubscribed.mutate({ id: row.id, unsubscribed: !checked })
          }
        />
      ),
    },
    {
      id: 'opens',
      header: 'Opens',
      align: 'right',
      sortBy: (row) => row.open_count ?? 0,
      cell: (row) => <span className="font-mono text-[12.5px]">{num(row.open_count ?? 0)}</span>,
    },
    {
      id: 'clicks',
      header: 'Clicks',
      align: 'right',
      sortBy: (row) => row.click_count ?? 0,
      cell: (row) => <span className="font-mono text-[12.5px]">{num(row.click_count ?? 0)}</span>,
    },
    {
      id: 'last_open',
      header: 'Last open',
      sortBy: (row) => row.last_open_at ?? '',
      cell: (row) =>
        row.last_open_at ? (
          <span title={row.last_open_at} className="text-muted">
            {relativeTime(row.last_open_at)}
          </span>
        ) : (
          <span className="text-muted-2">never</span>
        ),
    },
    {
      id: 'created',
      header: 'Added',
      sortBy: (row) => row.created_at,
      cell: (row) => (
        <span title={row.created_at} className="text-muted">
          {relativeTime(row.created_at)}
        </span>
      ),
    },
  ]

  if (audience.isLoading) return <DetailSkeleton />

  const name = audience.data?.name ?? audienceId

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/app/audiences" className="underline-offset-4 hover:underline">
            ← Audiences
          </Link>
        }
        title={name}
        description={
          audience.data?.contact_count === undefined
            ? 'Contacts in this audience. Subscription state is per audience, suppression is per workspace.'
            : `${num(audience.data.contact_count)} contacts. Subscription state is per audience, suppression is per workspace.`
        }
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <UserPlus aria-hidden="true" />
              Add contact
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              Import CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={exportPage} disabled={rows.length === 0}>
              Export
            </Button>
          </>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor={searchId} className="sr-only">
              Filter contacts by email
            </Label>
            <Input
              id={searchId}
              type="search"
              value={search}
              placeholder="Filter by email…"
              className="w-full max-w-[320px] font-mono text-[13px]"
              onChange={(event) => {
                setSearch(event.target.value)
                setCursors([])
                setSelected([])
              }}
            />
            {search ? (
              <span className="text-[12.5px] text-muted-2">
                Showing {num(rows.length)} matching contacts.
              </span>
            ) : null}
          </div>
        }
      />

      {audience.error ? (
        <Callout variant="warn" title="audience not loaded">
          This page is still usable, but the header count comes from the audience record, which
          failed to load. {errorMessage(audience.error)}
        </Callout>
      ) : null}

      <QueryState
        isLoading={contacts.isLoading}
        error={contacts.error}
        data={rows}
        subject="the contacts in this audience"
        onRetry={() => void contacts.refetch()}
        empty={
          search ? (
            <EmptyState
              icon={UserPlus}
              title="No contact matches that address"
              description="The filter runs over the email column only. Clear it to see the whole audience again."
              action={{ label: 'Clear the filter', onClick: () => setSearch('') }}
            />
          ) : (
            <EmptyState
              icon={UserPlus}
              title="This audience is empty"
              description="Nothing can be sent to it yet. Add one contact to try a broadcast against, or bring the whole list over in one go."
              action={{ label: 'Add a contact', onClick: () => setAdding(true) }}
              secondaryAction={{ label: 'Import a CSV', onClick: () => setImporting(true) }}
            />
          )
        }
      >
        {(visible) => (
          <>
            <DataTable
              rows={visible}
              columns={columns}
              rowId={(row) => row.id}
              caption={`Contacts in ${name}`}
              defaultSort={{ columnId: 'created', direction: 'desc' }}
              onRowClick={(row) => setOpen(row)}
              selection={{
                selected,
                onChange: setSelected,
                actions: (ids) => (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulkUnsubscribe.isPending}
                      onClick={() => bulkUnsubscribe.mutate(ids)}
                    >
                      Unsubscribe selected
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeletingSelection(true)}>
                      Delete selected
                    </Button>
                  </>
                ),
              }}
            />
            <CursorPager
              count={visible.length}
              hasMore={contacts.data?.has_more ?? false}
              hasPrevious={cursors.length > 0}
              onNext={() => {
                const next = contacts.data?.next_cursor
                if (next) {
                  setCursors((current) => [...current, next])
                  setSelected([])
                }
              }}
              onPrevious={() => {
                setCursors((current) => current.slice(0, -1))
                setSelected([])
              }}
            />
          </>
        )}
      </QueryState>

      <ContactImport audienceId={audienceId} open={importing} onOpenChange={setImporting} />

      <AddContactDialog
        open={adding}
        onOpenChange={setAdding}
        pending={addContact.isPending}
        onSubmit={(body) => addContact.mutate(body)}
      />

      <ConfirmDialog
        open={deletingSelection}
        onOpenChange={setDeletingSelection}
        title={`Delete ${num(selected.length)} contacts`}
        description="They are removed from this audience along with their engagement history."
        confirmPhrase={`delete ${selected.length}`}
        confirmLabel="Delete contacts"
        consequences={
          <p className="m-0">
            Opens, clicks and merge data go with them, so a segment over this audience will get
            smaller. Deleting a contact is <MonoChip size="sm">not</MonoChip> the same as
            unsubscribing: a deleted address can be re-added by an import and will be mailed again,
            whereas an unsubscribed one will not.
          </p>
        }
        pending={bulkDelete.isPending}
        onConfirm={() => bulkDelete.mutate(selected)}
      />

      <Sheet
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null)
        }}
      >
        <SheetContent className="w-full sm:max-w-[520px]">
          {open ? (
            <ContactSheet
              key={open.id}
              contact={open}
              pending={saveContact.isPending}
              onSave={(body) => saveContact.mutate({ id: open.id, body })}
              onToggleSubscribed={(unsubscribed) =>
                setSubscribed.mutate({ id: open.id, unsubscribed })
              }
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}

const AddContactDialog = ({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (body: Record<string, unknown>) => void
}) => {
  const [email, setEmail] = useState('')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const emailId = useId()
  const firstId = useId()
  const lastId = useId()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setEmail('')
          setFirst('')
          setLast('')
        }
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit({
              email: email.trim(),
              first_name: first.trim() || undefined,
              last_name: last.trim() || undefined,
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a contact</DialogTitle>
            <DialogDescription>
              Adding an address here is a claim that it consented. A suppressed address stays
              suppressed and will not be mailed even after being added.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={emailId}>Email address</Label>
              <Input
                id={emailId}
                type="email"
                required
                value={email}
                autoComplete="off"
                className="font-mono text-[13.5px]"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor={firstId}>First name</Label>
                <Input
                  id={firstId}
                  value={first}
                  onChange={(event) => setFirst(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={lastId}>Last name</Label>
                <Input id={lastId} value={last} onChange={(event) => setLast(event.target.value)} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={email.trim() === '' || pending}>
              {pending ? 'Adding…' : 'Add contact'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const ContactSheet = ({
  contact,
  pending,
  onSave,
  onToggleSubscribed,
}: {
  contact: ContactRecord
  pending: boolean
  onSave: (body: Record<string, unknown>) => void
  onToggleSubscribed: (unsubscribed: boolean) => void
}) => {
  const [first, setFirst] = useState(contact.first_name ?? '')
  const [last, setLast] = useState(contact.last_name ?? '')
  const [email, setEmail] = useState(contact.email)
  const emailId = useId()
  const firstId = useId()
  const lastId = useId()
  const custom = Object.entries(contact.data ?? {})

  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-mono text-[15px]">{contact.email}</SheetTitle>
        <SheetDescription>
          Added {dateTime(contact.created_at)}. Engagement counters are maintained by the event
          pipeline, so they are read-only here.
        </SheetDescription>
      </SheetHeader>

      <div className="mt-5 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3 rounded-tile border border-line-soft bg-card px-3.5 py-3">
          <div>
            <p className="m-0 text-[13.5px] font-medium text-ink">Subscribed to this audience</p>
            <p className="m-0 mt-0.5 text-[12.5px] text-muted">
              {contact.unsubscribed
                ? 'Excluded from every broadcast and automation over this audience.'
                : 'Included in broadcasts and automations over this audience.'}
            </p>
          </div>
          <Switch
            checked={!contact.unsubscribed}
            aria-label={`${contact.unsubscribed ? 'Resubscribe' : 'Unsubscribe'} ${contact.email}`}
            onCheckedChange={(checked) => onToggleSubscribed(!checked)}
          />
        </div>

        <KeyValueList>
          <KeyValue label="Contact id" value={contact.id} mono />
          <KeyValue label="Opens" value={num(contact.open_count ?? 0)} mono />
          <KeyValue label="Clicks" value={num(contact.click_count ?? 0)} mono />
          <KeyValue
            label="Last open"
            value={contact.last_open_at ? dateTime(contact.last_open_at) : 'never'}
          />
          <KeyValue
            label="Last click"
            value={contact.last_click_at ? dateTime(contact.last_click_at) : 'never'}
          />
          <KeyValue label="Added" value={dateTime(contact.created_at)} rule />
        </KeyValueList>

        <section className="flex flex-col gap-2">
          <h3 className="m-0 font-display text-[15px] font-medium">Merge data</h3>
          {custom.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">
              No custom fields. Anything imported into <MonoChip size="sm">data</MonoChip> shows
              here and can be used in a segment as <MonoChip size="sm">data.key</MonoChip>.
            </p>
          ) : (
            <KeyValueList>
              {custom.map(([key, value]) => (
                <KeyValue
                  key={key}
                  label={key}
                  mono
                  value={typeof value === 'string' ? value : JSON.stringify(value)}
                />
              ))}
            </KeyValueList>
          )}
        </section>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            onSave({
              email: email.trim(),
              first_name: first.trim() || null,
              last_name: last.trim() || null,
            })
          }}
        >
          <h3 className="m-0 font-display text-[15px] font-medium">Edit</h3>
          <div className="flex flex-col gap-2">
            <Label htmlFor={emailId}>Email address</Label>
            <Input
              id={emailId}
              type="email"
              value={email}
              className="font-mono text-[13.5px]"
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={firstId}>First name</Label>
              <Input
                id={firstId}
                value={first}
                onChange={(event) => setFirst(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={lastId}>Last name</Label>
              <Input id={lastId} value={last} onChange={(event) => setLast(event.target.value)} />
            </div>
          </div>
          <Button type="submit" size="sm" className="self-start" disabled={pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
        </form>
      </div>
    </>
  )
}
