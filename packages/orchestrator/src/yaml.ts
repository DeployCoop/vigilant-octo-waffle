import * as YAML from 'yaml';

/**
 * Deep merges override into base.
 * Follows yq-style merge behavior where nested maps are recursively merged,
 * and primitive values or matching keys are overwritten.
 */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined || override === null) {
    return base;
  }
  if (base === undefined || base === null) {
    return override;
  }

  // If both are arrays, concatenate or replace based on content
  if (Array.isArray(base) && Array.isArray(override)) {
    return [...base, ...override];
  }

  // If both are objects (and not arrays), merge recursively. The typeof /
  // Array.isArray guards above have done the runtime narrowing; the
  // Record view is how the merge walks the pair.
  if (typeof base === 'object' && typeof override === 'object' && !Array.isArray(base) && !Array.isArray(override)) {
    const overrideObj = override as Record<string, unknown>;
    const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const key of Object.keys(overrideObj)) {
      if (key in result) {
        result[key] = deepMerge(result[key], overrideObj[key]);
      } else {
        result[key] = overrideObj[key];
      }
    }
    return result;
  }

  // Primitives: override wins
  return override;
}

/**
 * Merges an override YAML string into an original YAML string.
 */
export function mergeYamlStrings(originalYaml: string, overrideYaml: string): string {
  const orig = YAML.parse(originalYaml) || {};
  const over = YAML.parse(overrideYaml) || {};
  const merged = deepMerge(orig, over);
  return YAML.stringify(merged);
}

export const deepMergeYaml = mergeYamlStrings;

/**
 * Parses a YAML string into a JS object.
 */
export function parseYaml<T = unknown>(yamlString: string): T {
  return YAML.parse(yamlString) as T;
}

/**
 * Serializes a JS object into a YAML string.
 */
export function stringifyYaml(data: unknown): string {
  return YAML.stringify(data);
}
