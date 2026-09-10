import { Button, Callout, Input, Label, toast } from '@mailysend/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { CopyValue } from '~/components/app/copy-value.tsx'
import { failure, postJson, useInstance } from '~/lib/instance.ts'
import { createPasskey, PasskeyError, passkeysSupported } from '~/lib/passkey.ts'

/**
 * Everything about getting back in.
 *
 * It lives on one screen because the four things here are one decision: a
 * passkey is bound to a hostname, so moving the instance domain invalidates it,
 * and recovery codes are what make both safe. Splitting them across three
 * screens is how somebody ends up with one passkey, no codes, and a hostname
 * change they did not understand.
 */

interface Passkey {
  id: string
  name: string | null
  rp_id: string
  usable_here: boolean
}

interface PendingDevice {
  id: string
  user_code: string
  client: string | null
  created_at: string
}

const asError = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback

const json = async <T,>(path: string): Promise<T> => {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(await failure(response, `Could not load ${path}.`))
  return (await response.json()) as T
}

const Section = ({
  title,
  lede,
  children,
}: {
  title: string
  lede: string
  children: React.ReactNode
}) => (
  <div className="flex flex-col gap-4 rounded-tile border border-line-soft bg-card p-5">
    <div>
      <h3 className="m-0 text-[15.5px] font-semibold -tracking-[0.01em] text-ink">{title}</h3>
      <p className="m-0 mt-1 max-w-[72ch] text-[13.5px] leading-[1.6] text-muted">{lede}</p>
    </div>
    {children}
  </div>
)

export function SecurityPanel() {
  return (
    <div className="flex flex-col gap-5">
      <PasskeysSection />
      <RecoveryCodesSection />
      <DevicesSection />
      <InstanceDomainSection />
    </div>
  )
}

function PasskeysSection() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const nameId = useId()

  const passkeys = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => json<{ data: Passkey[] }>('/v1/auth/passkey'),
  })

  const add = useMutation({
    mutationFn: async () => {
      const { challenge, response } = await createPasskey('/v1/auth/passkey/register/options')
      const verified = await postJson('/v1/auth/passkey/register/verify', {
        challenge,
        response,
        ...(name.trim() ? { name: name.trim() } : {}),
      })
      if (!verified.ok) throw new Error(await failure(verified, 'That passkey was not accepted.'))
    },
    onSuccess: () => {
      setName('')
      toast.success('Passkey added.')
      void queryClient.invalidateQueries({ queryKey: ['passkeys'] })
    },
    onError: (error: unknown) =>
      toast.error(
        asError(
          error,
          error instanceof PasskeyError ? error.message : 'Could not add that passkey.',
        ),
      ),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/v1/auth/passkey/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) throw new Error(await failure(response, 'Could not remove that passkey.'))
    },
    onSuccess: () => {
      toast.success('Passkey removed.')
      void queryClient.invalidateQueries({ queryKey: ['passkeys'] })
    },
    onError: (error: unknown) => toast.error(asError(error, 'Could not remove that passkey.')),
  })

  const rows = passkeys.data?.data ?? []
  const stale = rows.filter((row) => !row.usable_here)

  return (
    <Section
      title="Passkeys"
      lede="How you sign in. Add one per device you actually use — a second passkey is the difference between losing a laptop and losing the instance."
    >
      {!passkeysSupported() ? (
        <Callout variant="warn" title="This browser cannot make a passkey">
          Use a browser with WebAuthn support, or sign in with a recovery code.
        </Callout>
      ) : null}

      {stale.length > 0 ? (
        <Callout variant="warn" title="Some passkeys were registered for a different hostname">
          {stale.length} of your passkeys were created on{' '}
          {[...new Set(stale.map((row) => row.rp_id))].join(', ')} and will not work here. Register
          a new one on this hostname and remove them.
        </Callout>
      ) : null}

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-4 rounded-tile border border-line bg-paper px-4 py-3"
          >
            <div>
              <div className="text-[14px] font-semibold text-ink">{row.name ?? 'Passkey'}</div>
              <div className="ms-num font-mono text-[12px] text-muted-2">
                {row.rp_id}
                {row.usable_here ? '' : ' · not usable on this hostname'}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate(row.id)}
            >
              Remove
            </Button>
          </li>
        ))}
        {passkeys.isLoading ? null : rows.length === 0 ? (
          <li className="text-[13.5px] text-muted">No passkeys yet.</li>
        ) : null}
      </ul>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={nameId}>Name this device</Label>
          <Input
            id={nameId}
            value={name}
            placeholder="Work laptop"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button disabled={add.isPending || !passkeysSupported()} onClick={() => add.mutate()}>
          {add.isPending ? 'Waiting for your device…' : 'Add a passkey'}
        </Button>
      </div>
    </Section>
  )
}

