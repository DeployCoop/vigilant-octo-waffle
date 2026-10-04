import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseDefaultEnv, parseEnvFile, saveEnvFile, VowConfig, loadProjectConfig } from './config.js';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ConfigIssue {
  key: string;
  severity: IssueSeverity;
  category: 'cascade' | 'corruption' | 'format' | 'filesystem' | 'security';
  message: string;
  currentValue?: string;
  suggestedValue?: string;
  autoFixable: boolean;
}

export interface ConfigDoctorReport {
  valid: boolean;
  timestamp: string;
  projectRoot: string;
  summary: {
    totalIssues: number;
    errors: number;
    warnings: number;
    infos: number;
    fixable: number;
  };
  issues: ConfigIssue[];
  fixesApplied?: Record<string, { from: string; to: string }>;
  config: VowConfig;
}

/**
 * Known derived variable templates based on parent keys
 */
export const DEPENDENCY_DEFINITIONS: Record<string, { parent: string; compute: (env: Record<string, string>) => string }> = {
  THIS_DOMAIN: {
    parent: 'THIS_NAME',
    compute: (env) => `${env['THIS_NAME'] || 'example'}.${env['THIS_TLD'] || 'com'}`,
  },
  THIS_NAMESPACE: {
    parent: 'THIS_NAME',
    compute: (env) => env['THIS_NAME'] || 'example',
  },
  THIS_SECRETS: {
    parent: 'THIS_NAME',
    compute: (env) => `${env['THIS_NAME'] || 'example'}-secrets`,
  },
  KEY_FILE: {
    parent: 'THIS_SECRETS',
    compute: (env) => `./.secrets/${env['THIS_SECRETS'] || (env['THIS_NAME'] ? `${env['THIS_NAME']}-secrets` : 'example-secrets')}-plain.yaml`,
  },
  SECRET_FILE: {
    parent: 'THIS_SECRETS',
    compute: (env) => `./.secrets/${env['THIS_SECRETS'] || (env['THIS_NAME'] ? `${env['THIS_NAME']}-secrets` : 'example-secrets')}.yaml`,
  },
  THIS_OPENSEARCH_NAMESPACE: {
    parent: 'THIS_NAMESPACE',
    compute: (env) => env['THIS_NAMESPACE'] || env['THIS_NAME'] || 'example',
  },
  THIS_HOSTPATH_STORAGECLASS: {
    parent: 'THIS_NAMESPACE',
    compute: (env) => `${env['THIS_NAMESPACE'] || env['THIS_NAME'] || 'example'}-hostpath`,
  },
  THIS_LVM_VG: {
    parent: 'THIS_NAME',
    compute: (env) => `${env['THIS_NAME'] || 'example'}VG`,
  },
  THIS_STORAGE_PATH: {
    parent: 'THIS_NAME',
    compute: (env) => `/mnt/${env['THIS_NAME'] || 'example'}`,
  },
  THIS_LDAP_ORGANISATION: {
    parent: 'THIS_NAME',
    compute: (env) => `${env['THIS_NAME'] || 'example'} ${env['THIS_TLD'] || 'com'}`,
  },
  THIS_OPENPROJECT_ADMIN_CRED_SECRET: {
    parent: 'THIS_NAME',
    compute: (env) => `openproject-${env['THIS_NAME'] || 'example'}-admin-cred`,
  },
  THIS_OPENPROJECT_ADMIN_EMAIL: {
    parent: 'THIS_NAME',
    compute: (env) => `${env['THIS_ADMIN_USER'] || 'myadmin'}@${env['THIS_NAME'] || 'example'}.${env['THIS_TLD'] || 'com'}`,
  },
  THIS_MARIADB_ROOT_SECRET: {
    parent: 'THIS_NAME',
    compute: (env) => `${env['THIS_NAME'] || 'example'}-secret-mariadb`,
  },
  THIS_MARIADB_DB_SECRET: {
    parent: 'THIS_NAME',
    compute: (env) => `${env['THIS_NAME'] || 'example'}-db-secret-mariadb`,
  },
  THIS_OPENPROJECT_POSTGRES_USER: {
    parent: 'THIS_NAME',
    compute: (env) => `${env['THIS_NAME'] || 'example'}op`,
  },
  THIS_OPENPROJECT_POSTGRES_DB: {
    parent: 'THIS_NAME',
    compute: (env) => `${env['THIS_NAME'] || 'example'}opdb`,
  },
  THIS_OPENSEARCH_SVC_HOST: {
    parent: 'THIS_NAMESPACE',
    compute: (env) => `https://opensearch-cluster-master.${env['THIS_NAMESPACE'] || env['THIS_NAME'] || 'example'}.svc.cluster.local:9200`,
  },
  THIS_OPENSEARCH_ADMIN_CRED_USER: {
    parent: 'THIS_NAME',
    compute: (env) => `${env['THIS_NAME'] || 'example'}-opensearch-admin`,
  },
  THIS_OPENSEARCH_ADMIN_CRED_SECRET: {
    parent: 'THIS_NAME',
    compute: (env) => `opensearch-${env['THIS_NAME'] || 'example'}-admin-cred`,
  },
  THIS_OPENSEARCH_DASH_ADMIN_CRED_SECRET: {
    parent: 'THIS_NAME',
    compute: (env) => `opensearch-${env['THIS_NAME'] || 'example'}-dash-admin-cred`,
  },
  THIS_SUPA_STUDIO_DEFAULT_ORGANIZATION: {
    parent: 'THIS_NAME',
    compute: (env) => `${env['THIS_NAME'] || 'example'}_${env['THIS_TLD'] || 'com'}`,
  },
  THIS_SUPA_STUDIO_DEFAULT_PROJECT: {
    parent: 'THIS_NAME',
    compute: (env) => `${env['THIS_NAME'] || 'example'}_${env['THIS_TLD'] || 'com'}`,
  },
  THIS_CVAT_STORAGECLASS: {
    parent: 'THIS_NAME',
    compute: (env) => `${env['THIS_NAME'] || 'example'}-hostpath`,
  },
  THIS_AIRFLOW_POSTGRES_DB: {
    parent: 'THIS_NAME',
    compute: (env) => `${env['THIS_NAME'] || 'example'}airflowdb`,
  },
  THIS_VELERO_BUCKET: {
    parent: 'THIS_NAME',
    compute: (env) => env['THIS_NAME'] || 'example',
  },
  THIS_REG_DIR: {
    parent: 'THIS_NAME',
    compute: (env) => `/tmp/${env['THIS_NAME'] || 'example'}/registry`,
  },
};

