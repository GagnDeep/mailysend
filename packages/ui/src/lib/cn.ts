import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge only knows how to resolve a conflict between two classes when
 * it recognises the value on the end. Every scale below is one we invented in
 * `@mailysend/design-tokens` — without registering them, `cn('rounded-card',
 * 'rounded-pill')` would emit both and the last one in the stylesheet, rather
 * than the last one passed, would win.
 */
const twMerge = extendTailwindMerge<'ms-display'>({
  extend: {
    theme: {
      color: [
        'ink',
        'paper',
        'card',
        'tint',
        'line',
        'line-soft',
        'muted',
        'muted-2',
        'muted-3',
        'accent',
        'accent-hover',
        'accent-on-dark',
        'accent-soft',
        'accent-border',
        'positive',
        'positive-bright',
        'positive-bg',
        'warning',
        'dark',
        'dark-2',
        'dark-line',
        'dark-line-soft',
        'on-dark',
        'on-dark-2',
        'on-dark-3',
        'on-dark-4',
        'on-dark-5',
        'code-green',
        'neutral-bar',
      ],
      font: ['display', 'body', 'mono'],
      radius: ['chip', 'menu', 'code', 'tile', 'card', 'panel', 'block', 'pill'],
      shadow: ['accent'],
      animate: ['ms-pulse', 'ms-fade-up', 'ms-marquee'],
      ease: ['fast', 'base'],
    },
    classGroups: {
      // The display scale carries its own size, leading and tracking, so two of
      // these on one element is always a mistake rather than a layering.
      'ms-display': ['ms-hero', 'ms-display-1', 'ms-display-2', 'ms-display-3'],
    },
  },
})

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))
