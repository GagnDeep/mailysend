import { Callout, ComparisonTable } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { FactTable, Gotcha, Takeaway } from '~/components/marketing/guide-blocks.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono, Str } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'templates-handlebars-mjml'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/templates-handlebars-mjml')({
  head: () => guideHead(SLUG),
  component: Page,
})

/** The fifteen components the AST document is built from. There is no `div`. */
const COMPONENTS: Array<[string, string]> = [
  ['Html', 'The document root'],
  ['Head', 'Where a style block lives'],
  ['Body', 'The outer background'],
  ['Container', 'The centred fixed-width column'],
  ['Section', 'A horizontal band'],
  ['Row', 'A table row'],
  ['Column', 'A cell inside a row'],
  ['Text', 'A paragraph'],
  ['Heading', 'H1 through H6'],
  ['Button', 'A bulletproof padded anchor'],
  ['Link', 'An inline anchor'],
  ['Img', 'An image with dimensions'],
  ['Hr', 'A rule'],
  ['Preview', 'The hidden inbox preview line'],
  ['CodeBlock', 'Monospaced, for tokens and ids'],
]

/**
 * Why the AST filter chain and the handlebars helper table are the same table.
 *
 * Two renderers with two formatting tables is a bug that takes a year to
 * surface and an afternoon to explain.
 */
