import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from './fixtures.js';
import { requireOwnedProject } from './support/stack.js';

const exec = promisify(execFile);
test('native n8n wait survives restart, concurrent callbacks and duplicate replay', async ({
  lab,
}) => {
  test.setTimeout(120_000);
  const instance = process.env.RELAYDESK_E2E_INSTANCE!;
  requireOwnedProject(instance);
  const created = await lab.control<{ id: string }>('/api/v1/wait-exercises', {
    expiresInSeconds: 600,
  });
  // Approval before the wait is ready must be retained.
  await lab.control(`/api/v1/wait-exercises/${created.id}/approve`, {});
  expect(await lab.control(`/__e2e/wait/${created.id}/start`, {})).toEqual({
    accepted: true,
  });
  await expect
    .poll(
      async () =>
        (
          await lab.control<{ registered: boolean }>(
            `/__e2e/wait/${created.id}`,
          )
        ).registered,
    )
    .toBe(true);
  // Read the real pinned n8n execution store; never mutate its private schema.
  await expect
    .poll(async () =>
      Number(
        (
          await exec('docker', [
            'exec',
            `${instance}-postgres-1`,
            'psql',
            '-U',
            'lab_admin',
            '-d',
            'n8n',
            '-At',
            '-c',
            "SELECT count(*) FROM execution_entity WHERE status='waiting'",
          ])
        ).stdout.trim(),
      ),
    )
    .toBeGreaterThan(0);
  await exec('docker', ['restart', `${instance}-n8n-1`], { timeout: 60_000 });
  await expect
    .poll(
      async () =>
        (await lab.control<{ ready: boolean }>('/__e2e/n8n-health')).ready,
      { timeout: 45_000 },
    )
    .toBe(true);
  // A callback may race n8n rehydration, so use its bounded persisted retry budget.
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    await Promise.allSettled([
      lab.control(`/api/v1/wait-exercises/${created.id}/resume`, {}),
      lab.control(`/api/v1/wait-exercises/${created.id}/resume`, {}),
    ]);
    const status = await lab.control<{ status: string }>(
      `/__e2e/wait/${created.id}`,
    );
    if (status.status === 'completed') break;
  }
  await expect
    .poll(
      async () =>
        (await lab.control<{ status: string }>(`/__e2e/wait/${created.id}`))
          .status,
    )
    .toBe('completed');
  expect(
    await lab.control(`/api/v1/wait-exercises/${created.id}/resume`, {}),
  ).toMatchObject({ completed: true, replayed: true });
  const before = await lab.control<{ callback_attempts: number }>(
    `/__e2e/wait/${created.id}`,
  );
  await lab.control(`/api/v1/wait-exercises/${created.id}/resume`, {});
  expect(
    (
      await lab.control<{ callback_attempts: number }>(
        `/__e2e/wait/${created.id}`,
      )
    ).callback_attempts,
  ).toBe(before.callback_attempts);
});
