import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  StatusDot,
} from '@mailysend/ui'
import { Link } from '@tanstack/react-router'
import { Check, ChevronsUpDown, LogOut, Menu, Search, Settings, Users } from 'lucide-react'
import { useRef, useState } from 'react'
import { endDemo, useDemo } from '~/lib/demo/state.ts'
import { AppSidebar } from './app-sidebar.tsx'
import { useCommandPalette } from './command-palette.tsx'
import { EnvironmentSwitcher } from './env-switcher.tsx'
import { initials } from './format.ts'
import { useAppScope } from './scope.tsx'

const WorkspaceSwitcher = () => {
  const { user, userLoading, workspaceId, setWorkspaceId } = useAppScope()

  if (userLoading) return <Skeleton className="h-8 w-40" />

  const workspaces = user?.workspaces ?? []
  const active = workspaces.find((workspace) => workspace.id === workspaceId) ?? workspaces[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 font-mono text-[12.5px] font-normal text-muted"
          aria-label={`Workspace: ${active?.name ?? 'none'}`}
        >
          <span className="grid size-[22px] place-items-center rounded-[7px] bg-accent font-mono text-[11px] font-bold text-white">
            {(active?.name ?? 'M').slice(0, 1).toUpperCase()}
          </span>
          <span className="max-w-40 truncate">{active?.slug ?? 'no workspace'}</span>
          <ChevronsUpDown aria-hidden="true" className="size-3.5 text-muted-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.id} onSelect={() => setWorkspaceId(workspace.id)}>
            <span className="flex-1 truncate">{workspace.name}</span>
            {workspace.role ? (
              <span className="font-mono text-[11px] text-muted-2">{workspace.role}</span>
            ) : null}
            {workspace.id === active?.id ? <Check aria-hidden="true" className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
        {workspaces.length === 0 ? (
          <DropdownMenuItem disabled>No workspaces yet</DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/app/settings" search={{ section: 'workspace' }}>
            Workspace settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const UserMenu = () => {
  const { user, userLoading } = useAppScope()
  const demo = useDemo()
  const signOutForm = useRef<HTMLFormElement>(null)

  if (userLoading) return <Skeleton className="size-8 rounded-pill" />

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${user?.email ?? 'you'}`}
          className="rounded-pill transition-opacity duration-[0.18s] hover:opacity-80"
        >
          <Avatar className="size-8">
            <AvatarFallback>{initials(user?.name ?? null, user?.email ?? '?')}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>
          <div className="truncate font-semibold">{user?.name ?? 'Signed in'}</div>
          <div className="truncate font-mono text-[11.5px] font-normal text-muted-2">
            {user?.email ?? '—'}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/app/settings" search={{ section: 'workspace' }}>
            <Settings aria-hidden="true" className="size-3.5" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/app/team">
            <Users aria-hidden="true" className="size-3.5" />
            Team & roles
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* In the tour there is no session to end, and "Sign out" would post to
            an endpoint that clears a cookie nobody holds — leaving the visitor
            exactly where they were, which reads as a broken button. */}
        {demo ? (
          <DropdownMenuItem
            onSelect={() => {
              void endDemo().then(() => {
                window.location.href = '/'
              })
            }}
          >
            <LogOut aria-hidden="true" className="size-3.5" />
            Leave the demo
          </DropdownMenuItem>
        ) : (
          <>
            {/* Keep the menu row as the Radix item. A form wrapped by an item
                closes before its nested submit button can reliably submit. */}
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                signOutForm.current?.requestSubmit()
              }}
            >
              <LogOut aria-hidden="true" className="size-3.5" />
              Sign out
            </DropdownMenuItem>
            {/* This remains a native POST, so sign-out does not depend on a
                JavaScript API call or access to the HttpOnly session cookie. */}
            <form ref={signOutForm} method="post" action="/auth/sign-out" className="hidden" />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const AppTopbar = () => {
  const { setOpen, pendingChord } = useCommandPalette()
  const [navOpen, setNavOpen] = useState(false)

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2.5 border-b border-line bg-tint px-4 py-2.5">
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="sm" className="lg:hidden" aria-label="Open navigation">
            <Menu aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0">
          <SheetTitle className="sr-only">Dashboard navigation</SheetTitle>
          <AppSidebar onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <WorkspaceSwitcher />

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="ml-auto gap-2 border border-line bg-card font-normal text-muted-2 hover:bg-card hover:text-ink"
      >
        <Search aria-hidden="true" />
        <span className="hidden sm:inline">Search or jump to…</span>
        <Kbd className="ml-1">⌘K</Kbd>
      </Button>

      {/* The chord hint is `aria-live` so a keyboard user who pressed `g` by
          accident is told the app is waiting for a second key. */}
      <span aria-live="polite" className="font-mono text-[11.5px] text-accent">
        {pendingChord ? (
          <span className="inline-flex items-center gap-1.5">
            <StatusDot tone="accent" size={6} pulse />g …
          </span>
        ) : null}
      </span>

      <EnvironmentSwitcher />
      <UserMenu />
    </header>
  )
}
