import { cn, MonoChip } from '@mailysend/ui'
import type { GuideMeta } from '~/content/guides/manifest.ts'
import { guidePath } from '~/content/site-map.ts'

/**
 * One guide, as a card.
 *
 * Shared by the index and by the "read next" block at the foot of every guide,
 * so a guide cannot look like one thing in the list and another thing when
 * another guide recommends it — which is exactly how a reader loses their place.
 *
 * It is an `<a>` carrying the card's own border rather than a `Card` wrapping a
 * link: a card-shaped element with a link inside it gives a keyboard user a
 * focus ring around the text instead of around the thing they are about to
 * activate.
 */
export const GuideCard = ({ guide, className }: { guide: GuideMeta; className?: string }) => (
  <a
    href={guidePath(guide.slug)}
    className={cn(
      'group flex h-full flex-col gap-2 rounded-card border border-line bg-card p-5 no-underline',
      'transition-colors duration-[0.18s] hover:border-ink',
      className,
    )}
  >
    <span className="flex flex-wrap items-center gap-2">
      <MonoChip size="sm" tone="accent">
        {guide.category}
      </MonoChip>
      <span className="font-mono text-[11.5px] text-muted-2">
        {guide.level} · {guide.minutes} min
      </span>
    </span>
    <span className="text-[16px] font-semibold text-ink group-hover:text-accent">
      {guide.title}
    </span>
    <span className="text-[14px] leading-[1.55] text-muted-2">{guide.description}</span>
  </a>
)
