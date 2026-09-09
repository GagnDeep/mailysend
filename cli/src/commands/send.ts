import { readFile } from 'node:fs/promises'
import { ApiClient } from '../api.ts'
import type { FlagSpecs } from '../args.ts'
import { CliError, type CommandContext } from '../command.ts'
import { resolveCredentials } from '../config.ts'
import { kv, note, ok, out, style } from '../term.ts'

export const sendFlags: FlagSpecs = {
  from: { kind: 'string', short: 'f', describe: 'Sender, e.g. "Acme <hi@acme.com>"' },
  to: { kind: 'list', short: 't', describe: 'Recipients' },
  cc: { kind: 'list', describe: 'Carbon copy' },
  bcc: { kind: 'list', describe: 'Blind carbon copy' },
  'reply-to': { kind: 'list', describe: 'Reply-To addresses' },
  subject: { kind: 'string', short: 's', describe: 'Subject line' },
  text: { kind: 'string', describe: 'Plain text body' },
  html: { kind: 'string', describe: 'HTML body' },
  'html-file': { kind: 'string', describe: 'Read the HTML body from a file' },
  template: { kind: 'string', describe: 'Template id to render' },
  data: { kind: 'string', describe: 'JSON template data' },
  tag: { kind: 'list', describe: 'Tags as name=value' },
  'scheduled-at': { kind: 'string', describe: 'ISO time, or "in 30 min"' },
  provider: { kind: 'string', describe: 'Pin one transport: cloudflare|ses|resend|smtp' },
  json: { kind: 'boolean', describe: 'Print the API response as JSON' },
}

const parseTags = (raw: string[]) =>
  raw.map((entry) => {
    const [name, ...rest] = entry.split('=')
    if (!name || rest.length === 0) {
      throw new CliError(`--tag expects name=value, got "${entry}"`)
    }
    return { name, value: rest.join('=') }
  })

export const send = async (ctx: CommandContext) => {
  const flags = ctx.args.flags
  const to = flags.to as string[]
  const positional = ctx.args.positionals.slice(1)
  const recipients = to.length > 0 ? to : positional

  if (recipients.length === 0) throw new CliError('No recipients. Pass --to someone@example.com')
  if (!flags.from) {
    throw new CliError('No sender.', { hint: 'Pass --from, or set MAILYSEND_FROM.' })
  }
  if (!flags.subject) throw new CliError('No subject. Pass --subject')

  const htmlFile = flags.htmlFile as string | undefined
  const html = htmlFile ? await readFile(htmlFile, 'utf8') : (flags.html as string | undefined)
  const text = flags.text as string | undefined
  const templateId = flags.template as string | undefined

  if (!html && !text && !templateId) {
    throw new CliError('Nothing to send.', {
      hint: 'Provide --text, --html, --html-file or --template.',
    })
  }

  const tags = parseTags(flags.tag as string[])
  const body = {
    from: flags.from,
    to: recipients,
    subject: flags.subject,
    ...((flags.cc as string[]).length > 0 ? { cc: flags.cc } : {}),
    ...((flags.bcc as string[]).length > 0 ? { bcc: flags.bcc } : {}),
    ...((flags.replyTo as string[]).length > 0 ? { reply_to: flags.replyTo } : {}),
    ...(html === undefined ? {} : { html }),
    ...(text === undefined ? {} : { text }),
    ...(templateId === undefined ? {} : { template_id: templateId }),
    ...(flags.data === undefined ? {} : { template_data: JSON.parse(String(flags.data)) }),
    ...(tags.length === 0 ? {} : { tags }),
    ...(flags.scheduledAt === undefined ? {} : { scheduled_at: flags.scheduledAt }),
    ...(flags.provider === undefined ? {} : { provider: flags.provider }),
  }

  const client = new ApiClient(await resolveCredentials(ctx.global))
  const response = await client.post<{ id: string; created_at?: string }>('/emails', body)

  if (flags.json === true) {
    out(JSON.stringify(response, null, 2))
    return
  }

  out()
  kv([
    ['id', style.cyan(response.id)],
    ['to', recipients.join(', ')],
    ['subject', String(flags.subject)],
    ...(flags.scheduledAt === undefined
      ? []
      : ([['scheduled', String(flags.scheduledAt)]] as [string, string][])),
  ])
  out()
  ok(flags.scheduledAt === undefined ? 'Queued for delivery.' : 'Scheduled.')
  note(`mailysend logs ${response.id}`)
}
