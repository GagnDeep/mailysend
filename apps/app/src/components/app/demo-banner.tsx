import { Button } from '@mailysend/ui'
import { Eye } from 'lucide-react'
import { endDemo, useDemo } from '~/lib/demo/state.ts'
import { DEPLOY_URL } from '~/seo'

/**
 * The line that stops this being a lie.
 *
 * Everything below it is fiction — a made-up workspace with made-up mail in it —
 * and a visitor who wandered in from a link has no other way to know that. It
 * is deliberately the first thing under the topbar, deliberately not
 * dismissible, and deliberately says *nothing is saved* rather than "read-only
 * mode": the second is a mode name, the first is the consequence.
 */
export const DemoBanner = () => {
  const demo = useDemo()
  if (!demo) return null

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-accent-border bg-accent-soft px-5 py-2 text-[13px] text-warning"
    >
      <Eye aria-hidden="true" className="size-3.5 shrink-0" />
      <span>
        <strong className="font-semibold">Demo.</strong> Sample data for a workspace that does not
        exist. Nothing here is saved and no mail is sent.
      </span>
      <span className="ms-auto flex items-center gap-1">
        <Button asChild variant="link" size="sm" className="h-auto">
          <a href={DEPLOY_URL} rel="noreferrer">
            Deploy your own
          </a>
        </Button>
        <Button
          variant="link"
          size="sm"
          className="h-auto"
          onClick={() => {
            void endDemo().then(() => {
              window.location.href = '/'
            })
          }}
        >
          Leave
        </Button>
      </span>
    </div>
  )
}
