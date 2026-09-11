/**
 * The guides, as data.
 *
 * One entry per guide. `sections` drives three things at once — the table of
 * contents, the visible `<h2>`s, and the `TechArticle` JSON-LD — which is the
 * same invariant `DOC_SECTIONS` establishes for /docs: three surfaces that can
 * disagree if they are written down separately, so they are written down once.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS FILE MUST STAY PURE DATA. NO IMPORTS — not even `import type`.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `content/public-pages.ts` carries the full reasoning; the short version is
 * that vite.config.ts imports this through esbuild's config bundler, the
 * post-build scripts import it through `tsx`, and the app imports it normally.
 * Only relative specifiers with explicit extensions survive all three, and this
 * file needs none at all. `GuideMeta` is therefore declared locally rather than
 * built from `~/seo`'s types; the shapes are structural, so they stay mutually
 * assignable, and `seo/guide-head.ts` asserts that once where `~/` is legal.
 *
 * `published` and `updated` are string literals rather than computed dates, so
 * that prerendered HTML is byte-identical across builds — a JSON-LD block that
 * changes on every deploy is a diff nobody can review.
 */

export type GuideCategory =
  | 'Deploy'
  | 'Deliverability'
  | 'Sending'
  | 'Receiving'
  | 'Marketing'
  | 'Platform'

export type GuideLevel = 'Beginner' | 'Intermediate' | 'Advanced'

export interface GuideSection {
  /** `id` on the heading and the `#fragment` the TOC links to. Unique per guide. */
  anchor: string
  /** Short form, for the table of contents. */
  label: string
  /** The rendered `<h2>`, and the `headline` in JSON-LD. */
  headline: string
  /** One sentence. Also the `description` in JSON-LD. */
  description: string
}

export interface GuideMeta {
  slug: string
  title: string
  /** The meta description and the card blurb. Two sentences at most. */
  description: string
  category: GuideCategory
  level: GuideLevel
  /** Honest reading time, not a marketing number. */
  minutes: number
  published: string
  updated: string
  /** Rendered as the "You'll need" box. `href` must be a real path. */
  prerequisites: Array<{ label: string; href: string }>
  /** Slugs. Every one is checked against this array by a test. */
  related: string[]
  sections: GuideSection[]
  faq: Array<{ question: string; answer: string }>
}

export const GUIDE_BASE = '/guides'

