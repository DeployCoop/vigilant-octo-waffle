/**
 * Shared error types for the studio wiring (Batch C).
 *
 * These are the thrown shapes the web routes classify: `route-error.ts`
 * maps them to their canonical status + envelope code, so a wired studio
 * module only has to throw — it never builds HTTP responses itself.
 */

/**
 * Thrown when a wired studio operation needs the Kubernetes cluster and
 * it is unreachable (no kubeconfig, API server down). The web route maps
 * it to 503 with code `cluster_unavailable` (Phase 0 F1 contract). The
 * message is a fixed benign string: it is surfaced to the caller, so it
 * must never carry cluster internals.
 */
export class ClusterUnavailableError extends Error {
  constructor(message = 'Kubernetes cluster is unavailable') {
    super(message);
    this.name = 'ClusterUnavailableError';
  }
}
