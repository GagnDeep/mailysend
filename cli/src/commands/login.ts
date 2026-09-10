import type { FlagSpecs } from '../args.ts'
import { CliError, type CommandContext } from '../command.ts'
import { configPath, DEFAULT_BASE_URL, readConfig, writeConfig } from '../config.ts'
import { kv, note, ok, out, Progress, style } from '../term.ts'

/**
 * Device-code login.
 *
 * The browser flow is a device code rather than a local callback server for a
 * reason that shows up constantly in practice: people run this over SSH, in a
 * container, and on machines whose `localhost` the browser cannot reach. A code
 * the user reads out loud works everywhere a redirect does not.
 *
 * `--token` exists because CI has no browser and no human, and pretending
 * otherwise pushes people towards pasting keys into shell history instead.
 */

export const loginFlags: FlagSpecs = {
  token: { kind: 'string', describe: 'Store an existing API key instead of opening a browser' },
  url: { kind: 'string', describe: 'Base URL of the deployment', default: DEFAULT_BASE_URL },
  profile: {
    kind: 'string',
    short: 'p',
    describe: 'Profile name to store under',
    default: 'default',
  },
  list: { kind: 'boolean', describe: 'Show the stored profiles and exit' },
}

interface DeviceCode {
  device_code: string
  user_code: string
  verification_url: string
  interval?: number
  expires_in?: number
}

export const login = async (ctx: CommandContext) => {
  const config = await readConfig()

  if (ctx.args.flags.list === true) {
    const names = Object.keys(config.profiles)
    if (names.length === 0) {
      note('No profiles stored yet.')
      return
    }
    out()
    for (const name of names) {
      const marker = name === config.current ? style.green('*') : ' '
      const profile = config.profiles[name]!
      out(`${marker} ${style.bold(name.padEnd(12))} ${style.dim(profile.baseUrl)}`)
    }
    out()
    note(configPath())
    return
  }

  const baseUrl = String(ctx.args.flags.url).replace(/\/+$/, '')
  const name = String(ctx.args.flags.profile)
  const direct = ctx.args.flags.token as string | undefined

  let apiKey: string
  let label: string | undefined

  if (direct) {
    apiKey = direct
  } else {
    const start = await fetch(`${baseUrl}/v1/auth/device`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: 'mailysend-cli' }),
    })
    if (!start.ok) {
      throw new CliError(`${baseUrl} did not start a device login (${start.status}).`, {
        hint:
          start.status === 404
            ? 'That deployment predates the device flow. Upgrade it, or run `mailysend login --token ms_live_…`.'
            : `If nobody has claimed that instance yet, run: mailysend claim --url ${baseUrl}`,
      })
    }
    const device = (await start.json()) as DeviceCode

    out()
    out(`  Open ${style.cyan(device.verification_url)}`)
    out(`  Enter ${style.bold(device.user_code)}`)
    out()

    const progress = new Progress('Waiting for approval')
    const interval = (device.interval ?? 5) * 1000
    const deadline = Date.now() + (device.expires_in ?? 900) * 1000
    let token: string | undefined

    while (Date.now() < deadline && token === undefined) {
      await new Promise((resolve) => setTimeout(resolve, interval))
      const poll = await fetch(`${baseUrl}/v1/auth/device/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_code: device.device_code }),
      })
      if (poll.status === 428 || poll.status === 202) continue
      if (!poll.ok) {
        progress.stop()
        throw new CliError(`Login failed (${poll.status}).`)
      }
      const body = (await poll.json()) as { token: string; workspace?: string }
      token = body.token
      label = body.workspace
    }
    progress.stop()

    if (token === undefined) throw new CliError('The login code expired before it was approved.')
    apiKey = token
  }

  const whoami = await fetch(`${baseUrl}/v1/domains?limit=1`, {
    headers: { authorization: `Bearer ${apiKey}` },
  })
  if (whoami.status === 401) throw new CliError('That key was rejected by the API.')

  config.profiles[name] = {
    apiKey,
    baseUrl,
    ...(label === undefined ? {} : { label }),
  }
  config.current = name
  await writeConfig(config)

  out()
  kv([
    ['profile', style.cyan(name)],
    ['endpoint', baseUrl],
    ['stored in', `${configPath()} ${style.dim('(0600)')}`],
  ])
  out()
  ok('Signed in.')
}
