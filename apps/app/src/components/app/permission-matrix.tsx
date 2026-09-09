import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@mailysend/ui'
import type { RoleName } from '~/lib/api-client.ts'
import { ROLES } from '~/lib/api-client.ts'

/**
 * The role model, written down.
 *
 * It is drawn as a matrix rather than four prose paragraphs because the
 * question people actually arrive with — "can a marketer rotate a key?" — is a
 * lookup, and prose makes a lookup into a reading exercise.
 */

export const ROLE_LABEL: Record<RoleName, string> = {
  owner: 'Owner',
  developer: 'Developer',
  marketer: 'Marketer',
  read_only: 'Read-only',
}

export const ROLE_SUMMARY: Record<RoleName, string> = {
  owner: 'Everything, including billing, the provider choice and deleting the workspace.',
  developer: 'Keys, domains, webhooks and the sending API. No billing, no team changes.',
  marketer: 'Broadcasts, audiences, templates and automations. Cannot touch keys or DNS.',
  read_only: 'Reads everything, changes nothing — including message bodies in the logs.',
}

interface Capability {
  id: string
  label: string
  allowed: RoleName[]
  /** Set on the one row whose answer surprises people. */
  flagged?: boolean
}

const CAPABILITIES: Capability[] = [
  { id: 'send', label: 'Send email via the API', allowed: ['owner', 'developer'] },
  { id: 'keys', label: 'Manage API keys', allowed: ['owner', 'developer'] },
  { id: 'domains', label: 'Manage domains & DNS', allowed: ['owner', 'developer'] },
  {
    id: 'logs',
    label: 'View logs & message bodies',
    allowed: ['owner', 'developer', 'marketer', 'read_only'],
    flagged: true,
  },
  { id: 'broadcasts', label: 'Create & send broadcasts', allowed: ['owner', 'marketer'] },
  { id: 'audiences', label: 'Manage audiences & contacts', allowed: ['owner', 'marketer'] },
  { id: 'templates', label: 'Edit templates', allowed: ['owner', 'developer', 'marketer'] },
  { id: 'automations', label: 'Edit automations', allowed: ['owner', 'developer', 'marketer'] },
  { id: 'webhooks', label: 'Manage webhooks', allowed: ['owner', 'developer'] },
  { id: 'team', label: 'Manage team & roles', allowed: ['owner'] },
  { id: 'billing', label: 'Change billing / provider settings', allowed: ['owner'] },
  { id: 'delete', label: 'Delete the workspace', allowed: ['owner'] },
]

export const PermissionMatrix = () => (
  <div className="flex flex-col gap-3">
    <Table>
      <caption className="px-4 py-3 text-left text-[13.5px] leading-[1.65] text-muted">
        The permission model. Every role in this workspace can do exactly the ticked rows and
        nothing else.{' '}
        <strong className="font-semibold text-ink">
          Read-only includes message bodies, which are your customers' data
        </strong>{' '}
        — the name suggests a safer role than it is, so give it out like log access, not like a view
        of the dashboard.
      </caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col" className="min-w-[220px]">
            Capability
          </TableHead>
          {ROLES.map((role) => (
            <TableHead key={role} scope="col" className="text-center">
              {ROLE_LABEL[role]}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {CAPABILITIES.map((capability) => (
          <TableRow key={capability.id}>
            <TableCell className="font-medium text-ink">
              {capability.label}
              {capability.flagged ? (
                <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.1em] text-warning">
                  customer data
                </span>
              ) : null}
            </TableCell>
            {ROLES.map((role) => {
              const allowed = capability.allowed.includes(role)
              return (
                <TableCell key={role} className="text-center">
                  <span
                    role="img"
                    aria-label={`${ROLE_LABEL[role]}: ${capability.label}: ${
                      allowed ? 'allowed' : 'not allowed'
                    }`}
                    className={allowed ? 'text-positive' : 'text-muted-3'}
                  >
                    {allowed ? '✓' : '—'}
                  </span>
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
)
