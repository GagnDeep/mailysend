import type { Status } from '@mailysend/ui'
import type { DomainRecord } from '~/lib/api-client.ts'
import { transportLabel } from './transports.ts'

/**
 * What a domain can do, as two answers rather than seven panels.
 *
 * The domain page used to render Sending transport, DNS records, Receiving,
 * Deliverability, Daily quota, Settings and Danger zone as co-equal sections,
 * so the two questions a reader actually has — *can I send from this domain
 * yet, and can I receive on it* — were answered nowhere, and the two signals
 * that contradicted each other (Cloudflare publishes these records / DKIM is
 * failing) sat in different sections with nothing relating them.
 *
 * The derivation lives here, in a plain `.ts` module with no JSX, for a
 * practical reason: `apps/app/test` runs in `environment: 'node'` and collects
 * only `.test.ts`, so a React render test is impossible in this repo. Keeping
 * the branching — the part worth testing — out of the component is what makes
 * it testable at all.
 *
 * **There is no `receiving.ready`, and there must never be one.** Cloudflare's
 * Email Routing catch-all rule is not readable over its API, so the server can
 * prove the MX points at Email Routing and that a mailbox exists, and cannot
 * prove that mail arrives. `deriveReceiving` therefore never returns
 * `badge: 'verified'` — the best it says is that everything observable is in
 * place and one step remains that only the operator can confirm. A test holds
 * that over the whole cross-product of inputs.
 */

/** One step in a track: what is true, what to do, and who does it. */
export interface Step {
  key: string
  title: string
  /** `done` is an observation, `blocked` is an observation too — not a guess. */
  state: 'done' | 'current' | 'blocked' | 'waiting' | 'unknowable'
  detail: string
}

export interface Track {
  /** Drawn with `StatusBadge`, so it must be a member of its `Status` union. */
  badge: Status
  headline: string
  /** The single next action, in the imperative, or null when there is none. */
  action: string | null
  /** Who performs it — this app, the transport's dashboard, or the DNS zone. */
  actor: 'you-here' | 'cloudflare' | 'your-dns' | 'nobody'
  steps: Step[]
}

export const SENDING_STEPS = ['bound', 'published', 'resolving', 'aligned'] as const
export const RECEIVING_STEPS = ['mx', 'route', 'mailbox', 'arrived'] as const

/** Three states, not two: null and undefined both mean nobody has looked. */
export const dmarcState = (domain: DomainRecord): boolean | undefined => {
  if (domain.dmarc_policy === undefined || domain.dmarc_policy === null) return undefined
  return domain.dmarc_policy !== 'missing'
}

/** Every record here is one the transport publishes itself, so copying is not the job. */
export const isManaged = (domain: DomainRecord): boolean => {
  const records = domain.records ?? []
  return records.length > 0 && records.every((record) => record.origin === 'observe')
}

/**
 * Can this domain send?
 *
 * Branches S-A…S-G, in the order a domain actually moves through them. The
 * order matters more than the wording: whichever branch fires first is the one
 * thing the reader is asked to do, and everything below it is evidence.
 */
