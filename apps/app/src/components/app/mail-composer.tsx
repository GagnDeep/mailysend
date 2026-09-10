import {
  Badge,
  Button,
  Callout,
  cn,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@mailysend/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Paperclip,
  Quote,
  Send,
  Underline,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type Squire from 'squire-rte'
import { bytes } from '~/components/app/format.ts'
import { IdentityPicker } from '~/components/app/identity-picker.tsx'
import { bare, RecipientField } from '~/components/app/recipient-field.tsx'
import { useAppScope } from '~/components/app/scope.tsx'
import {
  createApiClient,
  type MailDraftRecord,
  type MailMessageRecord,
  type MailThreadDetailRecord,
} from '~/lib/api-client.ts'
import { quoteForReply, sanitizeMailHtml } from '~/lib/mail-html.ts'
import { qk } from '~/lib/query.ts'

/**
 * Composing.
 *
 * Squire rather than a general-purpose rich-text editor because the hard parts
 * of writing *email* are the ones it already solves: multi-level blockquotes
 * that survive a reply chain, and arbitrary sender HTML preserved intact on a
 * forward. Its `sanitizeToDOMFragment` hook is pointed at the same allowlist
 * the reading pane uses, so pasted and quoted markup passes through exactly one
 * sanitiser rather than two that disagree.
 */

export interface ComposerSeed {
  mode: 'new' | 'reply' | 'reply_all' | 'forward'
  thread?: MailThreadDetailRecord
  message?: MailMessageRecord
  /** Reopening a saved draft, from the Drafts folder. */
  draft?: MailDraftRecord
}

export interface MailComposerProps {
  seed: ComposerSeed
  onClose: () => void
  onSent: () => void
}

/** `Ana <ana@x>` keeps its display name on the wire; the guard checks the address. */
const looksSendable = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bare(value))

