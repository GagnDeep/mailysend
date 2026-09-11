import { Button, Input, Label, StatusDot } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import {
  AUTH_LINK,
  AUTH_LINK_STRONG,
  AuthLayout,
  AuthPre,
} from '~/components/marketing/auth-layout.tsx'
import { failure, type Instance, postJson, useInstance } from '~/lib/instance.ts'
import { createPasskey, PasskeyError, passkeysSupported } from '~/lib/passkey.ts'
import { breadcrumbSchema, pageHead } from '~/seo'

/**
 * First run.
 *
 * `/sign-up` used to be a mock: a form with no action, a fabricated API key
 * printed as if it were yours, and four other pages linking to it as "the setup
 * wizard". This is the real one, and it is the only screen in the product that
 * can create an owner.
 *
 * Three steps, and **two of them are skippable**, which is the point. Setup
 * screens that demand a verified domain before they will let you in are the
 * reason people abandon self-hosted software: the domain needs DNS, DNS needs
 * time, and none of it is required to look at a dashboard. Only step one is
 * mandatory, because an unclaimed instance is one anybody can claim.
 */
export const Route = createFileRoute('/setup')({
  head: () =>
    pageHead({
      title: 'Set up your instance',
      description:
        'Claim your MailySend deployment with a passkey, save your recovery codes, and — when ' +
        'you are ready — add a sending domain and send your first email.',
      path: '/setup',
      image: '/og/sign-up.png',
      jsonLd: [breadcrumbSchema([{ name: 'Set up', path: '/setup' }])],
    }),
  component: SetupPage,
})

const FOOTER_LINKS = [
  { label: 'Docs', href: '/docs' },
  { label: 'Self-hosting', href: '/resources#selfhost' },
  { label: 'Security', href: '/resources#security' },
]

type Step = 'claim' | 'codes' | 'domain' | 'send' | 'done'

interface DnsRecord {
  record: string
  name: string
  value: string
  status: string
  purpose?: string
}

