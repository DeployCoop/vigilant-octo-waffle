// The static export is served from /<repo-name> on GitHub Pages; the deploy
// workflow passes that prefix as GITHUBIO_BASE_PATH (see next.config.ts).
// next/image with `unoptimized` serves public/ files verbatim, so asset
// URLs are prefixed here explicitly. Empty in local and PR builds.
export const BASE_PATH = process.env.GITHUBIO_BASE_PATH ?? '';

export function asset(path: string): string {
  return `${BASE_PATH}${path}`;
}
