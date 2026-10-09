import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@vow/orchestrator'],
  serverExternalPackages: ['@kubernetes/client-node', 'yaml'],
  allowedDevOrigins: ['10.80.0.210', '10.80.0.210:3000', 'localhost', 'localhost:3000'],
};

export default nextConfig;