/**
 * Validates the environment configuration of a project
 */
export function checkConfig(projectRoot: string): ConfigDoctorReport {
  const defaultEnvPath = path.join(projectRoot, 'src', 'default.env');
  const userEnvPath = path.join(projectRoot, '.env');
  const issues: ConfigIssue[] = [];

  const defaultContent = fs.existsSync(defaultEnvPath) ? fs.readFileSync(defaultEnvPath, 'utf-8') : '';
  const defaultEnv = parseDefaultEnv(defaultContent);

  const userContent = fs.existsSync(userEnvPath) ? fs.readFileSync(userEnvPath, 'utf-8') : '';
  const userEnv = parseEnvFile(userContent);

  const config = loadProjectConfig(projectRoot);
  const raw = { ...defaultEnv, ...userEnv };

  const currentName = raw['THIS_NAME'] || 'example';

  // 1. Check for value corruptions (e.g. unescaped quotes or trailing comments stored in values)
  for (const [key, val] of Object.entries(userEnv)) {
    if (typeof val === 'string') {
      if (val.includes('\\"') || val.includes('\\\\"') || val.includes('"')) {
        const cleaned = val.replace(/\\+"/g, '').replace(/"+/g, '').trim();
        issues.push({
          key,
          severity: 'error',
          category: 'corruption',
          message: `Variable contains corrupted escape characters or quotes.`,
          currentValue: val,
          suggestedValue: cleaned,
          autoFixable: true,
        });
      }
      if (val.includes('#') && (val.includes('Ingress controller') || val.includes('volume group') || val.includes('default:'))) {
        const cleaned = val.split('#')[0].replace(/\\+"/g, '').replace(/"+/g, '').trim();
        issues.push({
          key,
          severity: 'error',
          category: 'corruption',
          message: `Variable contains trailing inline comment text inside its value.`,
          currentValue: val,
          suggestedValue: cleaned,
          autoFixable: true,
        });
      }
    }
  }

  // 2. Check for stale cascade variables
  for (const [key, def] of Object.entries(DEPENDENCY_DEFINITIONS)) {
    const currentVal = raw[key];
    const expectedVal = def.compute(raw);

    if (currentVal && currentVal !== expectedVal) {
      // Check if currentVal contains the default placeholder "example" while THIS_NAME is something else
      const isDefaultPlaceholder = currentVal.includes('example') && currentName !== 'example';
      
      if (isDefaultPlaceholder || key === 'THIS_NAMESPACE' || key === 'THIS_SECRETS' || key === 'SECRET_FILE' || key === 'KEY_FILE') {
        issues.push({
          key,
          severity: isDefaultPlaceholder ? 'error' : 'warning',
          category: 'cascade',
          message: `Derived value is out of sync with parent '${def.parent}' (${raw[def.parent] || 'unset'}).`,
          currentValue: currentVal,
          suggestedValue: expectedVal,
          autoFixable: true,
        });
      }
    }
  }

  // 3. Check for specific format/type constraints
  const ingress = raw['THIS_CLUSTER_INGRESS']?.toLowerCase();
  if (ingress && !['nginx', 'traefik', 'haproxy'].includes(ingress)) {
    issues.push({
      key: 'THIS_CLUSTER_INGRESS',
      severity: 'error',
      category: 'format',
      message: `Invalid ingress controller '${raw['THIS_CLUSTER_INGRESS']}'. Must be 'nginx', 'traefik', or 'haproxy'.`,
      currentValue: raw['THIS_CLUSTER_INGRESS'],
      suggestedValue: 'nginx',
      autoFixable: true,
    });
  }

  const k8sType = raw['THIS_K8S_TYPE']?.toLowerCase();
  if (k8sType && !['kind', 'k3d', 'k3s'].includes(k8sType)) {
    issues.push({
      key: 'THIS_K8S_TYPE',
      severity: 'error',
      category: 'format',
      message: `Invalid K8s platform '${raw['THIS_K8S_TYPE']}'. Must be 'kind', 'k3d', or 'k3s'.`,
      currentValue: raw['THIS_K8S_TYPE'],
      suggestedValue: 'k3s',
      autoFixable: true,
    });
  }

  const cdRunner = raw['THIS_CD_RUNNER']?.toLowerCase();
  if (cdRunner && !['argocd', 'flux', 'fluxcd', 'both'].includes(cdRunner)) {
    issues.push({
      key: 'THIS_CD_RUNNER',
      severity: 'error',
      category: 'format',
      message: `Invalid CD runner '${raw['THIS_CD_RUNNER']}'. Must be 'argocd', 'flux', or 'both'.`,
      currentValue: raw['THIS_CD_RUNNER'],
      suggestedValue: 'argocd',
      autoFixable: true,
    });
  }

  // 4. Check secrets directory and secret file consistency
  const secretsDir = path.join(projectRoot, '.secrets');
  if (!fs.existsSync(secretsDir)) {
    issues.push({
      key: 'SECRETS_DIR',
      severity: 'warning',
      category: 'filesystem',
      message: `Secrets directory '.secrets/' does not exist yet. Run src/secrets.sh or ./up to generate it.`,
      autoFixable: false,
    });
  } else {
    const expectedSecretFile = raw['SECRET_FILE'] || `./.secrets/${raw['THIS_SECRETS'] || 'example-secrets'}.yaml`;
    const resolvedSecretPath = path.isAbsolute(expectedSecretFile) ? expectedSecretFile : path.join(projectRoot, expectedSecretFile);
    if (!fs.existsSync(resolvedSecretPath)) {
      issues.push({
        key: 'SECRET_FILE',
        severity: 'warning',
        category: 'filesystem',
        message: `Configured secret file '${expectedSecretFile}' does not exist on disk.`,
        currentValue: expectedSecretFile,
        suggestedValue: `./.secrets/${currentName}-secrets.yaml`,
        autoFixable: false,
      });
    }
  }

  // Summary counts
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const infos = issues.filter((i) => i.severity === 'info').length;
  const fixable = issues.filter((i) => i.autoFixable).length;

  return {
    valid: errors === 0,
    timestamp: new Date().toISOString(),
    projectRoot,
    summary: {
      totalIssues: issues.length,
      errors,
      warnings,
      infos,
      fixable,
    },
    issues,
    config,
  };
}

