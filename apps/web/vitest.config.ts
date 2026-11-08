import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Modules that read the validated public env at import time need these.
    env: { NEXT_PUBLIC_APP_ENV: 'test', NEXT_PUBLIC_API_URL: 'http://api.test' },
    include: ['src/**/*.test.{ts,tsx}'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Barrels, the env instance and the Next.js-only root layout are covered by build and e2e.
      exclude: [
        'src/**/index.ts',
        'src/**/*.test.{ts,tsx}',
        'src/shared/config/env.ts',
        'src/app/**',
      ],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