export function deriveSending(domain: DomainRecord): Track {
  const managed = isManaged(domain)
  const records = domain.records ?? []
  const checked = domain.checked
  const transport = transportLabel(domain.provider)
  const bound = Boolean(domain.provider)

  const step = (key: string, title: string, state: Step['state'], detail: string): Step => ({
    key,
    title,
    state,
    detail,
  })

  // S-A — nothing to publish yet. A record set of zero is not a domain that
  // failed a check; it is a domain nobody has computed records for.
  if (records.length === 0) {
    return {
      badge: 'not_started',
      headline: 'This domain has no records yet',
      action: 'Set up with this transport',
      actor: 'you-here',
      steps: [
        step(
          'bound',
          'Transport chosen',
          bound ? 'done' : 'current',
          `Sends through ${transport}.`,
        ),
        step('published', 'Records computed', 'current', 'No record set exists for this domain.'),
        step('resolving', 'Records resolve', 'waiting', 'Nothing to resolve yet.'),
        step('aligned', 'DKIM and SPF pass', 'waiting', 'Nothing to check yet.'),
      ],
    }
  }

  const never = (checked?.resolved ?? 0) + (checked?.errored ?? 0) === 0

  // S-B — the resolver, not the zone. Reporting this as "records outstanding"
  // sends people to re-check a zone that was already correct.
  if (checked && checked.errored > 0 && checked.resolved === 0) {
    return {
      badge: 'error',
      headline: 'None of these records could be looked up',
      action: 'Check records again',
      actor: 'you-here',
      steps: [
        step('bound', 'Transport chosen', 'done', `Sends through ${transport}.`),
        step('published', 'Records computed', 'done', `${records.length} records for this domain.`),
        step(
          'resolving',
          'Records resolve',
          'blocked',
          checked.first_error ??
            'The DNS resolver did not answer. Nothing here says your zone is wrong.',
        ),
        step('aligned', 'DKIM and SPF pass', 'waiting', 'Unknown until the lookups complete.'),
      ],
    }
  }

  // S-C — never checked. A hollow state, not a failing one.
  if (never) {
    return {
      badge: 'not_started',
      headline: managed
        ? `${transport} has not published these records yet`
        : 'These records have not been checked yet',
      action: managed ? 'Finish the setup with the transport, then check' : 'Check records',
      actor: managed ? 'cloudflare' : 'your-dns',
      steps: [
        step('bound', 'Transport chosen', 'done', `Sends through ${transport}.`),
        step('published', 'Records computed', 'done', `${records.length} records for this domain.`),
        step(
          'resolving',
          'Records resolve',
          'current',
          managed
            ? `${transport} writes these itself. Onboard the domain there, then check.`
            : 'Add them to your DNS zone, then check. Propagation is usually minutes.',
        ),
        step('aligned', 'DKIM and SPF pass', 'waiting', 'Unknown until the lookups complete.'),
      ],
    }
  }

  const outstanding = records.filter((record) => record.status !== 'verified').length

  // S-D — the working case, said once.
  if (domain.sending_ready ?? (domain.status === 'verified' && domain.dkim_ready)) {
    const dmarc = dmarcState(domain)
    return {
      badge: 'verified',
      headline: `Ready to send through ${transport}`,
      action: dmarc === false ? 'Add a DMARC record at p=none' : null,
      actor: dmarc === false ? 'your-dns' : 'nobody',
      steps: [
        step('bound', 'Transport chosen', 'done', `Sends through ${transport}.`),
        step('published', 'Records computed', 'done', `${records.length} records for this domain.`),
        step('resolving', 'Records resolve', 'done', 'Every record resolves.'),
        step(
          'aligned',
          'DKIM and SPF pass',
          'done',
          dmarc === false
            ? 'Signed and authorised. DMARC is still missing — worth adding, not urgent.'
            : 'Signed and authorised.',
        ),
      ],
    }
  }

  // S-E — verified as a roll-up, but the signature does not actually resolve.
  // `rollUpStatus` can read `verified` for a record set that predates a rebind.
  if (domain.status === 'verified' && domain.dkim_ready === false) {
    return {
      badge: 'pending',
      headline: 'The records resolve, but nothing is signing this domain',
      action: 'Re-check the DKIM record',
      actor: managed ? 'cloudflare' : 'your-dns',
      steps: [
        step('bound', 'Transport chosen', 'done', `Sends through ${transport}.`),
        step('published', 'Records computed', 'done', `${records.length} records for this domain.`),
        step('resolving', 'Records resolve', 'done', 'Every record resolves.'),
        step(
          'aligned',
          'DKIM and SPF pass',
          'blocked',
          'The DKIM key does not resolve at the selector we publish. Receivers cannot tell this mail from a forgery.',
        ),
      ],
    }
  }

  // S-F — a record was looked for and was not there.
  if (domain.status === 'failed') {
    return {
      badge: 'failed',
      headline: `${outstanding} of ${records.length} records are not there yet`,
      action: managed ? 'Finish the setup with the transport' : 'Publish the outstanding records',
      actor: managed ? 'cloudflare' : 'your-dns',
      steps: [
        step('bound', 'Transport chosen', 'done', `Sends through ${transport}.`),
        step('published', 'Records computed', 'done', `${records.length} records for this domain.`),
        step(
          'resolving',
          'Records resolve',
          'blocked',
          managed
            ? `We resolved the zone and ${outstanding} of ${transport}'s records were not published. That setup finishes on the transport's side.`
            : `${outstanding} records are missing or hold a different value. The table below shows what resolved.`,
        ),
        step('aligned', 'DKIM and SPF pass', 'waiting', 'Blocked on the records above.'),
      ],
    }
  }

  // S-G — partway. Everything else lands here, including a partial check.
  return {
    badge: 'pending',
    headline: `${records.length - outstanding} of ${records.length} records resolve`,
    action: managed ? 'Finish the setup with the transport, then check' : 'Check records',
    actor: managed ? 'cloudflare' : 'your-dns',
    steps: [
      step('bound', 'Transport chosen', 'done', `Sends through ${transport}.`),
      step('published', 'Records computed', 'done', `${records.length} records for this domain.`),
      step(
        'resolving',
        'Records resolve',
        'current',
        checked && checked.errored > 0
          ? `${checked.errored} of ${checked.total} could not be looked up at all — that is the resolver, not your zone.`
          : 'Some records have not reached our resolver yet. This re-checks itself, more slowly each time.',
      ),
      step('aligned', 'DKIM and SPF pass', 'waiting', 'Unknown until every record resolves.'),
    ],
  }
}

/**
 * Can this domain receive?
 *
 * Branches R-A…R-F. The last step is `unknowable` in every branch, by
 * construction — see the module comment. The best badge this returns is
 * `pending`.
 */
