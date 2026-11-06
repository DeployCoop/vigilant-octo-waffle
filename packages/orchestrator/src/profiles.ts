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
    if (!bundle || typeof bundle.enablers !== 'object' || bundle.enablers === null || Array.isArray(bundle.enablers)) {
      throw new Error('Invalid profile bundle format');
    }

    const overridesDir = path.resolve(this.projectRoot, '.argo_overrides');
    const validatedOverrides: Array<{ destPath: string; content: string }> = [];

    if (bundle.argoOverrides !== undefined) {
      if (typeof bundle.argoOverrides !== 'object' || bundle.argoOverrides === null || Array.isArray(bundle.argoOverrides)) {
        throw new Error('Invalid argoOverrides format in profile bundle');
      }
      for (const [relPath, content] of Object.entries(bundle.argoOverrides)) {
        if (typeof content !== 'string') {
          throw new Error(`Invalid override content for '${relPath}'`);
        }
        if (
          !relPath ||
          relPath.includes('\0') ||
          path.isAbsolute(relPath) ||
          (!relPath.endsWith('.yaml') && !relPath.endsWith('.yml'))
        ) {
          throw new Error(`Invalid override path '${relPath}': must be a relative .yaml/.yml path`);
        }
        const destPath = path.resolve(overridesDir, relPath);
        if (!destPath.startsWith(overridesDir + path.sep)) {
          throw new Error(`Path traversal rejected in override path '${relPath}'`);
        }
        validatedOverrides.push({ destPath, content });
      }
    }

    // 1. Update enablers
    saveEnablerFile(this.projectRoot, bundle.enablers);

    // 2. Restore validated argo overrides
    for (const { destPath, content } of validatedOverrides) {
      const parentDir = path.dirname(destPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(destPath, content, 'utf-8');
    }
  }
}
