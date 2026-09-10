import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GUIDES } from '~/content/guides/manifest.ts'

/**
 * A guide has to be scannable, and "scannable" has to be measurable.
 *
 * The first pass of this surface was correct and unreadable: twenty to
 * forty-three consecutive paragraphs per page against zero to three tables. A
 * reader looking for one fact had to read prose to find it, which is the
 * failure the guides existed to fix — /docs was already correct.
 *
 * So the rule is counted rather than asserted in a style guide nobody opens.
 * Every section must carry at least two things that are not paragraphs, and a
 * guide may not average more than 1.6 paragraphs per structural element.
 * Neither number is sacred. They were chosen by measuring the first pass — it
 * ranged from 0.41 to 4.67 — and picking a line that most of it failed, so
 * that passing means the page was actually restructured rather than nudged.
 */
const ROUTES = fileURLToPath(new URL('../src/routes/guides', import.meta.url))

/**
 * Anything that gives the eye somewhere to land: a table, a diagram, a
 * contrast, a callout, a code block, a numbered step, a figure, a widget.
 * Widgets are matched by suffix rather than enumerated, so a new one counts on
 * the day it is written.
 */
const STRUCTURAL =
  /<(?:FactTable|Table|ComparisonTable|Diagram|FlowNode|Contrast|StepCard|Takeaway|Gotcha|Callout|Code|CodeTabs|Terminal|CommandStrip|MetricGrid|Metric|StatTile|BarRow|GainLossList|KeyValueList|KeyValue|LogRow|Accordion|Progress|Tabs|ul|ol)\b|<[A-Z][A-Za-z]*(?:Playground|Calculator|Chooser|Builder|Classifier|Panel|Visualizer|Inspector|Planner|Checklist|Columns)\b/g

const PARAGRAPH = /<p[\s>]/g

const count = (source: string, pattern: RegExp): number => source.match(pattern)?.length ?? 0

describe('guide density', () => {
  for (const guide of GUIDES) {
    const source = readFileSync(join(ROUTES, `${guide.slug}.tsx`), 'utf8')
    const structural = count(source, STRUCTURAL)
    const paragraphs = count(source, PARAGRAPH)

    it(`${guide.slug} has something to look at in every section`, () => {
      expect(structural).toBeGreaterThanOrEqual(guide.sections.length * 2)
    })

    it(`${guide.slug} is not a wall of text`, () => {
      expect(paragraphs / Math.max(structural, 1)).toBeLessThanOrEqual(1.6)
    })
  }

  it('every guide file exists to be measured', () => {
    const onDisk = readdirSync(ROUTES).filter((n) => n.endsWith('.tsx') && n !== 'index.tsx')
    expect(onDisk).toHaveLength(GUIDES.length)
  })
})
