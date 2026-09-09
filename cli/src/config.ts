import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Credentials on disk.
 *
 * Written 0600 and the directory 0700, because an API key that can send mail
 * from a verified domain is a spoofing capability, not a preference. The file
 * holds several named profiles so one machine can talk to a self-hosted
 * deployment and to mailysend.com without swapping tokens by hand.
 *
 * `MAILYSEND_API_KEY` in the environment always wins: CI must never depend on
 * a file that CI cannot write.
 */

export interface Profile {
  apiKey: string
  baseUrl: string
  workspaceId?: string
  label?: string
}

export interface ConfigFile {
  version: 1
  current: string
  profiles: Record<string, Profile>
}

export const DEFAULT_BASE_URL = 'https://api.mailysend.com'

export const configDir = (): string =>
  process.env.MAILYSEND_CONFIG_DIR ??
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'mailysend')

export const configPath = (): string => join(configDir(), 'config.json')

const empty: ConfigFile = { version: 1, current: 'default', profiles: {} }

export const readConfig = async (): Promise<ConfigFile> => {
  try {
    const parsed = JSON.parse(await readFile(configPath(), 'utf8')) as ConfigFile
    if (parsed?.version !== 1 || typeof parsed.profiles !== 'object') return { ...empty }
    return parsed
  } catch {
    return { ...empty }
  }
}

export const writeConfig = async (config: ConfigFile): Promise<void> => {
  const dir = configDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const path = configPath()
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  // `writeFile`'s mode applies only on create, so an existing world-readable
  // file would silently stay world-readable after a re-login.
  await chmod(path, 0o600)
}

export interface Credentials {
  apiKey: string
  baseUrl: string
  profile: string
}

export class NotLoggedIn extends Error {
  constructor() {
    super('No API key. Run `mailysend login`, or set MAILYSEND_API_KEY.')
  }
}

export const resolveCredentials = async (
  overrides: { apiKey?: string; baseUrl?: string; profile?: string } = {},
): Promise<Credentials> => {
  const envKey = overrides.apiKey ?? process.env.MAILYSEND_API_KEY
  const envUrl = overrides.baseUrl ?? process.env.MAILYSEND_BASE_URL

  if (envKey) {
    return { apiKey: envKey, baseUrl: envUrl ?? DEFAULT_BASE_URL, profile: 'env' }
  }

  const config = await readConfig()
  const name = overrides.profile ?? process.env.MAILYSEND_PROFILE ?? config.current
  const profile = config.profiles[name]
  if (!profile) throw new NotLoggedIn()
  return { apiKey: profile.apiKey, baseUrl: envUrl ?? profile.baseUrl, profile: name }
}

/** Per-command scratch state (import checkpoints, cached version checks). */
export const statePath = (name: string): string => join(configDir(), 'state', `${name}.json`)

export const readState = async <T>(name: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(statePath(name), 'utf8')) as T
  } catch {
    return null
  }
}

export const writeState = async (name: string, value: unknown): Promise<void> => {
  const path = statePath(name)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}
