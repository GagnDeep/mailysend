import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { constants } from 'node:fs'
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import type { Blob, BlobBody, BlobObject, BlobPutOptions } from '../types.ts'

/**
 * `Blob` over the filesystem.
 *
 * R2 holds the send spool, raw inbound MIME, attachments, NDJSON event staging
 * and the parquet archive. On a single server all of that is just files, and
 * keeping it as files means a self-hoster can back the whole thing up with
 * rsync and inspect it with `less`.
 *
 * Keys contain `/` and are stored as real directories. `..` is rejected rather
 * than normalised — an object key is attacker-influenced in the inbound path,
 * and a traversal there would be a filesystem write primitive.
 */
export class NodeBlob implements Blob {
  #root: string

  constructor(root: string) {
    this.#root = root
  }

  #path(key: string): string {
    if (key.includes('..') || key.startsWith('/') || key.includes('\0')) {
      throw new Error(`unsafe blob key: ${key}`)
    }
    return join(this.#root, key.split('/').join(sep))
  }

  #metaPath(key: string): string {
    return `${this.#path(key)}.__meta.json`
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream | null,
    options: BlobPutOptions = {},
  ): Promise<BlobObject | null> {
    if (value === null) return null
    const file = this.#path(key)
    await mkdir(dirname(file), { recursive: true })

    let bytes: Uint8Array
    if (typeof value === 'string') bytes = new TextEncoder().encode(value)
    else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value)
    else if (ArrayBuffer.isView(value))
      bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    else bytes = new Uint8Array(await new Response(value as ReadableStream).arrayBuffer())

    await writeFile(file, bytes)
    const etag = createHash('md5').update(bytes).digest('hex')
    const meta = {
      etag,
      httpMetadata: options.httpMetadata ?? {},
      customMetadata: options.customMetadata ?? {},
      uploaded: new Date().toISOString(),
    }
    await writeFile(this.#metaPath(key), JSON.stringify(meta))
    return {
      key,
      size: bytes.byteLength,
      etag,
      uploaded: new Date(meta.uploaded),
      httpMetadata: meta.httpMetadata,
      customMetadata: meta.customMetadata,
    }
  }

  async #meta(key: string) {
    try {
      return JSON.parse(await readFile(this.#metaPath(key), 'utf8'))
    } catch {
      return { etag: '', httpMetadata: {}, customMetadata: {}, uploaded: new Date().toISOString() }
    }
  }

  async head(key: string): Promise<BlobObject | null> {
    try {
      const st = await stat(this.#path(key))
      const meta = await this.#meta(key)
      return {
        key,
        size: st.size,
        etag: meta.etag,
        uploaded: new Date(meta.uploaded),
        httpMetadata: meta.httpMetadata,
        customMetadata: meta.customMetadata,
      }
    } catch {
      return null
    }
  }

  async get(key: string): Promise<BlobBody | null> {
    let bytes: Buffer
    try {
      bytes = await readFile(this.#path(key))
    } catch {
      return null
    }
    const meta = await this.#meta(key)
    const buf = new Uint8Array(bytes)
    return {
      key,
      size: buf.byteLength,
      etag: meta.etag,
      uploaded: new Date(meta.uploaded),
      httpMetadata: meta.httpMetadata,
      customMetadata: meta.customMetadata,
      get body() {
        return new Response(buf).body as ReadableStream
      },
      arrayBuffer: async () =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      text: async () => new TextDecoder().decode(buf),
      json: async () => JSON.parse(new TextDecoder().decode(buf)),
    }
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      await rm(this.#path(key), { force: true })
      await rm(this.#metaPath(key), { force: true })
    }
  }

  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const prefix = options.prefix ?? ''
    const limit = Math.min(options.limit ?? 1000, 1000)
    const after = options.cursor ? Buffer.from(options.cursor, 'base64url').toString() : ''

    // Walking from the deepest common directory keeps a prefixed list from
    // touching unrelated trees — `events/ws_x/` must not scan `spool/`.
    const base = join(this.#root, prefix.split('/').slice(0, -1).join(sep))
    const found: string[] = []
    const walk = async (dir: string) => {
      let entries: Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const name = String(e.name)
        const full = join(dir, name)
        if (e.isDirectory()) await walk(full)
        else if (!name.endsWith('.__meta.json')) {
          const key = relative(this.#root, full).split(sep).join('/')
          if (key.startsWith(prefix) && key > after) found.push(key)
        }
      }
    }
    try {
      await access(base, constants.R_OK)
      await walk(base)
    } catch {
      /* prefix does not exist yet — an empty page is the right answer */
    }

    found.sort()
    const page = found.slice(0, limit)
    const objects = await Promise.all(page.map((k) => this.head(k)))
    return {
      objects: objects.filter((o): o is BlobObject => o !== null),
      truncated: found.length > limit,
      ...(found.length > limit ? { cursor: Buffer.from(page.at(-1)!).toString('base64url') } : {}),
    }
  }
}
