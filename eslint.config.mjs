// Root ESLint flat config — covers packages/orchestrator and apps/ink.
// apps/web has its own config (eslint-config-next) in apps/web/eslint.config.mjs
// and is ignored here so the two never double-lint.
//
// Improvements plan WS2 (§5.1), §16 Q2 decided: ESLint.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      'apps/web/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/**/*.ts', 'apps/ink/**/*.ts', 'apps/ink/**/*.tsx'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Warn for now: the `catch (err: any)` population is burned down by
      // the WS4 error-envelope migration, which will let this become an
      // error. See improvements_implementation.md §5.1/§7.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Empty `catch {}` is this codebase's deliberate best-effort idiom
      // (probe commands and fallback chains swallow intentionally, usually
      // alongside `|| true`). Allow empty catch blocks; every other empty
      // block statement remains an error.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Commander action handlers take positional args they may not need;
      // an underscore prefix marks an intentionally unused parameter.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