export const GUIDES: GuideMeta[] = [
  // ─── Deploy ──────────────────────────────────────────────────────────────
  {
    slug: 'deploy-to-cloudflare',
    title: 'Deploy MailySend to your own Cloudflare account',
    description:
      'One click, about a minute, and the resources it creates in your account. What the deploy button actually provisions, and what it deliberately leaves for you.',
    category: 'Deploy',
    level: 'Beginner',
    minutes: 9,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [
      { label: 'A Cloudflare account', href: '/stack' },
      { label: 'A domain you control DNS for', href: '/docs#domains' },
    ],
    related: ['claim-your-instance', 'send-your-first-email', 'what-100k-emails-costs'],
    sections: [
      {
        anchor: 'what-gets-created',
        label: 'What gets created',
        headline: 'What the deploy actually provisions',
        description:
          'The Workers, Queues, Durable Objects, D1, KV, R2 and Workflows resources the deploy creates in your account, and roughly what each one costs at rest.',
      },
      {
        anchor: 'run-it',
        label: 'Run the deploy',
        headline: 'Run the deploy',
        description:
          'The one-click path, and the equivalent wrangler commands if you would rather watch each step.',
      },
      {
        anchor: 'first-boot',
        label: 'First boot',
        headline: 'What happens on first boot',
        description:
          'Migrations, the bootstrap API key printed once, the open claim window, and the health endpoint that tells you which bindings resolved.',
      },
      {
        anchor: 'what-is-not-done',
        label: 'What is not done yet',
        headline: 'What the deploy deliberately does not do',
        description:
          'DNS, domain verification and transport credentials are yours, and the guide says why automating them would be worse.',
      },
      {
        anchor: 'troubleshoot',
        label: 'If it fails',
        headline: 'If the deploy fails',
        description:
          'The four failures worth naming: a missing Email Service beta enrolment, a name collision, an account without Workers Paid, and a stale wrangler.',
      },
    ],
    faq: [
      {
        question: 'Does MailySend hold any of my data?',
        answer:
          'No. Every resource the deploy creates lives in your Cloudflare account, under your billing and your access controls. There is no MailySend-operated server in the path, which is also why nobody here can recover your data for you.',
      },
      {
        question: 'How long does the deploy take?',
        answer:
          'About a minute for the resources. DNS propagation for your sending domain is the slow part and is not on the deploy path at all — you can deploy first and verify a domain whenever you are ready.',
      },
      {
        question: 'Can I deploy more than one instance?',
        answer:
          'Yes. Each deploy is an independent set of resources with its own database, so a staging instance and a production instance share nothing but the source.',
      },
    ],
  },
  {
    slug: 'claim-your-instance',
    title: 'Claim a fresh instance and choose how you will sign in',
    description:
      'A newly deployed instance has no owner, and the first person to reach /setup takes it. Here is how the claim works, how to close the window early, and which of the six sign-in doors to open.',
    category: 'Deploy',
    level: 'Beginner',
    minutes: 8,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'A deployed instance', href: '/guides/deploy-to-cloudflare' }],
    related: ['deploy-to-cloudflare', 'api-keys-and-environments', 'self-host-on-a-node-server'],
    sections: [
      {
        anchor: 'why-a-claim',
        label: 'Why a claim',
        headline: 'Why a fresh instance has no owner',
        description:
          'A deploy is public infrastructure until someone proves they own it, so the first-run flow is a claim rather than a signup.',
      },
      {
        anchor: 'claim-it',
        label: 'Claim it',
        headline: 'Claim the instance',
        description:
          'The /setup screen, and the two variables that close the claim window early: MS_OWNER_EMAIL to reserve it for one address, MS_REQUIRE_CLAIM_CODE to demand a code printed on first boot.',
      },
      {
        anchor: 'six-doors',
        label: 'The six doors',
        headline: 'Choosing a sign-in method',
        description:
          'Cloudflare Access, one-time codes, passkeys, OIDC, and the two paths meant for automation — what each costs you operationally.',
      },
      {
        anchor: 'lock-it-down',
        label: 'Lock it down',
        headline: 'Closing the doors you are not using',
        description:
          'Turning off the methods you do not need, and why leaving the claim path open after first run is the one mistake that matters.',
      },
    ],
    faq: [
      {
        question: 'What if someone else claims my instance first?',
        answer:
          'By default that is possible, which is why you should open /setup as soon as the deploy answers. If the URL will be public before you get to it, set MS_OWNER_EMAIL before the first request reaches the instance and the claim completes only for that address, or set MS_REQUIRE_CLAIM_CODE=1 and first boot mints a code that /setup demands.',
      },
      {
        question: 'Can I change the owner later?',
        answer:
          'Yes, from the dashboard, and the change is recorded. What you cannot do is re-run the initial claim: once an instance has an owner, the first-run path is closed permanently.',
      },
      {
        question: 'Do session tokens get stored?',
        answer:
          'Only as SHA-256 hashes, the same as API keys and invite tokens. A database dump yields no usable credential.',
      },
    ],
  },
  {
    slug: 'self-host-on-a-node-server',
    title: 'Self-host MailySend on a plain Node server',
    description:
      'The same application, without Cloudflare in front of it: a Node build behind nginx, run under a process manager, with the platform bindings pointed somewhere else.',
    category: 'Deploy',
    level: 'Advanced',
    minutes: 14,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [
      { label: 'A Linux host and a domain', href: '/docs#quickstart' },
      { label: 'Node 22 or newer', href: '/docs' },
    ],
    related: ['deploy-to-cloudflare', 'choose-a-sending-transport', 'claim-your-instance'],
    sections: [
      {
        anchor: 'what-changes',
        label: 'What changes',
        headline: 'What is different without Workers',
        description:
          'Bindings resolve through @mailysend/platform rather than being imported directly, so the application code is identical and only the adapters differ.',
      },
      {
        anchor: 'build',
        label: 'Build it',
        headline: 'Build the Node target',
        description:
          'MS_TARGET=node produces .output/server, and the environment variables the build itself needs — including the one that decides whether a sitemap is written.',
      },
      {
        anchor: 'run',
        label: 'Run it',
        headline: 'Run it behind nginx',
        description:
          'A single fork-mode process on a loopback port, an nginx server block in front, and why cluster mode is the wrong default here.',
      },
      {
        anchor: 'env',
        label: 'Environment',
        headline: 'The environment variables that matter',
        description:
          'MS_SECRET, MS_PUBLIC_URL, MS_LANDING and the transport credentials, and which of them are needed at build time versus run time.',
      },
      {
        anchor: 'upgrades',
        label: 'Upgrades',
        headline: 'Upgrading without downtime you will notice',
        description:
          'Build into a fresh directory, run migrations, reload the process — and the one ordering rule that makes rollback possible.',
      },
    ],
    faq: [
      {
        question: 'Do I lose any features by self-hosting on Node?',
        answer:
          'The Cloudflare Email Service transport needs a Cloudflare account, so on a plain server you send through SES, Resend, SendGrid, Postmark or SMTP instead. Everything else — broadcasts, automations, inbound, analytics — runs on the platform adapters.',
      },
      {
        question: 'Why is MS_LANDING needed at build time?',
        answer:
          'Prerendering boots the real server to render each public page, and the real server redirects / to the dashboard on a self-hosted instance. Without the variable in the build shell, the build would try to prerender a redirect.',
      },
      {
        question: 'Can I run more than one process?',
        answer:
          'Yes, but read the upgrade section first: some background work assumes a single leaseholder, and horizontal scaling means moving that coordination somewhere both processes can see.',
      },
    ],
  },
  {
    slug: 'choose-a-sending-transport',
    title: 'Choose a sending transport: Cloudflare, SES, Resend or SMTP',
    description:
      'Four transports with genuinely different ceilings and genuinely different event data. The real limits, straight out of the adapters, plus what failover does and does not buy you.',
    category: 'Deploy',
    level: 'Intermediate',
    minutes: 12,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [
      { label: 'A verified sending domain', href: '/guides/verify-a-sending-domain' },
    ],
    related: ['spf-dkim-dmarc', 'what-100k-emails-costs', 'read-a-bounce'],
    sections: [
      {
        anchor: 'the-numbers',
        label: 'The real numbers',
        headline: 'The limits, as the code enforces them',
        description:
          'Message size, attachment size and recipients per message for each of the four adapters — read from the adapter constants, not from a marketing page.',
      },
      {
        anchor: 'events',
        label: 'Who reports events',
        headline: 'Which transports report delivery events',
        description:
          'The difference that surprises people: SMTP reports nothing, and SES only reports if you configure it to.',
      },
      {
        anchor: 'pick-one',
        label: 'Pick one',
        headline: 'Picking a transport',
        description:
          'A decision tree with every outcome written out, so the answer is readable whether or not you touch the control.',
      },
      {
        anchor: 'failover',
        label: 'Failover',
        headline: 'What failover actually protects against',
        description:
          'Failover covers a transport being unreachable. It does not cover a reputation problem, and swapping transports mid-incident usually makes one worse.',
      },
    ],
    faq: [
      {
        question: 'Which transport has the largest attachment ceiling?',
        answer:
          'Amazon SES and Resend accept 40 MB messages; raw SMTP is capped at 25 MiB here; Cloudflare Email Service caps at 5 MiB (25 MiB only to verified destinations). The ceiling is per transport, so a message that sends today can fail after a transport switch.',
      },
      {
        question: 'Can I use different transports for different domains?',
        answer:
          'Yes. Routing is per sending domain, which is the usual way to keep marketing volume off the same reputation as transactional mail.',
      },
      {
        question: 'Why does SMTP show no opens or bounces in analytics?',
        answer:
          'The SMTP adapter reports no events by design — a 250 from a relay tells you the relay accepted the message and nothing about what happened next. Bounces arrive later as DSNs, which is a separate inbound path.',
      },
    ],
  },

  // ─── Deliverability ──────────────────────────────────────────────────────
  {
    slug: 'spf-dkim-dmarc',
    title: 'SPF, DKIM and DMARC, explained by the records you actually publish',
    description:
      'The three records, what each one proves, and the exact values for your transport. Generated from the same code the setup screen uses, so the guide cannot drift from the product.',
    category: 'Deliverability',
    level: 'Beginner',
    minutes: 13,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'DNS access for your domain', href: '/docs#domains' }],
    related: ['verify-a-sending-domain', 'dmarc-from-none-to-reject', 'why-email-goes-to-spam'],
    sections: [
      {
        anchor: 'what-each-proves',
        label: 'What each proves',
        headline: 'What each record actually proves',
        description:
          'SPF authorises a sender, DKIM signs the message, DMARC ties either one back to the address a reader sees. They are three different claims, and only the third is about the From header.',
      },
      {
        anchor: 'your-records',
        label: 'Your records',
        headline: 'The records for your domain',
        description:
          'Enter a domain and pick a transport; the builder emits the same rows the setup screen would, including the ones your provider publishes for you.',
      },
      {
        anchor: 'alignment',
        label: 'Alignment',
        headline: 'Alignment is the part people miss',
        description:
          'A message can pass SPF and still fail DMARC, because DMARC checks that the passing domain matches the From domain.',
      },
      {
        anchor: 'dkim-key',
        label: 'The DKIM key',
        headline: 'Selectors, key sizes and who mints the key',
        description:
          'Some transports sign with their own key under their own selector, which is why the guide will not print a value it cannot verify.',
      },
      {
        anchor: 'check-it',
        label: 'Check your work',
        headline: 'Checking your work',
        description:
          'What a correct lookup looks like from a resolver, and the two mistakes that produce a record that looks right and proves nothing.',
      },
    ],
    faq: [
      {
        question: 'Can I have two SPF records?',
        answer:
          'No. A domain must publish exactly one SPF TXT record; two is a permanent error, and receivers treat it as no SPF at all. Merge the includes into a single record instead.',
      },
      {
        question: 'Why does my DKIM record say only v=DKIM1 here?',
        answer:
          'Because for transports that mint their own key under their own selector, the value is not knowable in advance. The product checks that something of the right shape resolves rather than printing a key that would be wrong.',
      },
      {
        question: 'Do I need DKIM if SPF passes?',
        answer:
          'Yes, in practice. SPF breaks on forwarding and DKIM survives it, so a domain with only SPF loses authentication exactly when a message is forwarded to a mailbox that is judging you.',
      },
    ],
  },
  {
    slug: 'verify-a-sending-domain',
    title: 'Verify a sending domain, and read the verification screen honestly',
    description:
      'How verification checks each record over DoH, what the four states mean, and why a domain can sit at pending for an hour without anything being wrong.',
    category: 'Deliverability',
    level: 'Beginner',
    minutes: 10,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'Your DNS records published', href: '/guides/spf-dkim-dmarc' }],
    related: ['spf-dkim-dmarc', 'debug-a-550-rejection', 'choose-a-sending-transport'],
    sections: [
      {
        anchor: 'how-it-checks',
        label: 'How it checks',
        headline: 'How verification checks a record',
        description:
          'A DNS-over-HTTPS resolver, one lookup per required record, and three different matching rules depending on what the record is.',
      },
      {
        anchor: 'four-states',
        label: 'The four states',
        headline: 'verified, pending, failed, error',
        description:
          'Four states rather than a boolean, because "we could not reach a resolver" and "the record says the wrong thing" are different problems with different fixes.',
      },
      {
        anchor: 'rollup',
        label: 'The roll-up',
        headline: 'How the domain-level status is decided',
        description:
          'One failed record does not always fail the domain — records the provider publishes for itself are observed rather than required.',
      },
      {
        anchor: 'stuck',
        label: 'When it is stuck',
        headline: 'When a domain will not verify',
        description:
          'TTLs, split-horizon DNS, a registrar that appends the domain to a name you already fully qualified, and the CNAME-at-apex trap.',
      },
    ],
    faq: [
      {
        question: 'How long should verification take?',
        answer:
          'As long as your old record has left to live. If the name never existed before, seconds; if you edited a record with a 24-hour TTL, up to that. Nothing in the product can make a resolver forget a cached answer.',
      },
      {
        question: 'What is the difference between failed and error?',
        answer:
          'Failed means the lookup succeeded and the answer was wrong. Error means the lookup itself did not complete. Only the first one is something you can fix in your DNS panel.',
      },
      {
        question: 'Why is one record marked as observed rather than required?',
        answer:
          'Because your provider publishes it, not you. There is nothing for you to copy, so the check confirms it exists and does not block you if the provider has not written it yet.',
      },
    ],
  },
  {
    slug: 'dmarc-from-none-to-reject',
    title: 'Move DMARC from p=none to p=reject without losing mail',
    description:
      'A staged rollout with the percentage tag, what to look for in aggregate reports between stages, and the two sources of legitimate mail that always break first.',
    category: 'Deliverability',
    level: 'Advanced',
    minutes: 15,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [
      { label: 'DMARC published at p=none', href: '/guides/spf-dkim-dmarc' },
      { label: 'Aggregate reports arriving', href: '/analytics#dmarc' },
    ],
    related: ['spf-dkim-dmarc', 'why-email-goes-to-spam', 'inbox-placement-vs-delivery'],
    sections: [
      {
        anchor: 'why-move',
        label: 'Why move at all',
        headline: 'What p=none is not doing for you',
        description:
          'A policy of none asks receivers to report and change nothing, so it protects your domain from exactly nobody.',
      },
      {
        anchor: 'read-reports',
        label: 'Read the reports',
        headline: 'Reading an aggregate report without a spreadsheet',
        description:
          'Sources, volumes and pass rates, and the specific shape of report that means a forwarder rather than a forger.',
      },
      {
        anchor: 'the-ladder',
        label: 'The ladder',
        headline: 'none → quarantine at 25% → quarantine → reject',
        description:
          'The staged rollout, how long to sit at each rung, and the pct tag that makes a stage survivable.',
      },
      {
        anchor: 'what-breaks',
        label: 'What breaks',
        headline: 'The two things that always break',
        description:
          'Mailing lists that rewrite nothing, and the third-party tool somebody set up in 2019 that nobody remembers.',
      },
      {
        anchor: 'subdomains',
        label: 'Subdomains',
        headline: 'sp= and the subdomain you forgot',
        description:
          'The subdomain policy tag, and why tightening the parent while leaving sp permissive is a gap worth closing on the same day.',
      },
    ],
    faq: [
      {
        question: 'How long should I stay at each stage?',
        answer:
          'Long enough to see a full business cycle in the reports — usually two weeks. Monthly invoicing or a quarterly newsletter means the cycle is longer than you think, and those are exactly the senders that surprise you at reject.',
      },
      {
        question: 'Does p=reject hurt deliverability?',
        answer:
          'For mail you actually authorised, no — it helps, because receivers can act on a clear policy. It only rejects mail that fails to align, which is either forgery or a sending path you have not authenticated yet.',
      },
      {
        question: 'Can I skip straight to reject?',
        answer:
          'You can, and people do it on a brand-new domain with exactly one sending path. On a domain with history it is how you discover your billing system was sending as you, by way of customers not getting invoices.',
      },
    ],
  },
  {
    slug: 'why-email-goes-to-spam',
    title: 'Why your email goes to spam, in the order worth checking',
    description:
      'A diagnostic order rather than a list of tips: authentication, then reputation, then list quality, then content. Includes a parser for the Authentication-Results header.',
    category: 'Deliverability',
    level: 'Intermediate',
    minutes: 14,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'A message that landed in spam', href: '/guides/spf-dkim-dmarc' }],
    related: ['inbox-placement-vs-delivery', 'warm-up-a-sending-domain', 'read-a-bounce'],
    sections: [
      {
        anchor: 'read-the-headers',
        label: 'Read the headers',
        headline: 'Start with the headers, not with the content',
        description:
          'Paste an Authentication-Results header and see what the receiver concluded, which settles the authentication question in one step.',
      },
      {
        anchor: 'authentication',
        label: 'Authentication',
        headline: 'Authentication failures',
        description:
          'The failures that are binary and fixable in an afternoon, and why they must be ruled out before anything subjective.',
      },
      {
        anchor: 'reputation',
        label: 'Reputation',
        headline: 'Domain and IP reputation',
        description:
          'What a reputation is actually built from, how long it takes to move, and the one behaviour that moves it fastest in the wrong direction.',
      },
      {
        anchor: 'list-quality',
        label: 'List quality',
        headline: 'List quality beats content every time',
        description:
          'Complaint rate, unknown-user rate and engagement — the three numbers receivers weigh, none of which are about your subject line.',
      },
      {
        anchor: 'content',
        label: 'Content',
        headline: 'Content, last and least',
        description:
          'The content factors that still matter in 2026, and the folklore that has not mattered for a decade.',
      },
    ],
    faq: [
      {
        question: 'Does the word "free" in a subject line send mail to spam?',
        answer:
          'No. Content scoring on individual words has not been the dominant signal for many years. A sender with a clean complaint rate and aligned authentication can write "free" as often as they like.',
      },
      {
        question: 'Should I buy a dedicated IP?',
        answer:
          'Only above roughly 100,000 messages a month on a steady schedule. Below that, a dedicated IP never accumulates enough volume to build a reputation and you are worse off than on a well-run shared pool.',
      },
      {
        question: 'My mail passes SPF, DKIM and DMARC and still goes to spam. Now what?',
        answer:
          'Then it is reputation or list quality, and the header tells you nothing more. Move to the complaint rate and unknown-user rate, and read the placement guide for why an accepted message is not an inboxed one.',
      },
    ],
  },
  {
    slug: 'warm-up-a-sending-domain',
    title: 'Warm up a new sending domain',
    description:
      'A schedule that starts with the people most likely to open, and how the send path learns an unpublished quota by watching rejections instead of guessing.',
    category: 'Deliverability',
    level: 'Intermediate',
    minutes: 11,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'A verified domain', href: '/guides/verify-a-sending-domain' }],
    related: ['why-email-goes-to-spam', 'broadcasts-at-scale', 'inbox-placement-vs-delivery'],
    sections: [
      {
        anchor: 'what-warming-is',
        label: 'What warming is',
        headline: 'What you are actually warming',
        description:
          'You are not warming an IP so much as building a history of mail that people want, at a volume that does not look like an incident.',
      },
      {
        anchor: 'the-schedule',
        label: 'The schedule',
        headline: 'A schedule you can adjust',
        description:
          'Enter your target volume and list size; the planner produces a day-by-day ramp, with every row rendered rather than hidden behind the control.',
      },
      {
        anchor: 'who-first',
        label: 'Who goes first',
        headline: 'Send to your best segment first',
        description:
          'Order the ramp by engagement, because early opens are the signal that buys the next day’s volume.',
      },
      {
        anchor: 'learned-quota',
        label: 'The learned quota',
        headline: 'How the send path learns an unpublished quota',
        description:
          'The rate limiter halves on rejection and grows by at most double after a clean day, which converges without ever needing a published number.',
      },
      {
        anchor: 'when-to-slow',
        label: 'When to slow down',
        headline: 'The signals that mean stop climbing',
        description:
          'Deferrals, a rising unknown-user rate, and a complaint rate that moves at all — any one of them means hold, not push.',
      },
    ],
    faq: [
      {
        question: 'How long does warming take?',
        answer:
          'Four to six weeks to a steady six-figure monthly volume, assuming engaged recipients. Warming faster than the receivers are willing to accept does not compress the timeline, it restarts it.',
      },
      {
        question: 'Do I need to warm up for transactional mail?',
        answer:
          'Less so, because transactional volume grows with your product rather than arriving all at once, and it is mail people expect. A migration that moves existing transactional volume to a new domain overnight is a warm-up whether you call it one or not.',
      },
      {
        question: 'What happens if I get deferred mid-ramp?',
        answer:
          'The send path backs off on its own and retries. What you should not do is manually retry the batch from your side — that is the behaviour receivers read as abuse.',
      },
    ],
  },
  {
    slug: 'read-a-bounce',
    title: 'Read a bounce: eight classes, and what each one should do to your list',
    description:
      'Paste a real diagnostic and see how the product classifies it, including how long a soft bounce suppresses. Runs the actual classifier in your browser.',
    category: 'Deliverability',
    level: 'Intermediate',
    minutes: 11,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [],
    related: ['debug-a-550-rejection', 'why-email-goes-to-spam', 'webhooks-end-to-end'],
    sections: [
      {
        anchor: 'classifier',
        label: 'Classify one',
        headline: 'Paste a bounce and see the classification',
        description:
          'The widget imports the product’s own classifier, so the answer here is the answer your instance would record.',
      },
      {
        anchor: 'hard-vs-soft',
        label: 'Hard vs soft',
        headline: 'The distinction that actually matters',
        description:
          'A hard bounce suppresses permanently and a soft one must not, and being wrong in either direction is expensive.',
      },
      {
        anchor: 'eight-classes',
        label: 'The eight classes',
        headline: 'The eight classes, and why each exists',
        description:
          'Invalid, domain, blocked, mailbox full, throttled, content, temporary, and the deliberate unknown that does not suppress.',
      },
      {
        anchor: 'suppression',
        label: 'Suppression windows',
        headline: 'How long a soft bounce holds',
        description:
          'One day for throttling, two for a generic temporary failure, three for content, seven for a full mailbox — and never for unknown.',
      },
      {
        anchor: 'enhanced-codes',
        label: 'Enhanced codes',
        headline: 'Enhanced status codes beat text every time',
        description:
          'RFC 3463 codes are the reliable signal where present; the text patterns are a fallback for MTAs that do not emit them.',
      },
    ],
    faq: [
      {
        question: 'Why does an unrecognised bounce not suppress the address?',
        answer:
          'Because an unrecognised diagnostic is a gap in the classifier, not evidence about the recipient. Guessing wrong costs a real subscriber permanently, so unknown deliberately does nothing.',
      },
      {
        question: 'Is 5.7.1 a hard bounce?',
        answer:
          'It is classified as blocked rather than invalid, which suppresses but is shown differently — the address may be perfectly real and the receiver is refusing you, not the recipient.',
      },
      {
        question: 'My provider already classifies bounces. Is that used?',
        answer:
          'Yes, and trusted where present, because the provider can see things this side cannot — their own suppression list and feedback loops. The text is still checked against it.',
      },
    ],
  },
  {
    slug: 'inbox-placement-vs-delivery',
    title: 'Inbox placement is not delivery, and the difference is the whole game',
    description:
      'Why an SMTP 250 means accepted rather than inboxed, where real placement numbers come from, and how to read an estimate that is labelled as one.',
    category: 'Deliverability',
    level: 'Intermediate',
    minutes: 9,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [],
    related: ['why-email-goes-to-spam', 'open-rates-and-apple-mpp', 'dmarc-from-none-to-reject'],
    sections: [
      {
        anchor: 'what-250-means',
        label: 'What 250 means',
        headline: 'What a 250 actually tells you',
        description:
          'The receiving MTA accepted responsibility for the message. Everything after that — folder, filtering, silent discard — happens where you cannot see.',
      },
      {
        anchor: 'where-placement-comes-from',
        label: 'Real placement data',
        headline: 'Where real placement data comes from',
        description:
          'Seed sends and provider postmaster feeds. There are exactly two sources, and neither is your delivery event stream.',
      },
      {
        anchor: 'estimates',
        label: 'Estimates',
        headline: 'Reading an estimate that says it is one',
        description:
          'What the modelled figure is built from, its error bars, and the rule that it is never presented as measurement.',
      },
      {
        anchor: 'what-to-do',
        label: 'What to do about it',
        headline: 'Acting on a placement problem',
        description:
          'The order of investigation when placement drops but delivery does not, which is the case that looks like nothing is wrong.',
      },
    ],
    faq: [
      {
        question: 'Why does MailySend not show an inbox rate from my delivery events?',
        answer:
          'Because it cannot be derived from them. An accepted message and an inboxed message are different facts, and a chart that conflates them is the kind of number this product exists not to ship.',
      },
      {
        question: 'How do I set up seed sends?',
        answer:
          'Send the same campaign to a set of addresses you control across the major providers and record where it lands. It is a sample rather than a measurement of your whole list, but it is a real observation.',
      },
      {
        question: 'Is Google Postmaster Tools worth setting up?',
        answer:
          'Yes, if any meaningful share of your list is on Gmail. It is one of the only direct views a sender gets of how a large receiver actually judges them.',
      },
    ],
  },
  {
    slug: 'open-rates-and-apple-mpp',
    title: 'Open rates after Apple Mail Privacy Protection',
    description:
      'MPP pre-fetches every image, so a raw open rate measures nothing. How the privacy-adjusted rate is computed, which classification rules actually fire, and which are inert today.',
    category: 'Deliverability',
    level: 'Advanced',
    minutes: 12,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [],
    related: ['inbox-placement-vs-delivery', 'segments-query-language', 'broadcasts-at-scale'],
    sections: [
      {
        anchor: 'what-mpp-did',
        label: 'What MPP did',
        headline: 'What MPP did to the open rate',
        description:
          'Every image in every message is pre-fetched whether or not anyone looked, so an unfiltered open rate is a measure of Apple’s cache.',
      },
      {
        anchor: 'five-classes',
        label: 'Five classes',
        headline: 'Classifying a hit instead of counting it',
        description:
          'human, mpp, proxy_prefetch, scanner and bot — everything is stored, and only one of them counts toward a headline rate.',
      },
      {
        anchor: 'the-rate',
        label: 'The adjusted rate',
        headline: 'The privacy-adjusted open rate',
        description:
          'MPP opens are removed from both the numerator and the denominator, which is the only option that neither inflates nor deflates the result.',
      },
      {
        anchor: 'what-actually-fires',
        label: 'What actually fires',
        headline: 'Which rules fire in production today',
        description:
          'An honest accounting: several of the classifier’s best heuristics depend on inputs the tracking endpoint does not yet supply, so they never trigger.',
      },
      {
        anchor: 'what-to-measure',
        label: 'Measure this instead',
        headline: 'What to measure instead of opens',
        description:
          'Clicks, replies and downstream conversion survive MPP intact, and segmenting on them is what the DSL is for.',
      },
    ],
    faq: [
      {
        question: 'Should I stop tracking opens entirely?',
        answer:
          'No — an open is still useful as a per-message diagnostic, and the classification is stored so you can investigate a specific delivery. It just should not be a headline metric or a segmentation input.',
      },
      {
        question: 'Why is a proxy pre-fetch excluded rather than counted as an open?',
        answer:
          'Because it says the message arrived, which the delivery event already told you, and nothing about whether anyone read it. Counting it would double-count delivery and call it engagement.',
      },
      {
        question: 'Which classification rules are inert right now?',
        answer:
          'The ones needing timing or network context: the three-links-in-two-seconds check, the Gmail-proxy timing window, the Apple and Google network rules, and verified-bot detection. The tracking endpoint does not pass those inputs yet, so user-agent matching is doing the work. The guide says so rather than implying otherwise.',
      },
    ],
  },

  // ─── Sending ─────────────────────────────────────────────────────────────
  {
    slug: 'send-your-first-email',
    title: 'Send your first email',
    description:
      'From an API key to a delivered message, in curl and in code. Includes what to check when the response is a 200 and nothing arrives.',
    category: 'Sending',
    level: 'Beginner',
    minutes: 8,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [
      { label: 'A verified sending domain', href: '/guides/verify-a-sending-domain' },
      { label: 'An API key', href: '/guides/api-keys-and-environments' },
    ],
    related: ['api-keys-and-environments', 'batch-and-schedule', 'migrate-from-resend'],
    sections: [
      {
        anchor: 'one-request',
        label: 'One request',
        headline: 'One request, six languages',
        description:
          'The same send in curl, Node and Python — and why any Resend client, in any language, works once you repoint its base URL.',
      },
      {
        anchor: 'the-response',
        label: 'The response',
        headline: 'Reading the response',
        description:
          'What the id is good for, why acceptance is asynchronous, and the one field worth logging on your side.',
      },
      {
        anchor: 'idempotency',
        label: 'Idempotency',
        headline: 'Retrying safely',
        description:
          'An idempotency key turns a network timeout from a duplicate-send risk into a no-op, which matters most for the mail you least want to send twice.',
      },
      {
        anchor: 'nothing-arrived',
        label: 'Nothing arrived',
        headline: 'When you get a 200 and nothing arrives',
        description:
          'The checklist in the order that resolves it fastest: domain state, transport credentials, suppression list, then the event stream.',
      },
    ],
    faq: [
      {
        question: 'Can I send from an unverified domain?',
        answer:
          'No, and that is deliberate. Sending as a domain you have not proven control of is the behaviour every receiver is filtering for.',
      },
      {
        question: 'Is the API really Resend-compatible?',
        answer:
          'For the send path, yes: change the base URL and the key and existing resend SDK calls keep working. The migration guide covers where the two diverge.',
      },
      {
        question: 'How many recipients can one message have?',
        answer:
          'Fifty across to, cc and bcc on every current transport. Above that you want a batch or a broadcast, which are different endpoints for good reasons.',
      },
    ],
  },
  {
    slug: 'batch-and-schedule',
    title: 'Batch sends and scheduled sends',
    description:
      'One hundred messages per batch, partial success semantics, and scheduling — including how to reschedule or cancel a message while it is still queued.',
    category: 'Sending',
    level: 'Intermediate',
    minutes: 9,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'A working send', href: '/guides/send-your-first-email' }],
    related: ['send-your-first-email', 'broadcasts-at-scale', 'templates-handlebars-mjml'],
    sections: [
      {
        anchor: 'batching',
        label: 'Batching',
        headline: 'One hundred per request',
        description:
          'The batch endpoint takes up to a hundred distinct messages, which is a different thing from one message with a hundred recipients.',
      },
      {
        anchor: 'partial-success',
        label: 'Partial success',
        headline: 'One bad item does not fail the batch',
        description:
          'Results come back per item, so a malformed address in position seven does not discard the other ninety-nine.',
      },
      {
        anchor: 'scheduling',
        label: 'Scheduling',
        headline: 'Scheduling a send',
        description:
          'scheduled_at, the time zone rule that prevents the classic off-by-an-hour, and how far ahead you can schedule.',
      },
      {
        anchor: 'change-your-mind',
        label: 'Changing your mind',
        headline: 'Rescheduling and cancelling',
        description:
          'PATCH moves a queued message and DELETE cancels it — both only while it is still queued, and the guide is explicit about where that boundary is.',
      },
      {
        anchor: 'batch-vs-broadcast',
        label: 'Batch or broadcast',
        headline: 'When to use a broadcast instead',
        description:
          'Batches are for distinct messages you already have. Broadcasts are for one message to an audience, and they scale differently.',
      },
    ],
    faq: [
      {
        question: 'What happens if I cancel a message that has already sent?',
        answer:
          'You get an error saying it is no longer cancellable. There is no way to recall a message that has left, from any provider, and an API that pretended otherwise would be lying.',
      },
      {
        question: 'Can I batch more than a hundred?',
        answer:
          'Split into multiple requests. The limit exists because a batch is one atomic unit of work and an unbounded one cannot be given a sensible timeout.',
      },
      {
        question: 'Does each item in a batch get its own id?',
        answer:
          'Yes, and its own events. A batch is a convenience for the request, not a grouping in the data.',
      },
    ],
  },
  {
    slug: 'templates-handlebars-mjml',
    title: 'Templates: four engines, and which one you actually want',
    description:
      'The structured AST, handlebars, MJML and raw HTML — what each is for, why handlebars escapes triple braces identically to double, and where MJML cannot run.',
    category: 'Sending',
    level: 'Intermediate',
    minutes: 13,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'A working send', href: '/guides/send-your-first-email' }],
    related: ['send-your-first-email', 'broadcasts-at-scale', 'unsubscribe-and-preferences'],
    sections: [
      {
        anchor: 'four-engines',
        label: 'Four engines',
        headline: 'Four engines, one entry point',
        description:
          'renderTemplate covers all four; the choice is about who edits the template and what runtime it has to render on.',
      },
      {
        anchor: 'the-ast',
        label: 'The AST',
        headline: 'The structured AST, and its fifteen components',
        description:
          'A validated document rather than a string, which is what makes a visual editor and a safe render possible at the same time.',
      },
      {
        anchor: 'handlebars',
        label: 'Handlebars',
        headline: 'Handlebars, interpreted rather than compiled',
        description:
          'Nothing here evaluates a string as code, so triple braces escape exactly like double braces — a deliberate difference from upstream handlebars.',
      },
      {
        anchor: 'mjml',
        label: 'MJML',
        headline: 'MJML, and the runtime it needs',
        description:
          'MJML is Node-only and sits behind a runtime-guarded dynamic import, so a Workers deployment gets a clear error rather than a mysterious one.',
      },
      {
        anchor: 'after-render',
        label: 'After render',
        headline: 'What happens to your HTML afterwards',
        description:
          'CSS inlining, table layout, tracking injection and the unsubscribe check that runs on every message including transactional mail.',
      },
    ],
    faq: [
      {
        question: 'Why does {{{value}}} escape my HTML?',
        answer:
          'Because this implementation interprets the template rather than compiling it to a function, on a runtime with no new Function. Honouring raw interpolation would mean either an eval path or a second, subtly different renderer — so triple braces behave like double braces, and the docs say so rather than leaving you to find out.',
      },
      {
        question: 'Can I use MJML on Cloudflare Workers?',
        answer:
          'No. MJML needs Node APIs that Workers does not provide. Render it ahead of time and store the resulting HTML, or use the AST engine, which was designed for exactly this constraint.',
      },
      {
        question: 'Do I have to add an unsubscribe link myself?',
        answer:
          'The send path injects List-Unsubscribe headers on every message, including transactional. A visible link in the body is still your call, and is still what a reader looks for.',
      },
    ],
  },

  // ─── Receiving ───────────────────────────────────────────────────────────
  {
    slug: 'receive-email',
    title: 'Receive email: MX to mailbox, end to end',
    description:
      'The full inbound path — MX records, Email Routing, the worker handler, the queue, and the mail screen — plus the one thing Cloudflare will not let the product read back.',
    category: 'Receiving',
    level: 'Intermediate',
    minutes: 12,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'A domain on Cloudflare', href: '/guides/deploy-to-cloudflare' }],
    related: ['debug-a-550-rejection', 'mcp-agent-inbox', 'webhooks-end-to-end'],
    sections: [
      {
        anchor: 'the-path',
        label: 'The path',
        headline: 'The whole path, in one diagram',
        description:
          'MX record, Email Routing rule, the email() handler, a queue, then storage and the mail screen — five hops, each one observable.',
      },
      {
        anchor: 'mx-and-routing',
        label: 'MX and routing',
        headline: 'MX records and routing rules',
        description:
          'What to publish, and the interaction between a catch-all rule and specific addresses that decides which one wins.',
      },
      {
        anchor: 'mailboxes',
        label: 'Mailboxes',
        headline: 'Mailboxes and who can read them',
        description:
          'Mapping addresses to mailboxes, and scoping access so an agent inbox is not the same thing as your support inbox.',
      },
      {
        anchor: 'threading',
        label: 'Threading',
        headline: 'How replies get threaded',
        description:
          'A signed token in the reply-to address, which is a stronger signal than References because mail clients mangle References.',
      },
      {
        anchor: 'the-honest-gap',
        label: 'The honest gap',
        headline: 'The one thing that cannot be shown',
        description:
          'Cloudflare’s catch-all rule is not readable over its API, so the dashboard cannot mirror its state and does not pretend to.',
      },
    ],
    faq: [
      {
        question: 'Can I receive mail on a domain that is not on Cloudflare?',
        answer:
          'Not through Email Routing, which is a Cloudflare feature. You can point MX at a relay you run and forward into the inbound endpoint, which is the same path with a different first hop.',
      },
      {
        question: 'Why does the dashboard not show my catch-all setting?',
        answer:
          'Because Cloudflare’s API does not expose it for reading. Showing a value the product cannot verify would be worse than showing none, so the screen links you to the setting instead.',
      },
      {
        question: 'Are attachments stored?',
        answer:
          'Yes, in your own R2 bucket, under keys that reject traversal patterns. Nothing leaves your account.',
      },
    ],
  },
  {
    slug: 'debug-a-550-rejection',
    title: 'Debug a 550 rejection',
    description:
      'A 550 is a sentence, not a status code. How to read the enhanced code and the text, decide whether it is about you or the recipient, and what to do in each case.',
    category: 'Receiving',
    level: 'Intermediate',
    minutes: 10,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [],
    related: ['read-a-bounce', 'why-email-goes-to-spam', 'verify-a-sending-domain'],
    sections: [
      {
        anchor: 'anatomy',
        label: 'Anatomy',
        headline: 'The anatomy of a rejection',
        description:
          'Reply code, enhanced status code, and free text — three fields with three different levels of reliability.',
      },
      {
        anchor: 'about-you-or-them',
        label: 'You or them?',
        headline: 'Is it about you or about the recipient?',
        description:
          'The single most useful split: 5.1.x is usually the address, 5.7.x is usually you, and the fix is completely different.',
      },
      {
        anchor: 'common-ones',
        label: 'Common ones',
        headline: 'The rejections you will actually see',
        description:
          'Ten real diagnostics with what each one means and the first thing to change, drawn from the patterns the classifier matches.',
      },
      {
        anchor: 'do-not-retry',
        label: 'Do not retry',
        headline: 'When retrying makes it worse',
        description:
          'Repeatedly retrying a permanent rejection is one of the behaviours receivers score you on directly.',
      },
    ],
    faq: [
      {
        question: 'Is 550 always permanent?',
        answer:
          'Nearly always — 5xx is defined as permanent. Some receivers use it loosely for temporary conditions, which is why the enhanced code and the text are checked rather than the first digit alone.',
      },
      {
        question: 'The text says "spam" but it is a 5.7.1. What is that?',
        answer:
          'A policy rejection: they believe the message is unwanted. The address is probably fine. Retrying the same content will not change the answer, and the deliverability guides are the actual fix.',
      },
      {
        question: 'Should I remove an address that 550s once?',
        answer:
          'If the class is invalid or domain, yes, immediately. If it is blocked, suppress but investigate — a whole receiving domain rejecting you is a reputation event, not a list-hygiene one.',
      },
    ],
  },

  // ─── Marketing ───────────────────────────────────────────────────────────
  {
    slug: 'segments-query-language',
    title: 'The segment query language, and why it cannot be injected',
    description:
      'The full grammar with a live playground that runs the real parser and shows the real parameterised SQL. Twelve columns, no escape hatch, no string concatenation anywhere.',
    category: 'Marketing',
    level: 'Intermediate',
    minutes: 14,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'An audience with contacts', href: '/docs#audiences' }],
    related: ['broadcasts-at-scale', 'automations-instance-vs-cohort', 'open-rates-and-apple-mpp'],
    sections: [
      {
        anchor: 'playground',
        label: 'Playground',
        headline: 'Write an expression and watch it compile',
        description:
          'The real parser, the real describer and the real compiler, running in your browser — including the error offsets you would see in the product.',
      },
      {
        anchor: 'grammar',
        label: 'The grammar',
        headline: 'The grammar, in one page',
        description:
          'Comparisons, in-lists, null checks, and the boolean operators — with precedence stated rather than implied.',
      },
      {
        anchor: 'columns',
        label: 'The columns',
        headline: 'The twelve columns you can name',
        description:
          'The registry is the whole vocabulary: an identifier that is not in it is a syntax error, never a string that reaches SQL.',
      },
      {
        anchor: 'sugar',
        label: 'Sugar',
        headline: 'Sugar, and the one place it is approximate',
        description:
          'subscribed, opened_last_30d, never_clicked and friends — plus the bounced window that degrades to "ever bounced" and says so.',
      },
      {
        anchor: 'why-safe',
        label: 'Why it is safe',
        headline: 'Why injection is structurally impossible here',
        description:
          'Identifiers come only from the registry and everything else is a bound parameter, so there is no code path where user text becomes SQL.',
      },
      {
        anchor: 'nulls',
        label: 'Nulls',
        headline: 'What "not" means when a column is null',
        description:
          'Nullability decides whether a comparison needs a guard, which is what makes negation mean what a marketer expects.',
      },
    ],
    faq: [
      {
        question: 'Can I write raw SQL in a segment?',
        answer:
          'No, and there is deliberately no escape hatch. The column registry is the entire security boundary; adding a raw node would remove it.',
      },
      {
        question: 'Why does opened_last_30d work but bounced_last_30d not really?',
        answer:
          'There is a last_open_at column and no last_bounce_at. A windowed bounce would mean joining the event table, which is exactly the cost the denormalised columns exist to avoid, so it degrades to "has ever bounced" and the description tells you.',
      },
      {
        question: 'Are segments recomputed continuously?',
        answer:
          'They are recomputed in bounded, resumable passes rather than in one query, because no query here is allowed to scale with the size of your audience.',
      },
    ],
  },
  {
    slug: 'broadcasts-at-scale',
    title: 'Broadcasts at scale, without a counting pass',
    description:
      'How one campaign to a large audience is split across coordinators, why nothing counts the list first, and what makes the whole thing resumable after a crash.',
    category: 'Marketing',
    level: 'Advanced',
    minutes: 13,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'A segment or audience', href: '/guides/segments-query-language' }],
    related: ['segments-query-language', 'warm-up-a-sending-domain', 'batch-and-schedule'],
    sections: [
      {
        anchor: 'the-shape',
        label: 'The shape',
        headline: 'The shape of a broadcast',
        description:
          'Ranges, coordinators and a monotonic cursor — the three ideas that make a send resumable rather than restartable.',
      },
      {
        anchor: 'no-counting',
        label: 'No counting pass',
        headline: 'Why nothing counts your list first',
        description:
          'A count is a full scan that tells you a number that is stale by the time you read it, and it gets slower exactly as it gets more expensive.',
      },
      {
        anchor: 'ranges',
        label: 'Ranges',
        headline: 'Splitting the audience into ranges',
        description:
          'Fixed ranges rather than dynamic work-stealing, so a coordinator that dies is replaced without any global bookkeeping.',
      },
      {
        anchor: 'pace',
        label: 'Pacing',
        headline: 'Pacing against a limit nobody published',
        description:
          'The send path learns the receiving quota by backing off on rejection, which is also what makes a warm-up ramp work.',
      },
      {
        anchor: 'observe',
        label: 'Watching it',
        headline: 'Watching a broadcast go out',
        description:
          'What progress means when there is no total, and the two numbers that actually tell you whether to stop.',
      },
    ],
    faq: [
      {
        question: 'Can I pause a broadcast halfway?',
        answer:
          'Yes. Because progress is a cursor rather than a count, pausing and resuming is the same operation the system already performs after a crash.',
      },
      {
        question: 'How large an audience can one broadcast handle?',
        answer:
          'The design has no audience-size constant in it — cost scales with pages walked, not with members. The real ceilings you will meet are your transport’s rate and your own reputation.',
      },
      {
        question: 'Does everyone get the message at the same time?',
        answer:
          'No, and you would not want them to. Delivery is paced, and sending a large list in one instant is the single most reliable way to be rate-limited by every major receiver at once.',
      },
    ],
  },
  {
    slug: 'automations-instance-vs-cohort',
    title: 'Automations: instance mode or cohort mode',
    description:
      'Two execution models with very different ceilings — 40,000 enrollments one way, 25,000 members the other — and a straight answer about which to pick.',
    category: 'Marketing',
    level: 'Advanced',
    minutes: 12,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'An audience', href: '/docs#audiences' }],
    related: ['broadcasts-at-scale', 'segments-query-language', 'unsubscribe-and-preferences'],
    sections: [
      {
        anchor: 'two-models',
        label: 'Two models',
        headline: 'One workflow per contact, or one pass per step',
        description:
          'Instance mode gives every contact its own durable execution; cohort mode walks the whole group once per step. Both are correct, for different shapes of automation.',
      },
      {
        anchor: 'the-ceilings',
        label: 'The ceilings',
        headline: 'The numbers, and where they come from',
        description:
          'A cohort seals at 25,000. Instance mode refuses past 40,000 because the engine caps concurrent instances at 50,000 and one drip must not eat the account’s whole budget.',
      },
      {
        anchor: 'pick-one',
        label: 'Which to pick',
        headline: 'Picking a mode',
        description:
          'Long waits and per-contact branching want instances. Large groups on a shared schedule want a cohort. Every outcome is written out below the control.',
      },
      {
        anchor: 'branching',
        label: 'Branching',
        headline: 'Branching, waits and exit conditions',
        description:
          'How a condition is evaluated at the moment it is reached, and why an exit condition is not the same as a filter on entry.',
      },
      {
        anchor: 'changing-live',
        label: 'Editing a live one',
        headline: 'Editing an automation that is running',
        description:
          'What happens to contacts already mid-flow when you change a step, which is the question that decides how you version them.',
      },
    ],
    faq: [
      {
        question: 'What happens if I try to enroll past the limit?',
        answer:
          'The enrollment is refused with the number in the error. Both the API and the workflow engine check the same constant, so you cannot get into a state one of them considers valid.',
      },
      {
        question: 'Can I convert an automation from one mode to the other?',
        answer:
          'Not in place, because the execution state has a different shape. Create the other mode and migrate enrollments deliberately — an in-place switch would silently strand contacts mid-flow.',
      },
      {
        question: 'Do unsubscribes exit an automation?',
        answer:
          'Yes, immediately, at the next step boundary. Continuing to send to someone who unsubscribed is both a legal problem and the fastest complaint rate you will ever build.',
      },
    ],
  },
  {
    slug: 'unsubscribe-and-preferences',
    title: 'Unsubscribe done properly: RFC 8058 one-click and a preference centre',
    description:
      'What Gmail and Yahoo actually require, why the one-click endpoint returns plain text with no form, and how to offer preferences without hiding the exit.',
    category: 'Marketing',
    level: 'Intermediate',
    minutes: 10,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'A sending domain', href: '/guides/verify-a-sending-domain' }],
    related: [
      'templates-handlebars-mjml',
      'why-email-goes-to-spam',
      'automations-instance-vs-cohort',
    ],
    sections: [
      {
        anchor: 'the-headers',
        label: 'The headers',
        headline: 'The two headers, and what each one does',
        description:
          'List-Unsubscribe offers a URL and a mailto; List-Unsubscribe-Post is the part that makes the client show a native button.',
      },
      {
        anchor: 'one-click',
        label: 'One-click',
        headline: 'Why the POST endpoint returns plain text',
        description:
          'RFC 8058 means a receiver posts directly with no human present. A form, a redirect or a confirmation screen would break the contract.',
      },
      {
        anchor: 'preference-centre',
        label: 'Preference centre',
        headline: 'Offering preferences without hiding the exit',
        description:
          'A preference page is fine as long as unsubscribing is one action on it, not a maze — and the header path must still work regardless.',
      },
      {
        anchor: 'transactional',
        label: 'Transactional mail',
        headline: 'Transactional mail gets headers too',
        description:
          'Every message carries the headers, including receipts, because the alternative is deciding on a reader’s behalf what they are allowed to leave.',
      },
      {
        anchor: 'suppression',
        label: 'Suppression',
        headline: 'What an unsubscribe writes down',
        description:
          'Where the suppression lands, its scope, and how it interacts with a contact being re-imported later.',
      },
    ],
    faq: [
      {
        question: 'Do I still need a visible unsubscribe link in the body?',
        answer:
          'Yes. The header is for the mail client; the link is for the reader who is looking for it. Omitting the link is also the fastest way to convert an unsubscribe into a spam complaint.',
      },
      {
        question: 'Why does the one-click URL not show a confirmation page?',
        answer:
          'Because nothing human is there to confirm. Gmail posts to it directly on the reader’s behalf, so the endpoint records the unsubscribe and returns plain text.',
      },
      {
        question: 'If someone re-subscribes, is the suppression cleared?',
        answer:
          'Only through an explicit re-subscribe action, never as a side effect of a CSV import. An import that silently resurrects unsubscribed addresses is how senders end up on blocklists.',
      },
    ],
  },

  // ─── Platform ────────────────────────────────────────────────────────────
  {
    slug: 'webhooks-end-to-end',
    title: 'Webhooks end to end: signing, retries and replay',
    description:
      'Verify a signature in six languages, understand the retry ladder, and know exactly when an endpoint gets disabled. Includes a live signature playground.',
    category: 'Platform',
    level: 'Intermediate',
    minutes: 14,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'An HTTPS endpoint you control', href: '/docs#webhooks' }],
    related: ['api-keys-and-environments', 'read-a-bounce', 'receive-email'],
    sections: [
      {
        anchor: 'the-signature',
        label: 'The signature',
        headline: 'How a delivery is signed',
        description:
          'An HMAC over the timestamp and the raw body, with the timestamp inside the signed material so a captured delivery cannot be replayed later.',
      },
      {
        anchor: 'verify-it',
        label: 'Verify it',
        headline: 'Verify a signature, live',
        description:
          'Paste a secret and a body and compute the header yourself, using the same construction the product uses.',
      },
      {
        anchor: 'raw-body',
        label: 'The raw body',
        headline: 'The mistake everyone makes once',
        description:
          'Verify against the raw bytes, before your framework parses them. Re-serialised JSON is a different string and will never match.',
      },
      {
        anchor: 'retries',
        label: 'Retries',
        headline: 'The retry ladder',
        description:
          'Six queue attempts, then a long tail at three, six, twelve and twenty-four hours — visualised, so "we retried" has a shape.',
      },
      {
        anchor: 'disable-and-replay',
        label: 'Disable and replay',
        headline: 'Disabling and replaying',
        description:
          'Twenty consecutive failures disables an endpoint, and replay is how you catch up once it is fixed.',
      },
    ],
    faq: [
      {
        question: 'How long is the timestamp tolerance?',
        answer:
          'Five minutes by default. Outside that the signature is still cryptographically valid but the delivery is rejected, which is the point — it bounds how long a captured request stays useful.',
      },
      {
        question: 'What happens after twenty consecutive failures?',
        answer:
          'The endpoint is disabled and stops receiving deliveries. Re-enable it after fixing the receiver, then replay the window you missed.',
      },
      {
        question: 'Can I get the same event twice?',
        answer:
          'Yes. At-least-once delivery is the honest guarantee; every event carries a stable id, so make your handler idempotent on it.',
      },
    ],
  },
  {
    slug: 'api-keys-and-environments',
    title: 'API keys, scopes and the test/live split',
    description:
      'Why the environment is visible in the key itself, what the two permission levels really allow, and how keys are stored so that a database dump yields nothing usable.',
    category: 'Platform',
    level: 'Beginner',
    minutes: 9,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'A claimed instance', href: '/guides/claim-your-instance' }],
    related: ['send-your-first-email', 'webhooks-end-to-end', 'mcp-agent-inbox'],
    sections: [
      {
        anchor: 'the-prefix',
        label: 'The prefix',
        headline: 'The environment is in the key',
        description:
          'ms_live_ and ms_test_ make the environment visible in a log line or a screenshot, which is how a test key stops reaching production.',
      },
      {
        anchor: 'permissions',
        label: 'Permissions',
        headline: 'Full access and sending access',
        description:
          'Two levels rather than a scope matrix, because sending access is the one narrow role that most integrations actually need.',
      },
      {
        anchor: 'storage',
        label: 'Storage',
        headline: 'Why a key is shown exactly once',
        description:
          'Keys are stored only as a SHA-256 hash, so nobody — including you — can read one back. The preview exists so you can tell two keys apart.',
      },
      {
        anchor: 'rotation',
        label: 'Rotation',
        headline: 'Rotating without an outage',
        description:
          'Overlap the old and new key, cut over, then revoke — in that order, which is the only one with no window where nothing works.',
      },
      {
        anchor: 'leaked',
        label: 'If one leaks',
        headline: 'What to do about a leaked key',
        description:
          'Revoke first and investigate second, and what the audit trail can and cannot tell you afterwards.',
      },
    ],
    faq: [
      {
        question: 'Can I recover a key I lost?',
        answer:
          'No. Only a hash is stored, which is exactly the property that makes a database dump worthless. Create a new key and revoke the old one.',
      },
      {
        question: 'Does a test key send real email?',
        answer:
          'It operates against the test environment, so it exercises the whole path without putting messages in front of real recipients. The prefix is your reminder of which one you are holding.',
      },
      {
        question: 'What is sending_access allowed to do?',
        answer:
          'It holds the single scope emails:send, so anything that checks a scope refuses it — key management, configuration, contact writes. Note that contact list and read are not scope-checked today, so a sending key can still read them; the guide says so plainly rather than describing the intent.',
      },
    ],
  },
  {
    slug: 'mcp-agent-inbox',
    title: 'Give an agent an inbox, safely',
    description:
      'Nine MCP tools, two of which will not act without a confirmation token — and the structural reason an agent cannot approve its own send.',
    category: 'Platform',
    level: 'Advanced',
    minutes: 13,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [
      { label: 'An API key', href: '/guides/api-keys-and-environments' },
      { label: 'A verified domain', href: '/guides/verify-a-sending-domain' },
    ],
    related: ['receive-email', 'api-keys-and-environments', 'webhooks-end-to-end'],
    sections: [
      {
        anchor: 'the-tools',
        label: 'The nine tools',
        headline: 'The nine tools an agent gets',
        description:
          'Send, reply, list, get, search, threads, domains, analytics and contacts — with the read/write split stated per tool.',
      },
      {
        anchor: 'confirmation',
        label: 'Confirmation',
        headline: 'The two tools that need a human',
        description:
          'Sending and replying return confirmation_required as a normal outcome rather than an error, carrying a token the agent must be given back.',
      },
      {
        anchor: 'why-structural',
        label: 'Why it holds',
        headline: 'Why an agent cannot approve its own send',
        description:
          'There is no approve method in the JSON-RPC table. The approval is not a permission the agent lacks; it is an operation the protocol does not offer it.',
      },
      {
        anchor: 'connect',
        label: 'Connect one',
        headline: 'Connecting an agent',
        description:
          'The endpoint, the credential, and the scoping choices that decide which mailbox the agent can see.',
      },
      {
        anchor: 'operating',
        label: 'Operating it',
        headline: 'Running an agent inbox in production',
        description:
          'Rate limits, audit trail, and the review habit that makes a confirmation gate meaningful instead of a rubber stamp.',
      },
    ],
    faq: [
      {
        question: 'Can the agent read my whole mail history?',
        answer:
          'Only what its credential is scoped to. Give an agent its own mailbox rather than your support inbox, which is also what makes the audit trail readable.',
      },
      {
        question: 'What stops a prompt injection from sending mail?',
        answer:
          'The confirmation gate. A message telling the agent to send something still produces a confirmation_required result, and the token can only come from outside the agent’s own tool surface.',
      },
      {
        question: 'Is the confirmation token reusable?',
        answer:
          'No. It is bound to the specific call it was issued for and is rejected otherwise, so it cannot be replayed onto a different send.',
      },
    ],
  },
  {
    slug: 'what-100k-emails-costs',
    title: 'What 100,000 emails a month actually costs',
    description:
      'Every line item, priced, with a calculator that runs the same functions the pricing page uses. Includes what changes at 10,000 and at a million.',
    category: 'Platform',
    level: 'Beginner',
    minutes: 10,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [],
    related: ['choose-a-sending-transport', 'deploy-to-cloudflare', 'migrate-from-resend'],
    sections: [
      {
        anchor: 'calculator',
        label: 'The calculator',
        headline: 'Put your volume in',
        description:
          'The same cost functions the pricing page runs, with every line item broken out rather than rolled into a single number.',
      },
      {
        anchor: 'line-items',
        label: 'Line items',
        headline: 'Where the money actually goes',
        description:
          'Requests, queue operations, durable object time, database rows, storage and analytics — and which of them are rounding errors.',
      },
      {
        anchor: 'the-shape',
        label: 'The shape',
        headline: 'The cost curve is not a straight line',
        description:
          'A fixed floor plus a genuinely small marginal cost, which is why the interesting comparison changes with volume.',
      },
      {
        anchor: 'versus',
        label: 'Versus a vendor',
        headline: 'Against a per-message vendor',
        description:
          'An honest comparison including the costs a self-hosted deployment adds — your time is a line item too.',
      },
    ],
    faq: [
      {
        question: 'Is the software really free?',
        answer:
          'Yes, MIT licensed, with no upgrade tier. What you pay is your infrastructure bill, which is why the calculator prices infrastructure rather than plans.',
      },
      {
        question: 'What is the fixed floor?',
        answer:
          'The paid Workers plan plus the minimum for the storage products. Below a few thousand messages a month, that floor dominates and a free vendor tier is genuinely cheaper.',
      },
      {
        question: 'Does the calculator include the sending cost?',
        answer:
          'It includes the transport you pick, which is the largest variable — Cloudflare Email Service, SES and a third-party API have very different per-message prices.',
      },
    ],
  },
  {
    slug: 'migrate-from-resend',
    title: 'Migrate from Resend without changing your code',
    description:
      'Change the base URL and the key. Then the parts that are not one line: domains, webhooks, contacts, suppressions, and a cutover that can be rolled back.',
    category: 'Platform',
    level: 'Intermediate',
    minutes: 12,
    published: '2026-09-11',
    updated: '2026-09-11',
    prerequisites: [{ label: 'A deployed instance', href: '/guides/deploy-to-cloudflare' }],
    related: ['send-your-first-email', 'choose-a-sending-transport', 'what-100k-emails-costs'],
    sections: [
      {
        anchor: 'the-one-line',
        label: 'The one line',
        headline: 'The part that really is one line',
        description:
          'The send path is Resend-compatible, so pointing the SDK at your instance is a base URL and a key.',
      },
      {
        anchor: 'domains',
        label: 'Domains',
        headline: 'Moving a sending domain',
        description:
          'Publish the new records alongside the old, verify, then cut over — which means no window where neither is authenticated.',
      },
      {
        anchor: 'data',
        label: 'Data',
        headline: 'Contacts, suppressions and history',
        description:
          'What to bring across and what not to. The suppression list is the one you must not skip.',
      },
      {
        anchor: 'webhooks',
        label: 'Webhooks',
        headline: 'Rewiring webhooks',
        description:
          'A different signature scheme, so the receiver needs a change — run both verifiers during the overlap.',
      },
      {
        anchor: 'cutover',
        label: 'Cutover',
        headline: 'A cutover you can undo',
        description:
          'Percentage-based cutover, what to watch during it, and the condition that should make you roll straight back.',
      },
      {
        anchor: 'differences',
        label: 'Differences',
        headline: 'Where the two genuinely differ',
        description:
          'Stated plainly, including where Resend is the better answer — a comparison you cannot check is not worth reading.',
      },
    ],
    faq: [
      {
        question: 'Will my existing resend SDK calls keep working?',
        answer:
          'For sending, yes — that is what API compatibility means here. Contacts, broadcasts and audiences have their own endpoints and are worth reading before you assume parity.',
      },
      {
        question: 'Do I have to move my suppression list?',
        answer:
          'Yes, before your first send. Starting with an empty suppression list means re-mailing every address that already bounced or unsubscribed, which is the worst possible first impression to give a receiver.',
      },
      {
        question: 'Is there a reason to stay on Resend?',
        answer:
          'Several. It is a capable product with real people operating it, and if you do not want to run infrastructure that is a legitimate answer. The difference is ownership, not a feature gap.',
      },
    ],
  },
]
