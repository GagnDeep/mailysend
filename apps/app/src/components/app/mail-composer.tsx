import {
  Badge,
  Button,
  Callout,
  cn,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
import Squire from 'squire-rte'
import { bytes } from '~/components/app/format.ts'
import { useAppScope } from '~/components/app/scope.tsx'
import {
  createApiClient,
  type MailMessageRecord,
  type MailThreadDetailRecord,
} from '~/lib/api-client.ts'
import { quoteForReply, sanitizeMailHtml } from '~/lib/mail-html.ts'

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
}

export interface MailComposerProps {
  seed: ComposerSeed
  onClose: () => void
  onSent: () => void
}

const addressList = (value: string): string[] =>
  value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)

export function MailComposer({ seed, onClose, onSent }: MailComposerProps) {
  const { api, environment, workspaceId } = useAppScope()
  const draftId = useMemo(() => `drf_${Math.random().toString(36).slice(2, 12)}`, [])
  const fieldId = useId()

  const parent = seed.message
  const isReply = seed.mode === 'reply' || seed.mode === 'reply_all'

  const [to, setTo] = useState(() => {
    if (!parent) return ''
    if (seed.mode === 'forward') return ''
    return parent.direction === 'in' ? parent.from : parent.to.join(', ')
  })
  const [cc, setCc] = useState(() =>
    seed.mode === 'reply_all' && parent ? parent.cc.join(', ') : '',
  )
  const [bcc, setBcc] = useState('')
  const [showCc, setShowCc] = useState(seed.mode === 'reply_all')
  const [subject, setSubject] = useState(() => {
    if (!parent) return ''
    const base = parent.subject.replace(/^((re|fwd?):\s*)+/i, '')
    return seed.mode === 'forward' ? `Fwd: ${base}` : `Re: ${base}`
  })
  const [text, setText] = useState('')
  const [html, setHtml] = useState('')
  const [view, setView] = useState('rich')
  const [testMode, setTestMode] = useState(environment === 'test')
  const [scheduledAt, setScheduledAt] = useState('')
  const [attachments, setAttachments] = useState<
    { key: string; filename: string; content_type: string; size: number }[]
  >([])

  const editorHost = useRef<HTMLDivElement>(null)
  const editor = useRef<Squire | null>(null)

  const domains = useQuery({ queryKey: ['mail', 'from-domains'], queryFn: () => api.listDomains() })

  const verified = (domains.data?.data ?? []).filter((domain) => domain.status === 'verified')
  const [from, setFrom] = useState('')

  useEffect(() => {
    if (from) return
    // In test mode nothing leaves the process, so an unverified domain is not
    // a deliverability lie — it is the only way a fresh instance can compose at
    // all. In live mode only a verified domain is offered.
    const first = verified[0]?.name ?? (testMode ? 'test.invalid' : '')
    if (first) setFrom(`mail@${first}`)
  }, [verified, from, testMode])

  // Squire is instantiated once. React never touches the contenteditable after
  // that: two owners of one DOM subtree is how a cursor ends up jumping to the
  // start of the document on every keystroke.
  useEffect(() => {
    const host = editorHost.current
    if (!host || editor.current) return
    const instance = new Squire(host, {
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
      parent && (isReply || seed.mode === 'forward')
        ? quoteForReply({
            from: parent.from,
            at: parent.at,
            html: parent.html ?? null,
            text: parent.text ?? null,
          })
        : ''
    instance.setHTML(`<div><br></div>${seeded}`)
    instance.addEventListener('input', () => {
      const value = instance.getHTML()
      setHtml(value)
      setText(htmlToText(value))
    })
    instance.focus()
    return () => {
      instance.destroy()
      editor.current = null
    }
  }, [isReply, parent, seed.mode])

  // Autosave. A composer that loses forty minutes of typing to a refresh is the
  // single most expensive bug a mail client can have.
  useEffect(() => {
    const timer = setTimeout(() => {
      void api
        .saveMailDraft(draftId, {
          thread_id: seed.thread?.id ?? null,
          mode: seed.mode,
          from,
          to: addressList(to),
          cc: addressList(cc),
          bcc: addressList(bcc),
          subject,
          html,
          text,
        })
        .catch(() => {
          // Autosave is best-effort; a failed save must not interrupt typing.
        })
    }, 2_000)
    return () => clearTimeout(timer)
  }, [api, draftId, seed.thread?.id, seed.mode, from, to, cc, bcc, subject, html, text])

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
      return client.sendMail({
        ...(seed.thread ? { thread_id: seed.thread.id } : {}),
        from,
        to: addressList(to),
        ...(addressList(cc).length ? { cc: addressList(cc) } : {}),
        ...(addressList(bcc).length ? { bcc: addressList(bcc) } : {}),
        subject,
        html,
        text,
        ...(attachments.length ? { attachments } : {}),
        ...(scheduledAt ? { scheduled_at: new Date(scheduledAt).toISOString() } : {}),
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
            : 'Sent',
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
    setText(htmlToText(value))
  }, [])

  const canSend = from.trim() !== '' && addressList(to).length > 0 && !send.isPending

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 sm:max-w-[720px]">
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
          <div className="flex items-center gap-2">
            <Label htmlFor={`${fieldId}-from`} className="w-14 shrink-0 text-[12.5px] text-muted">
              From
            </Label>
            {verified.length > 0 ? (
              <Select value={from} onValueChange={setFrom}>
                <SelectTrigger id={`${fieldId}-from`} className="flex-1">
                  <SelectValue placeholder="Pick a sending address" />
                </SelectTrigger>
                <SelectContent>
                  {verified.map((domain) => (
                    <SelectItem key={domain.id} value={`mail@${domain.name}`}>
                      mail@{domain.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`${fieldId}-from`}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                placeholder={testMode ? 'anything@test.invalid' : 'You have no verified domain yet'}
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor={`${fieldId}-to`} className="w-14 shrink-0 text-[12.5px] text-muted">
              To
            </Label>
            <Input
              id={`${fieldId}-to`}
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="someone@example.com, another@example.com"
            />
            <Button size="sm" variant="ghost" onClick={() => setShowCc((value) => !value)}>
              Cc/Bcc
            </Button>
          </div>

          {showCc ? (
            <>
              <div className="flex items-center gap-2">
                <Label htmlFor={`${fieldId}-cc`} className="w-14 shrink-0 text-[12.5px] text-muted">
                  Cc
                </Label>
                <Input
                  id={`${fieldId}-cc`}
                  value={cc}
                  onChange={(event) => setCc(event.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label
                  htmlFor={`${fieldId}-bcc`}
                  className="w-14 shrink-0 text-[12.5px] text-muted"
                >
                  Bcc
                </Label>
                <Input
                  id={`${fieldId}-bcc`}
                  value={bcc}
                  onChange={(event) => setBcc(event.target.value)}
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
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
        </div>

        <Tabs value={view} onValueChange={setView} className="flex min-h-0 flex-1 flex-col">
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
              <Button
                size="sm"
                variant="ghost"
                aria-label="Link"
                onClick={() => {
                  const url = window.prompt('Link URL')
                  if (url) applyFormat((e) => e.makeLink(url))
                }}
              >
                <Link2 className="size-3.5" />
              </Button>
            </div>
            <div
              ref={editorHost}
              className="min-h-[220px] flex-1 overflow-auto rounded-sm border border-line-soft bg-paper p-3 text-[14px] leading-relaxed"
            />
          </div>

          <TabsContent value="html" className="min-h-0 flex-1">
            <Textarea
              value={html}
              onChange={(event) => setHtml(event.target.value)}
              className="min-h-[260px] font-mono text-[12.5px]"
              aria-label="HTML body"
            />
          </TabsContent>

          <TabsContent value="plain" className="min-h-0 flex-1">
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="min-h-[260px] font-mono text-[12.5px]"
              aria-label="Plain-text body"
            />
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
              <Send className="size-4" /> {scheduledAt ? 'Schedule' : 'Send'}
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
