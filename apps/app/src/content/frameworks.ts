/**
 * Sending from the stack you already have.
 *
 * Almost nothing here is first-party, and that is the point. A MailySend
 * deployment is an HTTP API with an OpenAPI document and an SMTP front door, so
 * the integration for any given framework is that framework's own mailer, or
 * `resend`, or `@react-email/components`, or a generated client — libraries
 * that are already installed, already documented and already maintained by
 * somebody else. Writing a first-party equivalent of each one would mean
 * shipping nine half-SDKs to avoid pointing at nine whole ones.
 *
 * So every recipe below is somebody else's library, pointed at your own
 * deployment. The only MailySend-specific parts are a base URL and a key.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS FILE HAS NO MODULE IMPORTS, DELIBERATELY.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Same reason as `doc-sections.ts` beside it: the content modules are read by
 * `tsx` in `scripts/llms.ts`, where the `~` alias does not exist, so anything
 * llms.txt might one day list has to be loadable on its own. It is *not* in the
 * `PURE_DATA_FILES` list in `apps/app/test/guides.manifest.test.ts`, because
 * that assertion is a regex for `^import` and the samples below are code
 * samples — several of them start with an import statement of their own,
 * inside a string, which the regex cannot tell apart from a real one.
 */

export interface FrameworkRecipe {
  /** The tab value, and the `?q=` needle people actually type. */
  value: string
  /** The tab label. */
  label: string
  code: string
}

export interface FrameworkGroup {
  id: string
  title: string
  blurb: string
  /** The caption in the tab strip — what this group of recipes is doing. */
  caption: string
  items: FrameworkRecipe[]
  /** One honest caveat, where one is owed. */
  note?: string
}

const BASE = 'https://your-deployment/v1'

