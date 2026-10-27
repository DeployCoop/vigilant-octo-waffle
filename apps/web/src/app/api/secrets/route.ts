import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import {
  generateClusterSecrets,
  saveClusterSecrets,
  loadProjectConfig,
  listClusterSecrets,
} from '@vow/orchestrator';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { authorizeRequest } from '@/lib/authz';
import { routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'secrets:read');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);
    const domain = config.cluster.domain;

    const secretsDir = path.join(root, '.secrets');
    const exists = fs.existsSync(secretsDir);
    const files = exists ? fs.readdirSync(secretsDir) : [];

    const secrets = listClusterSecrets(root, domain);

    return NextResponse.json({
      exists,
      files,
      secrets,
    });
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/secrets',
      fallbackMessage: 'Failed to list cluster secrets',
    });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'secrets:read');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);
    const secretsDir = path.join(root, '.secrets');

    const secrets = generateClusterSecrets({
      secretName: config.raw['THIS_SECRETS'] || 'cluster-secrets',
      namespace: config.cluster.namespace,
      domainName: config.cluster.domain,
      enablePlainSecrets: config.raw['THIS_ENABLE_PLAIN_SECRETS_FILE'] === 'true',
    });

    const plainName = `${config.raw['THIS_SECRETS'] || 'cluster-secrets'}-plain.yaml`;
    const paths = saveClusterSecrets(secretsDir, secrets, plainName);

    return NextResponse.json({
      success: true,
      secretKeys: Object.keys(secrets.items),
      paths,
    });
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/secrets',
      fallbackMessage: 'Failed to generate cluster secrets',
    });
  }
}
