import { defineConfig } from 'vitest/config';

export default defineConfig({ test: {
  include: ['apps/**/*.integration.test.ts'], fileParallelism: false, testTimeout: 10_000,
} });
