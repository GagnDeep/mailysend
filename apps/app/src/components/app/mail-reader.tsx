import {
  Badge,
  Button,
  Callout,
  cn,
  KeyValue,
  KeyValueList,
  MonoChip,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@mailysend/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Download,
  ImageOff,
  Monitor,
  Moon,
  Paperclip,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sun,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { bareAddress, bytes, dateTime } from '~/components/app/format.ts'
import { useApi, useEnvironment } from '~/components/app/scope.tsx'
import type { MailMessageRecord } from '~/lib/api-client.ts'
import { mailFrameDocument, sanitizeMailHtml, textToHtml } from '~/lib/mail-html.ts'
import { qk } from '~/lib/query.ts'

/**
 * One message, read five ways.
 *
 * An email platform's inbox is also a debugging tool: the person reading a
 * message here is often trying to work out why it looks wrong, and "rendered"
 * is only one of the answers. Plain text, HTML source, the headers in arrival
 * order and the original `.eml` are all one tab away, and none of them is
 * reconstructed — they are what is in storage.
 */

const MATCH_COPY: Record<string, { label: string; detail: string; certain: boolean }> = {
  reply_token: {
    label: 'reply token',
    detail:
      'Highest confidence. The reply came back to the per-thread address we minted, so the thread is identified rather than guessed.',
    certain: true,
  },
  in_reply_to: {
    label: 'in-reply-to',
    detail: 'High confidence. The sender echoed the Message-ID of a message in this thread.',
    certain: true,
  },
  references: {
    label: 'references',
    detail:
      'Good confidence. The References header names a message here, though clients rewrite that header more freely than In-Reply-To.',
    certain: true,
  },
  subject_participants: {
    label: 'subject + participants',
    detail:
      'A guess. No threading header survived, so this was attached on subject and participants. Two unrelated messages with the same subject between the same people would land together.',
    certain: false,
  },
  new: {
    label: 'new thread',
    detail: 'Nothing matched, so this started a conversation.',
    certain: true,
  },
}

const authTone = (value: string | null): 'positive' | 'danger' | 'neutral' => {
  if (value === 'pass') return 'positive'
  if (value === 'fail' || value === 'softfail') return 'danger'
  return 'neutral'
}

export interface MailReaderProps {
  message: MailMessageRecord
  /** Collapsed by default for every message but the last one in a thread. */
  defaultOpen?: boolean
}

export function MailReader({ message, defaultOpen = true }: MailReaderProps) {
  const api = useApi()
  const environment = useEnvironment()
  const [open, setOpen] = useState(defaultOpen)
  const [showImages, setShowImages] = useState(false)
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop')
  const [dark, setDark] = useState(false)
  const [view, setView] = useState('rendered')
  const [cidMap, setCidMap] = useState<Record<string, string>>({})
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(320)

  const inlineAttachments = useMemo(
    () => (message.attachments ?? []).filter((a) => a.inline && a.content_id),
    [message.attachments],
  )

  // `cid:` images are fetched here, with the session's cookies, and handed to
  // the frame as `blob:` URLs. The frame itself is on an opaque origin and has
  // no credentials, which is exactly the property that makes it safe.
  useEffect(() => {
    if (!open || inlineAttachments.length === 0) return
    let cancelled = false
    const urls: string[] = []
    void (async () => {
      const entries: [string, string][] = []
      for (const attachment of inlineAttachments) {
        try {
          const blob = await api.getMailAttachmentBlob(attachment.id)
          const url = URL.createObjectURL(blob)
          urls.push(url)
          entries.push([attachment.content_id as string, url])
        } catch {
          // A missing inline image is a broken picture, not a broken message.
        }
      }
      if (!cancelled) setCidMap(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [api, inlineAttachments, open])

  const sanitized = useMemo(() => {
    if (message.html)
      return sanitizeMailHtml(message.html, { allowRemoteImages: showImages, cidMap })
    return { html: textToHtml(message.text ?? ''), blockedImages: 0, hasRemoteContent: false }
  }, [message.html, message.text, showImages, cidMap])

  const srcdoc = useMemo(
    () => mailFrameDocument(sanitized.html, { allowRemoteImages: showImages, dark }),
    [sanitized.html, showImages, dark],
  )

  // The frame is cross-origin by design, so the parent cannot measure it. The
  // one script inside it posts its own height; this is the other half.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      const data = event.data as { type?: string; height?: number }
      if (data?.type === 'ms-mail-height' && typeof data.height === 'number') {
        setHeight(Math.min(Math.max(data.height + 8, 120), 20_000))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const headers = useQuery({
    queryKey: qk.mailHeaders(environment, message.id),
    queryFn: () => api.listMailHeaders(message.id),
    enabled: open && view === 'headers' && Boolean(message.has_raw),
  })

  const raw = useQuery({
    queryKey: qk.mailRaw(environment, message.id),
    queryFn: () => api.getMailRaw(message.id),
    enabled: open && view === 'raw' && Boolean(message.has_raw),
  })

  // A header list's identity genuinely is its order — `Received` appears many
  // times with different values and no other key distinguishes them — so the
  // position is folded into the key here rather than passed as one.
  const headerRows = useMemo(
    () =>
      (headers.data?.data ?? []).map((header, index) => ({
        ...header,
        key: `${index}:${header.name}`,
      })),
    [headers.data],
  )

  const match = message.matched_by ? MATCH_COPY[message.matched_by] : undefined

  return (
    <article
      className={cn(
        'rounded-tile border border-line-soft bg-card',
        message.direction === 'out' && 'border-dashed',
        message.unread && 'border-l-2 border-l-accent',
      )}
    >
      <header className="flex flex-wrap items-start gap-3 p-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="truncate font-medium">
              {message.from_name ?? bareAddress(message.from)}
            </span>
            <span className="truncate text-[12.5px] text-muted-2">{message.from}</span>
            {message.direction === 'out' ? <Badge variant="outline">Sent</Badge> : null}
          </div>
          <p className="truncate text-[12.5px] text-muted-2">
            to {message.to.join(', ') || '—'}
            {message.cc.length > 0 ? ` · cc ${message.cc.join(', ')}` : ''}
          </p>
          {!open ? <p className="truncate text-[12.5px] text-muted-2">{message.snippet}</p> : null}
        </button>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[12.5px] text-muted-2">{dateTime(message.at)}</span>
          {/* What Gmail cannot show you: where this message actually got to. */}
          {message.direction === 'out' && message.status ? (
            <div className="flex items-center gap-1">
              <StatusBadge status={message.status as never} />
              {message.email_id ? (
                <Link
                  to="/app/emails/$emailId"
                  params={{ emailId: message.email_id }}
                  className="text-[12.5px] underline underline-offset-2"
                >
                  timeline
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-line-soft p-3">
          {message.parse_status === 'raw_only' ? (
            <Callout variant="warn" title="Unparsed">
              MIME parsing failed, so there is no rendered body — only the original bytes, which are
              kept exactly as they arrived. The raw tab is the whole message.
            </Callout>
          ) : null}

          {message.direction === 'in' ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {(['spf', 'dkim', 'dmarc'] as const).map((check) => {
                const value = message[check]
                const tone = authTone(value)
                return (
                  <Tooltip key={check}>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-chip border border-line-soft px-1.5 py-0.5',
                          tone === 'positive' && 'border-positive/40 text-positive',
                          tone === 'danger' && 'border-accent-border text-warning',
                          tone === 'neutral' && 'text-muted-2',
                        )}
                      >
                        {tone === 'positive' ? (
                          <ShieldCheck className="size-3" />
                        ) : (
                          <ShieldAlert className="size-3" />
                        )}
                        {check.toUpperCase()} {value ?? 'unknown'}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {value
                        ? `The receiving edge reported ${check.toUpperCase()} ${value}.`
                        : `Nothing reported ${check.toUpperCase()} for this message. Unknown is not the same as pass.`}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
              {match ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        'rounded-chip border border-line-soft px-1.5 py-0.5',
                        match.certain ? 'text-muted-2' : 'border-accent-border text-warning',
                      )}
                    >
                      threaded by {match.label}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{match.detail}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          ) : null}

          {sanitized.blockedImages > 0 ? (
            <div className="flex items-center gap-2 rounded-sm border border-accent-border bg-accent-soft p-2 text-[12.5px]">
              <ImageOff className="size-4 shrink-0" />
              <span className="flex-1">
                {sanitized.blockedImages} remote image
                {sanitized.blockedImages === 1 ? '' : 's'} blocked. Loading them tells the sender
                you opened this — which is exactly how the open tracking in this product works.
              </span>
              <Button size="sm" variant="outline" onClick={() => setShowImages(true)}>
                Show images
              </Button>
            </div>
          ) : null}

          <Tabs value={view} onValueChange={setView}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="rendered">Rendered</TabsTrigger>
                <TabsTrigger value="text">Plain text</TabsTrigger>
                <TabsTrigger value="html">HTML source</TabsTrigger>
                <TabsTrigger value="headers">Headers</TabsTrigger>
                <TabsTrigger value="raw">Raw .eml</TabsTrigger>
              </TabsList>

              {view === 'rendered' ? (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant={width === 'desktop' ? 'outline' : 'ghost'}
                    aria-label="Desktop width"
                    onClick={() => setWidth('desktop')}
                  >
                    <Monitor className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant={width === 'mobile' ? 'outline' : 'ghost'}
                    aria-label="Mobile width"
                    onClick={() => setWidth('mobile')}
                  >
                    <Smartphone className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={dark ? 'Preview on light' : 'Preview on dark'}
                    onClick={() => setDark((value) => !value)}
                  >
                    {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  </Button>
                </div>
              ) : null}
            </div>

            <TabsContent value="rendered">
              <div className={cn('mx-auto', width === 'mobile' ? 'max-w-[390px]' : 'w-full')}>
                <iframe
                  ref={frame}
                  title={`Message ${message.id}`}
                  srcDoc={srcdoc}
                  // No `allow-same-origin`: the document lives in an opaque
                  // origin and cannot reach this page, its storage or its
                  // cookies. `allow-scripts` exists only for the height
                  // reporter; the sanitiser removed every other script.
                  sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  className="w-full rounded-sm border border-line-soft bg-paper"
                  style={{ height }}
                />
              </div>
            </TabsContent>

            <TabsContent value="text">
              <pre className="m-0 max-h-[600px] overflow-auto rounded-sm bg-tint p-3 font-mono text-[12.5px] whitespace-pre-wrap break-words">
                {message.text ?? 'This message had no plain-text alternative.'}
              </pre>
            </TabsContent>

            <TabsContent value="html">
              <pre className="m-0 max-h-[600px] overflow-auto rounded-sm bg-tint p-3 font-mono text-[12.5px] whitespace-pre-wrap break-words">
                {message.html ?? 'This message had no HTML part.'}
              </pre>
            </TabsContent>

            <TabsContent value="headers">
              {!message.has_raw ? (
                <p className="text-[12.5px] text-muted-2">
                  No original is stored for this message — it was composed here and sent, so the
                  headers on the wire were built by the transport.
                </p>
              ) : (
                <KeyValueList>
                  {headerRows.map((header) => (
                    <KeyValue
                      key={header.key}
                      label={header.name}
                      mono
                      value={<span className="break-all">{header.value}</span>}
                    />
                  ))}
                </KeyValueList>
              )}
            </TabsContent>

            <TabsContent value="raw">
              {!message.has_raw ? (
                <p className="text-[12.5px] text-muted-2">
                  No original is stored for this message.
                </p>
              ) : (
                <pre className="m-0 max-h-[600px] overflow-auto rounded-sm bg-tint p-3 font-mono text-[12.5px] whitespace-pre-wrap break-words">
                  {raw.data ?? 'Loading…'}
                </pre>
              )}
            </TabsContent>
          </Tabs>

          {(message.attachments ?? []).length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {(message.attachments ?? []).map((attachment) => (
                <a
                  key={attachment.id}
                  href={attachment.url}
                  className="inline-flex items-center gap-2 rounded-chip border border-line-soft px-2 py-1 text-[12.5px] hover:bg-tint"
                >
                  <Paperclip className="size-3" />
                  <span className="max-w-[220px] truncate">{attachment.filename}</span>
                  <span className="text-muted-2">{bytes(attachment.size)}</span>
                  <Download className="size-3" />
                </a>
              ))}
            </div>
          ) : null}

          {message.message_id ? (
            <p className="text-[11px] text-muted-2">
              <MonoChip>{message.message_id}</MonoChip>
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
