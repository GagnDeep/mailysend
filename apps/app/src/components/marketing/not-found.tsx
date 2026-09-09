import { Button, Eyebrow } from '@mailysend/ui'
import { PageShell, Section } from './page-shell.tsx'

/**
 * The 404.
 *
 * TanStack Router ships `<p>Not Found</p>` when no component is configured, and
 * it warns about exactly that on every miss. A 404 is also a page a search
 * engine and a mistyped link both land on, so it gets the site chrome and — per
 * the design's own rule that no screen ends in "contact support" — three real
 * destinations rather than an apology.
 */
export const NotFound = () => (
  <PageShell>
    {/*
      React 19 hoists these into `<head>`. Without them a 404 inherits the
      root's title and description, which is the classic soft-404: the status
      line says 404 but every signal a crawler reads says "this is the home
      page", and the URL gets indexed.
    */}
    <title>Page not found — MailySend</title>
    <meta name="robots" content="noindex, follow" />
    <meta
      name="description"
      content="That page isn't here. Everything MailySend has is reachable from the home page, the documentation or the dashboard."
    />
    <Section className="pt-20 pb-24" innerClassName="flex flex-col items-center text-center">
      <Eyebrow>404</Eyebrow>
      <h1 className="ms-display-1 mt-4.5 max-w-[16ch]">That page isn't here.</h1>
      <p className="mt-5.5 max-w-[54ch] text-[19px] leading-[1.55] text-muted">
        The link may be old, or the address may have a typo in it. Everything the site has is
        reachable from the three below.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button asChild size="lg" className="font-medium">
          <a href="/">Home</a>
        </Button>
        <Button asChild variant="outline" size="lg" className="font-medium">
          <a href="/docs">Documentation</a>
        </Button>
        <Button asChild variant="outline" size="lg" className="font-medium">
          <a href="/app">Dashboard</a>
        </Button>
      </div>
    </Section>
  </PageShell>
)
