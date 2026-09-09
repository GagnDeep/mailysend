import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  StatusDot,
} from '@mailysend/ui'
import { useRouterState } from '@tanstack/react-router'
import { useState } from 'react'
import { FLAT_LINKS, MORE_GROUP, type NavGroup, PRODUCT_GROUP } from './nav-data.ts'
import { Wordmark } from './wordmark.tsx'

const linkClasses =
  'flex items-center gap-[7px] rounded-md px-[11px] py-[9px] text-[14.5px] text-muted no-underline ' +
  'transition-colors duration-[0.18s] hover:bg-tint hover:text-ink'

const drawerLinkClasses =
  'rounded-menu px-2 py-2.5 text-[15px] font-semibold text-ink no-underline hover:bg-tint'

const ActiveDot = () => <StatusDot tone="accent" size={6} />

const MenuGroup = ({ group, active }: { group: NavGroup; active: boolean }) => (
  <DropdownMenu>
    {/*
      Radix owns open/close here. The artboard hand-rolled it and closed on any
      click outside `[data-dc-nav-menu]`, an attribute that appears nowhere in
      its markup — so the menu opened and then never closed again.
    */}
    <DropdownMenuTrigger className={cn(linkClasses, 'cursor-pointer border-none bg-transparent')}>
      {active ? <ActiveDot /> : null}
      {group.label}
      <span aria-hidden="true" className="font-mono text-[9px] text-muted-2">
        ▾
      </span>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-[290px] rounded-card p-2">
      {group.items.map((item) => (
        <DropdownMenuItem key={item.href} asChild className="px-3 py-[11px]">
          <a href={item.href} className="block no-underline">
            <span className="block text-[14.5px] font-semibold text-ink">{item.label}</span>
            <span className="mt-0.5 block text-[12.5px] text-muted-2">{item.description}</span>
          </a>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
)

/**
 * The site header.
 *
 * A real `<nav>` rather than the artboard's `<div>`, and — below `lg` — a real
 * drawer rather than a row that wrapped onto four lines. The drawer is the
 * `Sheet` primitive, so focus is trapped and Escape closes it; a bare overlay
 * would leave every link behind it tabbable.
 *
 * The links are plain anchors, not `<Link>`s. Every marketing route prerenders
 * to static HTML, so a full document navigation costs one cached request and
 * buys a page that works identically with JavaScript disabled.
 */
export const SiteNav = () => {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  // The drawer records which page it was opened on rather than holding a bare
  // boolean, so navigating away closes it during render. A navigation that
  // leaves the drawer standing is a dead end on a phone, and the effect that
  // would otherwise close it paints the stale drawer for one frame first.
  const [openedOn, setOpenedOn] = useState<string | null>(null)
  const open = openedOn === pathname
  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null)

  const isActive = (href: string) => pathname === href
  const groupActive = (group: NavGroup) => group.matches.includes(pathname)

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/90 backdrop-blur-[16px]">
      <nav
        aria-label="Main"
        className="ms-container flex items-center gap-1.5 py-[11px] max-lg:justify-between"
      >
        <Wordmark size="sm" className="mr-2 py-[5px] pr-2" />

        <div className="flex flex-1 items-center gap-1.5 max-lg:hidden">
          <MenuGroup group={PRODUCT_GROUP} active={groupActive(PRODUCT_GROUP)} />
          {FLAT_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={cn(linkClasses, isActive(link.href) && 'text-ink')}
              aria-current={isActive(link.href) ? 'page' : undefined}
            >
              {isActive(link.href) ? <ActiveDot /> : null}
              {link.label}
            </a>
          ))}
          <MenuGroup group={MORE_GROUP} active={groupActive(MORE_GROUP)} />
        </div>

        <div className="flex items-center gap-1.5 max-lg:hidden">
          <a href="/sign-in" className={linkClasses}>
            Sign in
          </a>
          <Button asChild size="sm" className="h-10 px-[17px] text-[14px]">
            <a href="/resources#selfhost">Deploy free</a>
          </Button>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            aria-label="Open menu"
            className="grid size-10 place-items-center rounded-md text-ink transition-colors duration-[0.18s] hover:bg-tint lg:hidden"
          >
            {/* Inline rather than a lucide import: `lucide-react` is a
                dependency of @mailysend/ui, not of this app, and reaching
                through a workspace package's node_modules breaks the build. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </SheetTrigger>
          <SheetContent side="right" className="gap-6 overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-6">
              {[PRODUCT_GROUP, MORE_GROUP].map((group) => (
                <div key={group.label}>
                  <div className="ms-eyebrow mb-2.5">{group.label}</div>
                  <div className="flex flex-col">
                    {group.items.map((item) => (
                      <a key={item.href} href={item.href} className={drawerLinkClasses}>
                        {item.label}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
              <div>
                <div className="ms-eyebrow mb-2.5">REFERENCE</div>
                <div className="flex flex-col">
                  {FLAT_LINKS.map((link) => (
                    <a key={link.href} href={link.href} className={drawerLinkClasses}>
                      {link.label}
                    </a>
                  ))}
                  <a href="/sign-in" className={drawerLinkClasses}>
                    Sign in
                  </a>
                </div>
              </div>
            </div>
            <Button asChild className="w-full">
              <a href="/resources#selfhost">Deploy free</a>
            </Button>
          </SheetContent>
        </Sheet>
      </nav>
    </header>
  )
}