function SetupPage() {
  const state = useInstance()
  const [step, setStep] = useState<Step>('claim')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [codes, setCodes] = useState<string[]>([])

  const instance = state.status === 'ready' ? state.instance : null

  return (
    <AuthLayout
      footerLinks={FOOTER_LINKS}
      formWidth="max-w-[430px]"
      panel={<Panel instance={instance} step={step} />}
    >
      {error ? (
        <p
          role="alert"
          className="mb-5 rounded-md border border-warm-border bg-accent-soft px-3.5 py-3 text-[14.5px] text-warning"
        >
          {error}
        </p>
      ) : null}

      {state.status === 'loading' ? (
        <p className="m-0 text-[15px] text-muted">Checking this instance…</p>
      ) : instance?.claimed && step === 'claim' ? (
        <AlreadyClaimed />
      ) : step === 'claim' ? (
        <ClaimStep
          instance={instance}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onClaimed={(recoveryCodes) => {
            setCodes(recoveryCodes)
            setStep('codes')
          }}
        />
      ) : step === 'codes' ? (
        <RecoveryCodesStep codes={codes} onContinue={() => setStep('domain')} />
      ) : step === 'domain' ? (
        <DomainStep
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onDone={() => setStep('send')}
          onSkip={() => setStep('send')}
        />
      ) : step === 'send' ? (
        <FirstKeyStep
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          onDone={() => setStep('done')}
        />
      ) : (
        <DoneStep />
      )}
    </AuthLayout>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — claim
// ---------------------------------------------------------------------------

function ClaimStep({
  instance,
  busy,
  setBusy,
  setError,
  onClaimed,
}: {
  instance: Instance | null
  busy: boolean
  setBusy: (value: boolean) => void
  setError: (value: string | null) => void
  onClaimed: (codes: string[]) => void
}) {
  const [email, setEmail] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [claimCode, setClaimCode] = useState('')
  const supported = passkeysSupported()
  // False unless the deployment opted in with `MS_REQUIRE_CLAIM_CODE`, absent
  // on an instance that predates the claim code, and false once
  // `MS_OWNER_EMAIL` already narrows the claim — asking for both would be two
  // locks on one door.
  const needsCode = instance?.claim?.code_required ?? false
  const reserved = instance?.claim?.reserved ?? false

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const code = claimCode.trim().toUpperCase()
      const { challenge, response } = await createPasskey('/v1/setup/claim/options', {
        email,
        ...(code ? { claim_code: code } : {}),
      })
      const verify = await postJson('/v1/setup/claim/verify', {
        email,
        challenge,
        response,
        ...(code ? { claim_code: code } : {}),
        ...(workspace ? { workspace_name: workspace } : {}),
      })
      if (!verify.ok) throw new Error(await failure(verify, 'This instance could not be claimed.'))
      const body = (await verify.json()) as { recovery_codes: string[] }
      onClaimed(body.recovery_codes)
    } catch (err) {
      setError(
        err instanceof PasskeyError || err instanceof Error
          ? err.message
          : 'This instance could not be claimed.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col">
      <h1 className="ms-display-2 m-0 mb-2.5">Claim this instance</h1>
      <p className="m-0 mb-7 text-[15.5px] leading-[1.6] text-muted">
        Nobody owns this deployment yet. Create a passkey and it is yours — no password to leak, no
        email to wait for, and nothing for us to hold on your behalf.
      </p>

      {needsCode ? (
        <>
          <Label htmlFor="setup-code" className="mb-[7px]">
            Claim code
          </Label>
          <Input
            id="setup-code"
            name="claim_code"
            required
            autoComplete="off"
            spellCheck={false}
            value={claimCode}
            onChange={(event) => setClaimCode(event.target.value.toUpperCase())}
            placeholder="ABCD-EFGH-JKMN"
            className="mb-1.5 h-[50px] rounded-md font-mono tracking-[0.08em]"
          />
          <p className="m-0 mb-4 text-[13px] leading-[1.6] text-muted-2">
            Printed once in this deployment’s log the first time it booted. On Cloudflare it is in{' '}
            <code className="font-mono text-muted">wrangler tail</code>, or the Worker’s{' '}
            <strong>Logs</strong> tab in the dashboard. It is what stops whoever finds this URL
            first from claiming the instance ahead of you.
          </p>
        </>
      ) : null}

      <Label htmlFor="setup-email" className="mb-[7px]">
        Your email
      </Label>
      <Input
        id="setup-email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@your-domain.dev"
        className="mb-1.5 h-[50px] rounded-md"
      />
      <p className="m-0 mb-4 text-[13px] leading-[1.6] text-muted-2">
        This address becomes the owner of the instance — it labels your account and is where alerts
        are addressed. Nothing is sent to it now; this instance has no verified sending domain yet.
        {reserved ? (
          <>
            {' '}
            <strong className="text-muted">
              This deployment is reserved for one specific address
            </strong>{' '}
            (<code className="font-mono">MS_OWNER_EMAIL</code> is set), so only that one will be
            accepted.
          </>
        ) : null}
      </p>

      <Label htmlFor="setup-workspace" className="mb-[7px]">
        Workspace name <span className="font-normal text-muted-2">· optional</span>
      </Label>
      <Input
        id="setup-workspace"
        name="workspace"
        value={workspace}
        onChange={(event) => setWorkspace(event.target.value)}
        placeholder="Acme"
        className="mb-5 h-[50px] rounded-md"
      />

      <Button
        type="submit"
        disabled={busy || !supported || (needsCode && !claimCode.trim())}
        className="h-[52px] w-full rounded-md text-[15px]"
      >
        {busy ? 'Waiting for your device…' : 'Create a passkey and claim'}
      </Button>

      {supported ? null : (
        <p className="mt-3.5 text-[13.5px] leading-[1.7] text-warning">
          This browser cannot create a passkey. Claim from a browser that can, or run{' '}
          <code className="font-mono">npx mailysend claim</code> against this instance.
        </p>
      )}

      <p className="mt-[26px] border-t border-line pt-[22px] text-[13.5px] leading-[1.7] text-muted-2">
        Prefer the terminal? <code className="font-mono text-muted">npx mailysend claim</code>{' '}
        proves you control the deployment by writing to its own database — and stays available
        afterwards as the way back in if you lose every passkey.{' '}
        <a href="/docs#auth" className={AUTH_LINK}>
          How it works
        </a>
        .
      </p>
    </form>
  )
}

function AlreadyClaimed() {
  return (
    <div className="flex flex-col">
      <h1 className="ms-display-2 m-0 mb-2.5">This instance already has an owner</h1>
      <p className="m-0 mb-7 text-[15.5px] leading-[1.6] text-muted">
        Setup runs once. Sign in with the passkey it was claimed with, or spend one of the recovery
        codes you saved.
      </p>
      <Button asChild className="h-[52px] w-full rounded-md text-[15px]">
        <a href="/sign-in">Go to sign in</a>
      </Button>
      <p className="mt-[26px] border-t border-line pt-[22px] text-[13.5px] leading-[1.7] text-muted-2">
        Lost both? <code className="font-mono text-muted">npx mailysend claim --url …</code>{' '}
        recovers access from a machine that can reach this deployment’s database.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — recovery codes
// ---------------------------------------------------------------------------

/**
 * Shown once, and gated behind typing something.
 *
 * A checkbox saying "I have saved these" is clicked reflexively; typing the
 * word is not. These ten strings are the entire answer to a lost passkey, and
 * the instance cannot show them again — it stores their hashes.
 */
function RecoveryCodesStep({ codes, onContinue }: { codes: string[]; onContinue: () => void }) {
  const [typed, setTyped] = useState('')
  const confirmed = typed.trim().toLowerCase() === 'saved'
  const text = codes.join('\n')

  return (
    <div className="flex flex-col">
      <h1 className="ms-display-2 m-0 mb-2.5">Save your recovery codes</h1>
      <p className="m-0 mb-5 text-[15.5px] leading-[1.6] text-muted">
        Ten codes, each usable once. They are the only way back in if the device holding your
        passkey is lost. This instance stores their hashes, so this screen cannot be shown again.
      </p>

      <AuthPre tone="paper" className="mb-4">
        {codes.map((code) => (
          <div key={code}>{code}</div>
        ))}
      </AuthPre>

      <div className="mb-5 flex gap-2.5">
        <Button
          type="button"
          variant="outline"
          className="h-[42px] flex-1 rounded-md text-[14px]"
          onClick={() => {
            void navigator.clipboard?.writeText(text)
          }}
        >
          Copy
        </Button>
        <Button asChild variant="outline" className="h-[42px] flex-1 rounded-md text-[14px]">
          <a
            href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
            download="mailysend-recovery-codes.txt"
          >
            Download
          </a>
        </Button>
      </div>

      <Label htmlFor="setup-confirm" className="mb-[7px]">
        Type <strong>saved</strong> to continue
      </Label>
      <Input
        id="setup-confirm"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        placeholder="saved"
        className="mb-3.5 h-[50px] rounded-md"
      />
      <Button
        type="button"
        disabled={!confirmed}
        onClick={onContinue}
        className="h-[50px] w-full rounded-md text-[15px]"
      >
        Continue
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — a sending domain (skippable)
// ---------------------------------------------------------------------------

function DomainStep({
  busy,
  setBusy,
  setError,
  onDone,
  onSkip,
}: {
  busy: boolean
  setBusy: (value: boolean) => void
  setError: (value: string | null) => void
  onDone: () => void
  onSkip: () => void
}) {
  const [name, setName] = useState('')
  const [domainId, setDomainId] = useState<string | null>(null)
  const [records, setRecords] = useState<DnsRecord[]>([])
  const [status, setStatus] = useState<string>('not_started')
  const [copied, setCopied] = useState<string | null>(null)

  const add = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await postJson('/v1/domains', { name })
      if (!response.ok) throw new Error(await failure(response, 'That domain could not be added.'))
      const body = (await response.json()) as { id: string; records?: DnsRecord[]; status: string }
      setDomainId(body.id)
      setRecords(body.records ?? [])
      setStatus(body.status)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That domain could not be added.')
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!domainId) return
    setBusy(true)
    setError(null)
    try {
      const response = await postJson(`/v1/domains/${domainId}/verify`)
      if (!response.ok) throw new Error(await failure(response, 'The check did not complete.'))
      const body = (await response.json()) as { status: string; records?: DnsRecord[] }
      setStatus(body.status)
      setRecords(body.records ?? records)
      if (body.status === 'verified') onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The check did not complete.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col">
      <h1 className="ms-display-2 m-0 mb-2.5">Add a sending domain</h1>
      <p className="m-0 mb-7 text-[15.5px] leading-[1.6] text-muted">
        DNS takes as long as it takes. You can skip this and come back — the dashboard works without
        it, and so does everything except actually sending mail.
      </p>

      {domainId ? (
        <>
          <p className="m-0 mb-3.5 text-[14.5px] text-muted">
            Add these records at your DNS provider, then check again.
          </p>
          <div className="mb-4 flex flex-col gap-2">
            {records.map((record) => {
              const managed = (record as DnsRecord & { origin?: string }).origin === 'observe'
              return (
                <div
                  key={`${record.record}-${record.name}-${record.value}`}
                  className="rounded-code border border-line bg-paper p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted-2">
                      {record.record} · {record.name}
                    </span>
                    {managed ? (
                      <span className="font-mono text-[11px] text-muted-2">published for you</span>
                    ) : (
                      <button
                        type="button"
                        className="font-mono text-[11px] text-accent"
                        onClick={() => {
                          void navigator.clipboard.writeText(record.value)
                          setCopied(`${record.record}:${record.name}`)
                        }}
                      >
                        {copied === `${record.record}:${record.name}` ? 'copied' : 'copy value'}
                      </button>
                    )}
                  </div>
                  {/*
                    The whole value, wrapped. It used to be cut at 48 characters
                    with no copy button beside it, which for a 2048-bit DKIM key
                    meant the one record that matters most could not be copied
                    at all — not from here, and not from anywhere.
                  */}
                  <code className="mt-1.5 block break-all font-mono text-[12px] leading-[1.5] text-ink">
                    {record.value}
                  </code>
                </div>
              )
            })}
          </div>
          <Button
            type="button"
            onClick={verify}
            disabled={busy}
            className="mb-3 h-[50px] w-full rounded-md text-[15px]"
          >
            {busy ? 'Checking DNS…' : 'Check DNS now'}
          </Button>
          <p className="m-0 mb-5 text-[13.5px] text-muted-2">Current status: {status}</p>
        </>
      ) : (
        <form onSubmit={add} className="flex flex-col">
          <Label htmlFor="setup-domain" className="mb-[7px]">
            Domain
          </Label>
          <Input
            id="setup-domain"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="mail.your-domain.dev"
            className="mb-3.5 h-[50px] rounded-md"
          />
          <Button
            type="submit"
            disabled={busy || !name}
            className="h-[50px] w-full rounded-md text-[15px]"
          >
            {busy ? 'Adding…' : 'Add domain'}
          </Button>
        </form>
      )}

      <button
        type="button"
        onClick={onSkip}
        className="mt-4 cursor-pointer self-start border-none bg-transparent text-[14px] text-muted underline-offset-4 hover:text-ink hover:underline"
      >
        Skip for now
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4 — first API key (skippable)
// ---------------------------------------------------------------------------

function FirstKeyStep({
  busy,
  setBusy,
  setError,
  onDone,
}: {
  busy: boolean
  setBusy: (value: boolean) => void
  setError: (value: string | null) => void
  onDone: () => void
}) {
  const [key, setKey] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await postJson('/v1/api-keys', { name: 'First key' })
      if (!response.ok) throw new Error(await failure(response, 'The key could not be created.'))
      const body = (await response.json()) as { token?: string }
      setKey(body.token ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The key could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col">
      <h1 className="ms-display-2 m-0 mb-2.5">Your first API key</h1>
      <p className="m-0 mb-7 text-[15.5px] leading-[1.6] text-muted">
        A real key, shown once. You can always make another from the dashboard, and revoke this one
        the moment you suspect it.
      </p>

      {key ? (
        <>
          <AuthPre tone="paper" className="mb-4">
            {key}
          </AuthPre>
          <Button
            type="button"
            variant="outline"
            className="mb-4 h-[42px] w-full rounded-md text-[14px]"
            onClick={() => {
              void navigator.clipboard?.writeText(key)
            }}
          >
            Copy
          </Button>
        </>
      ) : (
        <Button
          type="button"
          onClick={create}
          disabled={busy}
          className="mb-4 h-[50px] w-full rounded-md text-[15px]"
        >
          {busy ? 'Creating…' : 'Create a key'}
        </Button>
      )}

      <Button
        asChild
        variant={key ? 'primary' : 'outline'}
        className="h-[50px] w-full rounded-md text-[15px]"
      >
        <a href="/app" onClick={onDone}>
          Open the dashboard
        </a>
      </Button>
    </div>
  )
}

function DoneStep() {
  return (
    <div className="flex flex-col">
      <h1 className="ms-display-2 m-0 mb-2.5">You’re set up</h1>
      <p className="m-0 mb-7 text-[15.5px] leading-[1.6] text-muted">
        Everything else lives in the dashboard.
      </p>
      <Button asChild className="h-[52px] w-full rounded-md text-[15px]">
        <a href="/app">Open the dashboard</a>
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The dark panel — real values only
// ---------------------------------------------------------------------------

const STEP_LABELS: Record<Step, string> = {
  claim: 'Claim the instance',
  codes: 'Save recovery codes',
  domain: 'Add a sending domain',
  send: 'Create a key',
  done: 'Done',
}

function Panel({ instance, step }: { instance: Instance | null; step: Step }) {
  const host = instance ? new URL(instance.public_url).host : '…'
  return (
    <>
      <p className="ms-eyebrow m-0 text-accent-on-dark">THIS DEPLOYMENT</p>
      <AuthPre>
        <div>
          {'HOST '}
          <span className="text-code-green">{host}</span>
        </div>
        <div>
          {'AUTH '}
          <span className="text-code-green">passkey</span>
          {instance?.auth.access ? ' · cloudflare access' : ''}
          {instance?.auth.otp ? ' · email code' : ''}
        </div>
        <div>
          {'SEND '}
          <span className="text-code-green">
            {instance ? `${instance.sending.verified_domains} verified domain(s)` : '…'}
          </span>
        </div>
        <div>
          {'STEP '}
          <span className="text-code-green">{STEP_LABELS[step]}</span>
        </div>
      </AuthPre>
      <ul className="m-0 flex list-none flex-col gap-3.5 p-0 text-[15px] leading-[1.65] text-on-dark-3">
        <li className="flex gap-[11px]">
          <span aria-hidden="true" className="font-bold text-accent-on-dark">
            ·
          </span>
          Your data never leaves this deployment. There is no MailySend account.
        </li>
        <li className="flex gap-[11px]">
          <span aria-hidden="true" className="font-bold text-accent-on-dark">
            ·
          </span>
          Only the first two steps are permanent — a domain and a key can wait.
        </li>
        <li className="flex gap-[11px]">
          <span aria-hidden="true" className="font-bold text-accent-on-dark">
            ·
          </span>
          <span>
            Locked out later?{' '}
            <a href="/docs#auth" className={AUTH_LINK_STRONG}>
              npx mailysend claim
            </a>{' '}
            is the way back in.
          </span>
        </li>
      </ul>
      {instance ? (
        <p className="m-0 inline-flex items-center gap-2.5 self-start rounded-pill border border-dark-line px-3.5 py-2 text-[13px] text-on-dark-2">
          <StatusDot tone="positive" size={7} pulse className="bg-positive-bright" />
          {instance.mode === 'single' ? 'Self-hosted' : 'Hosted'} · v{instance.version}
        </p>
      ) : null}
    </>
  )
}