/**
 * Automatically cascades updates from parent variables to dependent variables
 */
export function cascadeConfigUpdates(
  currentRaw: Record<string, string>,
  updates: Record<string, string>
): Record<string, string> {
  const merged = { ...currentRaw, ...updates };

  // If THIS_NAME was updated and dependent values weren't explicitly provided, recalculate them
  const newName = updates['THIS_NAME'];
  if (newName) {
    for (const [key, def] of Object.entries(DEPENDENCY_DEFINITIONS)) {
      if (!updates[key]) {
        // If current value was matching old default or contains 'example', cascade to new name
        const currentVal = currentRaw[key];
        const oldExpected = def.compute(currentRaw);
        if (!currentVal || currentVal === oldExpected || currentVal.includes('example')) {
          merged[key] = def.compute(merged);
        }
      }
    }
  }

  // If THIS_NAMESPACE was updated, cascade namespace-dependent variables
  const newNamespace = updates['THIS_NAMESPACE'];
  if (newNamespace) {
    if (!updates['THIS_OPENSEARCH_NAMESPACE']) merged['THIS_OPENSEARCH_NAMESPACE'] = newNamespace;
    if (!updates['THIS_HOSTPATH_STORAGECLASS']) merged['THIS_HOSTPATH_STORAGECLASS'] = `${newNamespace}-hostpath`;
    if (!updates['THIS_OPENSEARCH_SVC_HOST']) {
      merged['THIS_OPENSEARCH_SVC_HOST'] = `https://opensearch-cluster-master.${newNamespace}.svc.cluster.local:9200`;
    }
  }

  // Clean any quote corruptions
  for (const [k, v] of Object.entries(merged)) {
    if (typeof v === 'string') {
      let cleanVal = v.replace(/\\+"/g, '').replace(/"+/g, '');
      if (cleanVal.includes('#')) {
        cleanVal = cleanVal.split('#')[0];
      }
      merged[k] = cleanVal.trim();
    }
  }

  return merged;
}

