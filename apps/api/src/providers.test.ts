import { chmod, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexProvider, FixtureProvider } from './providers.js';

const success = fileURLToPath(
  new URL('./fake-codex-success.sh', import.meta.url),
);
const tool = fileURLToPath(new URL('./fake-codex-tool.sh', import.meta.url));
const hang = fileURLToPath(new URL('./fake-codex-hang.sh', import.meta.url));
const homes: string[] = [];
const context = {
  ticket: {
    id: 'TICKET-001',
    customerRef: 'CUSTOMER-001',
    message: 'Where can I download invoices?',
  },
  customerResolved: true,
  payments: [],
};

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    homes.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function home() {
  const path = await mkdtemp(join(tmpdir(), 'relaydesk-provider-test-'));
  homes.push(path);
  return path;
}

async function fake(body: string, version = '0.155.0') {
  const directory = await home(),
    executable = join(directory, 'codex.mjs');
  await writeFile(
    executable,
    `#!${process.execPath}\nif(process.argv[2]==='--version'){console.log('codex-cli ${version}');process.exit(0)}\n${body}`,
    { mode: 0o700 },
  );
  return {
    directory,
    executable,
    provider: new CodexProvider(executable, directory, {
      timeoutMs: 2_000,
      killGraceMs: 50,
    }),
  };
}
const emit = (value: unknown) =>
  `console.log(${JSON.stringify(JSON.stringify(value))});`;

describe('production Codex boundary (no live inference)', () => {
  it('does not inherit developer API keys, hooks, proxies or Node options', async () => {
    const decision = (await new FixtureProvider().classify(context)).decision;
    const f = await fake(
      `const forbidden=['OPENAI_API_KEY','ANTHROPIC_API_KEY','NODE_OPTIONS','HTTP_PROXY','CODEX_TOKEN'];if(forbidden.some(k=>process.env[k]))process.exit(2);` +
        emit({
          type: 'item.completed',
          item: { type: 'agent_message', text: JSON.stringify(decision) },
        }) +
        emit({ type: 'turn.completed' }),
    );
    for (const key of [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'NODE_OPTIONS',
      'HTTP_PROXY',
      'CODEX_TOKEN',
    ])
      vi.stubEnv(key, 'synthetic-must-not-inherit');
    expect((await f.provider.classify(context)).decision).toEqual(decision);
  });
  it.each([
    ['malformed JSONL', 'console.log("not JSON")', 'invalid_output'],
    ['missing completion', emit({ type: 'turn.started' }), 'invalid_output'],
    [
      'malformed final',
      emit({
        type: 'item.completed',
        item: { type: 'agent_message', text: '{broken' },
      }) + emit({ type: 'turn.completed' }),
      'invalid_output',
    ],
    ['unexpected event', emit({ type: 'untrusted_event' }), 'invalid_output'],
    [
      'tool activity',
      emit({ type: 'item.started', item: { type: 'mcp_tool_call' } }) +
        'setInterval(()=>{},1000)',
      'security_violation',
    ],
    [
      'quota',
      emit({ type: 'error', message: 'quota exhausted' }),
      'quota_exceeded',
    ],
    [
      'rate limit',
      'console.error("429 rate limit");process.exit(1)',
      'rate_limited',
    ],
    [
      'authentication',
      'console.error("authentication required");process.exit(1)',
      'authentication_required',
    ],
    [
      'oversized capture',
      'process.stdout.write("x".repeat(1024*1024+1));setInterval(()=>{},1000)',
      'provider_output_limit',
    ],
    [
      'oversized final',
      'console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"x".repeat(65537)}}))',
      'invalid_output',
    ],
  ])('%s fails safely with a sanitized code', async (_, body, code) => {
    await expect((await fake(body)).provider.classify(context)).rejects.toThrow(
      code,
    );
  });
  it('rejects an unvalidated CLI version before inference', async () => {
    const f = await fake('throw new Error("must not invoke")', '0.156.0');
    await expect(f.provider.classify(context)).rejects.toThrow(
      'unsupported_capability',
    );
  });
  it('rejects oversized input before spawning', async () => {
    const f = await fake('throw new Error("must not invoke")');
    await expect(
      f.provider.classify({
        ...context,
        ticket: { ...context.ticket, message: 'x'.repeat(32769) },
      }),
    ).rejects.toThrow('input_limit');
  });
  it('cancels a queued request without waiting for the running request', async () => {
    const f = await fake('setInterval(()=>{},1000)');
    const running = new AbortController(),
      queued = new AbortController();
    const first = f.provider.classify(context, running.signal);
    const firstCheck = expect(first).rejects.toThrow('cancelled');
    const second = f.provider.classify(context, queued.signal);
    queued.abort();
    await expect(second).rejects.toThrow('cancelled');
    running.abort();
    await firstCheck;
  });
  it('timeout kills stubborn descendants before releasing the invocation', async () => {
    const f =
      await fake(`import {spawn} from 'node:child_process';
      spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});require("node:fs").writeFileSync(process.env.CODEX_HOME+"/child.pid",String(process.pid));setInterval(()=>{},1000)'],{stdio:'ignore'});
      process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
    const provider = new CodexProvider(f.executable, f.directory, {
      // Allow cold process startup under parallel unit-test load. The child
      // records readiness only after installing its stubborn SIGTERM handler.
      timeoutMs: 2000,
      killGraceMs: 100,
    });
    await expect(provider.classify(context)).rejects.toThrow('provider_timeout');
    const pid = Number(await readFile(join(f.directory, 'child.pid'), 'utf8'));
    expect(pid).toBeGreaterThan(0);
    await vi.waitFor(() => {
      expect(() => process.kill(pid, 0)).toThrow();
    });
  });
});

describe('AI providers', () => {
  it('keeps deterministic fixture behavior as the default contract', async () => {
    const result = await new FixtureProvider().classify(context);
    expect(result).toMatchObject({
      provider: 'fixture',
      model: 'relaydesk-fixture-v1',
      usage: null,
      decision: { intent: 'invoice_download', recommendedAction: 'reply' },
    });
  });

  it('accepts schema-valid Codex JSONL and retains usage metadata', async () => {
    await chmod(success, 0o755);
    const result = await new CodexProvider(success, await home()).classify(
      context,
    );
    expect(result).toMatchObject({
      provider: 'codex',
      model: 'gpt-5.6-terra',
      usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5 },
      decision: { intent: 'invoice_download' },
    });
  });

  it('rejects any observed tool activity', async () => {
    await chmod(tool, 0o755);
    await expect(
      new CodexProvider(tool, await home()).classify(context),
    ).rejects.toThrow('security_violation');
  });

  it('supports cancellation without waiting for the invocation deadline', async () => {
    await chmod(hang, 0o755);
    const controller = new AbortController();
    const result = new CodexProvider(hang, await home(), {
      timeoutMs: 2_000,
      killGraceMs: 50,
    }).classify(context, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(result).rejects.toThrow('cancelled');
  });
});
