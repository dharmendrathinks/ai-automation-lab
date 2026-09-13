import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const mode = process.argv[2];
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\n');
const decision = { category: 'billing', intent: 'duplicate_charge',
  recommendedAction: 'investigate_refund', needsHumanReview: true, reason: 'Two payments share one invoice.' };

if (mode === 'hang') setInterval(() => {}, 1000);
else if (mode === 'tree') {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'], { stdio: 'ignore' });
  writeFileSync(process.argv[3], String(child.pid));
  setInterval(() => {}, 1000);
} else if (mode === 'malformed') process.stdout.write('not-json\n');
else if (mode === 'overflow') process.stdout.write('x'.repeat(10000));
else if (mode === 'tool') emit({ type: 'item.started', item: { type: 'command_execution', command: 'echo forbidden' } });
else if (mode === 'failure') {
  process.stderr.write(process.argv[3]); process.exitCode = 1;
} else if (mode === 'missing') emit({ type: 'turn.completed' });
else {
  if (mode === 'schema') decision.recommendedAction = 'refund_everything';
  if (mode === 'extra') decision.permission = 'admin';
  emit({ type: 'thread.started', thread_id: 'synthetic-thread' });
  emit({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(decision) } });
  if (mode !== 'incomplete') emit({ type: 'turn.completed' });
}
