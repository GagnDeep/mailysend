import { createFileRoute } from '@tanstack/react-router'
import { SegmentColumns, SegmentPlayground } from '~/components/guides/segment-playground.tsx'
import {
  Contrast,
  Diagram,
  FactTable,
  Gotcha,
  Takeaway,
} from '~/components/marketing/guide-blocks.tsx'
import { GuideLayout } from '~/components/marketing/guide-layout.tsx'
import { Code, Com, Key, Lede, Mono, Str } from '~/components/marketing/prose.tsx'
import { guideBySlug, guideHead } from '~/seo/guide-head.ts'

const SLUG = 'segments-query-language'
const guide = guideBySlug(SLUG)

export const Route = createFileRoute('/guides/segments-query-language')({
  head: () => guideHead(SLUG),
  component: Page,
})

function Page() {
  return (
    <GuideLayout
      guide={guide}
      summary={
        <p className="m-0">
          You can now read any segment expression and predict both the English reading and the SQL
          it compiles to: twelve columns plus a JSON <code className="font-mono">data</code> column,
          a handful of operators, and three boolean words whose precedence you have seen written
          down. The thing most likely to bite you later is nullability — a comparison against a
          nullable column carries a NULL guard so that <code className="font-mono">not</code> means
          what you meant, and the one place the language is deliberately approximate is a windowed
          bounce, which degrades to “has ever bounced” and says so in the description rather than
          quietly joining an event table.
        </p>
      }
    >
      {{
        playground: (
          <>
            <Lede>
              The widget below is not a simulation. It imports <Mono>parse</Mono>,{' '}
              <Mono>describe</Mono> and <Mono>compile</Mono> from the same package the API calls, so
              the plain-English reading and the parameterised SQL you see are the ones your instance
              would produce — down to the character offset of an error.
            </Lede>
            <Takeaway>
              If the English reading says something you did not mean, the parser and you disagree,
              and the parser wins.
            </Takeaway>
            <SegmentPlayground />
            <FactTable
              columns={['What to watch as you type', 'Why it matters']}
              monoFirst={false}
              rows={[
                [
                  'The English reading',
                  'It comes from the AST, not from the text you typed. It is the only view of what the parser actually built.',
                ],
                [
                  'The SQL is a fragment',
                  'Always parenthesised, always a WHERE clause body, so it can be safely ANDed onto whatever scoping the caller adds for workspace and audience.',
                ],
                [
                  'The parameter list is separate from the SQL',
                  'Every value you typed is in it, and none of it is in the SQL. That separation is the whole safety story, and it gets a section of its own below.',
                ],
              ]}
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                Errors carry two pieces of metadata beyond the message.
              </strong>{' '}
              An <Mono>offset</Mono>, which is the character position the segment builder puts a
              caret under, and a <Mono>kind</Mono>. The kind tells you which half of the pipeline
              objected, and that is the difference between re-reading your syntax and re-reading
              your types.
            </p>
            <Contrast
              sides={[
                {
                  label: 'kind: syntax',
                  tone: 'neutral',
                  points: [
                    'The parser could not build an AST at all',
                    'An unknown field, an unterminated string, a stray character',
                    'Raised before the compiler ever sees the expression',
                  ],
                },
                {
                  label: 'kind: type',
                  tone: 'neutral',
                  points: [
                    'The expression parsed fine and then asked for something incoherent',
                    <>
                      <Mono>open_count = "ten"</Mono>, <Mono>created_at contains "2026"</Mono>
                    </>,
                    'Raised by the compiler, which is why it arrives with a field label in it: “open count is a number, not text”',
                  ],
                },
              ]}
            />
          </>
        ),
        grammar: (
          <>
            <Lede>
              The language is small on purpose. A predicate is a field, an operator and a value;
              predicates combine with <Mono>and</Mono>, <Mono>or</Mono> and <Mono>not</Mono>; and
              parentheses group. Everything below fits on this page because there is nothing else.
            </Lede>
            <Takeaway>
              Field, operator, value — combined with three boolean words and parentheses. There is
              no fourth production and no escape hatch.
            </Takeaway>
            <FactTable
              columns={['Production', 'What it means', 'Example']}
              rows={[
                [
                  '= != > >= < <=',
                  'The comparison operators. == normalises to = and <> to !=, so muscle memory from another language does not cost you an error.',
                  <Mono key="cmp">open_count &gt;= 3</Mono>,
                ],
                [
                  'contains / starts_with / ends_with',
                  'The three word operators for text. Each needs a text field on the left and a quoted string on the right.',
                  <Mono key="text-ops">email ends_with "@example.com"</Mono>,
                ],
                [
                  'in [a, b, c]',
                  'Membership. Takes at least one value — an empty list is a syntax error rather than a predicate that is false for everybody, because an empty list is nearly always a bug in whatever generated it. A null inside the list is refused.',
                  <Mono key="in-list">data.plan in ["pro", "team"]</Mono>,
                ],
                [
                  'is null / is not null',
                  'The only way to ask about absence. = null is refused with a message telling you to use is null.',
                  <Mono key="is-null">last_click_at is null</Mono>,
                ],
                [
                  'a bare boolean column',
                  'A predicate on its own. Any other column standing alone without an operator is an error, because it is almost always a half-typed comparison rather than an intention.',
                  <>
                    <Mono>unsubscribed</Mono> means <Mono>unsubscribed = true</Mono>
                  </>,
                ],
                [
                  'a duration: <number><unit>',
                  'A number glued to a unit — s, m, h, d, w. Anything else glued to a number is rejected by name rather than silently split into a number and an identifier. Compares only against a date field, and reads backwards from now.',
                  <>
                    <Mono>last_open_at &gt; 30d</Mono> — “opened more recently than thirty days ago”
                  </>,
                ],
                [
                  'a string',
                  'Single or double quotes, with backslash escapes.',
                  <Mono key="string">{`first_name = 'Ada'`}</Mono>,
                ],
                [
                  'data.key / data["key"]',
                  'A custom merge field under the fixed data column; the bracket form is for keys with a space in them. A name containing a double quote, a backslash or a control character is refused outright rather than mangled, because those would need JSON-path-level escaping that SQLite’s json1 does not define.',
                  <Mono key="custom-field">data["seat count"] &gt; 5</Mono>,
                ],
              ]}
              caption="The duration threshold is resolved at compile time, not at parse time — which is what lets a parsed expression be cached across hours and still mean the right thing when it is recompiled."
            />
            <FactTable
              columns={['Operator', 'Binds', 'Associativity']}
              rows={[
                ['not', 'tightest (3)', 'prefix — applies to the predicate immediately after it'],
                ['and', 'next (2)', 'left'],
                ['or', 'loosest (1)', 'left'],
              ]}
              caption="If you want a different reading, write the parentheses; the parser will not guess."
            />
            <Gotcha title="English binds the other way round">
              “Not subscribed and bounced” said out loud sounds like it negates the whole thing.
              Written down it does not: <Mono>not</Mono> takes <Mono>subscribed</Mono> alone, never
              the conjunction. The English reading in the playground will tell you which one you
              wrote before you send anything to either of them.
            </Gotcha>
            <Code>
              {`not subscribed and bounced
`}
              <Com>{`# parses as  (not subscribed) and bounced
# i.e.       unsubscribed = true  AND  bounce_count > 0

`}</Com>
              {`not (subscribed and bounced)
`}
              <Com>{`# parses as  the whole conjunction, negated
# i.e.       NOT (unsubscribed = false AND bounce_count > 0)`}</Com>
            </Code>
          </>
        ),
        columns: (
          <>
            <Lede>
              This table is generated from the registry itself, so it cannot drift from what your
              instance accepts. Twelve columns, plus the JSON <Mono>data</Mono> column for whatever
              custom fields you import.
            </Lede>
            <Takeaway>
              The counters and timestamps are denormalised onto the contact row rather than computed
              from the event table, which is what lets a segment be a single indexed{' '}
              <Mono>WHERE</Mono> clause instead of a join whose cost grows with a contact’s history.
            </Takeaway>
            <SegmentColumns />
            <FactTable
              columns={['Denormalised onto the contact row', 'Instead of']}
              rows={[
                [
                  'open_count, click_count, send_count, bounce_count',
                  'Counting rows in the event table per contact.',
                ],
                [
                  'last_open_at, last_click_at, last_send_at',
                  'A MAX() over the event table per contact.',
                ],
                [
                  'no last_bounce_at',
                  'The one gap the trade leaves, and the subject of the next section.',
                ],
              ]}
              caption="A deliberate trade: a single indexed WHERE clause, at the cost of the one question the columns cannot answer."
            />
            <FactTable
              columns={['You write', 'You get']}
              rows={[
                ['open_count = "ten"', 'open count is a number, not text'],
                [
                  'created_at contains "2026"',
                  '‘contains’ needs a text field, but creation date is a timestamp',
                ],
                ['frist_name = "Ada"', 'unknown field ‘frist_name’ — did you mean ‘first_name’?'],
              ]}
              caption="Types are enforced at compile time and the error names the field in the words the builder shows. A timestamp compares against a duration or an ISO string, and nothing else."
            />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The <Mono>data</Mono> column is the one exception to typing.
              </strong>{' '}
              Its type is whatever the contact happened to store, so it accepts any literal and any
              operator that makes sense for one.
            </p>
            <Gotcha title="An unknown field never reaches the compiler">
              A field name that is not in the registry fails at parse time, with an offset and —
              when the name is within an edit distance of two of a real column — a suggestion. A
              wrong field name is almost always a typo, and naming the intended column ends the
              investigation immediately.
            </Gotcha>
          </>
        ),
        sugar: (
          <>
            <Lede>
              Four families of shorthand exist so that the common queries read like sentences
              instead of like column arithmetic. They are not a second language: each one expands to
              comparisons on the columns you have already seen.
            </Lede>
            <Takeaway>
              Sugar survives parsing rather than being expanded on the spot — the compiler expands
              it, the printer does not — which is why the English reading says “opened in the last
              30 days” and not “last open is not null and after 2026-08-10T14:00:00Z”.
            </Takeaway>
            <FactTable
              columns={['You write', 'It means']}
              rows={[
                ['subscribed', <Mono key="subscribed">unsubscribed = false</Mono>],
                ['opened_last_30d', <Mono key="opened">last_open_at &gt; (now − 30 days)</Mono>],
                ['clicked_last_7d', <Mono key="clicked">last_click_at &gt; (now − 7 days)</Mono>],
                ['sent_last_90d', <Mono key="sent">last_send_at &gt; (now − 90 days)</Mono>],
                ['never_opened', <Mono key="never-opened">open_count = 0</Mono>],
                ['never_clicked', <Mono key="never-clicked">click_count = 0</Mono>],
                ['bounced', <Mono key="bounced">bounce_count &gt; 0</Mono>],
                [
                  'bounced_last_30d',
                  <>
                    <Mono>bounce_count &gt; 0</Mono> — see below
                  </>,
                ],
              ]}
            />
            <FactTable
              columns={['The windowed pattern', 'What it accepts']}
              monoFirst={false}
              rows={[
                [
                  'The verb',
                  <>
                    <Mono>opened</Mono>, <Mono>clicked</Mono>, <Mono>sent</Mono> or{' '}
                    <Mono>bounced</Mono>
                  </>,
                ],
                [
                  'The window',
                  <>
                    Any count and any unit, so <Mono>opened_last_36h</Mono> and{' '}
                    <Mono>clicked_last_2w</Mono> both work without anyone adding a keyword for them
                  </>,
                ],
                [
                  'A name collision',
                  <>
                    A real column always wins over sugar with the same name, so{' '}
                    <Mono>unsubscribed</Mono> reads as the column and gets the bare-boolean
                    treatment rather than acquiring a second meaning
                  </>,
                ],
              ]}
            />
            <Gotcha title="The one approximation">
              There is no <Mono>last_bounce_at</Mono> column, so a windowed bounce cannot be
              answered from the denormalised columns at all. <Mono>bounced_last_30d</Mono> therefore
              compiles to <Mono>bounce_count &gt; 0</Mono> — “has ever bounced” — and the English
              description tells you it did. The alternative was joining <Mono>message_events</Mono>,
              which is exactly the cost the denormalised columns exist to avoid. Being visibly
              approximate beats being quietly slow, but you do need to know which one you are
              getting.
            </Gotcha>
            <Contrast
              sides={[
                {
                  label: 'You want “bounced recently”',
                  tone: 'neutral',
                  points: [
                    'You are deciding whether to keep mailing someone',
                    'You want the suppression list, not a segment',
                    'A hard bounce suppresses the address directly, and the send path checks that before it checks anything you wrote',
                  ],
                },
                {
                  label: 'You want “has ever bounced”',
                  tone: 'neutral',
                  points: [
                    'You are building a cleanup list',
                    <>
                      <Mono>bounced</Mono> and <Mono>bounced_last_30d</Mono> both do exactly what
                      you want
                    </>,
                    'This is suppression hygiene, not targeting',
                  ],
                },
              ]}
            />
          </>
        ),
        'why-safe': (
          <>
            <Lede>
              The interesting claim here is not “we escape user input”. It is that there is no code
              path in which text you typed becomes SQL text at all. That property is enforced by one
              small file, and it is worth understanding why that is enough.
            </Lede>
            <Takeaway>
              The set of column names that can appear in a query is fixed at build time. Everything
              else you typed is a bound parameter — including the JSON path of a custom field.
            </Takeaway>
            <Diagram
              steps={[
                { kicker: 'INPUT', title: 'The text you typed', meta: 'identifiers and literals' },
                {
                  kicker: 'PARSER',
                  title: 'Identifier resolved',
                  meta: 'against the column registry, at parse time',
                },
                {
                  kicker: 'REGISTRY',
                  title: 'Hard-coded map',
                  tone: 'accent',
                  meta: 'name → physical column, type, nullability, label',
                },
                {
                  kicker: 'COMPILER',
                  title: 'Keyword + column name',
                  meta: 'the only strings ever concatenated',
                },
                {
                  kicker: 'D1',
                  title: 'Everything else bound',
                  meta: 'literals, in-lists, LIKE patterns, JSON paths',
                },
              ]}
            />
            <FactTable
              columns={['Where it comes from', 'How it reaches SQL']}
              monoFirst={false}
              rows={[
                [
                  'A field name you typed',
                  'Resolved against the registry at parse time. If it is not there, parsing fails with an offset and it never becomes an AST node — so the compiler can never be handed a field it would have to trust.',
                ],
                [
                  'An operator',
                  <>
                    A keyword chosen by a <Mono>switch</Mono> over a closed union.
                  </>,
                ],
                [
                  'A physical column name',
                  <>
                    The <Mono>sql</Mono> value read out of that hard-coded table.
                  </>,
                ],
                [
                  'A literal, an in-list, a LIKE pattern',
                  'A bound parameter. There is no sanitising step, because there is nothing to sanitise.',
                ],
                [
                  'A custom field’s JSON path',
                  <>
                    Also a bound parameter: <Mono>json_extract(data, ?)</Mono>, never{' '}
                    <Mono>json_extract(data, '$."plan"')</Mono>. That is precisely why an arbitrary
                    custom field name is harmless — the name is data, in the same sense the value
                    is.
                  </>,
                ],
              ]}
            />
            <Code>
              <Com>{`# subscribed and email ends_with "@example.com"\n\n`}</Com>
              <Key>SQL</Key>
              {`     ((unsubscribed = ?) AND (email LIKE ? ESCAPE `}
              <Str>{`'\\'`}</Str>
              {`))
`}
              <Key>params</Key>
              {`  [`}
              <Str>0</Str>
              {`, `}
              <Str>{`"%@example.com"`}</Str>
              {`]`}
            </Code>
            <FactTable
              columns={['Detail', 'Why it is there']}
              monoFirst={false}
              rows={[
                [
                  <>
                    The <Mono>ESCAPE</Mono> clause
                  </>,
                  <>
                    <Mono>LIKE</Mono> has its own wildcards, so a literal <Mono>%</Mono> or{' '}
                    <Mono>_</Mono> in a pattern you typed is escaped before binding — otherwise{' '}
                    <Mono>email contains "50%"</Mono> would quietly match far more people than you
                    asked for. Not a security bug, a correctness bug, and the kind that hides for a
                    year.
                  </>,
                ],
                [
                  <>
                    The explicit <Mono>__proto__</Mono> exclusion
                  </>,
                  <>
                    The lookup is{' '}
                    <Mono>Object.hasOwn(COLUMNS, name) &amp;&amp; name !== '__proto__'</Mono>. The
                    own-property check already does most of the work, but prototype-chain surprises
                    are exactly the class of bug that turns a lookup table into a bypass, and a
                    one-token guard is cheaper than being clever about why it is not needed.
                  </>,
                ],
                [
                  'The 100-parameter budget',
                  'D1 caps a statement at 100 bound parameters, and every value in your expression is one. So when the runner chunks a list of contact ids, it chunks against the budget left over after the expression rather than a fixed constant — an expression with forty literals in it gets smaller id chunks, automatically.',
                ],
              ]}
            />
            <Gotcha title="There is deliberately no raw node and no escape hatch">
              No <Mono>sql("…")</Mono> function, no passthrough for “advanced users”, no admin-only
              bypass. This is the part people ask for and the part that cannot be added without
              deleting the property above, because the property is not “we validate carefully”, it
              is “the set of column names that can appear in a query is fixed at build time”. One
              raw node and the security argument becomes a code-review argument instead of a
              structural one.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                One more property, about cost rather than safety.
              </strong>{' '}
              A full recomputation is a resumable keyset walk over the contacts index, one bounded
              page at a time, committed per page. No query in this subsystem is allowed to scale
              with the size of your audience — the same rule that shapes{' '}
              <a
                href="/guides/broadcasts-at-scale"
                className="text-accent underline underline-offset-4"
              >
                how a broadcast goes out
              </a>
              .
            </p>
          </>
        ),
        nulls: (
          <>
            <Lede>
              SQL’s three-valued logic is where well-meaning segment builders quietly produce the
              opposite of what the marketer asked for. The fix is in the registry: every column
              declares whether it is nullable, and the compiler emits a guard when it is.
            </Lede>
            <Takeaway>
              A comparison against a nullable column is wrapped in a NULL guard, so negating it
              includes exactly the people a marketer means rather than silently excluding everyone
              who has no value at all.
            </Takeaway>
            <Contrast
              sides={[
                {
                  label: 'Without a guard',
                  tone: 'bad',
                  points: [
                    <>
                      <Mono>not clicked_last_7d</Mono> expands to{' '}
                      <Mono>NOT (last_click_at &gt; ?)</Mono>
                    </>,
                    <>
                      For someone who has never clicked, <Mono>last_click_at</Mono> is NULL, so{' '}
                      <Mono>NULL &gt; ?</Mono> is NULL
                    </>,
                    <>
                      <Mono>NOT NULL</Mono> is NULL, and a WHERE clause treats NULL as false
                    </>,
                    'The people who have never clicked are excluded from “has not clicked in the last seven days” — the exact opposite of the request',
                    'It fails silently: a smaller segment, no error, no reason to suspect anything',
                  ],
                },
                {
                  label: 'With the guard',
                  tone: 'good',
                  points: [
                    <Mono key="guarded">
                      NOT (last_click_at IS NOT NULL AND last_click_at &gt; ?)
                    </Mono>,
                    'The inner expression is a real boolean for every row — false for a contact with no click, rather than NULL',
                    'Negating it includes exactly the people a marketer means',
                    'Emitted only for nullable targets, so the common queries stay readable',
                  ],
                },
              ]}
            />
            <Code>
              <Com>{`# not clicked_last_7d\n\n`}</Com>
              {`(NOT (last_click_at IS NOT NULL AND last_click_at > ?))

`}
              <Com>{`# not opened_last_30d, but on a NON-nullable column:
#   open_count is nullable=false, so no guard is emitted\n`}</Com>
              {`(NOT (open_count > ?))`}
            </Code>
            <FactTable
              columns={['Target', 'Guarded?', 'Why']}
              rows={[
                [
                  'open_count, send_count, unsubscribed, email, created_at',
                  'No',
                  'Declared non-nullable, so their comparisons compile to the clause you would have written by hand.',
                ],
                [
                  'last_click_at and the other nullable columns',
                  'Yes',
                  'A missing value would turn a negation into silent exclusion.',
                ],
                [
                  'is null / is not null',
                  'Never',
                  'They are already total, and negating them is exact, so wrapping them would only add noise.',
                ],
                [
                  'data.*',
                  'Always',
                  'Treated as nullable regardless of what the contacts happen to contain, because a custom field present on most of your list and missing on the rest is the normal case, not the exception.',
                ],
              ]}
            />
            <Gotcha title="When you still have to think">
              The guard makes <Mono>not</Mono> behave. It does not make “missing” and “zero” the
              same thing, and they are not. <Mono>first_name is null</Mono> and{' '}
              <Mono>first_name = ""</Mono> select different people, and an import that writes empty
              strings where it should write nothing will put half your list in the wrong one. If a
              greeting is coming out as “Hi ,” then the segment is fine and the import is what you
              need to look at.
            </Gotcha>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">The practical habit.</strong> When a segment returns a
              surprising count, negate it and check that the two counts add up to your audience. If
              they do not, the difference is sitting in a null somewhere, and the English reading in
              the{' '}
              <a href="#playground" className="text-accent underline underline-offset-4">
                playground
              </a>{' '}
              will usually tell you which column it is.
            </p>
          </>
        ),
      }}
    </GuideLayout>
  )
}