/**
 * Reconciles and fixes detected issues in the configuration
 */
export function reconcileConfig(
  projectRoot: string,
  options: { applyFixes?: boolean } = { applyFixes: true }
): ConfigDoctorReport {
  const preReport = checkConfig(projectRoot);
  if (!options.applyFixes || preReport.issues.length === 0) {
    return preReport;
  }

  const userEnvPath = path.join(projectRoot, '.env');
  const userContent = fs.existsSync(userEnvPath) ? fs.readFileSync(userEnvPath, 'utf-8') : '';
  let envMap = parseEnvFile(userContent);

  const fixesApplied: Record<string, { from: string; to: string }> = {};

  // Run up to 3 iterations for multi-hop cascade convergence
  for (let iter = 0; iter < 3; iter++) {
    const report = checkConfig(projectRoot);
    const fixableIssues = report.issues.filter((i) => i.autoFixable && i.suggestedValue !== undefined);
    if (fixableIssues.length === 0) break;

    for (const issue of fixableIssues) {
      const from = envMap[issue.key] || '';
      envMap[issue.key] = issue.suggestedValue!;
      fixesApplied[issue.key] = { from, to: issue.suggestedValue! };
    }

    envMap = cascadeConfigUpdates(envMap, {});
    saveEnvFile(projectRoot, envMap);
  }

  const postReport = checkConfig(projectRoot);
  postReport.fixesApplied = fixesApplied;
  return postReport;
}
