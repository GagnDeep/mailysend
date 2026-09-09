import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ApiClient } from '../api.ts'
import type { FlagSpecs } from '../args.ts'
import { CliError, type CommandContext } from '../command.ts'
import { readState, resolveCredentials, writeState } from '../config.ts'
import { kv, note, ok, out, Progress, style, table } from '../term.ts'

// ---------------------------------------------------------------------------
// traffic
// ---------------------------------------------------------------------------

export const trafficFlags: FlagSpecs = {
  set: { kind: 'list', describe: 'Weights as provider=percent, e.g. ses=80,resend=20' },
  pause: { kind: 'string', describe: 'Disable one provider' },
  resume: { kind: 'string', describe: 'Re-enable one provider' },
  json: { kind: 'boolean', describe: 'Print the routing table as JSON' },
}

interface ProviderConfig {
  provider: string
  priority: number
  weight: number
  enabled: boolean
}

/**
 * Weights are sent as a complete table rather than as a delta, because a
 * partial update is ambiguous the moment two people run this at once: "set ses
 * to 80" has no answer unless you also say what the rest became.
 */
export const traffic = async (ctx: CommandContext) => {
  const client = new ApiClient(await resolveCredentials(ctx.global))
  const current = await client.get<{ data: ProviderConfig[] }>('/settings/providers')
  const entries = new Map(current.data.map((entry) => [entry.provider, { ...entry }]))

  const assignments = ctx.args.flags.set as string[]
  const pause = ctx.args.flags.pause as string | undefined
  const resume = ctx.args.flags.resume as string | undefined

  if (assignments.length > 0 || pause || resume) {
    for (const assignment of assignments) {
      const [provider, raw] = assignment.split('=')
      const weight = Number(raw)
      if (!provider || !Number.isFinite(weight) || weight < 0) {
        throw new CliError(`--set expects provider=percent, got "${assignment}"`)
      }
      const entry = entries.get(provider)
      if (!entry) throw new CliError(`No provider named ${provider} is configured.`)
      entry.weight = weight
      entry.enabled = weight > 0
    }
    for (const [name, enabled] of [
      [pause, false],
      [resume, true],
    ] as [string | undefined, boolean][]) {
      if (!name) continue
      const entry = entries.get(name)
      if (!entry) throw new CliError(`No provider named ${name} is configured.`)
      entry.enabled = enabled
    }

    const total = [...entries.values()]
      .filter((e) => e.enabled)
      .reduce((sum, e) => sum + e.weight, 0)
    if (total === 0) throw new CliError('That would disable every provider — mail would stop.')

    await client.patch('/settings/providers', { providers: [...entries.values()] })
  }

  const table_ = [...entries.values()].sort((a, b) => a.priority - b.priority)
  if (ctx.args.flags.json === true) {
    out(JSON.stringify(table_, null, 2))
    return
  }

  const active = table_.filter((entry) => entry.enabled)
  const total = active.reduce((sum, entry) => sum + entry.weight, 0) || 1

  out()
  table(
    [
      { header: 'provider' },
      { header: 'priority', align: 'right' },
      { header: 'share', align: 'right' },
      { header: 'state' },
    ],
    table_.map((entry) => [
      entry.provider,
      String(entry.priority),
      entry.enabled ? `${Math.round((entry.weight / total) * 100)}%` : style.dim('—'),
      entry.enabled ? style.green('sending') : style.dim('paused'),
    ]),
  )
  out()
  note('Selection is hash(email_id) % weight, so a retry always reaches the same provider.')
}

// ---------------------------------------------------------------------------
// rollback
// ---------------------------------------------------------------------------

export const rollbackFlags: FlagSpecs = {
  to: { kind: 'number', describe: 'Version to roll back to (default: previous)' },
  yes: { kind: 'boolean', short: 'y', describe: 'Skip the confirmation' },
}

