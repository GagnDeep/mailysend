import {
  BarChart3,
  Braces,
  Contact2,
  FileCode2,
  Filter,
  Globe,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  ScrollText,
  Settings,
  ShieldBan,
  SlidersHorizontal,
  Target,
  Users,
  Workflow,
} from 'lucide-react'
import type { ComponentType } from 'react'

export interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** The second key of the `g`-prefixed chord. `g l` is logs, `g b` broadcasts. */
  chord?: string
  /** Words the palette matches on beyond the label. */
  keywords?: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/**
 * One list, three consumers: the sidebar draws it, the command palette searches
 * it, and the shortcut handler binds it. A screen added in one place and
 * forgotten in the other two is the usual way a keyboard-first promise rots.
 */
export const NAV: NavGroup[] = [
  {
    label: 'Send',
    items: [
      {
        to: '/app',
        label: 'Overview',
        icon: LayoutDashboard,
        chord: 'o',
        keywords: 'home dashboard counters',
      },
      {
        to: '/app/logs',
        label: 'Logs',
        icon: ScrollText,
        chord: 'l',
        keywords: 'messages emails events search',
      },
      {
        to: '/app/analytics',
        label: 'Analytics',
        icon: BarChart3,
        chord: 'n',
        keywords: 'charts opens clicks placement',
      },
    ],
  },
  {
    label: 'Audience',
    items: [
      {
        to: '/app/audiences',
        label: 'Audiences',
        icon: Contact2,
        chord: 'a',
        keywords: 'contacts lists import csv',
      },
      {
        to: '/app/segments',
        label: 'Segments',
        icon: Filter,
        chord: 's',
        keywords: 'expression query cohort',
      },
      {
        to: '/app/suppressions',
        label: 'Suppressions',
        icon: ShieldBan,
        chord: 'x',
        keywords: 'bounces complaints blocklist',
      },
    ],
  },
  {
    label: 'Campaigns',
    items: [
      {
        to: '/app/broadcasts',
        label: 'Broadcasts',
        icon: Megaphone,
        chord: 'b',
        keywords: 'campaign newsletter ab test',
      },
      {
        to: '/app/automations',
        label: 'Automations',
        icon: Workflow,
        chord: 'f',
        keywords: 'flows drip journey workflow',
      },
      {
        to: '/app/templates',
        label: 'Templates',
        icon: FileCode2,
        chord: 't',
        keywords: 'handlebars mjml layout',
      },
      {
        to: '/app/preferences',
        label: 'Preference centre',
        icon: SlidersHorizontal,
        keywords: 'unsubscribe topics opt out',
      },
    ],
  },
  {
    label: 'Deliverability',
    items: [
      {
        to: '/app/domains',
        label: 'Domains',
        icon: Globe,
        chord: 'd',
        keywords: 'dns spf dkim dmarc verify quota',
      },
      {
        to: '/app/placement',
        label: 'Placement tests',
        icon: Target,
        chord: 'p',
        keywords: 'seed list inbox spam',
      },
      {
        to: '/app/mail',
        label: 'Mail',
        icon: Inbox,
        chord: 'i',
        keywords: 'inbox threads replies mailbox compose send receive',
      },
    ],
  },
  {
    label: 'Workspace',
    items: [
      {
        to: '/app/api-keys',
        label: 'API keys',
        icon: KeyRound,
        chord: 'k',
        keywords: 'token secret ms_live ms_test',
      },
      {
        to: '/app/webhooks',
        label: 'Webhooks',
        icon: Braces,
        chord: 'w',
        keywords: 'endpoint signature replay attempts',
      },
      {
        to: '/app/team',
        label: 'Team',
        icon: Users,
        chord: 'm',
        keywords: 'members invites roles permissions',
      },
      {
        to: '/app/settings',
        label: 'Settings',
        icon: Settings,
        chord: ',',
        keywords: 'provider retention danger zone',
      },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV.flatMap((group) => group.items)

export const CHORDS: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.filter((item) => item.chord).map((item) => [item.chord as string, item.to]),
)
