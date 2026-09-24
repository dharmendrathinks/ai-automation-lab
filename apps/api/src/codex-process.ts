import { spawn } from 'node:child_process';

export function providerFailure(text: string) {
  if (/usage.limit|quota|credits.exhausted/i.test(text))
    return 'quota_exceeded';
  if (/rate.limit|429/i.test(text)) return 'rate_limited';
  if (
    /not logged in|authentication|unauthorized|401|sign.in|log.in required/i.test(
      text,
    )
  )
    return 'authentication_required';
  return 'provider_unavailable';
}

/** POSIX process boundary. Settle only after close; never expose captured logs. */
export function codexProcess(options: {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  input: string;
  signal?: AbortSignal | undefined;
  timeoutMs: number;
  killGraceMs: number;
  line: (line: string) => void;
}) {
  if (options.signal?.aborted) return Promise.reject(new Error('cancelled'));
  return new Promise<void>((resolve, reject) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let failure: Error | undefined,
      buffer = '',
      stderr = '',
      bytes = 0;
    let force: NodeJS.Timeout | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          /* Already exited. */
        }
      }
    };
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      kill('SIGTERM');
      force = setTimeout(() => kill('SIGKILL'), options.killGraceMs);
    };
    const consume = (line: string) => {
      if (!line.trim() || failure) return;
      try {
        options.line(line);
      } catch (error) {
        stop(error instanceof Error ? error : new Error('invalid_output'));
      }
    };
    const count = (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1024 * 1024) stop(new Error('provider_output_limit'));
    };
    const abort = () => stop(new Error('cancelled'));
    const timeout = setTimeout(
      () => stop(new Error('provider_timeout')),
      options.timeoutMs,
    );
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      count(chunk);
      if (failure) return;
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
    });
    child.stderr.on('data', (chunk: string) => {
      count(chunk);
      if (!failure) stderr += chunk;
    });
    child.stdin.on('error', () => {});
    child.on('error', () => stop(new Error('provider_unavailable')));
    child.on('close', (code) => {
      consume(buffer);
      clearTimeout(timeout);
      clearTimeout(force);
      options.signal?.removeEventListener('abort', abort);
      // A parent may exit while descendants survive with their stdio closed.
      kill('SIGKILL');
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(providerFailure(stderr)));
      else resolve();
    });
    child.stdin.end(options.input);
  });
}

export async function waitForTurn(
  previous: Promise<void>,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new Error('cancelled');
  let abort: (() => void) | undefined;
  try {
    await Promise.race([
      previous,
      new Promise<never>((_, reject) => {
        abort = () => reject(new Error('cancelled'));
        signal?.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
  }
}