function RecoveryCodesSection() {
  const [codes, setCodes] = useState<string[] | null>(null)

  const regenerate = useMutation({
    mutationFn: async () => {
      const response = await postJson('/v1/setup/recovery-codes')
      if (!response.ok) throw new Error(await failure(response, 'Could not generate codes.'))
      return (await response.json()) as { recovery_codes: string[] }
    },
    onSuccess: (data) => setCodes(data.recovery_codes),
    onError: (error: unknown) => toast.error(asError(error, 'Could not generate codes.')),
  })

  return (
    <Section
      title="Recovery codes"
      lede="Single-use, and the way back in when the passkey is gone. Generating a new set replaces every code you have — including any you have not used."
    >
      {codes ? (
        <>
          <Callout variant="warn" title="Save these now">
            They are shown once. Nothing on this instance can show them to you again.
          </Callout>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {codes.map((code) => (
              <code
                key={code}
                className="ms-num rounded-tile border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink"
              >
                {code}
              </code>
            ))}
          </div>
          <CopyValue value={codes.join('\n')} label="Copy all codes" />
        </>
      ) : null}
      <div>
        <Button
          variant="outline"
          disabled={regenerate.isPending}
          onClick={() => regenerate.mutate()}
        >
          {codes ? 'Generate a new set' : 'Generate recovery codes'}
        </Button>
      </div>
    </Section>
  )
}

function DevicesSection() {
  const queryClient = useQueryClient()
  const pending = useQuery({
    queryKey: ['device-codes'],
    queryFn: () => json<{ data: PendingDevice[] }>('/v1/auth/device/pending'),
    refetchInterval: 5_000,
  })

  const decide = useMutation({
    mutationFn: async ({ userCode, action }: { userCode: string; action: 'approve' | 'deny' }) => {
      const response = await postJson(`/v1/auth/device/${action}`, { user_code: userCode })
      if (!response.ok) throw new Error(await failure(response, 'That code is no longer waiting.'))
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.action === 'approve' ? 'Device approved.' : 'Device declined.')
      void queryClient.invalidateQueries({ queryKey: ['device-codes'] })
    },
    onError: (error: unknown) => toast.error(asError(error, 'That code is no longer waiting.')),
  })

  const rows = pending.data?.data ?? []

  return (
    <Section
      title="CLI sign-in requests"
      lede="`npx mailysend login` prints a code and waits here. Approving one mints a full-access API key named after the client, revocable from the API keys screen like any other."
    >
      {rows.length === 0 ? (
        <p className="m-0 text-[13.5px] text-muted">Nothing waiting.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-4 rounded-tile border border-line bg-paper px-4 py-3"
            >
              <div>
                <div className="ms-num font-mono text-[15px] font-semibold text-ink">
                  {row.user_code}
                </div>
                <div className="text-[12.5px] text-muted-2">{row.client ?? 'Unknown client'}</div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ userCode: row.user_code, action: 'approve' })}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ userCode: row.user_code, action: 'deny' })}
                >
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function InstanceDomainSection() {
  const instance = useInstance()
  const hostId = useId()
  const [hostname, setHostname] = useState('')
  const [steps, setSteps] = useState<string[] | null>(null)

  const move = useMutation({
    mutationFn: async () => {
      const response = await fetch('/v1/workspace/instance-domain', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hostname: hostname.trim().toLowerCase() }),
      })
      if (!response.ok) throw new Error(await failure(response, 'Could not set that hostname.'))
      return (await response.json()) as { next_steps: string[]; passkeys_to_reregister: number }
    },
    onSuccess: (data) => {
      setSteps(data.next_steps)
      toast.success(
        data.passkeys_to_reregister > 0
          ? `Saved. ${data.passkeys_to_reregister} passkey(s) will need re-registering on the new hostname.`
          : 'Saved.',
      )
    },
    onError: (error: unknown) => toast.error(asError(error, 'Could not set that hostname.')),
  })

  return (
    <Section
      title="Instance domain"
      lede="The hostname this instance answers on. Everything it mints follows from it — tracking links, unsubscribe links, and the hostname your passkeys are bound to."
    >
      <p className="m-0 text-[13.5px] text-muted">
        Currently{' '}
        <code className="font-mono text-[13px] text-ink">
          {instance.status === 'ready' ? instance.instance.public_url : '…'}
        </code>
      </p>

      <Callout variant="warn" title="Passkeys are bound to the hostname">
        Changing this means every existing passkey stops working. Generate recovery codes first;
        `npx mailysend claim` is the guaranteed way back in either way.
      </Callout>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={hostId}>New hostname</Label>
          <Input
            id={hostId}
            value={hostname}
            placeholder="mail.example.com"
            onChange={(event) => setHostname(event.target.value)}
          />
        </div>
        <Button
          variant="outline"
          disabled={move.isPending || hostname.trim().length < 3}
          onClick={() => move.mutate()}
        >
          Use this hostname
        </Button>
      </div>

      {steps ? (
        <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-[13.5px] leading-[1.6] text-muted">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
    </Section>
  )
}
