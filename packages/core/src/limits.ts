/**
 * Numbers that two packages have to agree on.
 *
 * `packages/durable` seals a cohort at `COHORT_MAX` and `packages/workflows`
 * sizes a plan against the same number; `packages/workflows` refuses an
 * enrollment past `INSTANCE_MODE_MAX_ENROLLMENTS` and the API refuses the same
 * edit with the same number. Whichever package owned them, the other would have
 * to import it — and since the runner lives in `durable` and the interpreter in
 * `workflows`, either direction closes a cycle. They live here because `core`
 * is the one package both already depend on.
 */

/**
 * The largest cohort a single instance walks.
 *
 * A cohort is one pass over the program per ordinal, so its cost is the fan-out
 * page count, not the member count — but the enrollment set has to be walkable
 * inside one instance's lifetime, and twenty-five thousand is what that buys.
 */
export const COHORT_MAX = 25_000

/**
 * The instance-mode ceiling.
 *
 * Workflows V2 caps 50,000 concurrent instances per account. Forty thousand
 * leaves room for every other automation in the deployment, which is the point:
 * one drip must not be able to consume the account's whole instance budget.
 */
export const INSTANCE_MODE_MAX_ENROLLMENTS = 40_000

/** The engine's own ceiling, for the error message that explains the refusal. */
export const WORKFLOWS_V2_MAX_CONCURRENT_INSTANCES = 50_000
