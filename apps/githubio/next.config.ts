import type { NextConfig } from 'next';

// This app is a fully static site (`output: 'export'`) published to GitHub
// Pages by .github/workflows/githubio.yml. A project Pages site is served
// from /<repo-name>, so the deploy workflow sets GITHUBIO_BASE_PATH to
// '/vigilant-octo-waffle' for the deploy build; local dev and PR builds
// leave it unset and serve from the root.
const basePath = process.env.GITHUBIO_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
