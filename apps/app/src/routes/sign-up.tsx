import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { pageHead } from '~/seo'

/**
 * `/sign-up` is not a thing MailySend has.
 *
 * There is no MailySend account to sign up for — you deploy an instance and
 * claim it. This route existed as a presentation-only mock of a wizard, with a
 * form that posted nowhere and a fabricated API key printed as if it were
 * yours; four other pages linked to it as "the setup wizard". It is kept only
 * as a redirect, because those links are in the wild and a 404 is a worse
 * answer than the real screen.
 */
export const Route = createFileRoute('/sign-up')({
  head: () =>
    pageHead({
      title: 'Set up your instance',
      description: 'MailySend has no accounts. Deploy an instance and claim it at /setup.',
      path: '/setup',
      noindex: true,
    }),
  component: SignUpRedirect,
})

function SignUpRedirect() {
  useEffect(() => {
    window.location.replace('/setup')
  }, [])

  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col justify-center gap-4 p-8 text-center">
      <h1 className="ms-display-2 m-0">Setup moved</h1>
      <p className="m-0 text-[15.5px] leading-[1.6] text-muted">
        MailySend has no accounts to sign up for. You claim your own deployment instead.
      </p>
      <p className="m-0 text-[15px]">
        <a href="/setup" className="font-semibold text-accent no-underline hover:text-ink">
          Continue to /setup
        </a>
      </p>
    </main>
  )
}
