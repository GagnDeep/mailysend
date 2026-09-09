# mailysend

The MailySend command line.

```
npx mailysend
```

## Commands

| Command | What it does |
| --- | --- |
| `deploy` | Deploy the worker to Cloudflare (wraps `wrangler deploy`) |
| `dev` | Run the API locally (wraps `wrangler dev`) |
| `tail` | Stream live events over the workspace WebSocket |
| `send` | Send one message |
| `domains verify` | Check a sending domain's DNS and verify it |
| `templates push` | Compile JSX templates to the restricted AST and upload them |
| `import resend` | Migrate a Resend account, resumably |
| `traffic` | Show or shift provider traffic |
| `rollback` | Roll a template back to an earlier version |
| `upgrade` | Check for a newer CLI |
| `export` | Export contacts, logs or events |
| `alerts add` | Create a deliverability alert |
| `login` | Sign in and store an API key |

Credentials live in `~/.config/mailysend/config.json` (mode 0600, directory
0700). `MAILYSEND_API_KEY` overrides the file; `--profile` selects between
stored deployments.

## `templates push`

A template is compiled on your machine into a **data-only AST**. The render
worker walks that document and **never evaluates an expression** — it has no
evaluator at all, which is what keeps one customer's template body from
becoming a way into another customer's send.

That single fact decides the entire language. Anything the AST cannot express
is a compile error naming the construct, with a file, a line and the offending
source. There is no silent fallback to string interpolation: a template either
compiles to something the worker can render, or it does not ship.

```
mailysend templates push ./emails --dry-run
```

### What a template looks like

```tsx
export default function Welcome({ user, items, showCta }) {
  return (
    <Html>
      <Body>
        <Container width={600}>
          <Heading level={1}>Welcome, {user.first_name}</Heading>
          <Text>You have {items.length} things waiting.</Text>

          {showCta && <Button href={user.cta_url}>Open dashboard</Button>}
          {user.plan === 'pro' ? <Text>Pro plan</Text> : <Text>Free plan</Text>}

          <ul>
            {items.map((item, i) => (
              <li className="row" style={{ marginTop: 4 }}>
                {i}. {f.upper(item.name)}
              </li>
            ))}
          </ul>
        </Container>
      </Body>
    </Html>
  )
}
```

The default-exported component is compiled. Its props are the template data:
`{ user }` reads `user`, `{ user: { name } }` reads `user.name`, and a named
`props` parameter addresses the data root, so `props.user.name` is `user.name`.

### Filters

JSX has no pipe operator, so filters are spelled as calls into one reserved
namespace, `f`:

```tsx
{f.upper(user.name)}
{f.default(user.name, 'there')}
{f.truncate(post.body, 120, '…')}
{f.upper(f.default(user.name, 'friend'))}   {/* chains nest */}
```

This is a call *in appearance only*. The compiler matches the exact shape
`f.<known filter>(…)` and lowers it to a filter record; every other call in the
file is rejected. `f` is reserved — a prop named `f` is an error — so whether
something is a filter is decided lexically, never by resolving a name at render
time.

Available filters: `upper`, `lower`, `capitalize`, `default`, `truncate`,
`formatDate`, `formatNumber`, `pluralize`. Filter arguments must be literals.

### What compiles

| You write | It becomes |
| --- | --- |
| `Hello there` | `text` |
| `{user.name}`, `{user?.name}`, `{items[0].id}` | `interpolation` |
| `{f.upper(user.name)}` | `interpolation` with filters |
| `<div class="x">`, `<a href={u.link}>` | `element` |
| `<Container width={600}>` | `component` |
| `{cond && <X/>}`, `{cond ? <A/> : <B/>}` | `conditional` |
| `{items.map((item, i) => <X/>)}` | `loop` |
| `<>…</>`, `<Fragment>` | flattened into the parent's children |
| `{null}`, `{false}`, `{undefined}` | nothing |

Conditions lower `!x`, `x === y`, `x !== y`, `<`, `<=`, `>`, `>=`, `&&` and
`||`. `className` becomes `class`, React attribute spellings such as `colSpan`
are lowercased, and a `style={{ … }}` object of literals is serialised to a CSS
string at compile time.

### What does not compile, and why

Every rejection is reported by name. The reason is always the same one: the
render worker has no evaluator.

