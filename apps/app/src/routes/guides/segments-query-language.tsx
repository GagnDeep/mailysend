import { Callout } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { SegmentColumns, SegmentPlayground } from '~/components/guides/segment-playground.tsx'
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
            <SegmentPlayground />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Three things are worth watching as you type. First, the{' '}
              <strong className="text-ink">English reading</strong> comes from the AST, not from the
              text you typed, so if it says something you did not mean then the parser and you
              disagree and the parser wins. Second, the{' '}
              <strong className="text-ink">SQL is a fragment</strong>: always parenthesised, always
              a WHERE clause body, so it can be safely <Mono>AND</Mono>ed onto whatever scoping the
              caller adds for workspace and audience. Third, the{' '}
              <strong className="text-ink">parameter list is separate from the SQL</strong> and
              every value you typed is in it. That separation is the whole safety story, and it gets
              a section of its own below.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Errors carry two pieces of metadata beyond the message: an <Mono>offset</Mono>, which
              is the character position the segment builder puts a caret under, and a{' '}
              <Mono>kind</Mono> that is either <Mono>syntax</Mono> or <Mono>type</Mono>. The
              distinction matters when you are debugging. A syntax error means the parser could not
              build an AST at all — an unknown field, an unterminated string, a stray character. A
              type error means the expression parsed fine and then asked for something incoherent,
              like <Mono>open_count = "ten"</Mono> or <Mono>created_at contains "2026"</Mono>. Type
              errors are raised by the compiler, which is why they arrive with a field label in
              them: “open count is a number, not text”.
            </p>
          </>
        ),
        grammar: (
          <>
            <Lede>
              The language is small on purpose. A predicate is a field, an operator and a value;
              predicates combine with <Mono>and</Mono>, <Mono>or</Mono> and <Mono>not</Mono>; and
              parentheses group. Everything below fits on this page because there is nothing else.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Comparison operators.</strong> <Mono>=</Mono>,{' '}
              <Mono>!=</Mono>, <Mono>&gt;</Mono>, <Mono>&gt;=</Mono>, <Mono>&lt;</Mono>,{' '}
              <Mono>&lt;=</Mono>. <Mono>==</Mono> normalises to <Mono>=</Mono> and{' '}
              <Mono>&lt;&gt;</Mono> to <Mono>!=</Mono>, so muscle memory from another language does
              not cost you an error. Three word operators handle text: <Mono>contains</Mono>,{' '}
              <Mono>starts_with</Mono> and <Mono>ends_with</Mono>, each of which needs a text field
              on the left and a quoted string on the right.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Lists and absence.</strong> <Mono>in [a, b, c]</Mono>{' '}
              takes at least one value — an empty list is a syntax error rather than a predicate
              that is false for everybody, because an empty list is nearly always a bug in whatever
              generated it. <Mono>is null</Mono> and <Mono>is not null</Mono> are the only way to
              ask about absence; <Mono>= null</Mono> is refused with a message telling you to use{' '}
              <Mono>is null</Mono>, and <Mono>null</Mono> inside an <Mono>in</Mono> list is refused
              for the same reason.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Bare booleans.</strong> A boolean column standing alone
              is a predicate: <Mono>unsubscribed</Mono> means <Mono>unsubscribed = true</Mono>. Any
              other column standing alone without an operator is an error, because it is almost
              always a half-typed comparison rather than an intention.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Durations.</strong> A number glued to a unit is a
              duration: <Mono>30d</Mono>, <Mono>12h</Mono>, <Mono>4w</Mono>. The units are{' '}
              <Mono>s</Mono>, <Mono>m</Mono>, <Mono>h</Mono>, <Mono>d</Mono> and <Mono>w</Mono>, and
              anything else glued to a number is rejected by name rather than silently split into a
              number and an identifier. A duration only compares against a date field, and it reads
              backwards from now: <Mono>last_open_at &gt; 30d</Mono> means “opened more recently
              than thirty days ago”. The threshold is resolved at compile time, not at parse time,
              which is what lets a parsed expression be cached across hours and still mean the right
              thing when it is recompiled.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Strings and custom fields.</strong> Strings take single
              or double quotes and support backslash escapes. Custom merge fields live under the
              fixed <Mono>data</Mono> column and are reached either as <Mono>data.plan</Mono> or,
              when the key has a space in it, as <Mono>data["seat count"]</Mono>. A custom field
              name containing a double quote, a backslash or a control character is refused outright
              rather than mangled, because those characters would need JSON-path-level escaping that
              SQLite’s <Mono>json1</Mono> does not define.
            </p>
            <Callout title="PRECEDENCE, STATED">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                <Mono>not</Mono> binds tightest, then <Mono>and</Mono>, then <Mono>or</Mono>. Both{' '}
                <Mono>and</Mono> and <Mono>or</Mono> are left-associative. So{' '}
                <Mono>a and b or c</Mono> is <Mono>(a and b) or c</Mono>, and{' '}
                <Mono>not a and b</Mono> is <Mono>(not a) and b</Mono> — the negation applies to{' '}
                <Mono>a</Mono> alone, never to the conjunction. If you want the other reading, write
                the parentheses; the parser will not guess.
              </p>
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              That last rule is the one that catches people, because English works the other way
              round. “Not subscribed and bounced” said out loud sounds like it negates the whole
              thing. Written down it does not:
            </p>
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Paste both into the playground above. The English reading will tell you which one you
              wrote before you send anything to either of them.
            </p>
          </>
        ),
        columns: (
          <>
            <Lede>
              This table is generated from the registry itself, so it cannot drift from what your
              instance accepts. Twelve columns, plus the JSON <Mono>data</Mono> column for whatever
              custom fields you import.
            </Lede>
            <SegmentColumns />
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              The four counters — <Mono>open_count</Mono>, <Mono>click_count</Mono>,{' '}
              <Mono>send_count</Mono>, <Mono>bounce_count</Mono> — and the three timestamps —{' '}
              <Mono>last_open_at</Mono>, <Mono>last_click_at</Mono>, <Mono>last_send_at</Mono> — are
              denormalised onto the contact row rather than computed from the event table. That is a
              deliberate trade: it is what lets a segment be a single indexed <Mono>WHERE</Mono>{' '}
              clause instead of a join whose cost grows with a contact’s history. It is also the
              reason for the one gap you will meet in the next section.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Types are enforced at compile time, and the error names the field in the words the
              builder shows: <Mono>open_count = "ten"</Mono> gets “open count is a number, not
              text”; <Mono>created_at contains "2026"</Mono> gets “‘contains’ needs a text field,
              but creation date is a timestamp”. A timestamp compares against a duration or an ISO
              string, and nothing else. The <Mono>data</Mono> column is the one exception: its type
              is whatever the contact happened to store, so it accepts any literal and any operator
              that makes sense for one.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              A field name that is not in the registry does not reach the compiler. It fails at
              parse time with an offset and, when the name is within an edit distance of two of a
              real column, a suggestion — because a wrong field name is almost always a typo, and{' '}
              <Mono>unknown field ‘frist_name’ — did you mean ‘first_name’?</Mono> ends the
              investigation immediately.
            </p>
          </>
        ),
        sugar: (
          <>
            <Lede>
              Four families of shorthand exist so that the common queries read like sentences
              instead of like column arithmetic. They are not a second language: each one expands to
              comparisons on the columns you have already seen.
            </Lede>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-tint text-left">
                    <th className="px-4 py-2.5 font-mono text-[12px] font-semibold">you write</th>
                    <th className="px-4 py-2.5 font-mono text-[12px] font-semibold">it means</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['subscribed', 'unsubscribed = false'],
                    ['opened_last_30d', 'last_open_at > (now − 30 days)'],
                    ['clicked_last_7d', 'last_click_at > (now − 7 days)'],
                    ['sent_last_90d', 'last_send_at > (now − 90 days)'],
                    ['never_opened', 'open_count = 0'],
                    ['never_clicked', 'click_count = 0'],
                    ['bounced', 'bounce_count > 0'],
                    ['bounced_last_30d', 'bounce_count > 0  — see below'],
                  ].map(([wrote, means]) => (
                    <tr key={wrote} className="border-line border-t">
                      <td className="px-4 py-2 font-mono text-[13px] text-ink">{wrote}</td>
                      <td className="px-4 py-2 font-mono text-[12.5px] text-muted">{means}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-5 text-[15.5px] leading-[1.7] text-muted">
              The windowed forms are a pattern rather than a fixed vocabulary: the verb is{' '}
              <Mono>opened</Mono>, <Mono>clicked</Mono>, <Mono>sent</Mono> or <Mono>bounced</Mono>,
              and the window is any count and any unit. <Mono>opened_last_36h</Mono> and{' '}
              <Mono>clicked_last_2w</Mono> both work without anyone adding a keyword for them.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Sugar survives parsing rather than being expanded on the spot. That is what lets the
              English reading say “opened in the last 30 days” instead of the mechanically correct
              but useless “last open is not null and after 2026-08-10T14:00:00Z”. The compiler
              expands it; the printer does not. One consequence worth knowing: a real column always
              wins over sugar with the same name, so <Mono>unsubscribed</Mono> reads as the column
              and gets the bare-boolean treatment rather than acquiring a second meaning.
            </p>
            <Callout variant="warn" title="THE ONE APPROXIMATION">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                There is no <Mono>last_bounce_at</Mono> column, so a windowed bounce cannot be
                answered from the denormalised columns at all. <Mono>bounced_last_30d</Mono>{' '}
                therefore compiles to <Mono>bounce_count &gt; 0</Mono> — “has ever bounced” — and
                the English description tells you it did. The alternative was joining{' '}
                <Mono>message_events</Mono>, which is exactly the cost the denormalised columns
                exist to avoid. Being visibly approximate beats being quietly slow, but you do need
                to know which one you are getting.
              </p>
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              In practice this matters for suppression hygiene rather than for targeting. If you
              want “bounced recently” in order to decide whether to keep mailing someone, you want
              the suppression list, not a segment — a hard bounce suppresses the address directly
              and the send path checks that before it checks anything you wrote. If you want “has
              ever bounced” in order to build a cleanup list, the sugar does exactly what you want.
            </p>
          </>
        ),
        'why-safe': (
          <>
            <Lede>
              The interesting claim here is not “we escape user input”. It is that there is no code
              path in which text you typed becomes SQL text at all. That property is enforced by one
              small file, and it is worth understanding why that is enough.
            </Lede>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The column registry is the entire security boundary.
              </strong>{' '}
              It is a hard-coded map from a name to a physical column, a type, a nullability flag
              and a label. An identifier in your expression is resolved against that map{' '}
              <em>at parse time</em>. If it is not there, parsing fails with an offset. It never
              becomes an AST node, which means the compiler can never be handed a field it would
              have to trust. There is no sanitising step, because there is nothing to sanitise: the
              only strings this system ever concatenates into SQL are operator keywords chosen by a{' '}
              <Mono>switch</Mono> over a closed union, and <Mono>sql</Mono> values read out of that
              hard-coded table.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">Everything else is a bound parameter.</strong> Literals,{' '}
              <Mono>in</Mono> lists, <Mono>LIKE</Mono> patterns — and, importantly, JSON paths. A
              custom field reference does not compile to <Mono>json_extract(data, '$."plan"')</Mono>
              ; it compiles to <Mono>json_extract(data, ?)</Mono> with the path bound alongside the
              value. That is precisely why an arbitrary custom field name is harmless: the name is
              data, in the same sense that the value is data.
            </p>
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Note the <Mono>ESCAPE</Mono> clause. <Mono>LIKE</Mono> has its own wildcards, so a
              literal <Mono>%</Mono> or <Mono>_</Mono> in a pattern you typed is escaped before
              binding — otherwise <Mono>email contains "50%"</Mono> would quietly match far more
              people than you asked for. That is not a security bug, it is a correctness bug, and it
              is the kind of thing that hides for a year.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                There is deliberately no raw node and no escape hatch.
              </strong>{' '}
              No <Mono>sql("…")</Mono> function, no passthrough for “advanced users”, no admin-only
              bypass. This is the part people ask for and the part that cannot be added without
              deleting the property above, because the property is not “we validate carefully”, it
              is “the set of column names that can appear in a query is fixed at build time”. One
              raw node and the security argument becomes a code-review argument instead of a
              structural one.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              <strong className="text-ink">
                The registry check rejects <Mono>__proto__</Mono> explicitly.
              </strong>{' '}
              The lookup is <Mono>Object.hasOwn(COLUMNS, name) && name !== '__proto__'</Mono>. The
              own-property check already does most of the work, but the explicit exclusion is there
              because prototype-chain surprises in JavaScript are exactly the class of bug that
              turns a lookup table into a bypass, and a one-token guard is cheaper than being clever
              about why it is not needed.
            </p>
            <Callout title="THE OTHER LIMIT WORTH KNOWING">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                D1 caps a statement at 100 bound parameters. Because every value in your expression
                is a parameter, a long <Mono>in</Mono> list eats into that budget — so when the
                runner needs to chunk a list of contact ids, it chunks against the budget{' '}
                <em>left over</em> after the expression, not against a fixed constant. An expression
                with forty literals in it gets smaller id chunks, automatically.
              </p>
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              One more property that is about cost rather than safety, but comes from the same
              instinct: a full recomputation is a resumable keyset walk over the contacts index, one
              bounded page at a time, committed per page. No query in this subsystem is allowed to
              scale with the size of your audience — which is the same rule that shapes{' '}
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
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Consider <Mono>not clicked_last_7d</Mono>. It expands to{' '}
              <Mono>NOT (last_click_at &gt; ?)</Mono>. For a contact who has never clicked anything,{' '}
              <Mono>last_click_at</Mono> is NULL, so <Mono>NULL &gt; ?</Mono> is NULL, so{' '}
              <Mono>NOT NULL</Mono> is NULL — and a WHERE clause treats NULL as false. The people
              who have <em>never</em> clicked are excluded from “has not clicked in the last seven
              days”. That is the exact opposite of the request, and it fails silently: you get a
              smaller segment, no error, and no reason to suspect anything.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              So a comparison against a nullable target is wrapped:
            </p>
            <Code>
              <Com>{`# not clicked_last_7d\n\n`}</Com>
              {`(NOT (last_click_at IS NOT NULL AND last_click_at > ?))

`}
              <Com>{`# not opened_last_30d, but on a NON-nullable column:
#   open_count is nullable=false, so no guard is emitted\n`}</Com>
              {`(NOT (open_count > ?))`}
            </Code>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              With the guard, the inner expression is a real boolean for every row — false for a
              contact with no click, rather than NULL — so negating it includes exactly the people a
              marketer means. The guard is emitted <em>only</em> for nullable targets, which is why
              the common queries stay readable: <Mono>open_count</Mono>, <Mono>send_count</Mono>,{' '}
              <Mono>unsubscribed</Mono>, <Mono>email</Mono> and <Mono>created_at</Mono> are all
              declared non-nullable, and their comparisons compile to the clause you would have
              written by hand.
            </p>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Two consequences follow from the same rule. <Mono>is null</Mono> and{' '}
              <Mono>is not null</Mono> are never guarded — they are already total, and negating them
              is exact, so wrapping them would only add noise. And every <Mono>data.*</Mono>{' '}
              reference is treated as nullable regardless of what the contacts happen to contain,
              because a custom field that is present on most of your list and missing on the rest is
              the normal case, not the exception.
            </p>
            <Callout variant="warn" title="WHEN YOU STILL HAVE TO THINK">
              <p className="m-0 text-[14.5px] leading-[1.65]">
                The guard makes <Mono>not</Mono> behave. It does not make “missing” and “zero” the
                same thing, and they are not. <Mono>first_name is null</Mono> and{' '}
                <Mono>first_name = ""</Mono> select different people, and an import that writes
                empty strings where it should write nothing will put half your list in the wrong
                one. If a greeting is coming out as “Hi ,” then the segment is fine and the import
                is what you need to look at.
              </p>
            </Callout>
            <p className="text-[15.5px] leading-[1.7] text-muted">
              The practical habit: when a segment returns a surprising count, negate it and check
              that the two counts add up to your audience. If they do not, the difference is sitting
              in a null somewhere, and the English reading in the{' '}
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
