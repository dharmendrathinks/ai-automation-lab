import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { JSDOM } from 'jsdom';

// DOM contract tests. These deliberately do not stand in for real-browser visual QA.
const html = await readFile(
  new URL('../public/index.html', import.meta.url),
  'utf8',
);
const ticketId = '10000000-0000-4000-8000-000000000001';
const runId = '20000000-0000-4000-8000-000000000001';
const approvalId = '30000000-0000-4000-8000-000000000001';
const operator = 'synthetic-test-token-never-a-real-secret';
const ticket = {
  id: ticketId,
  runId,
  customerRef: 'CUSTOMER-001',
  customerName: 'Morgan Example',
  message: 'How can I download my invoice?',
  mode: 'FIXTURE MODE',
  status: 'open',
  phase: 'pending',
  pendingApprovals: 0,
  verifiedActions: 0,
  createdAt: '2026-09-23T10:00:00Z',
};
const metrics = {
  mode: 'FIXTURE MODE',
  cohort: {
    tickets: 1,
    cutoff: '2026-09-23T10:00:00Z',
    definition: 'All received tickets.',
  },
  resolvedTickets: 0,
  automatedTickets: 0,
  escalatedTickets: 0,
  verifiedCompletionRate: 0,
  automationRate: 0,
  humanEscalationRate: 0,
  meanHandlingMs: null,
  meanApprovalElapsedMs: null,
  meanProviderLatencyMs: null,
  reliability: {
    attemptedActions: 0,
    failedActions: 0,
    failureRate: null,
    retryRate: null,
    retriedActions: 0,
    recoveredActions: 0,
    currentUnknown: 0,
    everUnknown: 0,
    duplicatePreventionEvents: 0,
  },
};
let dom, fetchMock, approvalRecords, failReads;
const tick = () => vi.advanceTimersByTimeAsync(50);
const click = (selector) => {
  const node = document.querySelector(selector);
  expect(node, selector).not.toBeNull();
  node.click();
};
const navigate = async (hash) => {
  window.location.hash = hash;
  await tick();
};
const submit = (id) =>
  document
    .querySelector(id)
    .dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
