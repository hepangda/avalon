import tseslint from 'typescript-eslint';

const eslintConfig = tseslint.config(
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // Allow intentionally-unused args/vars prefixed with underscore.
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
  {
    ignores: ['dist/**', 'node_modules/**', '.wrangler/**', '.next/**'],
  },
);

export default eslintConfig;
