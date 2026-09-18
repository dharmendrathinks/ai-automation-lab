import { spawnSync } from 'node:child_process';

function check(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  const detail = `${result.stdout}${result.stderr}`.trim().split('\n')[0] ?? '';
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}: ${detail || 'failed'}`);
  console.log(`OK  ${command} ${args.join(' ')}${detail ? ` — ${detail}` : ''}`);
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 24 || major >= 27) throw new Error(`Node 24–26 is required; found ${process.version}`);
console.log(`OK  node — ${process.version}`);
check('pnpm', ['--version']);
check('docker', ['info', '--format', '{{.ServerVersion}} {{.Architecture}}']);
check('docker', ['compose', 'version']);
console.log('OK  provider — FIXTURE MODE default (live inference requires explicit isolated configuration)');
