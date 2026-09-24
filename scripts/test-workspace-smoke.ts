import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// Requires the normal API + outbox worker + n8n. Adds synthetic tickets, never resets data.
if (!process.env.LAB_OPERATOR_TOKEN)
  throw new Error('LAB_OPERATOR_TOKEN is required.');
const headers = {
  authorization: `Bearer ${process.env.LAB_OPERATOR_TOKEN}`,
  'content-type': 'application/json',
};
type RunSummary = {
  actions: Array<{ businessOutcome: string }>;
  attempts: unknown[];
};
async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`http://127.0.0.1:3001${path}`, {
    headers,
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(
    response.ok,
    true,
    `Request failed: ${path} (${response.status})`,
  );
  return response.json() as Promise<T>;
}
assert.equal(
  (await request<{ mode: string }>('/healthz')).mode,
  'FIXTURE MODE',
  'This smoke test must not invoke a live provider.',
);
for (const scenario of [
  'support',
  'fail-before-commit',
  'commit-lost-response',
  'false-success',
  'verification-unavailable',
]) {
  const created = await request<{ ticketId: string; runId: string }>(
    scenario === 'support'
      ? '/api/v1/tickets'
      : `/api/v1/scenarios/${scenario}/start`,
    { customerRef: 'CUSTOMER-001', message: 'How can I download my invoice?' },
  );
  let run: RunSummary | undefined;
  for (let tries = 0; tries < 120; tries++) {
    run = await request<RunSummary>(`/api/v1/runs/${created.runId}`);
    if (
      run.actions.some((a: { businessOutcome: string }) =>
        ['verified', 'failed', 'unknown'].includes(a.businessOutcome),
      )
    )
      break;
    await delay(250);
  }
  assert.ok(
    run?.actions.length,
    `No action observed for ${scenario}; check the worker and workflows.`,
  );
  const outcome = run.actions[0]!.businessOutcome;
  assert.equal(
    outcome,
    scenario === 'false-success'
      ? 'failed'
      : scenario === 'verification-unavailable'
        ? 'unknown'
        : 'verified',
    scenario,
  );
  if (scenario === 'verification-unavailable') {
    assert.equal(
      (
        await request<{ outcome: string }>(
          `/api/v1/runs/${created.runId}/reconcile`,
          {},
        )
      ).outcome,
      'verified',
    );
  }
  const ticket = await request<{ messages: unknown[]; status: string }>(
    `/api/v1/tickets/${created.ticketId}`,
  );
  assert.equal(ticket.messages.length, scenario === 'false-success' ? 0 : 1);
  assert.equal(
    ticket.status,
    scenario === 'false-success' ? 'open' : 'resolved',
  );
  console.log(
    JSON.stringify({
      scenario,
      runId: created.runId,
      initialOutcome: outcome,
      finalTicketStatus: ticket.status,
      destinationMessages: ticket.messages.length,
      attempts: run.attempts.length,
    }),
  );
}
console.log(
  'Workspace API smoke passed through real n8n orchestration. Five synthetic tickets retained. No live AI was invoked.',
);
