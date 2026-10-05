/**
 * THE ENVIRONMENT VARIABLES THIS TOOL READS, UNDER THEIR NAME AND THEIR FORMER NAME.
 *
 * The product is Crusetra Routing since 5 October 2026, so every variable is named
 * `CRUSETRA_<NAME>`. The former name `CASCADE_<NAME>` is still read, as a deprecated alias:
 * a client's scripts may already set it, and a renamed variable that is silently ignored
 * changes what those scripts do.
 *
 *   CRUSETRA_OFFLINE=1            refuse the network          (former name CASCADE_OFFLINE)
 *   CRUSETRA_TESSDATA=<dir>       where the OCR files live    (former name CASCADE_TESSDATA)
 *   CRUSETRA_POIDS_RACINE=<dir>   a weights cache for a test  (former name CASCADE_POIDS_RACINE)
 *
 * The pre-push hook reads CRUSETRA_LICENCIE the same way, then its former name CASCADE_LICENCIE.
 *
 * A VALUE: the new name wins when both are set, and the former name is read only when the
 * new one is absent.
 *
 * THE OFFLINE SWITCH IS THE EXCEPTION, ON PURPOSE: either name set to 1 refuses the network.
 * A safety switch must never be turned off by a name its user has not heard of. A script that
 * sets CASCADE_OFFLINE=1 keeps refusing exactly as before, whatever else the environment
 * carries, and CRUSETRA_OFFLINE=0 does not reopen what CASCADE_OFFLINE=1 closed.
 */

/** The prefix every variable carries now. */
export const PREFIXE = "CRUSETRA_";
/** The former prefix, still read as a deprecated alias. */
export const PREFIXE_ANCIEN = "CASCADE_";

/** The value of `CRUSETRA_<nom>`, else of its former name `CASCADE_<nom>`, else undefined. */
export function lireVariable(nom: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[PREFIXE + nom] ?? env[PREFIXE_ANCIEN + nom];
}

/** True when the network is refused: CRUSETRA_OFFLINE=1, or its former name CASCADE_OFFLINE=1. */
export function horsLigne(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CRUSETRA_OFFLINE === "1" || env.CASCADE_OFFLINE === "1";
}

/**
 * The switch as a message should name it. When only the former name refused the network,
 * the message says so and gives the new name, so a reader is never told about a variable
 * they did not set, and still learns the one to use.
 */
export function drapeauHorsLigne(env: NodeJS.ProcessEnv = process.env): string {
  return env.CASCADE_OFFLINE === "1" && env.CRUSETRA_OFFLINE !== "1"
    ? "CASCADE_OFFLINE=1 (the former name of CRUSETRA_OFFLINE=1)"
    : "CRUSETRA_OFFLINE=1";
}
