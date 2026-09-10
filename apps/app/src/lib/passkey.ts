import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { failure, postJson } from './instance.ts'

/**
 * The browser half of the passkey ceremonies.
 *
 * `@simplewebauthn/browser` is here for one reason: the base64url ↔
 * ArrayBuffer conversions WebAuthn demands are fiddly, and getting one of them
 * subtly wrong produces a credential that registers fine and then never
 * authenticates. The server uses the matching library so both ends agree.
 */

export interface ChallengeEnvelope {
  rp_id: string
  user_id?: string
  options: Record<string, unknown>
}

export class PasskeyError extends Error {}

/** A user who closes the system dialog has not failed; they have declined. */
const asPasskeyError = (error: unknown): PasskeyError => {
  if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
    return new PasskeyError('That passkey prompt was dismissed.')
  }
  if (error instanceof Error && error.name === 'InvalidStateError') {
    return new PasskeyError('This device already has a passkey for this instance.')
  }
  return new PasskeyError(error instanceof Error ? error.message : 'The passkey step failed.')
}

async function envelope(path: string, body?: unknown): Promise<ChallengeEnvelope> {
  const response = await postJson(path, body)
  if (!response.ok)
    throw new PasskeyError(await failure(response, 'Could not start the passkey step.'))
  return (await response.json()) as ChallengeEnvelope
}

/** Registers a new passkey and returns what the matching `verify` call needs. */
export async function createPasskey(
  optionsPath: string,
  optionsBody?: unknown,
): Promise<{ challenge: string; response: unknown; userId?: string }> {
  const { options, user_id } = await envelope(optionsPath, optionsBody)
  let response: unknown
  try {
    response = await startRegistration({ optionsJSON: options as never })
  } catch (error) {
    throw asPasskeyError(error)
  }
  return {
    challenge: options.challenge as string,
    response,
    ...(user_id ? { userId: user_id } : {}),
  }
}

/**
 * Asserts an existing passkey. Discoverable, so no address is typed first.
 *
 * Not named `use…`: it is a plain async call made from an event handler, and a
 * `use` prefix makes every linter — and every reader — treat it as a hook.
 */
export async function assertPasskey(
  optionsPath: string,
): Promise<{ challenge: string; response: unknown }> {
  const { options } = await envelope(optionsPath)
  let response: unknown
  try {
    response = await startAuthentication({ optionsJSON: options as never })
  } catch (error) {
    throw asPasskeyError(error)
  }
  return { challenge: options.challenge as string, response }
}

/** Whether this browser can make a passkey at all. */
export const passkeysSupported = (): boolean =>
  typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function'