export const FRAMEWORK_GROUPS: FrameworkGroup[] = [
  {
    id: 'javascript',
    title: 'JavaScript & TypeScript',
    caption: 'npm i mailysend',
    blurb:
      'The SDK takes a key and a base URL, or reads MAILYSEND_API_KEY and MAILYSEND_BASE_URL from the environment. Pass a react-email component as `react` and it is rendered where your code runs — React never reaches the wire.',
    items: [
      {
        value: 'nextjs',
        label: 'Next.js',
        code: `// app/actions.ts — npm i mailysend @react-email/components
'use server'

import { MailySend } from 'mailysend'
import { Welcome } from '@/emails/welcome'

// MAILYSEND_API_KEY and MAILYSEND_BASE_URL=${BASE}
const ms = new MailySend()

export async function signUp(email: string) {
  const { id } = await ms.emails.send({
    from: 'Acme <hello@yourdomain.com>',
    to: [email],
    subject: 'Welcome to Acme',
    react: Welcome({ email }),
  })
  return id
}`,
      },
      {
        value: 'remix',
        label: 'Remix',
        code: `// app/routes/subscribe.tsx
import { MailySend } from 'mailysend'
import { Welcome } from '~/emails/welcome'

const ms = new MailySend()

export async function action({ request }: { request: Request }) {
  const form = await request.formData()
  await ms.emails.send({
    from: 'Acme <hello@yourdomain.com>',
    to: [String(form.get('email'))],
    subject: 'Welcome to Acme',
    react: Welcome({ email: String(form.get('email')) }),
  })
  return { ok: true }
}`,
      },
      {
        value: 'nuxt',
        label: 'Nuxt',
        code: `// server/api/subscribe.post.ts
import { MailySend } from 'mailysend'

const ms = new MailySend(process.env.MAILYSEND_API_KEY, {
  baseUrl: '${BASE}',
})

export default defineEventHandler(async (event) => {
  const { email } = await readBody(event)
  const { id } = await ms.emails.send({
    from: 'Acme <hello@yourdomain.com>',
    to: [email],
    subject: 'Welcome to Acme',
    html: '<p>Glad you are here.</p>',
  })
  return { id }
})`,
      },
      {
        value: 'astro',
        label: 'Astro',
        code: `// src/pages/api/subscribe.ts
import type { APIRoute } from 'astro'
import { MailySend } from 'mailysend'

const ms = new MailySend(import.meta.env.MAILYSEND_API_KEY, {
  baseUrl: '${BASE}',
})

export const POST: APIRoute = async ({ request }) => {
  const { email } = await request.json()
  const { id } = await ms.emails.send({
    from: 'Acme <hello@yourdomain.com>',
    to: [email],
    subject: 'Welcome to Acme',
    html: '<p>Glad you are here.</p>',
  })
  return Response.json({ id })
}`,
      },
      {
        value: 'express',
        label: 'Express',
        code: `// server.js — npm i express mailysend
import express from 'express'
import { MailySend } from 'mailysend'

const app = express()
const ms = new MailySend(process.env.MAILYSEND_API_KEY, {
  baseUrl: '${BASE}',
})

app.post('/subscribe', express.json(), async (req, res) => {
  const { id } = await ms.emails.send({
    from: 'Acme <hello@yourdomain.com>',
    to: [req.body.email],
    subject: 'Welcome to Acme',
    html: '<p>Glad you are here.</p>',
  })
  res.json({ id })
})`,
      },
      {
        value: 'workers',
        label: 'Workers',
        code: `// A Worker calling your own deployment. No SDK, no dependency.
export default {
  async fetch(request: Request, env: Env) {
    const { email } = await request.json()
    const sent = await fetch('${BASE}/emails', {
      method: 'POST',
      headers: {
        Authorization: \`Bearer \${env.MAILYSEND_API_KEY}\`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Acme <hello@yourdomain.com>',
        to: [email],
        subject: 'Welcome to Acme',
        html: '<p>Glad you are here.</p>',
      }),
    })
    return Response.json(await sent.json())
  },
}`,
      },
      {
        value: 'resend',
        label: 'Already on resend',
        code: `// Keep the SDK you have. One environment variable moves it.
// .env
//   RESEND_BASE_URL=${BASE}
//   RESEND_API_KEY=ms_live_…

import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

await resend.emails.send({
  from: 'Acme <hello@yourdomain.com>',
  to: ['someone@example.com'],
  subject: 'Welcome to Acme',
  react: Welcome({ email: 'someone@example.com' }),
})`,
      },
    ],
    note: 'The official `resend` client resolves its host as `process.env.RESEND_BASE_URL || "https://api.resend.com"`, so every recipe Resend publishes works here with that one variable changed. If you would rather change the import than the environment, `mailysend/compat` exports a `Resend` class with the same `{ data, error }` return shape.',
  },
  {
    id: 'languages',
    title: 'Python, Go, Ruby, PHP, Java, .NET',
    caption: 'POST /v1/emails',
    blurb:
      'There is no first-party client for these, and there does not need to be: your deployment serves its own OpenAPI document at /v1/openapi.json, so a generated client can never drift from the API it was generated against. For one endpoint, the HTTP call is shorter than the client.',
    items: [
      {
        value: 'generate',
        label: 'openapi-generator',
        code: `npx @openapitools/openapi-generator-cli generate \\
  -i ${BASE}/openapi.json \\
  -g python \\
  -o ./mailysend-client

# -g python | go | ruby | php | java | csharp | rust | elixir | …
# The document comes from your own deployment, so the generated
# client matches the version you are actually running.`,
      },
      {
        value: 'python',
        label: 'Python',
        code: `# pip install httpx
import os, httpx

r = httpx.post(
    "${BASE}/emails",
    headers={"Authorization": f"Bearer {os.environ['MAILYSEND_API_KEY']}"},
    json={
        "from": "Acme <hello@yourdomain.com>",
        "to": ["someone@example.com"],
        "subject": "Welcome to Acme",
        "html": "<p>Glad you are here.</p>",
    },
)
r.raise_for_status()
print(r.json()["id"])`,
      },
      {
        value: 'go',
        label: 'Go',
        code: `body, _ := json.Marshal(map[string]any{
    "from":    "Acme <hello@yourdomain.com>",
    "to":      []string{"someone@example.com"},
    "subject": "Welcome to Acme",
    "html":    "<p>Glad you are here.</p>",
})

req, _ := http.NewRequest("POST", "${BASE}/emails", bytes.NewReader(body))
req.Header.Set("Authorization", "Bearer "+os.Getenv("MAILYSEND_API_KEY"))
req.Header.Set("Content-Type", "application/json")

res, err := http.DefaultClient.Do(req)`,
      },
      {
        value: 'ruby',
        label: 'Ruby',
        code: `require 'net/http'
require 'json'

uri = URI('${BASE}/emails')
res = Net::HTTP.post(
  uri,
  {
    from: 'Acme <hello@yourdomain.com>',
    to: ['someone@example.com'],
    subject: 'Welcome to Acme',
    html: '<p>Glad you are here.</p>'
  }.to_json,
  'Authorization' => "Bearer #{ENV.fetch('MAILYSEND_API_KEY')}",
  'Content-Type' => 'application/json'
)

puts JSON.parse(res.body)['id']`,
      },
      {
        value: 'php',
        label: 'PHP',
        code: `<?php
$res = file_get_contents('${BASE}/emails', false, stream_context_create([
  'http' => [
    'method' => 'POST',
    'header' => [
      'Authorization: Bearer ' . getenv('MAILYSEND_API_KEY'),
      'Content-Type: application/json',
    ],
    'content' => json_encode([
      'from' => 'Acme <hello@yourdomain.com>',
      'to' => ['someone@example.com'],
      'subject' => 'Welcome to Acme',
      'html' => '<p>Glad you are here.</p>',
    ]),
  ],
]));

echo json_decode($res, true)['id'];`,
      },
    ],
    note: 'Idempotency is worth one extra header in any language: send `Idempotency-Key` and a retry inside 24 hours returns the original email instead of a second copy.',
  },
  {
    id: 'smtp-stacks',
    title: 'Rails, Django, Laravel, WordPress',
    caption: 'smtp.yourdomain.com:587',
    blurb:
      'These frameworks already have a mailer, and it already speaks SMTP. Point it at the relay with the API key as the password — no gem, no package, no plugin. Sends arrive in the same logs, analytics and webhooks as API sends.',
    items: [
      {
        value: 'rails',
        label: 'Rails',
        code: `# config/environments/production.rb
config.action_mailer.delivery_method = :smtp
config.action_mailer.smtp_settings = {
  address:              'smtp.yourdomain.com',
  port:                 587,
  user_name:            'mailysend',
  password:             ENV.fetch('MAILYSEND_API_KEY'),
  authentication:       :plain,
  enable_starttls_auto: true,
}
config.action_mailer.default_options = {
  from: 'Acme <hello@yourdomain.com>',
}`,
      },
      {
        value: 'django',
        label: 'Django',
        code: `# settings.py
import os

EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'smtp.yourdomain.com'
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = 'mailysend'
EMAIL_HOST_PASSWORD = os.environ['MAILYSEND_API_KEY']
DEFAULT_FROM_EMAIL = 'Acme <hello@yourdomain.com>'`,
      },
      {
        value: 'laravel',
        label: 'Laravel',
        code: `# .env
MAIL_MAILER=smtp
MAIL_HOST=smtp.yourdomain.com
MAIL_PORT=587
MAIL_USERNAME=mailysend
MAIL_PASSWORD=ms_live_…
MAIL_ENCRYPTION=tls
MAIL_FROM_ADDRESS=hello@yourdomain.com
MAIL_FROM_NAME=Acme`,
      },
      {
        value: 'wordpress',
        label: 'WordPress',
        code: `WP Mail SMTP → Settings → Mailer → "Other SMTP"

  Host         smtp.yourdomain.com
  Encryption   TLS
  Port         587
  Username     mailysend
  Password     your MailySend API key
  From Email   hello@yourdomain.com

Any SMTP plugin works — these are the only five values it needs.`,
      },
      {
        value: 'nodemailer',
        label: 'Nodemailer',
        code: `// For a Node app that already speaks SMTP.
import nodemailer from 'nodemailer'

const transport = nodemailer.createTransport({
  host: 'smtp.yourdomain.com',
  port: 587,
  secure: false, // STARTTLS on 587; use 465 with secure: true
  auth: { user: 'mailysend', pass: process.env.MAILYSEND_API_KEY },
})

await transport.sendMail({
  from: 'Acme <hello@yourdomain.com>',
  to: 'someone@example.com',
  subject: 'Welcome to Acme',
  html: '<p>Glad you are here.</p>',
})`,
      },
    ],
    note: 'Two things to know before you pick this door. Workers cannot accept inbound TCP, so the relay is an OCI container you run yourself rather than part of the Worker deploy. And SMTP is a one-way conversation: the relay reports acceptance, but opens, clicks and scheduling need the API.',
  },
]
