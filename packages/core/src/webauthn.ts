import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { base64url } from './crypto.ts'

/**
 * Passkeys.
 *
 * A self-hosted instance has to be claimable by whoever deployed it, with no
 * email, no DNS and no identity provider — because on a fresh deployment none
 * of those exist yet. A passkey is the only widely-supported credential that
 * needs nothing but the browser already open on the page.
 *
 * The WebAuthn ceremony itself is delegated to `@simplewebauthn/server`, which
 * is WebCrypto-only and therefore runs unchanged on Workers and on Node. What
 * lives here is the *storage* shape — everything crossing this boundary is a
 * string, so the database layer never sees a `Uint8Array` and the two runtimes
 * cannot disagree about how bytes are encoded.
 *
 * ## The RP ID
 *
 * WebAuthn binds a credential to one hostname. That is the point of it, and it
 * is also the sharpest edge in a product whose public URL is *learned* from the
 * first request: an instance reached first on `*.workers.dev` and later on a
 * custom domain has credentials that cannot ever work on the new host. So the
 * RP ID is passed in explicitly at every call site and stored on each
 * credential, which turns "my passkey stopped working" into a banner naming the
 * host it belongs to, plus a recovery code that still works.
 */

/** How a credential is stored. Base64url in, base64url out. */
export interface StoredCredential {
  credentialId: string
  publicKey: string
  signCount: number
  transports?: string[]
}

export interface RelyingParty {
  /** The hostname, e.g. `mail.acme.dev`. Never a URL, never a port. */
  id: string
  /** The full origin the browser will report, e.g. `https://mail.acme.dev`. */
  origin: string
  name: string
}

/** Derives the relying party from a resolved public URL. */
export function relyingPartyFrom(publicUrl: string, name = 'MailySend'): RelyingParty {
  const url = new URL(publicUrl)
  return { id: url.hostname, origin: url.origin, name }
}

export async function registrationOptions(opts: {
  rp: RelyingParty
  userId: string
  userName: string
  userDisplayName?: string
  exclude?: StoredCredential[]
}) {
  return generateRegistrationOptions({
    rpName: opts.rp.name,
    rpID: opts.rp.id,
    userID: new TextEncoder().encode(opts.userId) as Uint8Array<ArrayBuffer>,
    userName: opts.userName,
    userDisplayName: opts.userDisplayName ?? opts.userName,
    attestationType: 'none',
    excludeCredentials: (opts.exclude ?? []).map((c) => ({
      id: c.credentialId,
      ...(c.transports ? { transports: c.transports } : {}),
    })),
    authenticatorSelection: {
      // Discoverable, so signing in later needs no email typed first — the
      // browser offers the passkey and the server learns who it is from the
      // credential id alone.
      residentKey: 'required',
      userVerification: 'preferred',
    },
  })
}

export async function verifyRegistration(opts: {
  rp: RelyingParty
  challenge: string
  response: unknown
}): Promise<StoredCredential | null> {
  const result = await verifyRegistrationResponse({
    response: opts.response as never,
    expectedChallenge: opts.challenge,
    expectedOrigin: opts.rp.origin,
    expectedRPID: opts.rp.id,
    // A platform authenticator that only proves presence is still a far better
    // credential than a code emailed to an inbox we may not be able to reach.
    requireUserVerification: false,
  })
  if (!result.verified || !result.registrationInfo) return null
  const credential = result.registrationInfo.credential
  return {
    credentialId: credential.id,
    publicKey: base64url.encode(credential.publicKey),
    signCount: credential.counter,
    ...(credential.transports ? { transports: credential.transports as string[] } : {}),
  }
}

export async function authenticationOptions(opts: {
  rp: RelyingParty
  allow?: StoredCredential[]
}) {
  return generateAuthenticationOptions({
    rpID: opts.rp.id,
    ...(opts.allow?.length
      ? {
          allowCredentials: opts.allow.map((c) => ({
            id: c.credentialId,
            ...(c.transports ? { transports: c.transports as never } : {}),
          })),
        }
      : {}),
    userVerification: 'preferred',
  })
}

export async function verifyAuthentication(opts: {
  rp: RelyingParty
  challenge: string
  credential: StoredCredential
  response: unknown
}): Promise<{ newSignCount: number } | null> {
  const result = await verifyAuthenticationResponse({
    response: opts.response as never,
    expectedChallenge: opts.challenge,
    expectedOrigin: opts.rp.origin,
    expectedRPID: opts.rp.id,
    credential: {
      id: opts.credential.credentialId,
      // The library's `Uint8Array_` is pinned to a plain ArrayBuffer, which is
      // what `base64url.decode` allocates — TypeScript just cannot see through
      // the generic on the DOM lib's declaration.
      publicKey: base64url.decode(opts.credential.publicKey) as Uint8Array<ArrayBuffer>,
      counter: opts.credential.signCount,
      ...(opts.credential.transports ? { transports: opts.credential.transports as never } : {}),
    },
    requireUserVerification: false,
  })
  if (!result.verified) return null
  return { newSignCount: result.authenticationInfo.newCounter }
}

/**
 * Recovery codes.
 *
 * Twenty base32 characters in five-character groups: enough entropy that
 * guessing is hopeless, and short enough to write on paper without a
 * transcription error. The alphabet excludes I, L, O and U for the same reason
 * ULIDs do.
 */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % 32])
  return [chars.slice(0, 5), chars.slice(5, 10), chars.slice(10, 15), chars.slice(15, 20)]
    .map((group) => group.join(''))
    .join('-')
}

/** Accepts the code however it was typed: spaces, dashes, lower case. */
export const normalizeRecoveryCode = (code: string): string =>
  code.toUpperCase().replace(/[^0-9A-Z]/g, '')
