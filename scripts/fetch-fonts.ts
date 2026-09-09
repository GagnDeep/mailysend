/**
 * Downloads the three variable fonts the design uses into apps/app/public/fonts.
 *
 * We self-host rather than linking the Google CDN (see packages/design-tokens/
 * src/fonts.css for why). Run once after clone; the files are gitignored so the
 * repo stays small, and `pnpm build` fails loudly if they are missing.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'apps/app/public/fonts')

/** A modern UA string is required: Google serves woff2 only to browsers that ask for it. */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

const FACES = [
  { file: 'bricolage-grotesque-latin.woff2', css: 'Bricolage+Grotesque:opsz,wght@12..96,200..800' },
  { file: 'instrument-sans-latin.woff2', css: 'Instrument+Sans:wght@400..700' },
  { file: 'jetbrains-mono-latin.woff2', css: 'JetBrains+Mono:wght@400..700' },
]

async function main() {
  await mkdir(OUT, { recursive: true })
  for (const face of FACES) {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${face.css}&display=swap`
    const css = await (await fetch(cssUrl, { headers: { 'User-Agent': UA } })).text()

    // Google emits one @font-face block per unicode-range. We want the `latin`
    // block only — it is the last one in the file and the smallest useful subset.
    const blocks = css.split('@font-face').filter((b) => b.includes('unicode-range'))
    const latin = blocks.find((b) => b.includes('U+0000-00FF')) ?? blocks.at(-1)
    const url = latin?.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1]
    if (!url) throw new Error(`no woff2 url found for ${face.file}`)

    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
    await writeFile(join(OUT, face.file), bytes)
    console.log(`✓ ${face.file} — ${(bytes.length / 1024).toFixed(1)} KB`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
