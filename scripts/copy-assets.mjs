import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist/apps/api/migrations', { recursive: true });
await mkdir('dist/fixtures/business', { recursive: true });
await cp('apps/api/migrations', 'dist/apps/api/migrations', { recursive: true });
await cp('fixtures/business', 'dist/fixtures/business', { recursive: true });
await cp('apps/api/public', 'dist/apps/api/public', { recursive: true, filter: (source) => !source.endsWith('.test.js') });
