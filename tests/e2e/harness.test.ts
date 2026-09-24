import { expect, test } from 'vitest';
import {
  composeSpec,
  ownedProject,
  requireOwnedProject,
} from './support/stack.js';

test.each([
  'relaydesk',
  '',
  'main',
  'relaydesk-e2e',
  '../relaydesk-e2e-123-abcd1234',
  'relaydesk-e2e-123-abcd1234;echo nope',
])('cleanup refuses an unowned project: %s', (name) => {
  expect(ownedProject(name)).toBe(false);
  expect(() => requireOwnedProject(name)).toThrow();
});
test('test stack owns its volumes, uses a random loopback port, and exposes no database or n8n ports', () => {
  const spec = composeSpec('relaydesk-e2e-123-abcd1234');
  expect(spec.services.api.ports).toEqual(['127.0.0.1::3001']);
  expect(spec.services.postgres).not.toHaveProperty('ports');
  expect(spec.services.n8n).not.toHaveProperty('ports');
  expect(Object.keys(spec.volumes).sort()).toEqual([
    'api_modules',
    'n8n_data',
    'postgres_data',
  ]);
  expect(JSON.stringify(spec.volumes)).not.toContain('external');
});
test('API container cannot inherit model settings, developer homes, credentials or host node_modules', () => {
  const api = composeSpec('relaydesk-e2e-123-abcd1234').services.api;
  expect(api.environment.LAB_AI_MODE).toBe('fixture');
  expect(Object.keys(api.environment).sort()).toEqual([
    'CI',
    'DATABASE_URL',
    'LAB_AI_MODE',
    'RELAYDESK_E2E',
    'RELAYDESK_E2E_INSTANCE',
  ]);
  const mounts = api.volumes.filter((v) => typeof v !== 'string');
  expect(mounts.every((v) => v.read_only)).toBe(true);
  for (const mount of mounts) {
    expect(mount.source).not.toMatch(/(?:^|\/)\.(?:env|local|codex)(?:\/|$)/);
    expect(mount.target).not.toBe('/workspace');
    expect(mount.target).not.toContain('/node_modules');
  }
});
