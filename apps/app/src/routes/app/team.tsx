import {
  Avatar,
  AvatarFallback,
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
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { UserPlus } from 'lucide-react'
import { useId, useState } from 'react'
import { ConfirmDialog } from '~/components/app/confirm-dialog.tsx'
import type { Column } from '~/components/app/data-table.tsx'
import { DataTable } from '~/components/app/data-table.tsx'
import { initials, relativeTime, shortDate } from '~/components/app/format.ts'
import { PageHeader, PageSection } from '~/components/app/page.tsx'
import { PermissionMatrix, ROLE_LABEL, ROLE_SUMMARY } from '~/components/app/permission-matrix.tsx'
import { useApi } from '~/components/app/scope.tsx'
import { EmptyState, ErrorState, TableSkeleton } from '~/components/app/states.tsx'
import type { InviteRecord, MemberRecord, RoleName } from '~/lib/api-client.ts'
import { ROLES } from '~/lib/api-client.ts'
import { qk } from '~/lib/query.ts'
import { appHead } from '~/seo'

/**
 * Team and roles.
 *
 * Members and invites are workspace-scoped rather than environment-scoped: the
 * same people administer live and test, so these keys deliberately carry no
 * environment.
 */

export const Route = createFileRoute('/app/team')({
  head: () => appHead('Team'),
  component: Team,
})

function Team() {
  const api = useApi()
  const [inviting, setInviting] = useState(false)

  const members = useQuery({ queryKey: qk.members(), queryFn: () => api.listMembers() })
  const invites = useQuery({ queryKey: qk.invites(), queryFn: () => api.listInvites() })

  const rows = members.data?.data ?? []
  const ownerCount = rows.filter((member) => member.role === 'owner').length

  return (
    <>
      <PageHeader
        eyebrow="Team"
        title="Who can do what here"
        description="Roles decide what each person reaches. Read the matrix below before handing one out — read-only is not as harmless as it sounds."
        actions={
          <Button size="sm" onClick={() => setInviting(true)}>
            <UserPlus aria-hidden="true" />
            Invite
          </Button>
        }
      />

      <PageSection title="Members" description="Everyone with a standing seat in this workspace.">
        {members.isLoading ? (
          <TableSkeleton rows={4} columns={5} />
        ) : members.error ? (
          <ErrorState
            error={members.error}
            subject="the member list"
            onRetry={() => void members.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="No members yet"
            description="A workspace with nobody in it cannot be administered — invite the person who will hold the owner role."
            action={{ label: 'Invite a teammate', onClick: () => setInviting(true) }}
          />
        ) : (
          <MembersTable members={rows} ownerCount={ownerCount} />
        )}
      </PageSection>

      <PageSection
        title="Pending invites"
        description="Sent, not yet accepted. An invite that expires can simply be sent again."
      >
        {invites.isLoading ? (
          <TableSkeleton rows={2} columns={5} />
        ) : invites.error ? (
          <ErrorState
            error={invites.error}
            subject="pending invites"
            onRetry={() => void invites.refetch()}
          />
        ) : (invites.data?.data.length ?? 0) === 0 ? (
          <p className="m-0 rounded-tile border border-line-soft bg-card px-4 py-3.5 text-[13.5px] text-muted">
            No invites outstanding.
          </p>
        ) : (
          <InvitesTable invites={invites.data?.data ?? []} />
        )}
      </PageSection>

      <PageSection
        title="Permission model"
        description="The same table the API enforces. Nothing here is configurable per person."
      >
        <PermissionMatrix />
      </PageSection>

      <InviteDialog open={inviting} onOpenChange={setInviting} />
    </>
  )
}

function MembersTable({ members, ownerCount }: { members: MemberRecord[]; ownerCount: number }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState<MemberRecord | null>(null)

  /**
   * Deliberately not optimistic. A role change that paints itself green and
   * then quietly reverts leaves someone believing they revoked an access they
   * still have — the two seconds of a pending select are worth that.
   */
  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: RoleName }) => api.updateMemberRole(id, role),
    onSuccess: (member) => {
      void queryClient.invalidateQueries({ queryKey: qk.members() })
      toast.success(`${member.email} is now ${ROLE_LABEL[member.role].toLowerCase()}.`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.removeMember(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.members() })
      toast.success('Member removed.')
      setRemoving(null)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const isLastOwner = (member: MemberRecord) => member.role === 'owner' && ownerCount === 1

  const columns: Column<MemberRecord>[] = [
    {
      id: 'person',
      header: 'Member',
      sortBy: (member) => (member.name ?? member.email).toLowerCase(),
      cell: (member) => (
        <div className="flex items-center gap-3">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback className="text-[11.5px]">
              {initials(member.name, member.email)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-medium text-ink">
              {member.name ?? member.email}
            </div>
            <div className="truncate font-mono text-[12px] text-muted-2">{member.email}</div>
          </div>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      sortBy: (member) => member.role,
      cell: (member) => {
        const locked = isLastOwner(member)
        const pending = changeRole.isPending && changeRole.variables?.id === member.id
        return (
          <div className="flex flex-col gap-1">
            <Select
              value={member.role}
              disabled={locked || pending}
              onValueChange={(role) => changeRole.mutate({ id: member.id, role: role as RoleName })}
            >
              <SelectTrigger
                className="w-[168px]"
                aria-label={`Role for ${member.email}`}
                onClick={(event) => event.stopPropagation()}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {locked ? (
              <span className="text-[12px] text-muted-2">
                The last owner cannot be demoted — promote someone else first.
              </span>
            ) : pending ? (
              <span className="text-[12px] text-muted-2">Saving…</span>
            ) : null}
          </div>
        )
      },
    },
    {
      id: 'last_seen',
      header: 'Last seen',
      sortBy: (member) => member.last_seen_at ?? '',
      cell: (member) => (
        <span className="text-[13.5px] text-muted" title={member.last_seen_at ?? undefined}>
          {member.last_seen_at ? relativeTime(member.last_seen_at) : 'never'}
        </span>
      ),
    },
    {
      id: 'remove',
      header: 'Remove',
      srOnlyHeader: true,
      align: 'right',
      cell: (member) =>
        isLastOwner(member) ? (
          <span className="text-[12px] text-muted-2">Last owner — cannot be removed</span>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setRemoving(member)}>
            Remove
          </Button>
        ),
    },
  ]

  return (
    <>
      <DataTable
        rows={members}
        columns={columns}
        rowId={(member) => member.id}
        caption="Workspace members, their role and when they were last active"
        defaultSort={{ columnId: 'person', direction: 'asc' }}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title="Remove this member?"
        description={`${removing?.email ?? ''} loses access to this workspace immediately.`}
        confirmPhrase={removing?.email}
        confirmLabel="Remove member"
        pending={remove.isPending}
        consequences={
          <>
            Their dashboard session stops working on the next request, in both live and test. API
            keys they created keep working — a key belongs to the workspace, not to the person, so
            revoke any of theirs on the API keys screen if that is the point of removing them.
          </>
        }
        onConfirm={() => {
          if (removing) remove.mutate(removing.id)
        }}
      />
    </>
  )
}

function InvitesTable({ invites }: { invites: InviteRecord[] }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [revoking, setRevoking] = useState<InviteRecord | null>(null)

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvite(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.invites() })
      toast.success('Invite revoked.')
      setRevoking(null)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const columns: Column<InviteRecord>[] = [
    {
      id: 'email',
      header: 'Email',
      sortBy: (invite) => invite.email,
      cell: (invite) => <span className="font-mono text-[12.5px]">{invite.email}</span>,
    },
    {
      id: 'role',
      header: 'Role',
      sortBy: (invite) => invite.role,
      cell: (invite) => <MonoChip size="sm">{ROLE_LABEL[invite.role]}</MonoChip>,
    },
    {
      id: 'created',
      header: 'Sent',
      sortBy: (invite) => invite.created_at,
      cell: (invite) => (
        <span className="text-[13.5px] text-muted">{shortDate(invite.created_at)}</span>
      ),
    },
    {
      id: 'expires',
      header: 'Expires',
      sortBy: (invite) => invite.expires_at,
      cell: (invite) => {
        const expired = new Date(invite.expires_at).getTime() < Date.now()
        return (
          <span className={expired ? 'text-[13.5px] text-warning' : 'text-[13.5px] text-muted'}>
            {expired ? 'expired' : relativeTime(invite.expires_at)}
          </span>
        )
      },
    },
    {
      id: 'revoke',
      header: 'Revoke',
      srOnlyHeader: true,
      align: 'right',
      cell: (invite) => (
        <Button variant="ghost" size="sm" onClick={() => setRevoking(invite)}>
          Revoke
        </Button>
      ),
    },
  ]

  return (
    <>
      <DataTable
        rows={invites}
        columns={columns}
        rowId={(invite) => invite.id}
        caption="Invitations that have been sent but not yet accepted"
        defaultSort={{ columnId: 'created', direction: 'desc' }}
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
        title="Revoke this invite?"
        description={`The link sent to ${revoking?.email ?? ''} stops working.`}
        confirmLabel="Revoke invite"
        pending={revoke.isPending}
        consequences="If they follow the emailed link after this, they get an error rather than a seat. Sending a fresh invite is the only way back."
        onConfirm={() => {
          if (revoking) revoke.mutate(revoking.id)
        }}
      />
    </>
  )
}

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<RoleName>('marketer')
  const emailId = useId()

  const create = useMutation({
    mutationFn: () => api.createInvite({ email: email.trim(), role }),
    onSuccess: (invite) => {
      void queryClient.invalidateQueries({ queryKey: qk.invites() })
      toast.success(`Invite sent to ${invite.email}.`)
      setEmail('')
      setRole('marketer')
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            They get an email with a link. The role takes effect the moment they accept, and can be
            changed afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor={emailId}>Email</Label>
          <Input
            id={emailId}
            type="email"
            value={email}
            autoComplete="off"
            placeholder="teammate@acme.dev"
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-2">
            Role
          </legend>
          <RadioGroup
            value={role}
            onValueChange={(value) => setRole(value as RoleName)}
            aria-label="Role for the invited teammate"
          >
            {ROLES.map((option) => (
              <label
                key={option}
                htmlFor={`invite-role-${option}`}
                className="flex cursor-pointer gap-3 rounded-code border border-line bg-paper p-3"
              >
                <RadioGroupItem
                  id={`invite-role-${option}`}
                  value={option}
                  className="mt-0.5 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-ink">
                    {ROLE_LABEL[option]}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-[1.55] text-muted">
                    {ROLE_SUMMARY[option]}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </fieldset>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={create.isPending || !email.includes('@')}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Sending…' : 'Send invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
