import { StatusDot } from '@mailysend/ui'
import { FOOTER_COLUMNS, LEGAL_LINKS } from './nav-data.ts'

/**
 * The ink footer. A real `<footer>` landmark, and the link columns are lists —
 * the artboard's stacks of bare anchors gave a screen reader no count and no
 * grouping, so "twenty-nine links" arrived as one undifferentiated run.
 */
export const SiteFooter = () => (
  <footer className="bg-ink px-6 pt-16 pb-8 text-paper">
    <div className="mx-auto w-full max-w-site">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-x-6 gap-y-10">
        <div className="min-w-0">
          <div className="mb-3.5 flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid size-[27px] place-items-center rounded-sm bg-accent font-mono text-[13px] font-bold text-white"
            >
              M
            </span>
            <span className="text-[17px] font-semibold -tracking-[0.015em]">MailySend</span>
          </div>
          <p className="m-0 mb-[18px] max-w-[26ch] text-[14px] leading-relaxed text-on-dark-3">
            A Resend-compatible email platform — sending, receiving, broadcasts and analytics —
            running entirely on your own Cloudflare Workers.
          </p>
          <a
            href="/resources#status"
            className="inline-flex items-center gap-2 rounded-pill border border-dark-line px-3 py-1.5 text-[12.5px] text-on-dark-2 no-underline transition-colors duration-[0.18s] hover:border-accent hover:text-accent-on-dark"
          >
            <StatusDot tone="positive" size={7} pulse className="bg-positive-bright" />
            All systems operational
          </a>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title} className="min-w-0">
            <h2 className="ms-eyebrow mb-3.5 font-mono text-[11px] font-normal text-on-dark-4">
              {column.title}
            </h2>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[14px]">
              {column.links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-on-dark no-underline transition-colors duration-[0.18s] hover:text-accent"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="mt-[52px] flex flex-wrap items-center justify-between gap-x-7 gap-y-3.5 border-t border-dark-line-soft pt-[22px] text-[13px] text-on-dark-4">
        <span>
          © 2026 MailySend, Inc. Independent project — not affiliated with Cloudflare or Resend.
        </span>
        <span className="flex flex-wrap items-center gap-5">
          {LEGAL_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-on-dark-4 no-underline transition-colors duration-[0.18s] hover:text-accent"
            >
              {link.label}
            </a>
          ))}
          <span className="font-mono text-[12px] text-on-dark-3">
            MIT licensed · built on Workers
          </span>
        </span>
      </div>
    </div>
  </footer>
)
