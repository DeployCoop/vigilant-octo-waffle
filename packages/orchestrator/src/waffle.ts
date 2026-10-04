/**
 * Waffle pipelines — split by sub-domain under ./waffle/ (WS6).
 * This barrel re-exports the full historical surface of the former
 * single-file module, so no import sites change.
 */
export * from './waffle/schema.js';
export * from './waffle/sources.js';
export * from './waffle/runner.js';
export * from './waffle/history.js';
export * from './waffle/registry.js';
export * from './waffle/instances.js';
export { getWaffleExecutionEnv } from './waffle/shared.js';
