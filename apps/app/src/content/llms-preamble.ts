/**
 * The hand-written parts of llms.txt and robots.txt.
 *
 * Both files used to be static files in `public/`, typed out with
 * `https://mailysend.com` hardcoded through them — so a self-hosted deployment
 * shipped a retrieval map and a sitemap reference pointing at somebody else's
 * site. They are templates over `site` now, and `scripts/llms.ts` writes them
 * from the same host the sitemap uses.
 *
 * The prose here is the only part of either file a person writes; the page
 * lists are generated from `content/site-map.ts` and `content/doc-sections.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS FILE MUST STAY PURE DATA. NO IMPORTS.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The opening paragraphs of llms.txt.
 *
 * The stack sentence no longer claims Workers AI. It listed it for months after
 * the feature it referred to was removed from every page of the site, because
 * this text was a static file that nobody re-read when the claim was retired —
 * which is the whole argument for generating it.
 */
export const llmsPreamble = (site: string): string => `# MailySend

> Resend, on your Cloudflare. MailySend is an MIT-licensed email platform —
> transactional sending, marketing broadcasts, automations, inbound routing and
> deliverability analytics — that you deploy into your own Cloudflare account.
> It runs on Workers, Queues, Durable Objects, D1, KV, R2, Workflows and
> Analytics Engine. There is no MailySend server holding your data.

The API is Resend-compatible: change the base URL and the key, and existing
\`resend\` SDK calls keep working. Sending goes through Cloudflare Email Service
by default, with Amazon SES, Resend and raw SMTP available as alternate
transports with failover. There are four adapters, not more: anything else with
an SMTP endpoint — SendGrid, Postmark, a corporate relay — goes through the SMTP
transport, which cannot report delivery events.

Honest constraints, stated once so retrieval does not have to guess:
- Deploying takes about a minute end to end, most of it DNS propagation.
- Cloudflare Email Sending is a public beta; its pricing and limits can change.
- The Cloudflare transport caps a message at 5 MiB (25 MiB only to verified
  destinations). Amazon SES accepts 40 MB. The ceiling is per transport.
- Inbox-placement figures are never derived from delivery events. An SMTP 250
  means accepted, not inboxed. Placement comes from seed sends and provider
  postmaster feeds (Google Postmaster Tools, Microsoft SNDS); anything else is
  a labelled model, shown as an estimate.
- The SMTP relay is an OCI container image you run yourself. Workers has no
  inbound TCP listener, so \`smtp.yourdomain.com:587\` cannot run on Workers.
- Resend is a capable marketing product and ships automations, segments,
  topics, templates and contact properties. The difference is ownership, not a
  feature gap: MailySend runs in your account, under your licence.

Full text of every page: ${site}/llms-full.txt
`

/**
 * robots.txt.
 *
 * Generated for the same reason: the `Sitemap:` line has to name the host this
 * deployment actually serves, and it named a URL that returned 404 for the life
 * of the site because the sitemap was never generated at all. `sitemapHost` is
 * `null` when this build produced no sitemap, and the line is then omitted
 * rather than pointing a crawler at nothing.
 */
export const robotsTxt = (
  site: string,
  sitemapHost: string | null,
): string => `# MailySend — ${site}
# The docs and guides are the product's front door, so every public document is
# open to well-behaved crawlers. The dashboard is on this same origin under
# /app, and it is per-user: nothing there is a document, and every one of its
# URLs redirects to sign-in for a crawler anyway.

User-agent: *
Allow: /
# Also absent from sitemap.xml, for the same reason.
Disallow: /app
Disallow: /v1/
Disallow: /mcp

# Search-result and preview URLs are the same documents under a query string;
# indexing them splits the signal for the page they duplicate. /docs and
# /guides both filter on ?q=.
Disallow: /*?q=
Disallow: /_serverFn/
Disallow: /_build/

${sitemapHost ? `Sitemap: ${sitemapHost}/sitemap.xml\n` : '# No sitemap: this build has no configured public URL.\n'}
# Retrieval-augmented clients: the two files below are the site in plain text.
# llms.txt is the map; llms-full.txt is the whole thing.
# ${site}/llms.txt
# ${site}/llms-full.txt
`
