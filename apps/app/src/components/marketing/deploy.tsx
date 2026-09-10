import type { TerminalLine } from '@mailysend/ui'
import { Button, cn, MonoChip, Terminal } from '@mailysend/ui'
import { DEPLOY_URL } from '~/seo'

/**
 * The deploy claim, in one place.
 *
 * The artboards asserted a measured `48s` on seven pages. Nobody measured it,
 * and most of the wall-clock is DNS propagation we do not control — so the
 * number is a range with the reason attached rather than a figure that would
 * be wrong the first time a registrar was slow.
 */
export const DEPLOY_DURATION = 'about a minute'
export const DEPLOY_DURATION_LONG =
  'about a minute end to end — most of it DNS propagation, which is out of anyone’s hands'
export const DEPLOY_RANGE = '~40–90s'

/**
 * These are the commands as they actually exist.
 *
 * The artboard advertised `mailysend deploy --domain acme.dev` writing DNS and
 * creating an Access policy in one step. There is no `--domain` flag, `deploy`
 * is wrangler wearing our name, and the DNS records are shown for you to add in
 * the domain screen rather than written on your behalf. A terminal block is a
 * command someone will paste, so it says what the command does.
 *
 * `do` is ASCII, too: the artboard smuggled a Cyrillic o (U+043E) into this
 * exact word in both the Home and Resources terminals, which silently breaks
 * copy-paste of the very command the block is advertising.
 */
export const DEPLOY_LINES: TerminalLine[] = [
  { kind: 'command', text: 'npx mailysend provision && npx mailysend deploy' },
  { kind: 'success', text: `✓ queues · do · d1 · kv · r2   ready in ${DEPLOY_RANGE}` },
]

export const DEPLOY_LINES_VERBOSE: TerminalLine[] = [
  { kind: 'command', text: 'npx mailysend provision' },
  { kind: 'success', text: '  ✓ queues · analytics datasets' },
  { kind: 'command', text: 'npx mailysend deploy' },
  { kind: 'success', text: '  ✓ workers · do · d1 · kv · r2' },
  { kind: 'success', text: '  ✓ schema migrated on first request' },
  { kind: 'success', text: `  ready  https://mailysend.<you>.workers.dev  ${DEPLOY_RANGE}` },
]

export const DeployTerminal = ({
  verbose = false,
  className,
}: {
  verbose?: boolean
  className?: string
}) => (
  <Terminal
    lines={verbose ? DEPLOY_LINES_VERBOSE : DEPLOY_LINES}
    copyable
    caption="DEPLOY"
    className={className}
  />
)

export interface DeployButtonProps {
  label?: string
  /** The `1-CLICK` pill the artboards hang off the primary CTA. */
  chip?: string
  variant?: 'primary' | 'accent'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export const DeployButton = ({
  label = 'Deploy to Cloudflare',
  chip,
  variant = 'primary',
  size = 'md',
  className,
}: DeployButtonProps) => (
  <Button asChild variant={variant} size={size} className={className}>
    <a href={DEPLOY_URL} rel="noreferrer">
      {label}
      {chip ? (
        <MonoChip
          tone={variant === 'accent' ? 'ink' : 'accent'}
          size="sm"
          className={cn('tracking-[0.1em]', variant === 'accent' && 'bg-white/20 text-white')}
        >
          {chip}
        </MonoChip>
      ) : (
        <span aria-hidden="true" className="font-mono text-[13px]">
          →
        </span>
      )}
    </a>
  </Button>
)

/**
 * The quieter alternative beside the primary CTA.
 *
 * The self-host guide used to *be* the deploy button — a tollgate between the
 * homepage and Cloudflare that made a one-click deploy take three. It is still
 * worth reading if you want the CLI path or the bindings explained, so it keeps
 * a link; it just no longer stands in front of the button.
 */
export const SelfHostGuideLink = ({
  label = 'Read the self-host guide',
  className,
}: {
  label?: string
  className?: string
}) => (
  <Button asChild variant="ghost" size="md" className={className}>
    <a href="/resources#selfhost">{label}</a>
  </Button>
)
