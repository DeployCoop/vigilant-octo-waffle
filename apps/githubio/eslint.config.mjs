// apps/githubio ESLint flat config — same shape as apps/web: Next.js rules
// via eslint-config-next 16's native flat configs, plus the workspace-wide
// no-explicit-any warning.
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default [
  { ignores: ['.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts'] },
  ...nextVitals,
  ...nextTs,
  {
    // Pin the React version: eslint-plugin-react 7.37.5's 'detect' path
    // calls context.getFilename(), which ESLint 10 removed — version
    // detection crashes the whole lint run. An explicit version skips it.
    // Same pin as apps/web; this app moved to ESLint 10 with the
    // consolidated Dependabot batch (ex-#79), which is what exposed it.
    settings: { react: { version: '19.3.0' } },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
];