async function connect() {
  click('#connect-button');
  document.querySelector('#operator-token').value = operator;
  submit('#connect-form');
  await tick();
}
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  failReads = false;
  approvalRecords = [];
  dom = new JSDOM(html, {
    url: 'http://127.0.0.1:3001/dashboard',
    pretendToBeVisual: true,
  });
  for (const name of ['window', 'document', 'location', 'FormData'])
    vi.stubGlobal(name, dom.window[name]);
  window.scrollTo = vi.fn();
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  fetchMock = vi.fn(async (url, options = {}) => {
    let body;
    if (url === '/healthz') body = { mode: 'FIXTURE MODE' };
    else if (url === '/readyz') body = { ready: true };
    else if (failReads && !options.method)
      return new Response(JSON.stringify({ error: 'internal_error' }), {
        status: 500,
      });
    else if (url === '/api/v1/tickets' && options.method === 'POST')
      body = { ticketId, runId };
    else if (url === '/api/v1/tickets') body = { tickets: [ticket] };
    else if (url === '/api/v1/approvals') body = { approvals: approvalRecords };
    else if (String(url).startsWith('/api/v1/metrics/outcomes')) body = metrics;
    else if (url === `/api/v1/tickets/${ticketId}`)
      body = {
        ...ticket,
        customer: { name: 'Morgan Example', accountPlan: 'free' },
        messages: [],
        runs: [{ id: runId, phase: 'pending' }],
      };
    else if (url === `/api/v1/runs/${runId}`)
      body = {
        id: runId,
        ticketId,
        mode: 'FIXTURE MODE',
        actions: [],
        attempts: [],
        jobs: [],
        audit: [],
        events: [],
        workflows: [],
        scenarios: [],
        approvals: [],
      };
    else if (url === `/api/v1/approvals/${approvalId}/decision`)
      body = { status: JSON.parse(options.body).decision };
    else if (String(url).includes('/scenarios/')) body = { ticketId, runId };
    else throw new Error(`Unexpected test API request: ${url}`);
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  await import('../public/app.js');
  await tick();
});
afterEach(() => {
  dom.window.close();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('disconnected workspace has usable navigation and makes no private reads', () => {
  expect(document.body.textContent).toContain(
    'Good automation leaves evidence.',
  );
  expect(document.querySelectorAll('nav a')).toHaveLength(5);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/healthz']);
  expect(document.querySelector('#operator-token')).toBeNull();
});

test('connect, navigate all primary screens, and clear credentials on disconnect', async () => {
  await connect();
  expect(document.querySelector('h1').textContent).toBe(
    'Every outcome, accounted for.',
  );
  for (const [hash, title] of [
    ['tickets', 'Ticket workspace'],
    ['approvals', 'Your judgment belongs here.'],
    ['lab', 'Make it fail. Learn why.'],
    ['outcomes', 'Useful work. Measurable outcomes.'],
  ]) {
    await navigate(hash);
    expect(document.querySelector('h1').textContent).toBe(title);
    expect(document.title).toContain('RelayDesk');
  }
  expect(document.body.textContent).toContain('N/A means missing evidence');
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
  expect(document.documentElement.innerHTML).not.toContain(operator);
  click('#connect-button');
  expect(document.body.textContent).toContain(
    'Good automation leaves evidence.',
  );
});

test('ticket form submits explicit synthetic content and opens real ticket detail', async () => {
  await connect();
  click('[data-action="new-ticket"]');
  expect(document.querySelector('#modal').open).toBe(true);
  document.querySelector('#ticket-message').value =
    'How do I download an invoice?';
  submit('#ticket-form');
  await tick();
  const request = fetchMock.mock.calls.find(
    ([url, options]) => url === '/api/v1/tickets' && options.method === 'POST',
  );
  expect(JSON.parse(request[1].body)).toEqual({
    customerRef: 'CUSTOMER-001',
    message: 'How do I download an invoice?',
  });
  expect(request[1].headers['Content-Type']).toBe('application/json');
  expect(document.querySelector('h1').textContent).toBe(
    'The request. The response. The evidence.',
  );
  expect(document.body.textContent).toContain(
    'No destination response is recorded yet',
  );
  click(`a[href="#run/${runId}"]`);
  await tick();
  expect(document.querySelector('h1').textContent).toBe('Follow the evidence.');
  expect(document.body.textContent).toContain(
    'No provider call is recorded yet.',
  );
});

test('ticket search and empty results preserve the query and remain usable', async () => {
  await connect();
  await navigate('tickets');
  const search = document.querySelector('#ticket-search');
  search.value = 'not a matching request';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  expect(document.body.textContent).toContain('No matching tickets');
  expect(document.querySelector('#ticket-search').value).toBe(
    'not a matching request',
  );
});

test('bodyless API requests do not declare a JSON entity', async () => {
  await connect();
  const reads = fetchMock.mock.calls.filter(([url]) => url.startsWith('/api/'));
  expect(reads.length).toBeGreaterThan(0);
  for (const [, options] of reads) {
    expect(options.body).toBeUndefined();
    expect(options.headers).not.toHaveProperty('Content-Type');
    expect(options.headers.Authorization).toBe(`Bearer ${operator}`);
  }
});

test('ticket reference pattern compiles under modern HTML Unicode-set rules', async () => {
  await connect();
  click('[data-action="new-ticket"]');
  const pattern = new RegExp(
    `^(?:${document.querySelector('#customer-ref').pattern})$`,
    'v',
  );
  for (const value of ['CUSTOMER-001', 'customer_2', 'A'])
    expect(pattern.test(value)).toBe(true);
  for (const value of ['', 'invalid reference', 'customer/1', 'x'.repeat(65)])
    expect(pattern.test(value)).toBe(false);
});

test('approval form shows exact payment, requires a decision and sends reviewer reason', async () => {
  approvalRecords = [
    {
      id: approvalId,
      actionId: 'action-1',
      status: 'pending',
      expiresAt: '2099-01-01T00:00:00Z',
      requestedAt: '2026-09-23T10:00:00Z',
      proposalHash: 'synthetic-hash',
      ticket,
      action: {
        runId,
        policyVersion: 'refund-policy-v1',
        businessOutcome: 'pending',
        parameters: {
          customerId: 'CUSTOMER-001',
          paymentId: 'PAY-002',
          invoiceId: 'INV-001',
          amountMinor: 2900,
          currency: 'USD',
        },
      },
    },
  ];
  await connect();
  await navigate('approvals');
  click('[data-action="review"]');
  expect(document.querySelector('#modal').textContent).toContain('$29.00');
  expect(document.querySelector('#modal').textContent).toContain('PAY-002');
  expect(document.querySelector('#review-decision').value).toBe('');
  expect(document.querySelector('#review-form').checkValidity()).toBe(false);
  document.querySelector('#review-decision').value = 'rejected';
  document.querySelector('#review-reason').value =
    'Synthetic review: reject this proposal.';
  document.querySelector('#review-form input[type="checkbox"]').checked = true;
  expect(document.querySelector('#review-form').checkValidity()).toBe(true);
  submit('#review-form');
  await tick();
  const request = fetchMock.mock.calls.find(([url]) =>
    url.endsWith('/decision'),
  );
  expect(JSON.parse(request[1].body)).toEqual({
    decision: 'rejected',
    reason: 'Synthetic review: reject this proposal.',
  });
});

test('lab confirms fault configuration and inspects the resulting run without fabricating success', async () => {
  await connect();
  await navigate('lab');
  click('[data-id="false-success"]');
  expect(document.querySelector('#scenario-form').checkValidity()).toBe(false);
  document.querySelector('#scenario-form input').checked = true;
  submit('#scenario-form');
  await tick();
  const request = fetchMock.mock.calls.find(([url]) =>
    url.includes('/scenarios/'),
  );
  expect(request[0]).toBe('/api/v1/scenarios/false-success/start');
  expect(JSON.parse(request[1].body).message).toContain('invoice');
  expect(document.querySelector('h1').textContent).toBe('Follow the evidence.');
  expect(document.body.textContent).toContain(
    'No executable action was proposed',
  );
});

test('load failures show a recoverable error state, not successful or zero metrics', async () => {
  await connect();
  failReads = true;
  await navigate('tickets');
  expect(document.querySelector('h1').textContent).toBe(
    'Evidence is unavailable.',
  );
  expect(document.querySelector('[data-action="refresh"]').textContent).toBe(
    'Try again',
  );
  expect(document.querySelector('.metrics-grid')).toBeNull();
});

test('cancelled connection cannot reconnect the workspace after a late response', async () => {
  let finish;
  fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  click('#connect-button');
  document.querySelector('#operator-token').value = operator;
  submit('#connect-form');
  click('[data-action="close-modal"]');
  expect(document.activeElement).toBe(document.querySelector('#connect-button'));
  click('#connect-button');
  finish(new Response(JSON.stringify({ ready: true }), { status: 200 }));
  await tick();
  expect(document.querySelector('#connect-button').textContent).toBe('Connect workspace');
  expect(document.querySelector('#modal').open).toBe(true);
  expect(fetchMock.mock.calls.filter(([url]) => url.startsWith('/api/'))).toHaveLength(0);
});

test('disconnect during loading clears busy state and ignores late private data', async () => {
  await connect();
  let finish;
  fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await navigate('tickets');
  expect(document.querySelector('#main').getAttribute('aria-busy')).toBe('true');
  click('#connect-button');
  finish(new Response(JSON.stringify({ tickets: [ticket] }), { status: 200 }));
  await tick();
  expect(document.querySelector('#main').hasAttribute('aria-busy')).toBe(false);
  expect(document.body.textContent).toContain('Good automation leaves evidence.');
  expect(document.querySelector('#ticket-search')).toBeNull();
});

test('skip link focuses the workspace without changing the current route', async () => {
  await connect();
  await navigate('tickets');
  click('.skip-link');
  await tick();
  expect(window.location.hash).toBe('#tickets');
  expect(document.activeElement).toBe(document.querySelector('#main'));
});

test('a late ticket write cannot close a replacement dialog or navigate away', async () => {
  await connect();
  let finish;
  fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  click('[data-action="new-ticket"]');
  submit('#ticket-form');
  click('[data-action="close-modal"]');
  click('[data-action="new-ticket"]');
  document.querySelector('#ticket-message').value = 'Keep this new draft.';
  finish(new Response(JSON.stringify({ ticketId, runId }), { status: 201 }));
  await tick();
  expect(document.querySelector('#modal').open).toBe(true);
  expect(document.querySelector('#ticket-message').value).toBe('Keep this new draft.');
  expect(window.location.hash).not.toContain(ticketId);
  expect(document.querySelector('#toast').textContent).toContain('Refresh');
});
