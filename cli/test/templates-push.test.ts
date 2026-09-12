import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/main.ts'

/**
 * `templates push` accepts three kinds of file, and the docs say so.
 *
 * Each one is compiled in a different place and stored under a different
 * engine, and the only thing that used to be true was the JSX path — the
 * Templates section was titled "JSX, MJML, Handlebars" while the glob matched
 * `.tsx` and `.jsx` and the upload hard-coded `engine: 'jsx-ast'`.
 *
 * `--dry-run` is what this drives: it exercises collection, compilation and
 * engine selection, and stops before the network.
 */

let stdout = ''
let stderr = ''
let dir = ''

beforeEach(() => {
  stdout = ''
  stderr = ''
  dir = mkdtempSync(join(tmpdir(), 'mailysend-templates-'))
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk)
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk)
    return true
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const write = (name: string, body: string) => writeFileSync(join(dir, name), body)

describe('templates push --dry-run', () => {
  it('compiles a react-email component to the jsx-ast engine', async () => {
    // Byte for byte the sample the docs print, down to the import specifier —
    // which the compiler never reads, and which therefore has to name the
    // package those components actually come from.
    write(
      'LoginCode.tsx',
      `import { Html, Text, Button } from '@react-email/components';

export default ({ code }) => (
  <Html>
    <Text>Your code is {code}</Text>
    <Button href="https://acme.dev/verify">Verify</Button>
  </Html>
);
`,
    )

    expect(await main(['templates', 'push', dir, '--dry-run'])).toBe(0)
    expect(stdout).toContain('jsx-ast')
    expect(stdout).toContain('login-code')
    expect(stdout).toContain('code')
  })

  it('uploads Handlebars source as written, with its variables', async () => {
    write('Welcome.hbs', '<p>Hi {{contact.first_name}}, welcome to {{company}}.</p>')

    expect(await main(['templates', 'push', dir, '--dry-run'])).toBe(0)
    expect(stdout).toContain('handlebars')
    expect(stdout).toContain('contact.first_name')
    expect(stdout).toContain('company')
  })

  it('compiles MJML here, and keeps it handlebars when braces survive', async () => {
    // The merge pass runs after MJML, so `{{name}}` in the output is still a
    // variable and the stored engine has to be `handlebars`, not `html`.
    write(
      'Digest.mjml',
      '<mjml><mj-body><mj-section><mj-column><mj-text>Hello {{name}}</mj-text></mj-column></mj-section></mj-body></mjml>',
    )

    expect(await main(['templates', 'push', dir, '--dry-run'])).toBe(0)
    expect(stdout).toContain('handlebars')
    expect(stdout).toContain('name')
  })

  it('defaults to ./emails rather than a directory called `push`', async () => {
    // `templates push` parses as three positionals; reading the second one
    // made the bare command look for `./push`.
    expect(await main(['templates', 'push'])).toBe(1)
    expect(stderr).toMatch(/emails/)
    expect(stderr).not.toMatch(/[/\\]push/)
  })

  it('refuses JSX the render worker could not walk', async () => {
    write('Bad.tsx', 'export default () => <Html>{fetch("https://evil.test")}</Html>\n')

    expect(await main(['templates', 'push', dir, '--dry-run'])).toBe(1)
  })
})
