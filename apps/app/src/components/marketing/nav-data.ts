import { REPO_URL } from '~/seo'

/**
 * The navigation graph, in one place.
 *
 * The desktop menus and the mobile drawer render the same links, and the
 * artboards' two copies had already drifted (the footer's COMPARE column was
 * missing `vs Amazon SES` even though `/compare#ses` exists). One source makes
 * that drift impossible.
 */

export interface NavLink {
  label: string
  href: string
  /** The second line in the dropdown item. */
  description?: string
}

export interface NavGroup {
  label: string
  /** Paths that light the group's active dot. */
  matches: string[]
  items: NavLink[]
}

export const PRODUCT_GROUP: NavGroup = {
  label: 'Product',
  matches: ['/dashboard-tour', '/analytics', '/use-cases', '/stack'],
  items: [
    {
      label: 'Product tour',
      href: '/dashboard-tour',
      description: 'The dashboard, click by click',
    },
    {
      label: 'Analytics',
      href: '/analytics',
      description: 'Deliverability you can actually read',
    },
    {
      label: 'Use cases',
      href: '/use-cases',
      description: 'OTPs, receipts, digests, broadcasts',
    },
    {
      label: 'Stack & cost',
      href: '/stack',
      description: 'Every Cloudflare line item, in dollars',
    },
  ],
}

/**
 * "More" was a dropdown of three two-line rows whose second lines were
 * comma-jammed keyword lists — a 290px panel to hold two real destinations,
 * because the third ("Self-host (MIT)") only duplicated the deploy button that
 * now goes straight to Cloudflare. Two links do not need a menu, so they sit in
 * the bar with Docs and Cost.
 */

export const FLAT_LINKS: NavLink[] = [
  { label: 'Docs', href: '/docs' },
  { label: 'Guides', href: '/guides' },
  { label: 'Cost', href: '/pricing' },
  { label: 'Compare', href: '/compare' },
  { label: 'Resources', href: '/resources' },
]

export interface FooterColumn {
  title: string
  links: NavLink[]
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: 'PRODUCT',
    links: [
      { label: 'Overview', href: '/' },
      { label: 'Product tour', href: '/dashboard-tour' },
      { label: 'Use cases', href: '/use-cases' },
      { label: 'Analytics', href: '/analytics' },
      { label: 'Stack & cost', href: '/stack' },
      { label: 'What it costs', href: '/pricing' },
      { label: 'Status', href: '/resources#status' },
    ],
  },
  {
    title: 'DEVELOPERS',
    links: [
      { label: 'Documentation', href: '/docs' },
      { label: 'Quickstart', href: '/docs#quickstart' },
      { label: 'API reference', href: '/docs#api' },
      { label: 'SDKs & CLI', href: '/docs#sdks' },
      { label: 'Webhooks', href: '/docs#webhooks' },
      { label: 'SES & Resend providers', href: '/docs#providers' },
      { label: 'Self-host (MIT)', href: '/resources#selfhost' },
      // The only absolute URL in the graph. `SiteFooter` renders whatever is
      // here in a plain anchor, so an off-site destination needs no special
      // case — but it is worth saying out loud that this one leaves the site.
      { label: 'Source on GitHub', href: REPO_URL },
    ],
  },
  {
    title: 'COMPARE',
    links: [
      { label: 'vs Resend', href: '/compare#resend' },
      // The artboard omitted this one although the anchor has always existed.
      { label: 'vs Amazon SES', href: '/compare#ses' },
      { label: 'vs SendGrid', href: '/compare#sendgrid' },
      { label: 'vs Postmark', href: '/compare#postmark' },
      { label: 'vs Mailgun', href: '/compare#mailgun' },
      { label: 'Migration guide', href: '/compare#migrate' },
    ],
  },
  /**
   * Hand-written on purpose, unlike the page lists in `content/site-map.ts`.
   * This is editorial curation — four flagship guides out of twenty-six, chosen
   * because they are the ones people arrive looking for — and half of these
   * entries are `#anchor` links rather than pages, which a generated list
   * cannot express.
   *
   * It used to promise an "Engineering blog" at `/resources#blog`, which was
   * three teaser cards with no page behind any of them. That link is now the
   * guides index, which is the thing it was always pretending to be.
   */
  {
    title: 'GUIDES',
    links: [
      { label: 'All guides', href: '/guides' },
      { label: 'SPF, DKIM & DMARC', href: '/guides/spf-dkim-dmarc' },
      { label: 'Why email goes to spam', href: '/guides/why-email-goes-to-spam' },
      { label: 'Read a bounce', href: '/guides/read-a-bounce' },
      { label: 'What 100k emails costs', href: '/guides/what-100k-emails-costs' },
      { label: 'Migrate from Resend', href: '/guides/migrate-from-resend' },
    ],
  },
  {
    title: 'RESOURCES',
    links: [
      { label: 'Deliverability glossary', href: '/resources#glossary' },
      { label: 'Changelog', href: '/resources#changelog' },
      { label: 'Security & compliance', href: '/resources#security' },
      { label: 'Sitemap', href: '/resources#sitemap' },
    ],
  },
]

export const LEGAL_LINKS: NavLink[] = [
  { label: 'Terms', href: '/legal/terms' },
  { label: 'Privacy', href: '/legal/privacy' },
  { label: 'DPA', href: '/legal/dpa' },
]
