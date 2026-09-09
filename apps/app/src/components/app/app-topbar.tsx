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
import { useState } from 'react'
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
        {/* A real form POST, not a fetch: signing out must work even if the
            client bundle has failed, which is exactly when someone wants out. */}
        <DropdownMenuItem asChild>
          <form method="post" action="/auth/sign-out">
            <button type="submit" className="flex w-full items-center gap-2 text-left">
              <LogOut aria-hidden="true" className="size-3.5" />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
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
