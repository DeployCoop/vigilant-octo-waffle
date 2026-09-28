import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Finds the project root directory (containing pnpm-workspace.yaml, src/, argo/)
 */
export function getProjectRoot(): string {
  // Start from current working directory or process.cwd()
  let curr = process.cwd();

  // If running inside apps/web, root is one level up
  if (fs.existsSync(path.join(curr, 'pnpm-workspace.yaml'))) {
    return curr;
  }

  const parent = path.resolve(curr, '..');
  if (fs.existsSync(path.join(parent, 'pnpm-workspace.yaml'))) {
    return parent;
  }

  const grandParent = path.resolve(parent, '..');
  if (fs.existsSync(path.join(grandParent, 'pnpm-workspace.yaml'))) {
    return grandParent;
  }

  return curr;
}
