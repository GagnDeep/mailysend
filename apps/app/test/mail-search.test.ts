import { describe, expect, it } from 'vitest'
import { compileMailQuery, ftsMatch, tokenize } from '../src/lib/mail-search.ts'

/**
 * The search grammar.
 *
 * The injection cases are the point of the file. They do not check that a
 * hostile value is escaped — they check that it never reaches the SQL string at
 * all, because the compiler has no path that concatenates a value. If one of
 * these ever fails, the failure is structural rather than a missing escape.
 */

describe('tokenize', () => {
  it('keeps a quoted phrase together', () => {
    expect(tokenize('subject:"invoice 12" refund')).toEqual([
      { operator: 'subject', value: 'invoice 12', negated: false },
      { operator: null, value: 'refund', negated: false },
    ])
  })

  it('reads a leading minus as negation', () => {
    expect(tokenize('-from:noreply')).toEqual([
      { operator: 'from', value: 'noreply', negated: true },
    ])
  })
})

describe('compileMailQuery — every operator', () => {
  it('from: and to: compare against the message addresses', () => {
    const compiled = compileMailQuery('from:ana@acme.dev to:support')
    expect(compiled.where).toEqual([
      "m.from_address LIKE ? ESCAPE '\\'",
      "m.to_addresses LIKE ? ESCAPE '\\'",
    ])
    expect(compiled.params).toEqual(['%ana@acme.dev%', '%support%'])
  })

  it('subject: compares against the thread subject', () => {
    const compiled = compileMailQuery('subject:"invoice 12"')
    expect(compiled.where).toEqual(["t.subject LIKE ? ESCAPE '\\'"])
    expect(compiled.params).toEqual(['%invoice 12%'])
  })

  it('in: and folder: accept only the five real folders', () => {
    expect(compileMailQuery('in:archive').where).toEqual(['t.folder = ?'])
    expect(compileMailQuery('in:archive').params).toEqual(['archive'])
    // A folder that does not exist is not a filter — it is a word.
    const bogus = compileMailQuery('in:nowhere')
    expect(bogus.where).toEqual([])
    expect(bogus.match).toBe('"nowhere"')
  })

  it('label: matches the serialised JSON array exactly', () => {
    const compiled = compileMailQuery('label:lbl_123')
    expect(compiled.where).toEqual(["t.labels LIKE ? ESCAPE '\\'"])
    expect(compiled.params).toEqual(['%"lbl\\_123"%'])
  })

  it('before: and after: take an ISO date', () => {
    const compiled = compileMailQuery('before:2026-01-01 after:2025-01-01')
    expect(compiled.where).toEqual(['t.last_message_at < ?', 't.last_message_at > ?'])
    expect(compiled.params).toEqual(['2026-01-01', '2025-01-01'])
  })

  it('before: and after: also take a relative window', () => {
    const compiled = compileMailQuery('after:7d')
    const stamp = Date.parse(compiled.params[0] as string)
    const expected = Date.now() - 7 * 86_400_000
    expect(Math.abs(stamp - expected)).toBeLessThan(60_000)
  })

  it('mailbox: filters the thread by its mailbox', () => {
    expect(compileMailQuery('mailbox:mbx_1').where).toEqual(['t.mailbox_id = ?'])
  })

  it('is: and has: resolve to fixed clauses with no parameters at all', () => {
    const compiled = compileMailQuery('is:unread is:starred has:attachment is:sent')
    expect(compiled.where).toEqual([
      't.unread_count > 0',
      't.starred = 1',
      't.has_attachments = 1',
      "t.last_direction = 'out'",
    ])
    expect(compiled.params).toEqual([])
  })

  it('negates any operator', () => {
    expect(compileMailQuery('-from:noreply').where).toEqual([
      "NOT (m.from_address LIKE ? ESCAPE '\\')",
    ])
    expect(compileMailQuery('-is:unread').where).toEqual(['NOT (t.unread_count > 0)'])
  })

  it('treats an unknown operator as text rather than as a column', () => {
    const compiled = compileMailQuery('password:hunter2')
    expect(compiled.where).toEqual([])
    expect(compiled.match).toBe('"password:hunter2"')
  })

  it('mixes operators and free text in one query', () => {
    const compiled = compileMailQuery('from:ana is:unread refund overdue')
    expect(compiled.where).toEqual(["m.from_address LIKE ? ESCAPE '\\'", 't.unread_count > 0'])
    expect(compiled.match).toBe('"refund" "overdue"')
  })
})

describe('compileMailQuery — injection', () => {
  const attacks = [
    "'; DROP TABLE mail_messages; --",
    "' OR 1=1 --",
    "x' UNION SELECT value FROM settings --",
    'x") OR ("1"="1',
    "\\'; DELETE FROM mail_threads WHERE '1'='1",
  ]

  for (const attack of attacks) {
    it(`carries ${JSON.stringify(attack)} as a bound parameter in every operator`, () => {
      // The double quotes are the phrase delimiter, so they cannot also be
      // part of a phrase; everything else in the attack goes through verbatim.
      const payload = attack.replace(/"/g, '')
      for (const operator of ['from', 'to', 'subject', 'label', 'mailbox', 'before', 'after']) {
        const compiled = compileMailQuery(`${operator}:"${payload}"`)
        const sql = compiled.where.join(' AND ')
        // The SQL is a shape, never a value. Every clause the compiler can emit
        // is a registry column, a comparison, a `?`, and — for LIKE — the fixed
        // `ESCAPE '\\'` suffix. Nothing else is expressible, so this pattern
        // holding is the same statement as "the value never reached the SQL".
        expect(sql).toMatch(/^(?:NOT \()?[tm]\.[a-z_]+ (?:LIKE \? ESCAPE '\\'|[<>=] \?)\)?$/)
        // Whatever the reader typed is bound, not built in.
        expect(compiled.params.length).toBe(compiled.where.length)
        expect(String(compiled.params[0])).toContain(payload.replace(/[\\%_]/g, '\\$&').slice(1, 8))
      }
    })
  }

  it('does not let a hostile flag value invent a clause', () => {
    const compiled = compileMailQuery("is:unread' OR 1=1 --")
    // `is:unread'` is not a flag, so it becomes text; the rest is text too.
    expect(compiled.where).toEqual([])
    expect(compiled.match).not.toContain('OR 1=1 --')
  })

  it('escapes LIKE wildcards so a value cannot widen its own pattern', () => {
    expect(compileMailQuery('from:%').params).toEqual(['%\\%%'])
    // And an underscore — every id in this product has one — survives as a
    // literal instead of matching any character.
    expect(compileMailQuery('label:lbl_123').params).toEqual(['%"lbl\\_123"%'])
  })

  it('never emits a clause without a matching parameter', () => {
    const compiled = compileMailQuery('from:a to:b subject:c label:d in:inbox is:unread e f')
    const placeholders = compiled.where.join(' ').split('?').length - 1
    expect(placeholders).toBe(compiled.params.length)
  })
})

describe('ftsMatch', () => {
  it('quotes each term so FTS5 operators in user text stay literal', () => {
    expect(ftsMatch(['refund', 'AND', 'NOT'])).toBe('"refund" "AND" "NOT"')
  })

  it('is null when there is no free text', () => {
    expect(ftsMatch([])).toBeNull()
    expect(compileMailQuery('is:unread').match).toBeNull()
  })

  it('cannot be closed out of its own phrase', () => {
    expect(ftsMatch(['a" OR "b'])).toBe('"a OR b"')
  })
})