const FILTER_CHAIN_NOTE =
  'The filter chain — {value | formatDate:\u201cshort\u201d} — resolves against the exact same helper table the handlebars engine uses, on purpose, so that {{formatDate x \u201cshort\u201d}} and its AST equivalent cannot drift into producing different output.'

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You can now pick an engine on purpose rather than by default: the AST when a template
          needs to be edited by someone who is not you, handlebars when it is a string with names in
          it, MJML when you already have MJML and a build step, raw HTML when the body came from
          somewhere else and must not be touched. The thing most likely to bite you is that{' '}
          <Mono>{'{{{value}}}'}</Mono> escapes exactly like <Mono>{'{{value}}'}</Mono> here. That is
          a deliberate divergence from upstream handlebars, it is documented rather than discovered,
          and a warning is emitted so you find out from the render result instead of from a
          recipient.
        </p>
      }
    >
      {{
        'four-engines': (
          <>
            <Lede>
              Everything that renders a message — the send path, broadcast fan-out, the dashboard
              preview — calls one function, <Mono>renderTemplate</Mono>, and nothing else. That is
              not tidiness for its own sake: it is the only way a template can be guaranteed to
              render identically in the preview you approved and in the broadcast that goes out an
              hour later. Two code paths would eventually be two behaviours.
            </Lede>
            <Takeaway>
              The choice comes down to two questions: who edits this, and what runtime does it have
              to render on. Everything else is taste.
            </Takeaway>
            <ComparisonTable
              minWidth={780}
              labelColumn="minmax(150px, 1.1fr)"
              columns={[
                { key: 'ast', label: 'jsx-ast', emphasis: true },
                { key: 'hbs', label: 'handlebars' },
                { key: 'mjml', label: 'mjml' },
                { key: 'html', label: 'html' },
              ]}
              rows={[
                {
                  label: 'What you store',
                  values: {
                    ast: 'A validated JSON document',
                    hbs: 'A string with merge tags',
                    mjml: 'MJML source, compiled to HTML',
                    html: 'Raw HTML, verbatim',
                  },
                },
                {
                  label: 'Interpolates',
                  values: {
                    ast: true,
                    hbs: true,
                    mjml: true,
                    html: {
                      kind: 'text',
                      label: 'No — tags left in are a warning',
                      tone: 'negative',
                    },
                  },
                },
                {
                  label: 'Renders on a Worker',
                  values: {
                    ast: true,
                    hbs: true,
                    mjml: { kind: 'text', label: 'Throws MjmlUnavailableError', tone: 'negative' },
                    html: true,
                  },
                },
                {
                  label: 'Editable as a form',
                  values: {
                    ast: true,
                    hbs: { kind: 'partial', label: 'As text' },
                    mjml: { kind: 'partial', label: 'As text' },
                    html: { kind: 'partial', label: 'As text' },
                  },
                },
                {
                  label: 'Choose it when',
                  values: {
                    ast: 'Somebody who is not you edits it',
                    hbs: 'It is a string with names in it',
                    mjml: 'You already have MJML and a build step',
                    html: 'The body came from elsewhere and must not be touched',
                  },
                },
              ]}
              caption="One entry point, renderTemplate, covers all four."
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Who edits this?</strong> If the answer includes anybody
              who does not want to see angle brackets, you want a structured document rather than a
              string, because only a structured document can be presented as a form.{' '}
              <strong className="text-ink">What runtime does it have to render on?</strong> If the
              answer is a Cloudflare Worker — which it is, for every send on a default deployment —
              then MJML is out, and that is a hard constraint rather than a preference.
            </p>
            <Gotcha title="Nothing in the template package throws on a data problem">
              A missing merge field, an unknown filter, a subject that is too long, an HTML body
              over Gmail’s clipping threshold — all of these come back as <Mono>warnings</Mono> on
              the render result. A broadcast that stops halfway because one contact has no first
              name is worse than one that goes out with a blank in it, so the package records and
              the caller decides. Read the warnings array in your publish flow; that is where it is
              meant to be enforced.
            </Gotcha>
          </>
        ),
        'the-ast': (
          <>
            <Lede>
              The <Mono>jsx-ast</Mono> engine is the one that sounds most exotic and is in practice
              the most boring, which is the point. You author a React-Email-shaped <Mono>.tsx</Mono>{' '}
              file; <Mono>mailysend templates push</Mono> runs it through a real parser on your
              machine, where a parser and a filesystem are entirely reasonable things to have; and
              what gets stored is a data-only JSON tree.
            </Lede>
            <Takeaway>
              The server never sees JSX and never evaluates anything — which is what makes a visual
              editor and a safe render the same feature rather than two competing ones.
            </Takeaway>
            <Code>
              <Com>{'// welcome.tsx — what you write'}</Com>
              {
                '\n<Container>\n  <Preview>Your account is ready</Preview>\n  <Heading level={1}>Hi {'
              }
              <Key>{'contact.first_name | default:"there"'}</Key>
              {'}</Heading>\n  <Text>Two things to do first.</Text>\n  <Button href={'}
              <Str>{'"{{ activation_url }}"'}</Str>
              {'}>Activate</Button>\n</Container>'}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">That split is the whole design.</strong> A template body
              is customer-controlled data that gets stored and later rendered inside a shared
              isolate on behalf of somebody else’s send, so anything in that path capable of
              evaluating an expression from the body is a sandbox escape waiting to be found.
            </p>
            <FactTable
              columns={['The expression language has', 'Because']}
              rows={[
                [
                  'No function calls, no arithmetic',
                  'Neither can be bounded, and neither is needed to name a field.',
                ],
                [
                  'No operators outside a fixed comparison set',
                  'An enumerable set is the only kind that can be reviewed.',
                ],
                [
                  'No __proto__, constructor or prototype',
                  'The path schema refuses those property names outright.',
                ],
                ['A cap of twelve path segments', 'A path that deep is a bug, not a lookup.'],
                [
                  'Escaping at every interpolation site',
                  'There is no opt-out, so there is no gap.',
                ],
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Fifteen components make up the document.</strong> They
              are deliberately email components rather than web ones — there is no <Mono>div</Mono>,
              because a div is not how you lay out a message that has to survive Outlook.
            </p>
            <FactTable
              columns={['Component', 'What it is']}
              rows={COMPONENTS.map(([name, role]) => [name, role])}
              caption={FILTER_CHAIN_NOTE}
            />
          </>
        ),
        handlebars: (
          <>
            <Lede>
              This is a handlebars <em>interpreter</em>, not a handlebars compiler. Upstream
              handlebars compiles a template into a JavaScript function; this one parses the
              template into a tree and walks it.
            </Lede>
            <Takeaway>
              The runtime has no <Mono>new Function</Mono> and no <Mono>eval</Mono>, by design, and
              that single fact explains every difference you will notice.
            </Takeaway>
            <FactTable
              columns={['Group', 'The whole list', 'Note']}
              rows={[
                [
                  'Block helpers',
                  <Mono key="blocks">if · unless · each · with</Mono>,
                  'Four. There is no way to add a fifth from a template.',
                ],
                [
                  'Formatting',
                  <Mono key="formatting">
                    upper · lower · capitalize · truncate · default · formatDate · formatNumber ·
                    pluralize · link
                  </Mono>,
                  <>
                    <Mono>formatDate</Mono> defaults to UTC and takes an explicit <Mono>tz</Mono>{' '}
                    when you want otherwise. <Mono>default</Mono> treats the empty string as
                    missing, because “Hi ,” is the failure everybody has received.
                  </>,
                ],
                [
                  'Comparison and logic',
                  <Mono key="logic">eq · ne · gt · gte · lt · lte · and · or · not</Mono>,
                  'Being able to enumerate what a template can do is the only form of sandboxing that survives contact with untrusted authors.',
                ],
              ]}
            />
            <Code>
              {'Hi {{'}
              <Key>{'capitalize first_name'}</Key>
              {'}},\n\n{{#if '}
              <Key>{'plan'}</Key>
              {'}}You are on the {{'}
              <Key>{'plan'}</Key>
              {'}} plan.{{/if}}\n\nYou have {{'}
              <Key>{'formatNumber credits'}</Key>
              {'}} {{'}
              <Key>{'pluralize credits "credit" "credits"'}</Key>
              {'}} left,\nexpiring {{'}
              <Key>{'formatDate expires_at "medium"'}</Key>
              {'}}.\n\n{{#each '}
              <Key>{'items'}</Key>
              {'}}  · {{'}
              <Key>{'this.name'}</Key>
              {'}}\n{{/each}}'}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The UTC default is not a shrug.</strong> A Worker’s clock
              is always UTC while a self-hosted Node box is whatever the operator set, and “the same
              broadcast rendered a different date depending on which runtime picked up the job” is a
              bug that only appears near midnight, in production.
            </p>
            <Callout variant="warn" title="TRIPLE BRACES ESCAPE. THIS IS NOT A BUG.">
              <p className="m-0">
                <Mono>{'{{{value}}}'}</Mono> produces exactly the same output as{' '}
                <Mono>{'{{value}}'}</Mono>, and a warning is emitted so the author finds out from
                the render rather than from a recipient.
              </p>
              <p className="mt-2 mb-0">
                Two reasons, and the second is the one that decides it. Mechanically, honouring raw
                interpolation on an interpreter with no <Mono>new Function</Mono> would require
                either an eval path — the thing this design exists to avoid — or a second, subtly
                different renderer, and two renderers that disagree at the margins is worse than one
                that is honest about its limit. Substantively, “elsewhere” in an email template
                means contact data: a first name, a company name, a free-text field from a signup
                form. Honouring the triple stash means any contact who typed a script tag into a
                form field gets it rendered in every client that runs script — and stored HTML
                injection in an email body is also a phishing primitive, because it is an
                attacker-supplied anchor inside a legitimately DKIM-signed message from a brand the
                reader trusts.
              </p>
            </Callout>
            <Gotcha title="Keep the template body stable across a send">
              Parsed templates are cached in a map keyed by the template source, bounded at
              sixty-four entries, evicting oldest-first — bounded because a Worker isolate is shared
              across workspaces, and an unbounded map keyed by customer-controlled text is a memory
              leak with an attacker-supplied key. A broadcast renders the same body once per
              recipient and parsing is by far the most expensive part of that loop, so the cache
              turns an O(recipients) parse cost into O(1). Generating a slightly different source
              string per recipient — splicing a name into the template rather than passing it as
              data — defeats the cache completely, and is the difference between one parse and a
              hundred thousand.
            </Gotcha>
          </>
        ),
        mjml: (
          <>
            <Lede>
              MJML is supported and it is Node-only. The compiler needs Node APIs that Cloudflare
              Workers does not provide, so on a Worker the engine throws{' '}
              <Mono>MjmlUnavailableError</Mono> immediately rather than attempting a partial render.
            </Lede>
            <Takeaway>
              The design decision is in the word “immediately”: an error that names the fix is worth
              more than a capability check, and both supported answers are build-time.
            </Takeaway>
            <FactTable
              columns={['What the engine checks', 'What it concludes']}
              rows={[
                [
                  'navigator.userAgent === "Cloudflare-Workers"',
                  'The documented Workers signal. MJML cannot run here; throw before doing anything else.',
                ],
                [
                  'process.versions.node',
                  'A version string is what distinguishes real Node from the Deno and Bun shims that also define process.',
                ],
                [
                  'A dynamic import, indirected via a variable',
                  'So that bundlers which statically rewrite import("mjml") leave the Worker build alone.',
                ],
                [
                  'The optional dependency is not installed',
                  'The same error class with the reason in it — not a stack trace about a missing module.',
                ],
              ]}
            />
            <Code>
              <Com>{'// on a Worker:'}</Com>
              {'\nMjmlUnavailableError: MJML cannot be compiled on Cloudflare Workers.\n'}
              <Com>
                {'// Compile MJML before it reaches the send path: run `mailysend templates push`,'}
              </Com>
              {'\n'}
              <Com>
                {'// which compiles it locally and uploads the HTML, or add an MJML build step in'}
              </Com>
              {'\n'}
              <Com>{'// CI and store the compiled HTML on the template version.'}</Com>
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Either way the send path receives plain HTML</strong> and
              nothing on the hot path depends on a Node-only dependency. If you are starting a
              template from scratch and want MJML’s layout guarantees without its runtime, the AST
              engine was designed for exactly this constraint.
            </p>
            <Callout title="THE MERGE PASS RUNS AFTER COMPILATION, NOT BEFORE">
              MJML output is ordinary HTML that may still carry merge tags, so handlebars runs on
              the compiled result rather than on the source. The order is forced: MJML’s own parser
              chokes on a <Mono>{'{{#if}}'}</Mono> wrapped around an <Mono>{'<mj-column>'}</Mono>,
              because that is not valid MJML. Write conditionals around the HTML MJML produces, not
              around MJML’s own tags.
            </Callout>
          </>
        ),
        'after-render': (
          <>
            <Lede>
              Whichever engine produced it, the HTML then goes through a fixed post-render pipeline
              before it becomes a MIME message.
            </Lede>
            <Takeaway>
              None of these steps is optional decoration. Each one exists because email clients are
              not browsers.
            </Takeaway>
            <FactTable
              columns={['Step', 'What it does', 'Why it has to']}
              rows={[
                [
                  'inlineCss',
                  <>
                    Flattens a <Mono>&lt;style&gt;</Mono> block into <Mono>style</Mono> attributes
                    on the elements it matched. Runs only when there is a style block, and reports
                    selectors it could not handle as warnings rather than dropping them silently.
                  </>,
                  'Gmail strips head styles in several contexts and older clients never supported them, so a design that relies on a stylesheet arrives unstyled.',
                ],
                [
                  'ensureTableLayout',
                  <>
                    Stamps the attributes every layout table needs: <Mono>cellpadding</Mono>,{' '}
                    <Mono>cellspacing</Mono> and <Mono>role="presentation"</Mono>.
                  </>,
                  'cellpadding and cellspacing default to non-zero in Outlook and older Gmail — precisely where the mystery two-pixel gaps in a sliced hero image come from. role="presentation" stops a screen reader announcing layout scaffolding as a data table.',
                ],
                [
                  'injectTracking',
                  'Adds the open pixel and rewrites links, with three deliberate exemptions.',
                  'See the exemptions below — each one is a link that would break if it were signed into the click tracker.',
                ],
                [
                  'hasUnsubscribe',
                  <>
                    The pre-send check: does the body already resolve to an unsubscribe, through a
                    placeholder or the literal word. Both <Mono>{'{{unsubscribe_url}}'}</Mono> and
                    the Mailchimp-era <Mono>%unsubscribe_url%</Mono> are recognised, because senders
                    migrate and paste.
                  </>,
                  'If nothing is found a default footer is appended before the closing body tag, rather than the message going out without one.',
                ],
                [
                  'htmlToText',
                  'Derives the plain-text part when you have not supplied one, and records that it did so as a warning.',
                  'A multipart message with a real text alternative is treated better by filters than an HTML-only one, and there is a population of readers who see only that part.',
                ],
              ]}
            />
            <Gotcha title="Three links injectTracking will not touch">
              A link carrying <Mono>data-ms-no-track</Mono> is left alone — that is how the
              unsubscribe stays untracked. A link whose href is a <Mono>mailto:</Mono> or{' '}
              <Mono>tel:</Mono> is left alone. And a link whose href still contains an unresolved
              placeholder — <Mono>{'{{'}</Mono>, <Mono>{'{%'}</Mono>, <Mono>%token%</Mono>,{' '}
              <Mono>${'{'}</Mono> — is left alone, because rewriting it would sign a literal{' '}
              <Mono>{'{{unsubscribe_url}}'}</Mono> into the click tracker and produce a link that
              redirects to nowhere.
            </Gotcha>
            <FactTable
              columns={['Threshold', 'Warning', 'What it costs you']}
              rows={[
                [
                  '~102 KB of rendered body',
                  'Gmail clipping',
                  'Gmail shows a “View entire message” link and hides everything after the cut — including, in practice, your unsubscribe footer and your open pixel, so a clipped broadcast simultaneously under-reports opens and over-reports complaints.',
                ],
                [
                  '150 characters of subject',
                  'Subject too long',
                  'Most clients show fewer than eighty. The subject is rendered as plain text rather than HTML, since it ends up in a MIME header where &amp;amp; would be shown to the recipient literally.',
                ],
              ]}
              caption="Both are warnings on the render result. Wire them into your publish check rather than reading them by eye."
            />
            <Callout title="THE HEADERS GO ON EVERY MESSAGE, INCLUDING TRANSACTIONAL">
              Separately from the body, the send path attaches <Mono>List-Unsubscribe</Mono> — an
              HTTPS one-click endpoint and a <Mono>mailto:</Mono> fallback — plus{' '}
              <Mono>List-Unsubscribe-Post: List-Unsubscribe=One-Click</Mono>, to every message. Yes,
              including receipts and password resets. Gmail and Yahoo call that endpoint directly
              with no human present, which is why it returns plain text with no form, no redirect
              and no confirmation screen. A visible link in the body is still your call, and is
              still what a reader actually looks for —{' '}
              <a
                href="/guides/unsubscribe-and-preferences"
                className="text-accent underline underline-offset-4"
              >
                the unsubscribe guide
              </a>{' '}
              covers the rest.
            </Callout>
          </>
        ),
      }}
    </GuideLayout>
  )
}
