import { cn, Toaster, TooltipProvider } from '@mailysend/ui'
import { QueryClientProvider } from '@tanstack/react-query'
import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { useState } from 'react'
import { AppSidebar } from '~/components/app/app-sidebar.tsx'
import { AppTopbar } from '~/components/app/app-topbar.tsx'
import { CommandPaletteProvider } from '~/components/app/command-palette.tsx'
import { EnvironmentBanner } from '~/components/app/env-switcher.tsx'
import { RequireSession } from '~/components/app/require-session.tsx'
import { AppScopeProvider } from '~/components/app/scope.tsx'
import { createQueryClient } from '~/lib/query.ts'
import { appHead } from '~/seo'

/**
 * The authenticated shell.
 *
 * The dashboard is server-rendered and then hydrated — never prerendered —
 * because every byte on these screens belongs to one workspace. The prerender
 * list in `vite.config.ts` deliberately omits `/app` for the same reason.
 */
export const Route = createFileRoute('/app')({
  head: () => appHead('Dashboard'),
  ssr: true,
  component: AppLayout,
})

function AppLayout() {
  // One client per browser session, created in state so a re-render never
  // silently throws away every cache entry mid-navigation.
  const [queryClient] = useState(createQueryClient)

  /**
   * Whether the matched route wants the whole viewport.
   *
   * Read off the deepest match's `staticData` rather than the pathname, so a
   * screen declares its own shape next to its own code instead of the shell
   * keeping a list of exceptions that goes stale.
   */
  const fullBleed = useRouterState({
    select: (state) =>
      state.matches.some(
        (match) => (match.staticData as { fullBleed?: boolean } | undefined)?.fullBleed,
      ),
  })

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <AppScopeProvider>
          <RequireSession>
            <CommandPaletteProvider>
              <a
                href="#app-main"
                className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-paper"
              >
                Skip to content
              </a>
              <div className={cn('flex bg-paper', fullBleed ? 'h-screen' : 'min-h-screen')}>
                <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-tint lg:flex">
                  <div className="flex h-[57px] shrink-0 items-center gap-2.5 border-b border-line px-5">
                    <span className="grid size-[22px] place-items-center rounded-[7px] bg-accent font-mono text-[11px] font-bold text-white">
                      M
                    </span>
                    <span className="font-display text-[15px] font-medium -tracking-[0.02em]">
                      MailySend
                    </span>
                  </div>
                  <AppSidebar />
                </aside>
                <div className="flex min-w-0 flex-1 flex-col">
                  <AppTopbar />
                  <EnvironmentBanner />
                  {/* A mail client is an application, not a document: it wants
                      the whole viewport and three panes that scroll on their
                      own. Every other screen keeps the reading measure. A route
                      opts out with `staticData.fullBleed`. */}
                  {fullBleed ? (
                    <main id="app-main" className="min-h-0 min-w-0 flex-1">
                      <Outlet />
                    </main>
                  ) : (
                    <main id="app-main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
                      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6">
                        <Outlet />
                      </div>
                    </main>
                  )}
                </div>
              </div>
              <Toaster />
            </CommandPaletteProvider>
          </RequireSession>
        </AppScopeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
