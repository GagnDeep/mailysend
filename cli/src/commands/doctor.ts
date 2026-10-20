import { ApiCallError, ApiClient } from '../api.ts'
import type { FlagSpecs } from '../args.ts'
import { CliError, type CommandContext } from '../command.ts'
import { resolveCredentials } from '../config.ts'
import { note, out, relativeTime, style, table } from '../term.ts'

/**
 * `mailysend doctor` — why mail is not leaving this deployment.
 *
 * Everything it reports was already readable through the API and through five
 * different dashboard screens, which is the problem: the first hour with a new
 * instance is spent discovering *which* screen holds the reason, and the answer
 * is usually one of four things. A transport with no credentials. A domain
 * whose DKIM does not resolve. An unclaimed instance sitting on a public URL.
 * A queue with a head that has not moved. This asks all of them at once and
 * prints what it found.
 *
 * Three states, never two: `ok`, `warn` for something that will bite later, and
 * `fail` for something that stops mail now. A check whose question could not be
 * asked reports `unknown` and says why — the one thing this must never do is
 * report a green line because a request failed, since that is precisely the
 * reassurance somebody runs this command to disbelieve.
 */

export const doctorFlags: FlagSpecs = {
  json: { kind: 'boolean', describe: 'Print the findings as JSON' },
}

export type Level = 'ok' | 'warn' | 'fail' | 'unknown'

export interface Finding {
  check: string
  level: Level
  detail: string
  /** What to do about it, where there is something to do. */
  fix?: string
}

/** What the API answered, or `null` where it would not answer. */
export interface Facts {
  health: { status?: string; version?: string; database?: string; mode?: string } | null
  instance: { claimed?: boolean; mode?: string; public_url?: string | null } | null
  providers: {
    data?: { provider: string; enabled: boolean }[]
    default_provider?: string | null
  } | null
  domains: {
    data?: {
      name: string
      status: string
      dkim_ready?: boolean
      spf_ready?: boolean
    }[]
  } | null
  queue: {
    queued?: number
    sending?: number
    scheduled?: number
    oldest_waiting_at?: string | null
  } | null
  /** Why a fact is missing, keyed by the fact it is missing for. */
  unreachable: Partial<Record<keyof Omit<Facts, 'unreachable'>, string>>
}

/** Anything accepted more than this long ago and still not sent is not "busy". */
const STUCK_AFTER_MS = 10 * 60_000

/**
 * The findings, from the facts. Pure, because this is the part worth testing:
 * the shape of each answer matters more than the fetching of it.
 */
export function evaluate(facts: Facts, now: number = Date.now()): Finding[] {
  const findings: Finding[] = []
  const unknown = (check: string, key: keyof Facts['unreachable']): Finding => ({
    check,
    level: 'unknown',
    detail: facts.unreachable[key] ?? 'The deployment did not answer.',
  })

  // --- is it there at all --------------------------------------------------
  if (!facts.health) {
    findings.push(unknown('reachable', 'health'))
  } else if (facts.health.database && facts.health.database !== 'ok') {
    findings.push({
      check: 'database',
      level: 'fail',
      detail: facts.health.database,
      fix: 'The D1 binding is wrong or the database is gone. Check `d1_databases` in the deployed wrangler config.',
    })
  } else {
    findings.push({
      check: 'reachable',
      level: 'ok',
      detail: `${facts.health.status ?? 'operational'} · ${facts.health.mode ?? 'unknown mode'} · ${facts.health.version ?? 'unknown version'}`,
    })
  }

  // --- does anybody own it -------------------------------------------------
  if (!facts.instance) {
    findings.push(unknown('ownership', 'instance'))
  } else if (facts.instance.claimed === false) {
    findings.push({
      check: 'ownership',
      level: 'fail',
      detail: 'Nobody has claimed this instance, so the first person to reach /setup takes it.',
      fix: `Open ${facts.instance.public_url ?? 'the deployment'}/setup and create a passkey now.`,
    })
  } else {
    findings.push({ check: 'ownership', level: 'ok', detail: 'Claimed.' })
  }

  // --- can it hand mail to anything ---------------------------------------
  if (!facts.providers) {
    findings.push(unknown('transport', 'providers'))
  } else {
    const enabled = (facts.providers.data ?? []).filter((entry) => entry.enabled)
    // `default_provider` is what a send would leave through with nothing
    // configured — on Cloudflare that is a real transport, so "no stored
    // credentials" is not the same statement as "cannot send".
    const fallback = facts.providers.default_provider
    if (enabled.length > 0) {
      findings.push({
        check: 'transport',
        level: 'ok',
        detail: enabled.map((entry) => entry.provider).join(', '),
      })
    } else if (fallback) {
      findings.push({
        check: 'transport',
        level: 'ok',
        detail: `${fallback} (the runtime's own, with nothing configured)`,
      })
    } else {
      findings.push({
        check: 'transport',
        level: 'fail',
        detail: 'No transport is enabled and the runtime has none of its own.',
        fix: 'Settings → Transports, or `mailysend traffic --set ses=100` once credentials are stored.',
      })
    }
  }

  // --- can it send as anybody ---------------------------------------------
  if (!facts.domains) {
    findings.push(unknown('sending domain', 'domains'))
  } else {
    const domains = facts.domains.data ?? []
    const verified = domains.filter((domain) => domain.status === 'verified')
    const halfReady = verified.filter(
      (domain) => domain.dkim_ready === false || domain.spf_ready === false,
    )

    if (domains.length === 0) {
      findings.push({
        check: 'sending domain',
        level: 'fail',
        detail: 'No domains added.',
        fix: '`mailysend domains verify acme.dev` after adding it in the dashboard.',
      })
    } else if (verified.length === 0) {
      findings.push({
        check: 'sending domain',
        level: 'fail',
        detail: `${domains.length} added, none verified: ${domains.map((d) => `${d.name} (${d.status})`).join(', ')}`,
        fix: '`mailysend domains verify <name>` prints which records do not resolve.',
      })
    } else if (halfReady.length > 0) {
      // Verified is a column; DKIM and SPF resolving is the thing receivers
      // actually check, and the two have come apart before.
      findings.push({
        check: 'sending domain',
        level: 'warn',
        detail: `${halfReady.map((d) => d.name).join(', ')} verified, but DKIM or SPF does not resolve.`,
        fix: 'Mail from this domain is unsigned or unaligned. `mailysend domains verify <name>` says which record.',
      })
    } else {
      findings.push({
        check: 'sending domain',
        level: 'ok',
        detail: verified.map((domain) => domain.name).join(', '),
      })
    }
  }

  // --- is anything stuck ---------------------------------------------------
  if (!facts.queue) {
    findings.push(unknown('queue', 'queue'))
  } else {
    const waiting = (facts.queue.queued ?? 0) + (facts.queue.sending ?? 0)
    const oldest = facts.queue.oldest_waiting_at
    const stuck = oldest ? now - Date.parse(oldest) > STUCK_AFTER_MS : false
    findings.push(
      stuck
        ? {
            check: 'queue',
            level: 'fail',
            detail: `${waiting} waiting, the oldest accepted ${relativeTime(oldest as string)} ago and still not sent.`,
            fix: '`mailysend tail --status failed` shows what the transport is saying about them.',
          }
        : {
            check: 'queue',
            level: 'ok',
            detail:
              waiting === 0
                ? 'Nothing waiting.'
                : `${waiting} waiting, moving. ${facts.queue.scheduled ?? 0} scheduled.`,
          },
    )
  }

  return findings
}

