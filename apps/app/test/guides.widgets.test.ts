import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BounceClassifier } from '~/components/guides/bounce-classifier.tsx'
import { DnsRecordBuilder } from '~/components/guides/dns-record-builder.tsx'
import { HeadersInspector } from '~/components/guides/headers-inspector.tsx'
import { OpenRateCalculator } from '~/components/guides/open-rate-calculator.tsx'
import { RetryBackoffVisualizer } from '~/components/guides/retry-backoff-visualizer.tsx'
import { SegmentColumns, SegmentPlayground } from '~/components/guides/segment-playground.tsx'
import { TransportChooser } from '~/components/guides/transport-chooser.tsx'
import { TroubleshootingChecklist } from '~/components/guides/troubleshooting-checklist.tsx'
import { VolumeCostPanel } from '~/components/guides/volume-cost-panel.tsx'
import { WarmupPlanner } from '~/components/guides/warmup-planner.tsx'
import { WebhookSignaturePlayground } from '~/components/guides/webhook-signature-playground.tsx'

/**
 * Every widget renders on the server.
 *
 * `prerender.failOnError` is on, so a single `window` at module scope or a
 * `crypto.subtle` call during render kills the build for all forty-two pages —
 * four minutes into a Cloudflare deploy, with an error naming a chunk. This
 * catches the same class of mistake in milliseconds.
 *
 * It also asserts the editorial rule these widgets exist to satisfy: their
 * substance has to be in the server-rendered HTML. That HTML is what a crawler
 * indexes, what lands in llms-full.txt, and what a reader with JavaScript
 * disabled gets — so a decision tree that only renders the selected branch has
 * silently deleted most of its own page.
 */
const WIDGETS: Array<[string, () => string]> = [
  ['SegmentPlayground', () => renderToStaticMarkup(createElement(SegmentPlayground))],
  ['SegmentColumns', () => renderToStaticMarkup(createElement(SegmentColumns))],
  ['BounceClassifier', () => renderToStaticMarkup(createElement(BounceClassifier))],
  ['OpenRateCalculator', () => renderToStaticMarkup(createElement(OpenRateCalculator))],
  ['TransportChooser', () => renderToStaticMarkup(createElement(TransportChooser))],
  ['DnsRecordBuilder', () => renderToStaticMarkup(createElement(DnsRecordBuilder))],
  ['VolumeCostPanel', () => renderToStaticMarkup(createElement(VolumeCostPanel))],
  [
    'WebhookSignaturePlayground',
    () => renderToStaticMarkup(createElement(WebhookSignaturePlayground)),
  ],
  ['RetryBackoffVisualizer', () => renderToStaticMarkup(createElement(RetryBackoffVisualizer))],
  ['HeadersInspector', () => renderToStaticMarkup(createElement(HeadersInspector))],
  ['WarmupPlanner', () => renderToStaticMarkup(createElement(WarmupPlanner))],
  [
    'TroubleshootingChecklist',
    () =>
      renderToStaticMarkup(
        createElement(TroubleshootingChecklist, {
          title: 'TEST',
          steps: [{ label: 'One', detail: 'The first thing to check.' }],
        }),
      ),
  ],
]

describe('guide widgets', () => {
  it.each(WIDGETS)('%s renders to static markup', (_name, render) => {
    const html = render()
    expect(html.length).toBeGreaterThan(200)
  })

  it('renders every branch of a decision widget, not just the selected one', () => {
    const html = renderToStaticMarkup(createElement(TransportChooser))
    for (const transport of ['Cloudflare Email Service', 'Amazon SES', 'Resend', 'SMTP']) {
      expect(html).toContain(transport)
    }
    // The event story is the substance of that section, and it has to be text.
    expect(html).toContain('SNS configuration set')
  })

  it('runs the real segment compiler, not a description of one', () => {
    const html = renderToStaticMarkup(createElement(SegmentPlayground))
    // Real compiled output for the default expression, produced at render time.
    expect(html).toMatch(/unsubscribed/)
    expect(html).toMatch(/last_open_at/)
  })

  it('runs the real bounce classifier', () => {
    const html = renderToStaticMarkup(createElement(BounceClassifier))
    expect(html).toContain('hard_invalid')
  })

  /**
   * `crypto.subtle` is undefined during prerender and on any non-secure origin.
   * The component must render a complete, readable state without it rather than
   * throwing — this is the one widget where the environment is genuinely absent
   * rather than merely different.
   */
  it('renders the signature playground without Web Crypto', () => {
    const html = renderToStaticMarkup(createElement(WebhookSignaturePlayground))
    expect(html).toContain('t=')
    expect(html).not.toContain('undefined')
  })
})
