import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { decisionSchema } from './contract.js';
import type { z } from 'zod';

export type Failure = 'invalid_output' | 'security_violation' | 'timeout' |
  'cancelled' | 'authentication_required' | 'quota_exceeded' |
  'rate_limited' | 'provider_unavailable' | 'output_limit';

export type Result =
  | { ok: true; decision: z.infer<typeof decisionSchema> }
  | { ok: false; error: Failure };

export type Invocation = {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  prompt: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  killGraceMs?: number;
  maxOutputBytes?: number;
};

function providerFailure(text: string): Failure {
  if (/usage.limit|quota|credits.exhausted/i.test(text)) return 'quota_exceeded';
  if (/rate.limit|429/i.test(text)) return 'rate_limited';
  if (/not logged in|authentication|unauthorized|401|sign.in|log.in required/i.test(text)) {
    return 'authentication_required';
  }
  return 'provider_unavailable';
}

/** POSIX-only, bounded spike runner. Never returns process logs or private reasoning. */
export function runDecision(invocation: Invocation): Promise<Result> {
  if (!isAbsolute(invocation.executable)) throw new Error('Executable must be an absolute path');
  if (process.platform === 'win32') throw new Error('This spike supports macOS and Linux only');
  if (Buffer.byteLength(invocation.prompt) > 32 * 1024) throw new Error('Input exceeds 32 KiB');
  if (invocation.signal?.aborted) return Promise.resolve({ ok: false, error: 'cancelled' });

  return new Promise((resolve) => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd, env: invocation.env, shell: false,
      detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let failure: Failure | undefined;
    let bytes = 0;
    let buffer = '';
    let stderr = '';
    let finalText: string | undefined;
    let completed = false;
    let forceKill: NodeJS.Timeout | undefined;

    const killGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    };
    const stop = (error: Failure) => {
      if (failure) return;
      failure = error;
      killGroup('SIGTERM');
      forceKill = setTimeout(() => killGroup('SIGKILL'), invocation.killGraceMs ?? 5000);
    };
    const abort = () => stop('cancelled');
    const timeout = setTimeout(() => stop('timeout'), invocation.timeoutMs ?? 180_000);
    invocation.signal?.addEventListener('abort', abort, { once: true });

    const line = (raw: string) => {
      if (!raw.trim() || failure) return;
      try {
        const event = JSON.parse(raw) as Record<string, unknown>;
        if (event.type === 'item.started' || event.type === 'item.completed' || event.type === 'item.updated') {
          const item = event.item as Record<string, unknown> | undefined;
          if (!item || !['agent_message', 'reasoning'].includes(String(item.type))) {
            stop('security_violation');
          } else if (event.type === 'item.completed' && item.type === 'agent_message') {
            if (typeof item.text !== 'string' || Buffer.byteLength(item.text) > 64 * 1024) {
              stop('invalid_output');
            } else finalText = item.text;
          }
        } else if (event.type === 'turn.completed') completed = true;
        else if (event.type === 'turn.failed' || event.type === 'error') {
          stop(providerFailure(JSON.stringify(event)));
        } else if (!['thread.started', 'turn.started'].includes(String(event.type))) {
          stop('invalid_output');
        }
      } catch { stop('invalid_output'); }
    };
    const count = (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > (invocation.maxOutputBytes ?? 1024 * 1024)) stop('output_limit');
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      count(chunk);
      if (failure) return;
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
    });
    child.stderr.on('data', (chunk: string) => {
      count(chunk);
      if (!failure) stderr += chunk;
    });
    child.stdin.on('error', () => { /* A child may exit before consuming stdin. */ });
    child.on('error', () => stop('provider_unavailable'));
    child.on('close', (code) => {
      if (buffer.trim()) line(buffer);
      clearTimeout(timeout);
      clearTimeout(forceKill);
      invocation.signal?.removeEventListener('abort', abort);
      // Also terminate descendants if the parent exits before the grace timer.
      killGroup('SIGKILL');
      if (failure) return resolve({ ok: false, error: failure });
      if (code !== 0) return resolve({ ok: false, error: providerFailure(stderr) });
      if (!completed || !finalText) return resolve({ ok: false, error: 'invalid_output' });
      try {
        const parsed = decisionSchema.safeParse(JSON.parse(finalText));
        resolve(parsed.success ? { ok: true, decision: parsed.data } : { ok: false, error: 'invalid_output' });
      } catch { resolve({ ok: false, error: 'invalid_output' }); }
    });
    child.stdin.end(invocation.prompt);
  });
}
