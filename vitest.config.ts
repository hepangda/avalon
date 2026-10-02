import { configDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const slowTests = '**/*.slow.test.ts';

export default defineConfig({
  test: {
    environment: 'node',
    // `npm test` runs only `unit`; `npm run test:slow` runs the long bot self-play suite.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: [...configDefaults.exclude, slowTests],
        },
      },
      { extends: true, test: { name: 'slow', include: [`server/${slowTests}`] } },
    ],
  },
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
