# Mail

`/app/mail` is one conversation view over both directions: a message you sent
and the reply it earned sit in the same thread, with the outbound one showing its
live delivery state inline.

## Test mode — usable with no DNS at all

On a brand-new instance, with **no domain, no DNS and no provider credentials**:

1. Open `/app/mail` and press **Compose**.
2. Turn on **Test mode**.
3. Send.

The message is built as MIME exactly as a transport would build it — same bytes,
same headers, same DKIM signing path — and then delivered into the Test inbox
instead of being handed to a provider. It arrives fully rendered, with
attachments, headers and the raw `.eml`.

This is the fastest way to see what your mail actually looks like, and the only
way to see it before DNS exists.

## Reading safely

An HTML email is a document written by somebody who is not you, and the reading
pane treats it that way.

- **An opaque-origin iframe.** `sandbox="allow-scripts allow-popups
  allow-popups-to-escape-sandbox"` with **no `allow-same-origin`**, so the
  document cannot reach the dashboard's DOM, storage or cookies. `allow-scripts`
  exists for one height-reporting script; the sanitiser has removed every other.
- **An allowlist sanitiser**, not a blocklist. `script`, `iframe`, `object`,
  `embed`, `form`, `link`, `base` and every `on*` handler are gone;
  `javascript:` and `data:text/html` URLs are refused; stylesheets survive but
  `@import`, `position:fixed` and `expression()` do not.
- **Remote images blocked by default**, with a *Show images* bar. This is a
  privacy setting, and it defeats the tracking pixels this product itself ships.
  Enforced twice: the sanitiser rewrites `src` to a transparent pixel, and a CSP
  `<meta>` in the frame blocks anything it missed.
- **`cid:` attachments** are fetched by the parent, which has credentials, and
  handed to the frame as `blob:` URLs — so the frame needs none.

## Views

Five tabs per message: **Rendered · Plain text · HTML source · Headers · Raw
.eml**, plus desktop/mobile width and a dark-mode preview. For an email platform
these are debugging tools, not flourishes: "it looks wrong in Outlook" is a
question about bytes.

## Composing

The composer is [Squire](https://github.com/fastmail/Squire) (Fastmail, MIT,
16 KB gzip, no dependencies), chosen over a general-purpose editor because it
handles the two things email actually needs: multi-level blockquotes for replies,
and arbitrary-HTML preservation for forwards. Pasted and forwarded HTML goes
through the same allowlist as the reader — one sanitiser, not two.

Rich · HTML · Plain tabs keep the exact bytes going on the wire inspectable.

## Organisation

Read/unread, star, archive, spam, trash (soft; purged after 30 days), labels with
colours, snooze, and bulk selection. Selection lives in the URL, so a narrowed
view is a pasteable link.

## Search

An operator grammar over an FTS5 index:

```
from:  to:  subject:  label:  in:  mailbox:  before:  after:
is:unread  is:starred  is:sent  has:attachment
```

Prefix any operator with `-` to negate it. Quote a phrase. An operator that does
not exist is treated as text rather than as a column name — column names come
from a registry and values are always bound parameters, so an injection is not
escaped, it is unrepresentable.

## Keyboard

Gmail-compatible, because muscle memory is the whole point:

| | |
|---|---|
| `j` / `k` | next / previous thread |
| `Enter` | open |
| `u` | back to the list |
| `x` | select |
| `e` | archive |
| `#` | trash |
| `s` | star |
| `r` / `a` / `f` | reply / reply all / forward |
| `c` | compose |
| `/` | search |
| `?` | this list |

## Live updates

On Workers, the dashboard opens a WebSocket to `/v1/live` and the mail queries
invalidate as messages arrive. **On Node this does not work** — `packages/platform`
has no WebSocket abstraction and the actor registry has no socket server, so the
upgrade returns 501 and the queries fall back to polling every 60 seconds. That
costs freshness, never correctness.

## See also

- [RECEIVING.md](RECEIVING.md) — getting mail to arrive at all.
- [SENDING.md](SENDING.md) — transports and DNS.
