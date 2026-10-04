/**
 * Waffle per-project singleton registries: source managers, runners, histories (WS6 split of waffle.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import { WaffleSourceManager } from './sources.js';
import { WaffleRunner } from './runner.js';
import { WaffleRunHistory } from './history.js';

// Global singletons & cache by projectRoot
const sourceManagers = new Map<string, WaffleSourceManager>();

const runners = new Map<string, WaffleRunner>();

const histories = new Map<string, WaffleRunHistory>();

export function getWaffleSourceManager(root: string = process.cwd()): WaffleSourceManager {
  if (!sourceManagers.has(root)) {
    sourceManagers.set(root, new WaffleSourceManager(root));
  }
  return sourceManagers.get(root)!;
}

export function getWaffleRunner(root: string = process.cwd()): WaffleRunner {
  if (!runners.has(root)) {
    runners.set(root, new WaffleRunner(root));
  }
  return runners.get(root)!;
}

export function getWaffleRunHistory(root: string = process.cwd()): WaffleRunHistory {
  if (!histories.has(root)) {
    histories.set(root, new WaffleRunHistory(root));
  }
  return histories.get(root)!;
}
