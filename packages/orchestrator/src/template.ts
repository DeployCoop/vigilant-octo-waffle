/**
 * TemplateEngine: Replaces envsubst in pure TypeScript.
 * Supports:
 *  - ${VAR}
 *  - $VAR
 *  - ${VAR:-default}
 *  - ${VAR:=default}
 */
export interface SubstituteOptions {
  /**
   * When true, the substitution mirrors `envsubst` invoked with a
   * variable allowlist — the way the bash runners call it (allowlist
   * derived from src/default.env): only plain `$VAR` / `${VAR}`
   * references to variables present in `env` are substituted;
   * references to absent variables and parameter-expansion forms
   * (`${VAR:-default}`, `${VAR:=default}` — envsubst never expands
   * those) pass through literally. Manifest preparation needs this:
   * manifests carry literal `$` content (PHP `$settings`, shell
   * snippets, generated passwords containing `$XX`) that blanking
   * would corrupt. All file-template rendering opts in — app and
   * initializer manifests, cluster configs (kind/k3d), and the
   * ingress/OpenEBS Helm values templates (the OpenEBS values embed
   * Go-template code, `$releaseName` and friends, for the Alloy
   * config). Default false keeps the historical behavior
   * (expand defaults, blank unknowns) used by config resolution,
   * where shell-like expansion of `.env` values is the point.
   */
  preserveUnknown?: boolean;
}

export function substituteVariables(
  content: string,
  env: Record<string, string | undefined>,
  options?: SubstituteOptions
): string {
  // Regex matches:
  // 1. ${VAR:=default} or ${VAR:-default}
  // 2. ${VAR}
  // 3. $VAR (valid bash var identifier)
  const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?([-=]))?([^}]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

  return content.replace(
    pattern,
    (match, bracedVar, op, defaultValue, unbracedVar) => {
      const varName = bracedVar || unbracedVar;

      // envsubst-with-allowlist semantics: parameter-expansion forms
      // (${VAR:-default}) are not simple references and envsubst never
      // expands them; a variable the caller did not supply is not a
      // substitution target either. Both pass through literally.
      if (options?.preserveUnknown) {
        if (op === '-' || op === '=') {
          return match;
        }
        if (!Object.prototype.hasOwnProperty.call(env, varName)) {
          return match;
        }
      }

      const envVal = env[varName];

      if (envVal !== undefined && envVal !== '') {
        return envVal;
      }

      if (op === '-' || op === '=') {
        // Evaluate default value (default value itself could potentially reference variables)
        return defaultValue ?? '';
      }

      // If env value is not set and no default specified
      if (envVal !== undefined) {
        return envVal;
      }

      // If unresolved, return empty string like standard envsubst behavior,
      // or preserve if needed. In bash envsubst without params, unset vars become empty string.
      return '';
    }
  );
}
