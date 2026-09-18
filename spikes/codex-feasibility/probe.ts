import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { decisionSchema, prompt } from './contract.js';
import { runDecision } from './runner.js';

const executable = process.env.LAB_CODEX_BIN;
if (!executable || !isAbsolute(executable)) {
  throw new Error('Set LAB_CODEX_BIN to the absolute path of Codex CLI 0.155.0.');
}
const runtimeHome = resolve('.local/codex-runtime');
await mkdir(runtimeHome, { recursive: true, mode: 0o700 });
const cwd = await mkdtemp(join(tmpdir(), 'relaydesk-codex-spike-'));
// Child-only environment: no API keys, developer config location, or n8n credentials.
const env = { PATH: '/usr/bin:/bin', CODEX_HOME: runtimeHome,
  ...(process.env.HOME ? { HOME: process.env.HOME } : {}) };
const config = ['--ignore-user-config', '--strict-config',
  '-c', 'forced_login_method="chatgpt"', '-c', 'cli_auth_credentials_store="file"'];
try {
  const version = spawnSync(executable, ['--version'], { env, encoding: 'utf8', timeout: 10_000 });
  if (version.status !== 0 || version.stdout.trim() !== 'codex-cli 0.155.0') {
    throw new Error('Pinned Codex CLI 0.155.0 is required.');
  }
  // No model invocation until isolated authentication is established.
  const auth = spawnSync(executable, ['-c', 'cli_auth_credentials_store="file"',
    'login', 'status'], { env, cwd, encoding: 'utf8', timeout: 10_000 });
  const chatgptAuth = auth.status === 0 && /logged in using chatgpt/i.test(auth.stdout + auth.stderr);
  if (!chatgptAuth) {
    console.log(JSON.stringify({ mode: 'PREFLIGHT ONLY', cliVersion: '0.155.0',
      result: 'NO_GO', reason: 'isolated_chatgpt_authentication_not_established',
      modelCalls: 0, runtimeEnabled: false }, null, 2));
    process.exitCode = 2;
  } else if (process.env.LAB_CODEX_LIVE !== '1') {
    console.log(JSON.stringify({ result: 'LIVE_OPT_IN_REQUIRED', modelCalls: 0, runtimeEnabled: false }));
  } else {
    await writeFile(join(cwd, 'decision.schema.json'), JSON.stringify(z.toJSONSchema(decisionSchema)));
    const model = 'gpt-5.6-terra';
    const result = await runDecision({ executable, env, cwd, prompt,
      args: ['exec', ...config, '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
        '--json', '--model', model, '--output-schema', join(cwd, 'decision.schema.json'),
        '-c', 'approval_policy="never"', '-c', 'features.shell_tool=false',
        '-c', 'features.unified_exec=false', '-c', 'features.hooks=false',
        '-c', 'features.code_mode.enabled=false', '-c', 'agents.enabled=false',
        '-c', 'apps._default.enabled=false', '-c', 'web_search="disabled"',
        '-c', 'project_doc_max_bytes=0', '-'],
    });
    // A successful smoke call is NOT proof of tool isolation or runtime approval.
    console.log(JSON.stringify({ mode: 'LIVE AI MODE', cliVersion: '0.155.0', model,
      result, runtimeEnabled: false, limitation: 'Tool isolation still requires independent proof.' }, null, 2));
    if (!result.ok) process.exitCode = 1;
  }
} finally { await rm(cwd, { recursive: true, force: true }); }
