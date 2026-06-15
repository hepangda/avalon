import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Allow intentionally-unused args/vars prefixed with underscore.
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The pure engine must never use Math.random — randomness is injected via
    // the seeded RNG so games are deterministic & replayable.
    files: ['src/lib/engine/**/*.ts'],
    ignores: ['src/lib/engine/**/*.test.ts', 'src/lib/engine/testkit.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Engine must use the injected seeded RNG.' },
      ],
    },
  },
];

export default eslintConfig;
