import type { TerminalLine } from '@mailysend/ui'
import { Button, cn, MonoChip, Terminal } from '@mailysend/ui'

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
 * `do` is ASCII. The artboard smuggled a Cyrillic o (U+043E) into this exact
 * word in both the Home and Resources terminals, which silently breaks
 * copy-paste of the command the block is advertising.
 */
export const DEPLOY_LINES: TerminalLine[] = [
  { kind: 'command', text: 'npx mailysend deploy --domain acme.dev' },
  { kind: 'success', text: `✓ queues · do · d1 · r2 · dns   ready in ${DEPLOY_RANGE}` },
]

export const DEPLOY_LINES_VERBOSE: TerminalLine[] = [
  { kind: 'command', text: 'npx mailysend deploy --domain acme.dev' },
  { kind: 'success', text: '  ✓ workers · queues · do · d1 · kv · r2' },
  { kind: 'success', text: '  ✓ dns spf/dkim/dmarc written' },
  { kind: 'success', text: '  ✓ access policy created' },
  { kind: 'success', text: `  ready  https://mail.acme.dev  ${DEPLOY_RANGE}` },
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
    <a href="/resources#selfhost">
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
