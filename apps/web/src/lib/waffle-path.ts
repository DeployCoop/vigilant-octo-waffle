import * as path from 'node:path';

/**
 * Resolves a user-supplied pipeline path against the project root and
 * rejects anything outside it (bug hunt B11).
 *
 * Previously `customPath`/`validatePath` reached `loadWafflePipeline`
 * unconfined, so a tasks:run holder could execute a pipeline anywhere
 * on disk and a tasks:read viewer could read any valid waffle.yaml on
 * disk. Relative paths resolve against the root; absolute paths must
 * already be inside it. This is a lexical check (matching the route
 * layer's contract); symlink escapes are Batch A's confinement item.
 */
export function resolveWafflePathInRoot(root: string, userPath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.isAbsolute(userPath)
    ? path.resolve(userPath)
    : path.resolve(resolvedRoot, userPath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Pipeline path "${userPath}" must be inside the project root`);
  }
  return resolved;
}