const PAINT: Record<Level, (text: string) => string> = {
  ok: style.green,
  warn: style.yellow,
  fail: style.red,
  unknown: style.gray,
}

export const doctor = async (ctx: CommandContext) => {
  const client = new ApiClient(await resolveCredentials(ctx.global))

  const unreachable: Facts['unreachable'] = {}
  /** One failed check never stops the others: the whole point is the full picture. */
  const ask = async <T>(
    key: keyof Facts['unreachable'],
    read: () => Promise<T>,
  ): Promise<T | null> => {
    try {
      return await read()
    } catch (error) {
      unreachable[key] =
        error instanceof ApiCallError
          ? `${error.message} (${error.status})`
          : error instanceof Error
            ? error.message
            : 'The request failed.'
      return null
    }
  }

  const [health, instance, providers, domains, dashboard] = await Promise.all([
    ask('health', () => client.get<NonNullable<Facts['health']>>('/health')),
    ask('instance', () => client.get<NonNullable<Facts['instance']>>('/instance')),
    ask('providers', () => client.get<NonNullable<Facts['providers']>>('/providers')),
    ask('domains', () => client.get<NonNullable<Facts['domains']>>('/domains')),
    ask('queue', () => client.get<{ queue?: Facts['queue'] }>('/analytics/dashboard')),
  ])

  const facts: Facts = {
    health,
    instance,
    providers,
    domains,
    // The queue block is part of the dashboard read; an older deployment does
    // not carry it, and that is "could not ask" rather than "nothing waiting".
    queue: dashboard?.queue ?? null,
    unreachable:
      dashboard && !dashboard.queue
        ? {
            ...unreachable,
            queue:
              'This deployment is older than the queue reading — upgrade it to see the backlog.',
          }
        : unreachable,
  }

  const findings = evaluate(facts)

  if (ctx.args.flags.json) {
    out(JSON.stringify({ base_url: client.baseUrl, findings }, null, 2))
  } else {
    out()
    table(
      [{ header: '' }, { header: 'check' }, { header: 'detail' }],
      findings.map((finding) => [
        PAINT[finding.level](finding.level),
        finding.check,
        finding.detail,
      ]),
    )
    out()
    for (const finding of findings) {
      if (finding.fix) note(`${finding.check}: ${finding.fix}`)
    }
  }

  // Non-zero when something stops mail, so this is usable as a smoke test after
  // a deploy. A `warn` is not a failure: it is a thing to fix before volume.
  if (findings.some((finding) => finding.level === 'fail')) {
    throw new CliError('This deployment cannot send mail yet.', {
      hint: 'Each line above says what to do. Re-run `mailysend doctor` after.',
    })
  }
}
