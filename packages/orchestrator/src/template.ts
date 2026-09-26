/**
 * TemplateEngine: Replaces envsubst in pure TypeScript.
 * Supports:
 *  - ${VAR}
 *  - $VAR
 *  - ${VAR:-default}
 *  - ${VAR:=default}
 */
export function substituteVariables(
  content: string,
  env: Record<string, string | undefined>
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
