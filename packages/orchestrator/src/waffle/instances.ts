/**
 * Waffle cwd singletons, instantiated from the registry getters (kept apart from registry.ts: the runner imports waffleRunHistory, so eager instantiation in registry would close an ESM cycle) (WS6 split of waffle.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import { getWaffleSourceManager, getWaffleRunner, getWaffleRunHistory } from './registry.js';

export const waffleSourceManager = getWaffleSourceManager(process.cwd());

export const waffleRunner = getWaffleRunner(process.cwd());

export const waffleRunHistory = getWaffleRunHistory(process.cwd());
