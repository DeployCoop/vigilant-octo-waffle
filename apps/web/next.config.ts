import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@vow/orchestrator'],
  serverExternalPackages: ['@kubernetes/client-node', 'yaml'],
};

export default nextConfig;
