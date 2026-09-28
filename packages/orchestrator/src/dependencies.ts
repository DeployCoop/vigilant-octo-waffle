import { APP_CATALOG, type AppDefinition } from './registry.js';

export interface DependencyCheckResult {
  valid: boolean;
  missingDependencies: {
    appId: string;
    appName: string;
    missingPrerequisites: { id: string; name: string }[];
  }[];
}

/**
 * Validates that all enabled apps have their prerequisites satisfied
 */
export function validateDependencies(enabledAppIds: string[]): DependencyCheckResult {
  const enabledSet = new Set(enabledAppIds);
  const catalogMap = new Map<string, AppDefinition>(APP_CATALOG.map((a) => [a.id, a]));
  const missingDependencies: DependencyCheckResult['missingDependencies'] = [];

  for (const appId of enabledAppIds) {
    const app = catalogMap.get(appId);
    if (!app || !app.dependencies || app.dependencies.length === 0) continue;

    const missingPrerequisites: { id: string; name: string }[] = [];
    for (const depId of app.dependencies) {
      if (!enabledSet.has(depId)) {
        const depApp = catalogMap.get(depId);
        missingPrerequisites.push({
          id: depId,
          name: depApp?.name || depId,
        });
      }
    }

    if (missingPrerequisites.length > 0) {
      missingDependencies.push({
        appId: app.id,
        appName: app.name,
        missingPrerequisites,
      });
    }
  }

  return {
    valid: missingDependencies.length === 0,
    missingDependencies,
  };
}

/**
 * Returns topologically sorted list of application IDs based on dependencies.
 * Core foundation services appear first.
 */
export function getTopologicalOrder(appIds: string[]): string[] {
  const catalogMap = new Map<string, AppDefinition>(APP_CATALOG.map((a) => [a.id, a]));
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const id of appIds) {
    adj.set(id, []);
    inDegree.set(id, 0);
  }

  for (const id of appIds) {
    const app = catalogMap.get(id);
    if (!app || !app.dependencies) continue;

    for (const dep of app.dependencies) {
      if (adj.has(dep)) {
        adj.get(dep)!.push(id);
        inDegree.set(id, (inDegree.get(id) || 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    result.push(curr);

    const neighbors = adj.get(curr) || [];
    for (const neighbor of neighbors) {
      inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If cycle exists, append remaining apps
  for (const id of appIds) {
    if (!result.includes(id)) {
      result.push(id);
    }
  }

  return result;
}
