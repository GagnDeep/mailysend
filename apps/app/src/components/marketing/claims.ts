/**
 * The competitive copy, in one place, because it is the copy most likely to
 * become false.
 *
 * The artboards carried a `RESEND DOESN'T` badge and the claim "no automations,
 * no branching flows, no segmentation, no A/B tests". Resend now ships
 * automations, segments, topics, templates and contact properties, so that
 * claim is stale — and a page headed "Honest comparisons. Including where we
 * lose." cannot carry a false one. We still build all of those features; we
 * just stop framing them as holes in someone else's product.
 */

export const OWNERSHIP_BADGE = 'RUNS IN YOUR ACCOUNT'

export const RESEND_FRAMING =
  'Resend has grown into a capable marketing product. What it still can’t be is yours.'

export interface Differentiator {
  title: string
  description: string
  href?: string
  linkLabel?: string
}

/**
 * What survives scrutiny. Every line here is either a licence fact, an
 * architectural fact, or a published price — nothing that a competitor's next
 * changelog entry can turn into a lie.
 */
export const DIFFERENTIATORS: Differentiator[] = [
  {
    title: 'MIT, self-hostable',
    description:
      'The whole platform is the repo. Read it, fork it, run it, resell it — there is no hosted tier holding a feature back.',
    href: '/resources#selfhost',
    linkLabel: 'Self-host guide →',
  },
  {
    title: 'Native Worker binding',
    description:
      'Send from the Worker already handling the request through a service binding. No HTTP hop, no second TLS handshake, no cross-cloud round trip.',
    href: '/docs#quickstart',
    linkLabel: 'Binding docs →',
  },
  {
    title: 'Inbox-placement analytics',
    description:
      'Placement per recipient provider from seed sends and postmaster feeds — not a delivery percentage relabelled as inboxing.',
    href: '/analytics',
    linkLabel: 'How we measure →',
  },
  {
    title: 'Parsed DMARC aggregate reports',
    description:
      'The XML your domain already receives, parsed at the edge into alignment rates and a list of unaligned senders.',
    href: '/analytics#dmarc',
    linkLabel: 'DMARC view →',
  },
  {
    title: 'Free inbound with per-mailbox threading',
    description:
      'Cloudflare Email Routing costs nothing, so receiving is included: parsed JSON, attachments in your R2, one Durable Object per mailbox.',
    href: '/docs#inbound',
    linkLabel: 'Inbound docs →',
  },
  {
    title: 'Agent and MCP mailboxes',
    description:
      'An MCP endpoint with nine tools and a mandatory confirmation step before anything sends, with every agent action attributed in the audit log.',
    href: '/docs#mcp',
    linkLabel: 'MCP docs →',
  },
  {
    title: 'Data residency and retention you set',
    description:
      'Durable Objects and R2 buckets stay in the jurisdiction you pick at deploy, and retention is a config value rather than a plan feature.',
    href: '/resources#security',
    linkLabel: 'Security notes →',
  },
  {
    title: 'Roughly half the cost at 100k/month',
    description:
      '≈$40 of Cloudflare usage against $90 of Resend list price. Both numbers are published; the calculator shows the working.',
    href: '/stack#calculator',
    linkLabel: 'The math →',
  },
  {
    title: 'Multi-provider sending with failover',
    description:
      'Cloudflare Email Service, Amazon SES or Resend behind one API, with automatic failover on 5xx and a percentage split for migrations.',
    href: '/docs#providers',
    linkLabel: 'Provider docs →',
  },
]

/**
 * Where an inbox-placement number came from, and how much weight it carries.
 *
 * SMTP `250` means accepted, not inboxed, so no placement figure can be derived
 * from delivery events alone. Every placement number on the site therefore
 * names its source and its confidence, and an estimate is shown as one.
 */
export type PlacementSource = 'seed' | 'postmaster' | 'snds' | 'estimate'

export const PLACEMENT_SOURCE_LABEL: Record<PlacementSource, string> = {
  seed: 'seed list',
  postmaster: 'Google Postmaster Tools',
  snds: 'Microsoft SNDS',
  estimate: 'modelled estimate',
}

export const PLACEMENT_SOURCE_NOTE: Record<PlacementSource, string> = {
  seed: 'Measured by delivering to a seed set and reading where each copy landed.',
  postmaster: 'Reported by the provider’s own postmaster feed for your domain.',
  snds: 'Reported by Microsoft’s Smart Network Data Services for your sending IPs.',
  estimate:
    'Modelled from engagement and complaint signals. Directional only — no provider reports this number.',
}