export function deriveReceiving(domain: DomainRecord): Track {
  const receiving = domain.receiving
  const mailboxes = receiving?.mailboxes.count ?? 0
  const catchAll = receiving?.mailboxes.catch_all ?? null
  const arrived = receiving?.last_inbound_at ?? null

  const step = (key: string, title: string, state: Step['state'], detail: string): Step => ({
    key,
    title,
    state,
    detail,
  })

  const routeStep = step(
    'route',
    'Email Routing sends it to this Worker',
    'unknowable',
    "Cloudflare's catch-all rule is not readable over its API, so this is the one step nobody here can confirm. Open Email Routing and check that the catch-all action is Send to a Worker, pointed at this instance.",
  )

  const mailboxStep = step(
    'mailbox',
    'An address exists here to land in',
    mailboxes === 0 ? 'current' : 'done',
    mailboxes === 0
      ? 'No mailbox on this domain, so every address is answered with a 550 — which is why a first test message bounces even when routing is right.'
      : catchAll
        ? `${mailboxes} mailbox${mailboxes === 1 ? '' : 'es'}, with catch-all on ${catchAll}, so anything at this domain lands.`
        : `${mailboxes} mailbox${mailboxes === 1 ? '' : 'es'}, no catch-all — any other address is rejected.`,
  )

  const arrivedStep = step(
    'arrived',
    'Mail has actually arrived',
    arrived ? 'done' : 'waiting',
    arrived
      ? `The last message for this domain arrived ${arrived}. That is the only end-to-end proof there is; everything above it is a statement about configuration.`
      : 'Nothing has arrived for this domain yet. Send it a message from somewhere else — that is the only way to prove the whole path.',
  )

  // R-A — nobody has looked. Not `pending`, which would claim we looked and
  // found nothing.
  if (!receiving || receiving.mx_status === null) {
    return {
      badge: 'not_started',
      headline: 'Receiving has not been checked',
      action: 'Check receiving',
      actor: 'you-here',
      steps: [
        step(
          'mx',
          'The MX points at Cloudflare Email Routing',
          'current',
          'No MX lookup has run for this domain yet. This resolves it — no API token, and it changes nothing.',
        ),
        routeStep,
        mailboxStep,
        arrivedStep,
      ],
    }
  }

  // R-B — the resolver would not answer. Never laundered into a pass.
  if (receiving.mx_status === 'error') {
    return {
      badge: 'error',
      headline: 'The MX lookup did not complete',
      action: 'Check receiving again',
      actor: 'you-here',
      steps: [
        step(
          'mx',
          'The MX points at Cloudflare Email Routing',
          'blocked',
          'The resolver did not answer. That is not evidence this domain is wrong — it means we no longer know.',
        ),
        routeStep,
        mailboxStep,
        arrivedStep,
      ],
    }
  }

  // R-C — no MX at all. Nothing can deliver here, by anyone.
  if (receiving.mx_status === 'pending') {
    return {
      badge: 'not_started',
      headline: 'This domain publishes no MX, so nothing can deliver to it',
      action: 'Enable Email Routing on the zone',
      actor: 'cloudflare',
      steps: [
        step(
          'mx',
          'The MX points at Cloudflare Email Routing',
          'current',
          'No MX record is published at all. Turn on Email Routing and Cloudflare writes the MX records itself.',
        ),
        routeStep,
        mailboxStep,
        arrivedStep,
      ],
    }
  }

  // R-D — mail for this domain is delivered somewhere else entirely. The
  // consequence is worth stating: changing an MX moves *all* mail.
  if (receiving.mx_status === 'failed') {
    return {
      badge: 'failed',
      headline: "This domain's mail is delivered somewhere else",
      action: 'Point the MX at Cloudflare Email Routing',
      actor: 'cloudflare',
      steps: [
        step(
          'mx',
          'The MX points at Cloudflare Email Routing',
          'blocked',
          `Found ${receiving.mx_found ?? 'another mail host'}, expected ${receiving.expected}. Changing this moves every message for this domain, not just the ones this product handles.`,
        ),
        routeStep,
        mailboxStep,
        arrivedStep,
      ],
    }
  }

  // R-E / R-F — the MX is right. Everything observable is in place, and the
  // badge is still `pending`, because the catch-all rule is not observable.
  const mxStep = step(
    'mx',
    'The MX points at Cloudflare Email Routing',
    'done',
    `Mail for this domain reaches Cloudflare Email Routing (${receiving.mx_found ?? receiving.expected}). That is as far as this can be proved from here.`,
  )

  if (mailboxes === 0) {
    return {
      badge: 'pending',
      headline: 'Routing reaches us, but there is nowhere for mail to land',
      action: 'Create a mailbox on this domain',
      actor: 'you-here',
      steps: [mxStep, routeStep, mailboxStep, arrivedStep],
    }
  }

  return {
    badge: 'pending',
    headline: arrived ? 'Mail is arriving for this domain' : 'Everything we can check is in place',
    action: arrived ? null : 'Send this domain a test message',
    actor: arrived ? 'nobody' : 'you-here',
    steps: [mxStep, routeStep, mailboxStep, arrivedStep],
  }
}