export function MailComposer({ seed, onClose, onSent }: MailComposerProps) {
  const { api, environment, workspaceId } = useAppScope()
  // Reopening a draft keeps its id, so saving overwrites the row rather than
  // leaving the original behind as a duplicate every time it is opened.
  const draftId = useMemo(
    () => seed.draft?.id ?? `drf_${Math.random().toString(36).slice(2, 12)}`,
    [seed.draft?.id],
  )
  const fieldId = useId()

  const parent = seed.message
  const isReply = seed.mode === 'reply' || seed.mode === 'reply_all'

  const [to, setTo] = useState<string[]>(() => {
    if (seed.draft) return seed.draft.to ?? []
    if (!parent) return []
    if (seed.mode === 'forward') return []
    return parent.direction === 'in' ? [parent.from] : parent.to
  })
  const [cc, setCc] = useState<string[]>(() =>
    seed.draft ? (seed.draft.cc ?? []) : seed.mode === 'reply_all' && parent ? parent.cc : [],
  )
  const [bcc, setBcc] = useState<string[]>(() => seed.draft?.bcc ?? [])
  const [showCc, setShowCc] = useState(seed.mode === 'reply_all')
  const [showFromDetail, setShowFromDetail] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkOpen, setLinkOpen] = useState(false)
  const [subject, setSubject] = useState(() => {
    if (seed.draft) return seed.draft.subject ?? ''
    if (!parent) return ''
    const base = parent.subject.replace(/^((re|fwd?):\s*)+/i, '')
    return seed.mode === 'forward' ? `Fwd: ${base}` : `Re: ${base}`
  })
  const [text, setText] = useState(seed.draft?.text ?? '')
  const [html, setHtml] = useState(seed.draft?.html ?? '')
  const [view, setView] = useState('rich')
  const [replyTo, setReplyTo] = useState('')
  const [fromName, setFromName] = useState('')
  /**
   * Once the plain part has been written by hand it stops being derived from the
   * HTML. Both tabs used to be one-way and the next rich keystroke silently
   * overwrote whatever had been typed in either — which is why "I needed to send
   * html or plain" did not work.
   */
  const [plainIsManual, setPlainIsManual] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [testMode, setTestMode] = useState(environment === 'test')
  const [scheduledAt, setScheduledAt] = useState('')
  /**
   * Deliver on the request, rather than handing the message to the send queue.
   *
   * On by default, and the reason is what happens when it is off: the API
   * answers `202` the moment the message is on the queue, the composer says
   * Sent, and if nothing is consuming that queue — Cloudflare Queues are not on
   * every plan, and a consumer can simply not be attached — the message sits at
   * `sending` with no provider and no error, forever. Inline sending is slower
   * by exactly one provider call and tells the truth.
   */
  const [immediate, setImmediate] = useState(true)
  const [attachments, setAttachments] = useState<
    { key: string; filename: string; content_type: string; size: number }[]
  >([])

  const editorHost = useRef<HTMLDivElement>(null)
  const editor = useRef<Squire | null>(null)
  /** Undoes whatever the callback ref set up, when the node detaches. */
  const teardown = useRef<(() => void) | null>(null)
  /** The seed as it was when the sheet opened; the editor is built once. */
  const seedRef = useRef(seed)
  /** Read inside the Squire listener, which closes over its first render. */
  const plainManual = useRef(false)

  // Every address the workspace can actually send as, from the server. The old
  // list was `mail@` glued onto each verified domain — a string, not a fact.
  const identities = useQuery({
    queryKey: qk.mailIdentities(environment),
    queryFn: () => api.listMailIdentities(),
  })

  const rows = identities.data?.data ?? []
  const sendableDomains = identities.data?.sendable_domains ?? []
  const [from, setFrom] = useState(seed.draft?.from ?? '')

  useEffect(() => {
    if (from) return
    // On a reply, the identity is the address the parent was addressed to —
    // replying from the wrong inbox was previously the only option, because the
    // default was always the first verified domain.
    if (parent && isReply) {
      const addressedTo = parent.direction === 'in' ? parent.to : [parent.from]
      const owned = addressedTo.find((address) =>
        rows.some((identity) => identity.address.toLowerCase() === bare(address)),
      )
      if (owned) {
        setFrom(bare(owned))
        return
      }
    }
    const first =
      rows.find((identity) => identity.source === 'mailbox') ??
      rows[0] ??
      (testMode ? { address: 'test@test.invalid' } : null)
    if (first) setFrom(first.address)
  }, [rows, from, testMode, parent, isReply])

  /**
   * Squire is instantiated once, when the body element actually attaches.
   *
   * Two things kept the editor from ever existing, and both are answered here.
   * The import was static, and Squire reads `document` at module scope — which
   * threw during server rendering and took the whole Mail route's SSR with it.
   * And the instantiation lived in a mount effect reading `editorHost.current`,
   * which is still `null` at that point: Radix mounts the sheet's subtree after
   * the component's own effects have run, so the effect returned early, its
   * dependencies never changed, and it never ran again. The body stayed an
   * empty div nobody could type into.
   *
   * A callback ref fires when the node exists, whenever that turns out to be.
   * React never touches the contenteditable afterwards: two owners of one DOM
   * subtree is how a cursor ends up jumping to the start of the document on
   * every keystroke.
   */
  const attachEditor = useCallback((host: HTMLDivElement | null) => {
    editorHost.current = host
    if (!host) {
      teardown.current?.()
      teardown.current = null
      editor.current = null
      return
    }
    if (editor.current) return

    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let instance: Squire | undefined

    void (async () => {
      const { default: Squire } = await import('squire-rte')
      if (disposed) return
      instance = new Squire(host, {
        blockTag: 'div',
        sanitizeToDOMFragment: (dirty: string) => {
          const clean = sanitizeMailHtml(dirty, { allowRemoteImages: true }).html
          const template = document.createElement('template')
          template.innerHTML = clean
          return template.content
        },
      })
      editor.current = instance

      const seeded =
        seedRef.current.draft?.html ??
        (seedRef.current.message &&
        (seedRef.current.mode === 'reply' ||
          seedRef.current.mode === 'reply_all' ||
          seedRef.current.mode === 'forward')
          ? quoteForReply({
              from: seedRef.current.message.from,
              at: seedRef.current.message.at,
              html: seedRef.current.message.html ?? null,
              text: seedRef.current.message.text ?? null,
            })
          : '')
      instance.setHTML(seedRef.current.draft?.html ? seeded : `<div><br></div>${seeded}`)

      // Deriving the plain part meant a full `DOMParser` parse of the whole
      // document on every keystroke — O(document) per character on a long
      // quoted reply. The editor owns its own DOM either way, so the
      // React-visible copies can lag a frame behind the caret unnoticed.
      const editing = instance
      editing.addEventListener('input', () => {
        setDirty(true)
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          const value = editing.getHTML()
          setHtml(value)
          setText((current) => (plainManual.current ? current : htmlToText(value)))
        }, 150)
      })
      // The sheet's `onOpenAutoFocus` has already run by the time the module
      // arrives, so the caret is placed here rather than lost to the race.
      editing.focus()
    })()

    teardown.current = () => {
      disposed = true
      if (timer) clearTimeout(timer)
      instance?.destroy()
    }
  }, [])

  /**
   * Focus lands in the body, once, after the sheet has finished opening.
   *
   * Radix moves focus to the first tabbable descendant on open, which ran after
   * the editor's own `focus()` in the mount effect above and took the caret to
   * the From field — so the body looked like it could not be typed into at all.
   * `onOpenAutoFocus` is the hook that settles it; the editor's self-focus is
   * gone, because two things claiming focus is what caused this.
   */
  const focusEditor = useCallback(() => {
    editor.current?.focus()
  }, [])

  // Autosave. A composer that loses forty minutes of typing to a refresh is the
  // single most expensive bug a mail client can have.
  const hasContent =
    dirty || to.length > 0 || cc.length > 0 || bcc.length > 0 || subject.trim() !== ''

  useEffect(() => {
    // Nothing is saved until something has been written. Opening the composer
    // and closing it again used to leave an empty draft behind every time, and
    // with a Drafts folder in the rail that junk is now visible.
    if (!hasContent) return
    const timer = setTimeout(() => {
      void api
        .saveMailDraft(draftId, {
          thread_id: seed.thread?.id ?? null,
          mode: seed.mode,
          from,
          to,
          cc,
          bcc,
          subject,
          html,
          text,
        })
        .catch(() => {
          // Autosave is best-effort; a failed save must not interrupt typing.
        })
    }, 2_000)
    return () => clearTimeout(timer)
  }, [api, draftId, seed.thread?.id, seed.mode, from, to, cc, bcc, subject, html, text, hasContent])

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadMailAttachment(file),
    onSuccess: (result) =>
      setAttachments((value) => [
        ...value,
        {
          key: result.key,
          filename: result.filename,
          content_type: result.content_type,
          size: result.size,
        },
      ]),
    onError: (error: Error) => toast.error('Upload failed', { description: error.message }),
  })

  const send = useMutation({
    mutationFn: async () => {
      // The environment is a header, so sending in test mode from a live
      // dashboard is a differently scoped client, not a flag on the body.
      const client =
        testMode && environment !== 'test'
          ? createApiClient({ environment: 'test', workspaceId })
          : api
      const sender = fromName.trim() ? `${fromName.trim()} <${bare(from)}>` : from.trim()
      return client.sendMail({
        ...(seed.thread ? { thread_id: seed.thread.id } : {}),
        from: sender,
        to,
        ...(cc.length ? { cc } : {}),
        ...(bcc.length ? { bcc } : {}),
        ...(replyTo.trim() ? { reply_to: [replyTo.trim()] } : {}),
        subject,
        html,
        text,
        ...(attachments.length ? { attachments } : {}),
        ...(scheduledAt ? { scheduled_at: new Date(scheduledAt).toISOString() } : { immediate }),
        ...(parent?.message_id ? { in_reply_to: parent.message_id } : {}),
        ...(parent
          ? { references: [...parent.references, parent.message_id].filter(Boolean) }
          : {}),
      })
    },
    onSuccess: (result) => {
      void api.deleteMailDraft(draftId).catch(() => {})
      toast.success(
        testMode && environment !== 'test'
          ? 'Sent in Test mode — switch the environment switch to Test to read it'
          : scheduledAt
            ? 'Scheduled'
            : immediate
              ? 'Sent'
              : 'Queued',
        { description: result.id },
      )
      onSent()
    },
    onError: (error: Error) => toast.error('Could not send', { description: error.message }),
  })

  const applyFormat = useCallback((fn: (instance: Squire) => void) => {
    const instance = editor.current
    if (!instance) return
    fn(instance)
    instance.focus()
    const value = instance.getHTML()
    setHtml(value)
    setDirty(true)
    if (!plainManual.current) setText(htmlToText(value))
  }, [])

  const canSend = looksSendable(from) && to.length > 0 && to.every(looksSendable) && !send.isPending

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-3 sm:max-w-[720px]"
        onOpenAutoFocus={(event) => {
          // See `focusEditor`: Radix's default would move the caret to the From
          // field, which is what made the body unusable.
          event.preventDefault()
          focusEditor()
        }}
      >
        <SheetHeader>
          <SheetTitle>
            {seed.mode === 'forward' ? 'Forward' : isReply ? 'Reply' : 'New message'}
          </SheetTitle>
        </SheetHeader>

        {testMode ? (
          <Callout variant="info" title="Test mode">
            Nothing leaves this process. The message is built exactly as a provider would build it,
            then delivered straight back into the Test inbox — headers, attachments and raw
            <code> .eml</code> included.
          </Callout>
        ) : null}

        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <Label
              htmlFor={`${fieldId}-from`}
              className="w-14 shrink-0 pt-2 text-[12.5px] text-muted"
            >
              From
            </Label>
            <IdentityPicker
              id={`${fieldId}-from`}
              value={from}
              onChange={setFrom}
              identities={rows}
              sendableDomains={sendableDomains}
              permissive={testMode}
            />
            <Button size="sm" variant="ghost" onClick={() => setShowFromDetail((v) => !v)}>
              {showFromDetail ? 'Less' : 'Name / Reply-to'}
            </Button>
          </div>

          {showFromDetail ? (
            <div className="flex flex-wrap items-center gap-2 pl-16">
              <Input
                value={fromName}
                onChange={(event) => setFromName(event.target.value)}
                placeholder="Display name"
                aria-label="Display name"
                className="h-8 max-w-[220px]"
              />
              <Input
                value={replyTo}
                onChange={(event) => setReplyTo(event.target.value)}
                placeholder="Reply-to address"
                aria-label="Reply-to"
                className="h-8 max-w-[280px]"
              />
            </div>
          ) : null}

          <div className="flex items-start gap-2">
            <Label
              htmlFor={`${fieldId}-to`}
              className="w-14 shrink-0 pt-2 text-[12.5px] text-muted"
            >
              To
            </Label>
            <RecipientField
              id={`${fieldId}-to`}
              value={to}
              onChange={setTo}
              placeholder="someone@example.com"
              aria-label="To"
            />
            <Button size="sm" variant="ghost" onClick={() => setShowCc((value) => !value)}>
              Cc/Bcc
            </Button>
          </div>

          {showCc ? (
            <>
              <div className="flex items-start gap-2">
                <Label
                  htmlFor={`${fieldId}-cc`}
                  className="w-14 shrink-0 pt-2 text-[12.5px] text-muted"
                >
                  Cc
                </Label>
                <RecipientField id={`${fieldId}-cc`} value={cc} onChange={setCc} aria-label="Cc" />
              </div>
              <div className="flex items-start gap-2">
                <Label
                  htmlFor={`${fieldId}-bcc`}
                  className="w-14 shrink-0 pt-2 text-[12.5px] text-muted"
                >
                  Bcc
                </Label>
                <RecipientField
                  id={`${fieldId}-bcc`}
                  value={bcc}
                  onChange={setBcc}
                  aria-label="Bcc"
                />
              </div>
            </>
          ) : null}

          <div className="flex items-center gap-2">
            <Label
              htmlFor={`${fieldId}-subject`}
              className="w-14 shrink-0 text-[12.5px] text-muted"
            >
              Subject
            </Label>
            <Input
              id={`${fieldId}-subject`}
              value={subject}
              onChange={(event) => {
                setSubject(event.target.value)
                setDirty(true)
              }}
            />
          </div>
        </div>

        <Tabs
          value={view}
          onValueChange={(next) => {
            // Leaving the HTML tab is what commits a hand-edit back into the
            // editor. Without this the tabs were one-way: the edit stayed in
            // React state, the editor still held the pre-edit document, and the
            // next rich keystroke overwrote the edit with it.
            if (view === 'html' && next !== 'html') editor.current?.setHTML(html)
            setView(next)
            if (next === 'rich') window.setTimeout(focusEditor, 0)
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList>
            <TabsTrigger value="rich">Rich</TabsTrigger>
            <TabsTrigger value="html">HTML</TabsTrigger>
            <TabsTrigger value="plain">Plain</TabsTrigger>
          </TabsList>

          {/* The editor is mounted once and only hidden, never unmounted: a tab
              switch that destroyed the Squire instance would take the undo
              history and the caret with it. */}
          <div className={cn('flex min-h-0 flex-1 flex-col', view === 'rich' ? '' : 'hidden')}>
            <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-1 py-1">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Bold"
                onClick={() => applyFormat((e) => (e.hasFormat('B') ? e.removeBold() : e.bold()))}
              >
                <Bold className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Italic"
                onClick={() =>
                  applyFormat((e) => (e.hasFormat('I') ? e.removeItalic() : e.italic()))
                }
              >
                <Italic className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Underline"
                onClick={() =>
                  applyFormat((e) => (e.hasFormat('U') ? e.removeUnderline() : e.underline()))
                }
              >
                <Underline className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Bulleted list"
                onClick={() => applyFormat((e) => e.makeUnorderedList())}
              >
                <List className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Numbered list"
                onClick={() => applyFormat((e) => e.makeOrderedList())}
              >
                <ListOrdered className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Quote"
                onClick={() => applyFormat((e) => e.increaseQuoteLevel())}
              >
                <Quote className="size-3.5" />
              </Button>
              {/* `window.prompt` blurs the editor, and Squire's saved selection
                  goes with the blur — so `makeLink` ran against no range at all
                  about half the time. A popover keeps the document focused. */}
              <Popover
                open={linkOpen}
                onOpenChange={(open) => {
                  if (open) editor.current?.saveUndoState()
                  setLinkOpen(open)
                }}
              >
                <PopoverTrigger asChild>
                  <Button size="sm" variant="ghost" aria-label="Link">
                    <Link2 className="size-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="flex w-[320px] items-center gap-2 p-2">
                  <Input
                    autoFocus
                    value={linkUrl}
                    onChange={(event) => setLinkUrl(event.target.value)}
                    placeholder="https://example.com"
                    aria-label="Link URL"
                    className="h-8"
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      if (linkUrl.trim()) applyFormat((e) => e.makeLink(linkUrl.trim()))
                      setLinkUrl('')
                      setLinkOpen(false)
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (linkUrl.trim()) applyFormat((e) => e.makeLink(linkUrl.trim()))
                      setLinkUrl('')
                      setLinkOpen(false)
                    }}
                  >
                    Link
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
            <div
              ref={attachEditor}
              className="min-h-[220px] flex-1 overflow-auto rounded-sm border border-line-soft bg-paper p-3 text-[14px] leading-relaxed"
            />
          </div>

          <TabsContent value="html" className="min-h-0 flex-1">
            <Textarea
              value={html}
              onChange={(event) => {
                setHtml(event.target.value)
                setDirty(true)
                if (!plainManual.current) setText(htmlToText(event.target.value))
              }}
              className="min-h-[260px] font-mono text-[12.5px]"
              aria-label="HTML body"
            />
          </TabsContent>

          <TabsContent value="plain" className="min-h-0 flex-1">
            <Textarea
              value={text}
              onChange={(event) => {
                // From here on the plain part is the author's, not a derivation.
                plainManual.current = true
                setPlainIsManual(true)
                setText(event.target.value)
                setDirty(true)
              }}
              className="min-h-[260px] font-mono text-[12.5px]"
              aria-label="Plain-text body"
            />
            {plainIsManual ? (
              <p className="m-0 mt-1.5 flex items-center gap-2 text-[12px] text-muted-2">
                Written by hand — it will no longer follow the rich text.
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    plainManual.current = false
                    setPlainIsManual(false)
                    setText(htmlToText(html))
                  }}
                >
                  Re-derive from the HTML
                </button>
              </p>
            ) : null}
          </TabsContent>
        </Tabs>

        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((attachment) => (
              <Badge key={attachment.key} variant="neutral" size="sm">
                {attachment.filename} · {bytes(attachment.size)}
                <button
                  type="button"
                  aria-label={`Remove ${attachment.filename}`}
                  onClick={() =>
                    setAttachments((value) => value.filter((a) => a.key !== attachment.key))
                  }
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!canSend} onClick={() => send.mutate()}>
              <Send className="size-4" />{' '}
              {scheduledAt ? 'Schedule' : immediate ? 'Send now' : 'Send'}
            </Button>

            <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
              <input
                type="file"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) upload.mutate(file)
                  event.target.value = ''
                }}
              />
              <Paperclip className="size-4" /> Attach
            </label>

            <span className="inline-flex items-center gap-2 text-[12.5px] text-muted">
              Send at
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                className="h-8 w-[210px]"
                aria-label="Schedule send"
              />
            </span>

            {scheduledAt ? null : (
              <span className="inline-flex items-center gap-2 text-[12.5px] text-muted">
                <Switch
                  checked={immediate}
                  onCheckedChange={setImmediate}
                  aria-label="Send immediately"
                />
                {immediate ? 'Send immediately' : 'Queue for background sending'}
              </span>
            )}
          </div>

          <span className="inline-flex items-center gap-2 text-[12.5px] text-muted">
            <Switch
              checked={testMode}
              onCheckedChange={setTestMode}
              aria-label="Send in test mode"
            />
            Test mode
          </span>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * The plain-text alternative, derived rather than demanded.
 *
 * Every message goes out with both parts: a text/plain alternative is a
 * deliverability signal as much as an accessibility one, and asking a person to
 * write their message twice guarantees the second copy rots.
 */
function htmlToText(value: string): string {
  const doc = new DOMParser().parseFromString(value, 'text/html')
  for (const br of [...doc.querySelectorAll('br')]) br.replaceWith('\n')
  for (const block of [...doc.querySelectorAll('div,p,li,blockquote')]) {
    block.append('\n')
  }
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}
