/**
 * Shared lookup guard for the studio in-memory stores (Batch C, C4).
 *
 * Studio modules used to fall back to `store[0]` when a lookup missed,
 * silently running an action against an unrelated record (and, in keda's
 * case, mutating it). `requireFound` returns `null` on a miss so callers
 * can surface a not-found instead of operating on the wrong record.
 * It never falls back to the first entry.
 */
export function requireFound<T>(
  items: readonly T[],
  predicate: (item: T) => boolean
): T | null {
  return items.find(predicate) ?? null;
}
