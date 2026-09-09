import { describe, expect, it } from 'vitest'
import { formatExpression, describe as toEnglish } from '../src/describe.ts'
import { parse } from '../src/parser.ts'

describe('describe', () => {
  it('renders the canonical example', () => {
    expect(toEnglish('opened_last_30d and not clicked_last_7d')).toBe(
      'opened in the last 30 days and has not clicked in the last 7 days',
    )
  })

  it('renders each sugar predicate in both polarities', () => {
    const cases: [string, string, string][] = [
      ['opened_last_30d', 'opened in the last 30 days', 'has not opened in the last 30 days'],
      ['clicked_last_7d', 'clicked in the last 7 days', 'has not clicked in the last 7 days'],
      [
        'sent_last_90d',
        'received email in the last 90 days',
        'was not sent email in the last 90 days',
      ],
      ['never_opened', 'has never opened', 'has opened at least once'],
      ['never_clicked', 'has never clicked', 'has clicked at least once'],
      ['subscribed', 'is subscribed', 'is unsubscribed'],
      ['bounced', 'has bounced', 'has never bounced'],
    ]
    for (const [source, positive, negative] of cases) {
      expect(toEnglish(source)).toBe(positive)
      expect(toEnglish(`not ${source}`)).toBe(negative)
    }
  })

  it('does not claim a window that the compiler does not enforce', () => {
    // `bounced_last_30d` compiles to bounce_count > 0; the sentence says so.
    expect(toEnglish('bounced_last_30d')).toBe('has bounced')
  })

  it('pushes negation into the leaves rather than wrapping the sentence', () => {
    expect(toEnglish('not (never_opened or unsubscribed)')).toBe(
      'has opened at least once and is not unsubscribed',
    )
    expect(toEnglish('not open_count >= 3')).toBe('open count is less than 3')
    expect(toEnglish("not email contains 'a'")).toBe('email does not contain "a"')
    expect(toEnglish('not first_name is null')).toBe('first name is set')
  })

  it('reads dates as before/after rather than more/less', () => {
    expect(toEnglish('last_open_at > 30d')).toBe('last open was after 30 days ago')
    expect(toEnglish("created_at < '2026-01-01'")).toBe('creation date was before "2026-01-01"')
  })

  it('renders in-lists and custom fields', () => {
    expect(toEnglish("email in ['a', 'b', 'c']")).toBe('email is "a", "b" or "c"')
    expect(toEnglish("data.plan = 'pro'")).toBe('plan is "pro"')
    expect(toEnglish('data["seat count"] > 3')).toBe('seat count is more than 3')
  })

  it('reads a bare boolean column as a state', () => {
    expect(toEnglish('unsubscribed')).toBe('is unsubscribed')
    expect(toEnglish('not unsubscribed')).toBe('is not unsubscribed')
  })

  it('singularises units', () => {
    expect(toEnglish('opened_last_1d')).toBe('opened in the last 1 day')
    expect(toEnglish('opened_last_2w')).toBe('opened in the last 2 weeks')
  })
})

describe('formatExpression', () => {
  it('normalises spacing without changing meaning', () => {
    expect(formatExpression("email   in[ 'a' ,'b' ]")).toBe("email in ['a', 'b']")
    expect(formatExpression('OPENED_LAST_30D AND NOT SUBSCRIBED')).toBe(
      'opened_last_30d and not subscribed',
    )
  })

  it('keeps only the parentheses precedence requires', () => {
    expect(formatExpression('(subscribed) and (bounced)')).toBe('subscribed and bounced')
    expect(formatExpression('subscribed and (bounced or never_opened)')).toBe(
      'subscribed and (bounced or never_opened)',
    )
    expect(formatExpression('(subscribed and bounced) or never_opened')).toBe(
      'subscribed and bounced or never_opened',
    )
  })

  it('round-trips: re-parsing the output yields the same tree', () => {
    const sources = [
      'opened_last_30d and not clicked_last_7d',
      "email contains 'a' or data.plan in ['pro', 'team']",
      'subscribed and (bounced or never_opened) and first_name is not null',
      'unsubscribed',
      'data["seat count"] >= 3 and last_open_at > 12h',
    ]
    for (const source of sources) {
      const once = formatExpression(source)
      expect(formatExpression(once)).toBe(once)
      expect(parse(once)).toEqual(parse(source))
    }
  })

  it('escapes quotes when printing a string back', () => {
    expect(formatExpression('email = "it\'s"')).toBe("email = 'it\\'s'")
    expect(parse(formatExpression('email = "it\'s"'))).toEqual(parse('email = "it\'s"'))
  })
})
