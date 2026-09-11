import { DEFAULT_WORKSPACE } from '@mailysend/core'
import { VERSION } from '../../version.ts'
import {
  claimCodeRequired,
  isClaimed,
  LAST_SEND_ERROR_KEY,
  PREVIOUS_URL_KEY,
  readInstanceSetting,
} from '../bootstrap.ts'
import { tenancyFor } from '../context.ts'
import { getEnv } from '../env.ts'
import { oidcConfig } from './auth-oidc.ts'
import { createRouter } from './base.ts'

/**
 * `GET /v1/instance` — what this deployment can actually do.
 *
 * Every pre-auth screen reads this before it renders. The reason is a class of
 * bug this product shipped four times over: the sign-in page offered Cloudflare
 * Access as its *primary* action on instances where Access was not configured
 * and the endpoint answered 501, it offered an emailed one-time code on
 * instances with no verified sending domain, and it linked to a setup wizard
 * that did not exist. A door that is drawn on the wall is worse than no door,
 * because the person trying to get in spends their time on it.
 *
 * So this endpoint is deliberately unauthenticated — it is what the sign-in
 * page needs *before* anyone can be authenticated — and deliberately contains
 * no per-address facts. Everything here is a property of the deployment, which
 * anybody who can reach the deployment can already observe by trying each door
 * in turn. Answering honestly leaks nothing and saves them the trouble.
 */
export const instance = createRouter()

instance.get('/', async () => {
  const env = getEnv()
  const sql = tenancyFor(env).db('')

  const [claimed, verified, previousUrl, lastSendError, codeRequired] = await Promise.all([
    isClaimed(sql),
    sql
      .prepare(`SELECT COUNT(*) AS n FROM domains WHERE workspace_id = ? AND status = 'verified'`)
      .bind(DEFAULT_WORKSPACE)
      .first<{ n: number }>(),
    readInstanceSetting(sql, PREVIOUS_URL_KEY),
    readInstanceSetting(sql, LAST_SEND_ERROR_KEY),
    claimCodeRequired(sql, env.MS_OWNER_EMAIL, env.MS_REQUIRE_CLAIM_CODE),
  ])

  const verifiedDomains = verified?.n ?? 0
  const access = Boolean(env.MS_ACCESS_TEAM && env.MS_ACCESS_AUD)
  const oidcSet = oidcConfig()

  return Response.json({
    object: 'instance',
    claimed,
    // What `/setup` must ask for, and nothing about who. `code_required` says
    // this deployment opted into a code with `MS_REQUIRE_CLAIM_CODE`, minted one
    // on first boot, and has not spent it; `reserved` says
    // `MS_OWNER_EMAIL` is set. The address itself stays out of an
    // unauthenticated response — knowing that *an* address is required is what
    // the form needs, and is already observable by trying; knowing *which* is a
    // fact about a person, and is not.
    claim: { code_required: claimed ? false : codeRequired, reserved: Boolean(env.MS_OWNER_EMAIL) },
    mode: env.MS_MODE,
    version: VERSION,
    public_url: env.MS_PUBLIC_URL,
    landing: env.MS_LANDING,
    auth: {
      // Always offered: a passkey needs no email, no DNS and no identity
      // provider, which is precisely why it is the claim credential.
      passkey: true,
      access,
      // An emailed code is only a real option once something can be emailed.
      otp: verifiedDomains > 0,
      device: true,
      // Rendered only when all three of issuer, client id and secret are set,
      // so the button on the sign-in page is never a button that cannot work.
      oidc: oidcSet !== null,
      oidc_label: oidcSet?.label ?? null,
    },
    sending: {
      ready: verifiedDomains > 0,
      verified_domains: verifiedDomains,
      last_error: lastSendError,
    },
    // Non-null only after the deployment's own hostname changed, which is what
    // invalidates existing passkeys. The dashboard turns it into a banner.
    previous_public_url: previousUrl,
  })
})
