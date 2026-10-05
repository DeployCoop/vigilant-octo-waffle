// apps/web ESLint flat config — Next.js rules via eslint-config-next 16's
// native flat configs (the FlatCompat wrapper used for Next 15 cannot load
// them: it dies with "Converting circular structure to JSON"), plus the
// workspace-wide no-explicit-any warning.
// Improvements plan WS2 (§5.1), §16 Q2 decided: ESLint.
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...nextVitals,
  ...nextTs,
  {
    // Pin the React version: eslint-plugin-react 7.37.5's 'detect' path
    // calls context.getFilename(), which ESLint 10 removed — version
    // detection crashes the whole lint run. An explicit version skips it.
    settings: { react: { version: '19.3.0' } },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // New in eslint-plugin-react-hooks v6 (via eslint-config-next 16).
      // set-state-in-effect flags the dashboard's standard fetch-in-effect
      // pattern (31 sites) and static-components flags components defined
      // during render (22 sites); both are React Compiler readiness rules
      // this codebase predates. Warn-level burn-down, same treatment as
      // no-explicit-any, until a deliberate data-fetching/compiler pass.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
];
