import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['spikes/**/*.test.ts', 'apps/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
  },
});