export const rollback = async (ctx: CommandContext) => {
  const target = ctx.args.positionals[1]
  if (!target) {
    throw new CliError('What should be rolled back?', {
      hint: 'mailysend rollback <template-id-or-slug> [--to 3]',
    })
  }

  const client = new ApiClient(await resolveCredentials(ctx.global))
  const id = target.startsWith('tpl_')
    ? target
    : (await client.get<{ data: { id: string; slug: string }[] }>('/templates')).data.find(
        (t) => t.slug === target,
      )?.id

  if (!id) throw new CliError(`No template with id or slug "${target}".`)

  const versions = await client.get<{ data: { version: number; created_at: string }[] }>(
    `/templates/${id}/versions`,
  )
  const ordered = versions.data.sort((a, b) => b.version - a.version)
  const to = (ctx.args.flags.to as number | undefined) ?? ordered[1]?.version

  if (to === undefined) throw new CliError('There is no earlier version to roll back to.')

  const result = await client.post<{ version: number }>(`/templates/${id}/rollback`, {
    version: to,
  })
  ok(`${target} is now serving v${result.version}.`)
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

export const exportFlags: FlagSpecs = {
  resource: {
    kind: 'string',
    describe: 'contacts | logs | events | suppressions',
    default: 'contacts',
  },
  from: { kind: 'string', describe: 'Start of the window' },
  to: { kind: 'string', describe: 'End of the window' },
  format: { kind: 'string', describe: 'csv | ndjson', default: 'csv' },
  output: { kind: 'string', short: 'o', describe: 'Where to write the file' },
  audience: { kind: 'string', describe: 'Audience id, for contact exports' },
}

export const exportData = async (ctx: CommandContext) => {
  const client = new ApiClient(await resolveCredentials(ctx.global))
  const resource = String(ctx.args.flags.resource)

  const job = await client.post<{ id: string; status: string }>('/exports', {
    resource,
    format: ctx.args.flags.format,
    ...(ctx.args.flags.from === undefined ? {} : { from: ctx.args.flags.from }),
    ...(ctx.args.flags.to === undefined ? {} : { to: ctx.args.flags.to }),
    ...(ctx.args.flags.audience === undefined ? {} : { audience_id: ctx.args.flags.audience }),
  })

  const progress = new Progress(`Preparing ${resource} export`)
  let status = job.status
  let url: string | undefined

  // An export is built asynchronously because it can be very large; polling is
  // the honest interface for "we do not know how long this takes".
  while (status === 'pending' || status === 'running') {
    await new Promise((r) => setTimeout(r, 2000))
    const state = await client.get<{ status: string; url?: string; rows?: number }>(
      `/exports/${job.id}`,
    )
    status = state.status
    url = state.url
    if (state.rows !== undefined)
      progress.update(`Preparing ${resource} export — ${state.rows} rows`)
  }
  progress.stop()

  if (status !== 'complete' || !url) throw new CliError(`Export ${job.id} finished as "${status}".`)

  const destination = resolve(
    (ctx.args.flags.output as string | undefined) ??
      `${resource}-${new Date().toISOString().slice(0, 10)}.${ctx.args.flags.format}`,
  )
  await mkdir(dirname(destination), { recursive: true })

  const response = await fetch(url)
  if (!response.ok || !response.body)
    throw new CliError(`Could not download the export (${response.status}).`)
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destination))

  ok(`Wrote ${style.cyan(destination)}`)
}

// ---------------------------------------------------------------------------
// alerts add
// ---------------------------------------------------------------------------

export const alertsFlags: FlagSpecs = {
  metric: { kind: 'string', describe: 'bounce_rate | complaint_rate | delivery_rate | volume' },
  above: { kind: 'number', describe: 'Fire when the metric goes above this' },
  below: { kind: 'number', describe: 'Fire when the metric goes below this' },
  window: { kind: 'string', describe: 'Evaluation window', default: '1h' },
  domain: { kind: 'string', describe: 'Limit to one sending domain' },
  channel: { kind: 'string', describe: 'email | webhook | slack', default: 'email' },
  target: { kind: 'string', describe: 'Address or URL to notify' },
}

export const alertsAdd = async (ctx: CommandContext) => {
  const metric = ctx.args.flags.metric as string | undefined
  const above = ctx.args.flags.above as number | undefined
  const below = ctx.args.flags.below as number | undefined
  const target = ctx.args.flags.target as string | undefined

  if (!metric) throw new CliError('Which metric? --metric bounce_rate')
  if (above === undefined && below === undefined) {
    throw new CliError('An alert needs a threshold: --above 0.05 or --below 0.9')
  }
  if (!target) throw new CliError('Where should it go? --target ops@acme.com')

  const client = new ApiClient(await resolveCredentials(ctx.global))
  const alert = await client.post<{ id: string }>('/alerts', {
    metric,
    ...(above === undefined ? {} : { above }),
    ...(below === undefined ? {} : { below }),
    window: ctx.args.flags.window,
    channel: ctx.args.flags.channel,
    target,
    ...(ctx.args.flags.domain === undefined ? {} : { domain_id: ctx.args.flags.domain }),
  })

  out()
  kv([
    ['alert', style.cyan(alert.id)],
    ['metric', metric],
    ['threshold', above === undefined ? `below ${below}` : `above ${above}`],
    ['window', String(ctx.args.flags.window)],
    ['notify', `${ctx.args.flags.channel} → ${target}`],
  ])
  out()
  ok('Alert created.')
}

// ---------------------------------------------------------------------------
// upgrade
// ---------------------------------------------------------------------------

export const upgradeFlags: FlagSpecs = {
  check: { kind: 'boolean', describe: 'Only report, never suggest installing' },
}

interface VersionCache {
  latest: string
  checkedAt: number
}

/**
 * The CLI reports and instructs; it never installs itself. A tool that
 * overwrites its own binary has to guess the package manager, the permissions
 * and whether it is inside a lockfile-managed project — and it guesses wrong
 * on exactly the machines where being wrong is expensive.
 */
export const upgrade = async (ctx: CommandContext, currentVersion: string) => {
  const cached = await readState<VersionCache>('version-check')
  const fresh = cached && Date.now() - cached.checkedAt < 3_600_000

  let latest = cached?.latest
  if (!fresh) {
    const response = await fetch('https://registry.npmjs.org/@mailysend/cli/latest')
    if (!response.ok) throw new CliError(`The npm registry returned ${response.status}.`)
    latest = ((await response.json()) as { version: string }).version
    await writeState('version-check', { latest, checkedAt: Date.now() })
  }

  out()
  kv([
    ['installed', currentVersion],
    [
      'latest',
      latest === currentVersion ? style.green(String(latest)) : style.yellow(String(latest)),
    ],
  ])
  out()

  if (latest === currentVersion) {
    ok('Up to date.')
    return
  }
  if (ctx.args.flags.check === true) return
  note('To upgrade:')
  out(`  ${style.cyan('npm i -g @mailysend/cli@latest')}`)
}
