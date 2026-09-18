import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexProvider, FixtureProvider } from './providers.js';

const success = fileURLToPath(new URL('./fake-codex-success.sh', import.meta.url));
const tool = fileURLToPath(new URL('./fake-codex-tool.sh', import.meta.url));
const homes: string[] = [];
const context = { ticket: { id: 'TICKET-001', customerRef: 'CUSTOMER-001', message: 'Where can I download invoices?' }, customerResolved: true, payments: [] };

afterEach(async () => { await Promise.all(homes.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function home() { const path = await mkdtemp(join(tmpdir(), 'relaydesk-provider-test-')); homes.push(path); return path; }

describe('AI providers', () => {
  it('keeps deterministic fixture behavior as the default contract', async () => {
    const result = await new FixtureProvider().classify(context);
    expect(result).toMatchObject({ provider: 'fixture', model: 'relaydesk-fixture-v1', usage: null, decision: { intent: 'invoice_download', recommendedAction: 'reply' } });
  });

  it('accepts schema-valid Codex JSONL and retains usage metadata', async () => {
    await chmod(success, 0o755);
    const result = await new CodexProvider(success, await home()).classify(context);
    expect(result).toMatchObject({ provider: 'codex', model: 'gpt-5.6-terra', usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5 }, decision: { intent: 'invoice_download' } });
  });

  it('rejects any observed tool activity', async () => {
    await chmod(tool, 0o755);
    await expect(new CodexProvider(tool, await home()).classify(context)).rejects.toThrow('security_violation');
  });
});
