import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProjectConfig, saveEnablerFile } from './config.js';

export interface ProfileBundle {
  name: string;
  version: string;
  timestamp: string;
  cluster: {
    name?: string;
    platform?: string;
    domain?: string;
    tld?: string;
  };
  enablers: Record<string, boolean>;
  argoOverrides: Record<string, string>;
}

export class ProfileManager {
  constructor(private projectRoot: string) {}

  public exportProfile(profileName: string): ProfileBundle {
    const config = loadProjectConfig(this.projectRoot);
    const overridesDir = path.join(this.projectRoot, '.argo_overrides');
    const argoOverrides: Record<string, string> = {};

    if (fs.existsSync(overridesDir)) {
      const scanDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
            const relKey = path.relative(overridesDir, fullPath);
            argoOverrides[relKey] = fs.readFileSync(fullPath, 'utf-8');
          }
        }
      };
      scanDir(overridesDir);
    }

    return {
      name: profileName || 'default-profile',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      cluster: {
        name: config.raw['THIS_NAME'] || 'vigilant-octo-waffle',
        platform: config.cluster.k8sPlatform,
        domain: config.cluster.domain,
        tld: config.raw['THIS_TLD'] || 'internal',
      },
      enablers: config.enablers,
      argoOverrides,
    };
  }

  public importProfile(bundle: ProfileBundle): void {
    if (!bundle || !bundle.enablers) {
      throw new Error('Invalid profile bundle format');
    }

    // 1. Update enablers
    saveEnablerFile(this.projectRoot, bundle.enablers);

    // 2. Restore argo overrides if present
    if (bundle.argoOverrides && typeof bundle.argoOverrides === 'object') {
      const overridesDir = path.join(this.projectRoot, '.argo_overrides');
      for (const [relPath, content] of Object.entries(bundle.argoOverrides)) {
        const destPath = path.join(overridesDir, relPath);
        const parentDir = path.dirname(destPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(destPath, content, 'utf-8');
      }
    }
  }
}