| Construct | Rejected as |
| --- | --- |
| `{formatDate(x)}`, any call | `function-call` — use a filter |
| `f.shout(x)` | `unknown-filter` |
| `f.truncate(a, b)` with a non-literal argument | `filter-argument` |
| a prop named `f` | `reserved-filter-namespace` |
| `React.createElement(…)` | `create-element` |
| `` {`hi ${a}`} `` | `template-literal` |
| ``tag`x` `` | `tagged-template` |
| `{n * 2}`, `{a % b}` | `arithmetic-operator` |
| `{'Hi ' + name}` | `string-concatenation` |
| `href={a && b}`, `{a \|\| b}` as a value | `logical-value` |
| `href={a ? 'x' : 'y'}` | `ternary-in-attribute` |
| `{-n}`, `{void x}` | `unary-operator` |
| `{typeof a}` | `typeof-operator` |
| `{a instanceof Date}` | `instanceof-operator` |
| `{(a, b)}` | `sequence-expression` |
| `{(a.x = 1)}` | `assignment` |
| `{a.x++}` | `update-expression` |
| `{new Date()}` | `new-expression` |
| `{await p}` | `await-expression` |
| `{o.fn?.()}` | `optional-call` |
| `<Text {...props}>` | `spread-attribute` |
| `<Text>{...xs}</Text>` | `spread-child` |
| `f.default(a, ...rest)` | `spread-element` |
| `{o[key]}` with a non-literal key | `computed-member` |
| `{props}` on its own | `member-expression-root` |
| `{o.__proto__}`, `.constructor`, `.prototype` | `prototype-path` |
| an identifier that is not a prop or loop binding | `unresolved-identifier` |
| `.filter()`, `.reduce()`, `.slice()`, … | `array-method` — only `.map()` lowers |
| `xs.map(fn)` with a non-inline callback | `map-callback` |
| `xs.map(({ n }) => …)` | `destructured-loop-param` |
| an arrow anywhere but a `.map()` callback | `function-expression` |
| `onClick`, any `on*` prop | `event-handler` |
| `dangerouslySetInnerHTML` | `dangerous-html` |
| `<Sparkle/>` | `unknown-component` |
| `<script>`, `<iframe>`, `<form>`, … | `disallowed-element` |
| `tabindex`, `contenteditable`, … | `disallowed-attribute` |
| `style={{ color: c }}` with a dynamic value | `dynamic-style-object` |
| `{{ x: 1 }}`, `{[1, 2]}`, `{/re/}` | `object-value`, `array-value`, `regexp-literal` |
| `href={<Hr/>}` | `jsx-in-value` |
| `<svg:rect/>`, `<Foo.Bar/>` | `jsx-namespaced-name`, `jsx-member-element` |
| a statement other than the single `return` | `statement-in-component` |
| `({ name = 'x' })` | `destructuring-default` — use `f.default` |
| `({ a, ...rest })` | `rest-element` |
| no `export default` | `no-default-export` |

Every problem in a file is reported in one pass, and the element, attribute,
component and path allowlists come from `@mailysend/templates` itself, so the
compiler and the renderer cannot drift apart.

## `import resend`

```
mailysend import resend --resend-key re_…
```

Migrates domains, audiences and contacts. The run is **resumable**: an import
is a long sequence of creates with no idempotency key, so a run that dies
halfway and restarts from zero would duplicate everything it had already moved.
A source-id → destination-id map is therefore written after every entity, and a
re-run skips anything already in it. Interrupt it as often as you like; the
destination ends up with one of each.

The checkpoint lives in `~/.config/mailysend/state/`, keyed by a fingerprint of
the Resend key rather than the key itself. `--restart` discards it. Resend
exposes no template API, so templates are reported rather than moved — export
them and run `templates push`.

## `tail`

```
mailysend tail --filter email.bounced,email.complained
mailysend tail --json | jq 'select(.data.domain == "acme.com")'
```

Streams over the workspace WebSocket rather than polling. The socket is
expected to drop — the hub hibernates between events — so reconnects with
backoff are normal operation. Requires a Node with a global `WebSocket`
(Node 22+, or Node 20 with `--experimental-websocket`).

## Output

Colour only when stdout is a TTY and `NO_COLOR` is unset. Errors, hints and
progress go to stderr, so `--json` on stdout is always valid JSON. There are no
progress bars: where a total is known you get a counter, and where it is not
you get a spinner and an honest label.
