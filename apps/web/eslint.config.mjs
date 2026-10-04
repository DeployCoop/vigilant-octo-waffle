// apps/web ESLint flat config — Next.js rules via FlatCompat (the canonical
// Next 15 pattern), plus the workspace-wide no-explicit-any warning.
// Improvements plan WS2 (§5.1), §16 Q2 decided: ESLint.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
