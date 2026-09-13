import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runDecision } from './runner.js';
import type { Invocation } from './runner.js';

const fake = fileURLToPath(new URL('./fake-cli.mjs', import.meta.url));
const directories: string[] = [];
async function invocation(mode: string, extra: string[] = []): Promise<Invocation> {
  const cwd = await mkdtemp(join(tmpdir(), 'relaydesk-runner-test-'));
  directories.push(cwd);
  return { executable: process.execPath, args: [fake, mode, ...extra], cwd,
    env: {}, prompt: 'Synthetic test input', timeoutMs: 2000, killGraceMs: 50 };
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('bounded process handling (FIXTURE MODE)', () => {
  it('accepts a completed, schema-valid decision', async () => {
    const result = await runDecision(await invocation('success'));
    expect(result).toMatchObject({ ok: true, decision: { recommendedAction: 'investigate_refund' } });
  });
  it.each(['malformed', 'schema', 'extra', 'missing', 'incomplete'])('rejects %s output', async (mode) => {
    expect(await runDecision(await invocation(mode))).toEqual({ ok: false, error: 'invalid_output' });
  });
  it('rejects a tool event even if the process otherwise succeeds', async () => {
    expect(await runDecision(await invocation('tool'))).toEqual({ ok: false, error: 'security_violation' });
  });
  it('bounds process output', async () => {
    expect(await runDecision({ ...await invocation('overflow'), maxOutputBytes: 1000 }))
      .toEqual({ ok: false, error: 'output_limit' });
  });
  it('times out and terminates the process', async () => {
    expect(await runDecision({ ...await invocation('hang'), timeoutMs: 100 }))
      .toEqual({ ok: false, error: 'timeout' });
  });
  it('supports caller cancellation', async () => {
    const controller = new AbortController();
    const input = await invocation('hang');
    const result = runDecision({ ...input, signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    expect(await result).toEqual({ ok: false, error: 'cancelled' });
  });
  it('does not spawn for an already-cancelled request', async () => {
    expect(await runDecision({ ...await invocation('success'), signal: AbortSignal.abort() }))
      .toEqual({ ok: false, error: 'cancelled' });
  });
  it.each([
    ['Not logged in', 'authentication_required'], ['quota exhausted', 'quota_exceeded'],
    ['HTTP 429', 'rate_limited'], ['unknown model', 'provider_unavailable'],
  ])('normalizes %s without returning stderr', async (message, error) => {
    expect(await runDecision(await invocation('failure', [message]))).toEqual({ ok: false, error });
  });
  it('handles a missing executable without hanging', async () => {
    expect(await runDecision({ ...await invocation('success'), executable: '/nonexistent-relaydesk-codex' }))
      .toEqual({ ok: false, error: 'provider_unavailable' });
  });
  it('kills a descendant that ignores SIGTERM', async () => {
    const input = await invocation('tree');
    const pidFile = join(input.cwd, 'child.pid');
    input.args.push(pidFile);
    const result = runDecision({ ...input, timeoutMs: 500 });
    await expect.poll(async () => Number(await readFile(pidFile, 'utf8'))).toBeGreaterThan(0);
    const pid = Number(await readFile(pidFile, 'utf8'));
    expect(await result).toEqual({ ok: false, error: 'timeout' });
    await expect.poll(() => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    }).toBe(false);
  });
});
