/**
 * MailySend design tokens — the single source of truth.
 *
 * Every value here was extracted from the Claude-Design artboards in `design/`,
 * which style inline with literal hex values. Nothing below may be hand-written
 * as a literal anywhere else in the repo: `theme.css` mirrors this file as CSS
 * custom properties and a Tailwind v4 `@theme` block, and application code
 * imports from here when it needs a token in TypeScript (chart series, OG image
 * generation, email templates — the places CSS variables cannot reach).
 */

export const color = {
  /** Near-black warm ink. Body copy, headings, dark buttons. */
  ink: '#14120F',
  /** Page background. Warm off-white paper. */
  paper: '#F6F3EC',
  /** Raised surface: cards, panels, dropdown menus. */
  card: '#FDFCFA',
  /** Recessed surface: hovered menu items, inline code, table zebra. */
  tint: '#F1EDE4',
  /** Standard hairline border. */
  line: '#E2DCD1',
  /** Softer hairline, used inside cards where `line` is too loud. */
  lineSoft: '#EFEAE1',

  /** Secondary text. */
  muted: '#56514A',
  /** Tertiary text: descriptions, captions, mono eyebrows on paper. */
  muted2: '#8B8377',
  /** Quaternary: disabled, dividers-as-text, inactive dots. */
  muted3: '#D6CFC2',

  /** The brand accent. Logo, primary marks, active dots, links on paper. */
  accent: '#E8500F',
  /** Accent hover — only ever used as a hover/active state. */
  accentHover: '#FF6A2B',
  /** Accent equivalent for dark surfaces; #E8500F fails contrast on ink. */
  accentOnDark: '#F0A55B',
  /** Accent wash background: callouts, badges, the `1-CLICK` pill. */
  accentSoft: '#FDF3EC',
  /** Border colour paired with `accentSoft`. */
  accentBorder: '#F0C9AE',

  /** Deep teal. Success text, "delivered", positive deltas. */
  positive: '#0E5C55',
  /** Bright mint. Positive bars, dots, sparklines, on-dark success. */
  positiveBright: '#3FBF8F',
  /** Positive wash background. */
  positiveBg: '#E7F0EA',

  /** Warning / destructive / bounced / failed. */
  warning: '#B4321A',

  /** Primary dark surface: dark CTA bands, terminals, the ink footer. */
  dark: '#191713',
  /** Secondary dark surface: cards on top of `dark`. */
  dark2: '#1D1A16',
  /** Border on `dark`. */
  darkLine: '#2E2A24',
  /** Softer border on `dark`. */
  darkLineSoft: '#2A2620',

  /** Primary text on dark. */
  onDark: '#E6E0D6',
  /** Secondary text on dark. */
  onDark2: '#CFC7B9',
  /** Tertiary text on dark. */
  onDark3: '#A39B8F',
  /** Quaternary text on dark. */
  onDark4: '#7A7367',
  /** The terminal prompt `$` glyph and other barely-there marks on dark. */
  onDark5: '#5E574C',

  /** Terminal success lines (`✓ …`). */
  codeGreen: '#8FD6A8',
  /** Neutral comparison bars — the "them" series in every chart. */
  neutralBar: '#C9C0B2',
} as const

export type ColorToken = keyof typeof color

export const font = {
  /** Headings and display numerals. ALWAYS weight 500 — never bold. */
  display: "'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif",
  /** All body copy, labels, buttons. */
  body: "'Instrument Sans', ui-sans-serif, system-ui, -apple-system, sans-serif",
  /** The signature: eyebrows, chips, code, timestamps, ids, metrics. */
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const

/**
 * Display type is set tight and never bold. `tracking` narrows as size grows,
 * which is why the scale carries its own letter-spacing rather than leaving it
 * to a utility class.
 */
export const displayScale = {
  hero: { size: 'clamp(50px, 7.2vw, 104px)', leading: '0.92', tracking: '-0.045em' },
  h1: { size: 'clamp(38px, 4.6vw, 62px)', leading: '0.96', tracking: '-0.04em' },
  h2: { size: 'clamp(30px, 3.2vw, 44px)', leading: '1.02', tracking: '-0.035em' },
  h3: { size: 'clamp(23px, 2.1vw, 30px)', leading: '1.1', tracking: '-0.03em' },
  h4: { size: '20px', leading: '1.2', tracking: '-0.025em' },
  h5: { size: '17px', leading: '1.25', tracking: '-0.02em' },
} as const

export const radius = {
  /** Chips and small mono badges. */
  chip: '6px',
  /** The logo mark, code tab strips. */
  sm: '8px',
  /** Nav hit areas, buttons that are not pills. */
  md: '10px',
  /** Dropdown menu items. */
  menu: '11px',
  /** Inline code. */
  code: '12px',
  /** Tiles inside cards. */
  tile: '14px',
  /** Cards. */
  card: '16px',
  /** Panels and dialogs. */
  panel: '20px',
  /** Full-bleed feature blocks and terminals. */
  block: '22px',
  /** Every button and pill. */
  pill: '999px',
} as const

/** Four shadows only. All warm-black, all with heavy negative spread. */
export const shadow = {
  sm: '0 2px 8px rgba(20,18,15,0.06)',
  md: '0 8px 24px -12px rgba(20,18,15,0.14)',
  lg: '0 18px 48px -24px rgba(20,18,15,0.22)',
  accent: '0 2px 8px rgba(232,80,15,0.3)',
} as const

export const transition = {
  /** Buttons and other pressable things. */
  fast: '0.18s ease',
  /** Cards, panels, anything that moves more than a few pixels. */
  base: '0.2s ease',
} as const

export const layout = {
  container: '1200px',
  gutter: '24px',
  navHeight: '58px',
  sectionY: '72px',
  sectionYTight: '56px',
} as const

/**
 * Status colours. Every state a message, domain, key, broadcast or automation
 * can be in resolves through this map, so a badge is never coloured ad hoc.
 */
export const statusTone = {
  neutral: { fg: color.muted, bg: color.tint, border: color.line },
  progress: { fg: color.accent, bg: color.accentSoft, border: color.accentBorder },
  positive: { fg: color.positive, bg: color.positiveBg, border: '#C9DED4' },
  warning: { fg: '#8A5A12', bg: '#FBF1DF', border: '#EBD6AE' },
  danger: { fg: color.warning, bg: '#FBEBE7', border: '#F0C6BB' },
} as const

export type StatusTone = keyof typeof statusTone

/** Chart series colours, in the order a multi-series chart should consume them. */
export const chartSeries = [
  color.accent,
  color.positiveBright,
  color.neutralBar,
  color.accentOnDark,
  color.positive,
  color.muted2,
] as const
