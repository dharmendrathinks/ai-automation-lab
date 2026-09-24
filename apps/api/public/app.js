import {
  escapeHtml as e,
  humanize,
  percent,
  duration,
  money,
  shortId,
  statusTone,
  effectiveApprovalStatus,
} from './format.js';

const main = document.querySelector('#main');
const modal = document.querySelector('#modal');
const state = {
  token: '',
  mode: null,
  cohort: 'fixture',
  tickets: [],
  approvals: [],
  metrics: null,
  detail: null,
  filter: 'all',
  search: '',
  route: 'overview',
  id: '',
  connected: false,
};
let controller,
  toastTimer,
  modalOpener,
  lastSnapshot = '';
const date = (value) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(value))
    : 'Not recorded';
const badge = (label, tone = statusTone(label)) =>
  `<span class="badge ${tone}">${e(humanize(label))}</span>`;
const modeBadge = (mode) =>
  badge(mode ?? 'Not recorded', mode === 'LIVE AI MODE' ? 'blue' : 'amber');
const button = (label, action, kind = 'secondary', extra = '') =>
  `<button class="button ${kind}" data-action="${action}" ${extra}>${label}</button>`;
const evidence = (label, value) =>
  `<details><summary>${e(label)}</summary><pre>${e(JSON.stringify(value, null, 2))}</pre></details>`;
const empty = (title, description, action = '') =>
  `<div class="empty-state"><div class="empty-icon" aria-hidden="true">◇</div><h2>${e(title)}</h2><p>${e(description)}</p>${action}</div>`;
const metric = (label, value, note, icon = '↗') =>
  `<article class="metric"><div class="metric-label">${e(label)}<span aria-hidden="true">${icon}</span></div><div class="metric-value">${e(value)}</div><div class="metric-foot">${e(note)}</div></article>`;
const heading = (eyebrow, title, subtitle, actions = '') =>
  `<div class="page-heading"><div><span class="eyebrow">${e(eyebrow)}</span><h1>${e(title)}</h1><p>${e(subtitle)}</p></div><div class="heading-actions">${actions}</div></div>`;
const runtimeNotice = () =>
  `<div class="notice"><span class="notice-icon" aria-hidden="true">◇</span><p><strong>${e(state.mode ?? 'Runtime unavailable')}.</strong> ${state.mode === 'LIVE AI MODE' ? 'New tickets use the configured live provider. Only submit synthetic data; inference may consume provider allowance.' : 'Decisions are deterministic fixtures, not live-model predictions. All customers, payments, and responses are synthetic.'}</p></div>`;
const routeLink = (type, id) => `#${type}/${encodeURIComponent(id)}`;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
      Authorization: `Bearer ${state.token}`,
      ...options.headers,
    },
    cache: 'no-store',
  });
  if (response.status === 401)
    throw new Error(
      'Session not authorized. Reconnect with your local operator token.',
    );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const messages = {
      approval_conflict:
        'This proposal has already been decided. Refresh to see the current decision.',
      approval_expired: 'This approval has expired. No decision was recorded.',
      proposal_changed:
        'The proposal changed. Approval was blocked; inspect the current evidence.',
      fixture_mode_required:
        'Reliability scenarios require fixture mode. No ticket was created.',
      not_found: 'This record was not found in the current local database.',
      invalid_request: 'Check the input and try again.',
      verification_not_ready: 'This action has not executed yet. Wait for execution before reconciling.',
    };
    throw new Error(
      messages[payload.error] ??
        `The API could not complete this request (${response.status}). No success is assumed. Inspect the run before retrying a write.`,
    );
  }
  return response.json();
}
function toast(message) {
  const target = document.querySelector('#toast');
  target.textContent = message;
  target.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    target.hidden = true;
  }, 6500);
}
function showModal(title, eyebrow, content) {
  modalOpener = document.activeElement;
  document.querySelector('#modal-content').innerHTML =
    `<div class="modal-heading"><div><span class="eyebrow">${e(eyebrow)}</span><h2 id="modal-title">${e(title)}</h2></div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">×</button></div>${content}`;
  modal.showModal();
}
modal.addEventListener('close', () => {
  document.querySelector('#modal-content').replaceChildren();
  if (modalOpener?.isConnected) modalOpener.focus();
});
function connectDialog() {
  showModal(
    'Connect your workspace',
    'LOCAL OPERATOR ACCESS',
    `<p class="modal-intro">Use <code>LAB_OPERATOR_TOKEN</code> from your local <code>.env</code> file. This is not a model API key. It stays in this tab’s memory and is cleared on refresh or disconnect.</p><form id="connect-form"><div class="field"><label for="operator-token">Local operator token</label><input id="operator-token" name="token" type="password" autocomplete="off" minlength="32" required autofocus><small>Sent only to this local RelayDesk API. Never paste a provider credential here.</small></div><p class="field-error" role="alert" id="form-error"></p><div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit">Connect workspace <span aria-hidden="true">→</span></button></div></form>`,
  );
}
function connectState() {
  const connect = document.querySelector('#connect-button');
  connect.textContent = state.connected ? 'Disconnect' : 'Connect workspace';
  document.querySelector('#provider-mode').outerHTML = modeBadge(
    state.mode,
  ).replace('<span ', '<span id="provider-mode" ');
  document.querySelector('#ticket-count').textContent = state.connected
    ? String(state.tickets.length)
    : '—';
  document.querySelector('#approval-count').textContent = state.connected
    ? String(
        state.approvals.filter((a) => effectiveApprovalStatus(a) === 'pending')
          .length,
      )
    : '—';
}
function architecture() {
  return `<div class="system-row"><span class="system-step">01</span><div><strong>Understand</strong><small>Provider proposes a structured decision</small></div><span class="muted" aria-hidden="true">↗</span></div><div class="system-row"><span class="system-step">02</span><div><strong>Authorize</strong><small>Backend policy + human approval</small></div><span class="muted" aria-hidden="true">↗</span></div><div class="system-row"><span class="system-step">03</span><div><strong>Orchestrate</strong><small>n8n coordinates bounded actions</small></div><span class="muted" aria-hidden="true">↗</span></div><div class="system-row"><span class="system-step">04</span><div><strong>Verify</strong><small>Read the actual destination state</small></div><span class="muted" aria-hidden="true">✓</span></div>`;
}
function welcomePage() {
  return (
    heading(
      'THE AUTOMATION WORKSPACE',
      'Good automation leaves evidence.',
      'A local support lab where useful outcomes matter more than activity.',
    ) +
    `<section class="welcome"><div><span class="pill-note">Synthetic data. Real engineering.</span><h2>From customer request<br>to verified resolution.</h2><p>Create a ticket, follow the decision, and see what actually happened. Human approvals and independent verification keep the workflow accountable.</p>${button('Connect workspace <span aria-hidden="true">→</span>', 'connect', 'primary')}<p class="small-text muted">No model account needed in fixture mode.</p></div><div class="welcome-steps">${architecture()}</div></section><div class="equal-columns"><section class="panel"><span class="eyebrow">01 / EXPLORE THE WORKFLOW</span><h2>Start with an invoice question</h2><p class="muted small-text">Create a synthetic support ticket and follow intake, triage, policy, execution, and destination verification.</p></section><section class="panel"><span class="eyebrow">02 / TEST THE ASSUMPTIONS</span><h2>A green check isn’t the whole story</h2><p class="muted small-text">Run a controlled failure in the reliability lab. Compare the API response with the persisted business outcome.</p></section></div>`
  );
}
function cohortControl() {
  return `<div class="filters" role="group" aria-label="Metrics cohort"><button class="filter" data-cohort="fixture" aria-pressed="${state.cohort === 'fixture'}">Fixture results</button><button class="filter" data-cohort="live" aria-pressed="${state.cohort === 'live'}">Live AI results</button></div>`;
}
function summaryMetrics() {
  const m = state.metrics;
  return `<div class="metrics-grid">${metric('Tickets in cohort', m.cohort.tickets, 'Includes pending and failed work', '▤')}${metric('Verified completion', percent(m.verifiedCompletionRate), `${m.resolvedTickets} resolved with verified actions`, '✓')}${metric('Fully automated', percent(m.automationRate), 'Verified resolution without an approval', '↗')}${metric('Human escalation', percent(m.humanEscalationRate), `${m.escalatedTickets} routed to human follow-up`, '◇')}</div>`;
}
function ticketTable(tickets, compact = false) {
  if (!tickets.length)
    return empty(
      state.search || state.filter !== 'all'
        ? 'No matching tickets'
        : 'Your first ticket starts here',
      'Create a synthetic request to see its decision, actions, and verified outcome.',
      button('＋ New ticket', 'new-ticket', 'primary'),
    );
  return `<div class="table-scroll"><table><caption class="sr-only">${compact ? 'Recent tickets' : 'Ticket queue'} · newest first · up to 100 tickets across both modes</caption><thead><tr><th scope="col">Ticket / request</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Mode</th>${compact ? '' : '<th scope="col">Received</th>'}</tr></thead><tbody>${tickets
    .map(
      (t) =>
        `<tr><td><a class="ticket-subject" href="${routeLink('ticket', t.id)}">${e(t.message)}</a><span class="ticket-meta mono">RD-${e(shortId(t.id))}</span> <span class="ticket-meta">${t.verifiedActions ? '· Verified action' : t.pendingApprovals ? '· Review required' : '· ' + e(humanize(t.phase ?? 'pending'))}</span></td><td><div class="customer-cell"><span class="avatar" aria-hidden="true">${e(
          (t.customerName ?? 'Unknown')
            .split(' ')
            .map((s) => s[0])
            .join('')
            .slice(0, 2),
        )}</span><span>${e(t.customerName ?? t.customerRef)}<small class="ticket-meta">${t.customerName ? '<br>' + e(t.customerRef) : '<br>Identity unresolved'}</small></span></div></td><td>${badge(t.pendingApprovals ? 'pending_approval' : t.status)}</td><td>${modeBadge(t.mode)}</td>${compact ? '' : `<td class="ticket-meta">${e(date(t.createdAt))}</td>`}</tr>`,
    )
    .join('')}</tbody></table></div>`;
}
function overviewPage() {
  const pending = state.approvals.filter(
    (a) => effectiveApprovalStatus(a) === 'pending',
  ).length;
  return (
    heading(
      'WORKSPACE OVERVIEW',
      'Every outcome, accounted for.',
      'Understand what was automated, what needs a person, and what is actually verified.',
      button('↻ Refresh', 'refresh') +
        button('＋ New ticket', 'new-ticket', 'primary'),
    ) +
    runtimeNotice() +
    `<div class="toolbar"><div><h2>Outcome snapshot</h2><span class="muted small-text">${e(date(state.metrics.cohort.cutoff))} · all received tickets in selected mode</span></div>${cohortControl()}</div>` +
    summaryMetrics() +
    `<div class="two-columns"><div class="stack"><section class="panel flush"><div class="section-heading"><div><h2>Recent tickets</h2><p>The latest work across your local workspace.</p></div><a class="text-link" href="#tickets">View all <span aria-hidden="true">↗</span></a></div>${ticketTable(state.tickets.slice(0, 5), true)}<div class="table-footer"><span>Latest ${Math.min(state.tickets.length, 5)} of ${state.tickets.length}${state.tickets.length === 100 ? '+' : ''} loaded</span><span>Refreshes every 8 seconds</span></div></section><section class="panel feature-panel"><span class="eyebrow">THE RELIABILITY LAB</span><h2>What happens when “success” isn’t?</h2><p>Lose a response. Inject a failure. Make verification unavailable. Then follow the evidence—not just the workflow status.</p><a class="button secondary small" href="#lab">Explore scenarios <span aria-hidden="true">↗</span></a></section></div><div class="stack"><section class="panel"><div class="section-heading"><h2>Needs your judgment</h2>${badge(`${pending} pending`, pending ? 'amber' : 'neutral')}</div><p class="muted small-text">Refunds need a person to review the exact proposal before any action can run.</p><a class="button secondary full" href="#approvals">Review approvals <span aria-hidden="true">→</span></a></section><section class="panel"><span class="eyebrow">CLEAR OWNERSHIP</span><h2>The path to an outcome</h2>${architecture()}</section></div></div>`
  );
}
function ticketsPage() {
  const filtered = state.tickets.filter(
    (t) =>
      (state.filter === 'all' ||
        (state.filter === 'review'
          ? t.pendingApprovals > 0
          : t.status === state.filter)) &&
      `${t.message} ${t.customerName} ${t.customerRef} ${t.id}`
        .toLowerCase()
        .includes(state.search.toLowerCase()),
  );
  return (
    heading(
      'SUPPORT OPERATIONS',
      'Ticket workspace',
      'Every request has a story. Follow it from intake to independent verification.',
      button('↻ Refresh', 'refresh') +
        button('＋ New ticket', 'new-ticket', 'primary'),
    ) +
    `<div class="toolbar"><div class="filters" role="group" aria-label="Ticket status">${[
      ['all', 'All tickets'],
      ['open', 'Open'],
      ['review', 'Needs review'],
      ['resolved', 'Resolved'],
      ['human_follow_up', 'Escalated'],
    ]
      .map(
        ([value, label]) =>
          `<button class="filter" data-filter="${value}" aria-pressed="${state.filter === value}">${label}</button>`,
      )
      .join(
        '',
      )}</div><div class="search"><label class="sr-only" for="ticket-search">Search loaded tickets</label><input type="search" id="ticket-search" placeholder="Search tickets or customers…" value="${e(state.search)}"></div></div><section class="panel flush">${ticketTable(filtered)}<div class="table-footer"><span>${filtered.length} matching · newest 100 tickets maximum</span><span>Fixture + live modes clearly labeled</span></div></section>`
  );
}
function ticketPage() {
  const t = state.detail;
  return (
    `<a class="back-link" href="#tickets">← Back to tickets</a>` +
    heading(
      `TICKET RD-${shortId(t.id)}`,
      'The request. The response. The evidence.',
      'Only a verified destination action can count as a resolved outcome.',
      badge(t.status) + button('Record effort', 'effort'),
    ) +
    `<div class="two-columns"><section class="panel"><div class="section-heading"><h2>Conversation</h2><span class="eyebrow">SYNTHETIC CUSTOMER</span></div><article class="message"><div class="message-header"><span class="avatar" aria-hidden="true">${e((t.customer?.name ?? 'Unknown').slice(0, 1))}</span><div><strong>${e(t.customer?.name ?? t.customerRef)}</strong><small>${e(date(t.createdAt))} · Incoming request</small></div></div><div class="message-body">${e(t.message)}</div></article>${t.messages.map((m) => `<article class="message automation"><div class="message-header"><span class="avatar" aria-hidden="true">RD</span><div><strong>RelayDesk automation</strong><small>${e(date(m.createdAt))} · ${e(m.visibility)} destination message</small></div></div><div class="message-body">${e(m.text)}</div></article>`).join('')}${!t.messages.length ? '<div class="notice"><p>No destination response is recorded yet. This is not a completed resolution.</p></div>' : ''}</section><div class="stack"><section class="panel"><h2>Customer context</h2><dl class="key-values"><dt>Customer</dt><dd>${e(t.customer?.name ?? 'Unresolved')}</dd><dt>Reference</dt><dd class="mono">${e(t.customerRef)}</dd><dt>Account plan</dt><dd>${e(t.customer?.accountPlan ?? 'Not available')}</dd><dt>Status</dt><dd>${badge(t.status)}</dd></dl></section><section class="panel"><h2>Automation evidence</h2><p class="muted small-text">Triage completion is separate from the business outcome.</p>${t.runs.map((r) => `<div class="action-strip"><div><strong>Run ${e(shortId(r.id))}</strong><small>Triage: ${e(humanize(r.phase))}</small></div><a class="button secondary small" href="${routeLink('run', r.id)}">Inspect run ↗</a></div>`).join('') || '<p class="muted small-text">No automation run recorded.</p>'}</section></div></div>`
  );
}
function runPage() {
  const r = state.detail,
    policy = r.policyResult,
    actions = r.actions;
  const allVerified =
    actions.length > 0 &&
    actions.every((a) => a.businessOutcome === 'verified');
  const latestJob = r.jobs.at(-1);
  const stages = [
    ['01 / INTAKE', 'Request received', 'completed'],
    [
      '02 / DECISION',
      'Structured proposal',
      r.decision
        ? 'completed'
        : latestJob?.status === 'failed'
          ? 'failed'
          : 'pending',
    ],
    ['03 / POLICY', 'Backend authority', policy ? 'completed' : 'pending'],
    [
      '04 / ACTION',
      'Destination write',
      actions.some((a) => a.status === 'pending_approval')
        ? 'pending_approval'
        : (r.attempts.at(-1)?.result ?? 'pending'),
    ],
    [
      '05 / VERIFICATION',
      'Independent read-back',
      allVerified
        ? 'verified'
        : (actions.find((a) =>
            ['unknown', 'failed'].includes(a.businessOutcome),
          )?.businessOutcome ?? 'pending'),
    ],
  ];
  return (
    `<a class="back-link" href="${routeLink('ticket', r.ticketId)}">← Back to ticket</a>` +
    heading(
      `RUN ${shortId(r.id)}`,
      'Follow the evidence.',
      'Decision, policy, authorization, action, and verification—kept distinct.',
      modeBadge(r.mode) + button('↻ Refresh', 'refresh'),
    ) +
    `<div class="pipeline">${stages.map(([label, title, status]) => `<div class="pipeline-step"><span class="eyebrow">${label}</span><strong>${title}</strong>${badge(status)}</div>`).join('')}</div><div class="two-columns"><div class="stack"><section class="panel"><div class="section-heading"><div><h2>Durable audit trail</h2><p>${r.audit.length} recorded events · chronological order</p></div><a class="text-link" href="http://127.0.0.1:5678/" target="_blank" rel="noopener noreferrer">Open n8n ↗</a></div>${r.audit.length ? `<ol class="timeline">${r.audit.map((a) => `<li><div class="timeline-title"><span>${e(humanize(a.eventType))}</span><time datetime="${e(a.createdAt)}">${e(date(a.createdAt))}</time></div><div class="actor">${e(a.actor)}</div>${evidence('Inspect recorded evidence', a.evidence)}</li>`).join('')}</ol>` : empty('No audit events yet', 'The next refresh will check for persisted evidence.')}</section><section class="panel"><h2>Actions & verification</h2>${
      actions.length
        ? actions
            .map(
              (a) =>
                `<div class="action-strip"><div><strong>${e(humanize(a.kind))}</strong><small>Action ${e(shortId(a.id))} · ${e(a.policyVersion)}</small></div>${badge(a.businessOutcome)}</div>${evidence('Parameters, authorization key & action state', a)}${r.attempts
                  .filter((x) => x.actionId === a.id)
                  .map(
                    (x) =>
                      `<div class="action-strip"><div><strong>Attempt ${x.attempt}</strong><small>${e(date(x.createdAt))}</small></div>${badge(x.result)}</div>`,
                  )
                  .join('')}`,
            )
            .join('')
        : '<p class="muted small-text">No executable action was proposed. Inspect the policy route and escalation reason.</p>'
    }${actions.some((a) => a.businessOutcome === 'unknown') ? `<div class="notice warning"><p>Unknown is not failed and is not verified. Reconciliation reads destination state; it does not repeat the action.</p></div>${button('Reconcile outcome', 'reconcile', 'secondary')}` : ''}</section></div><div class="stack"><section class="panel"><h2>Structured decision</h2>${r.decision ? `<dl class="key-values compact"><dt>Intent</dt><dd>${e(humanize(r.decision.intent))}</dd><dt>Category</dt><dd>${e(humanize(r.decision.category))}</dd><dt>Recommendation</dt><dd>${e(humanize(r.decision.recommendedAction))}</dd><dt>Explanation</dt><dd>${e(r.decision.reason)}</dd></dl>${evidence('Full decision contract', r.decision)}` : `<p class="muted small-text">${latestJob?.status === 'failed' ? 'Provider failed. No decision is assumed.' : 'Waiting for orchestration to request a decision.'}</p>`}</section><section class="panel"><h2>Policy & approval</h2><dl class="key-values compact"><dt>Policy route</dt><dd>${e(humanize(policy?.route ?? 'pending'))}</dd><dt>Escalation</dt><dd>${e(humanize(r.escalationReason ?? 'none recorded'))}</dd></dl>${r.approvals.map((a) => `<div class="action-strip"><div><strong>Human review</strong><small>${e(humanize(effectiveApprovalStatus(a)))}</small></div><a class="text-link" href="#approvals">Review →</a></div>`).join('')}${policy ? evidence('Policy evaluation', policy) : ''}</section><section class="panel"><h2>Provider record</h2>${latestJob ? `<dl class="key-values compact"><dt>Provider</dt><dd>${e(latestJob.provider)}</dd><dt>Model</dt><dd class="mono">${e(latestJob.model)}</dd><dt>Duration</dt><dd>${e(duration(latestJob.durationMs))}</dd><dt>Status</dt><dd>${badge(latestJob.status)}</dd><dt>Error code</dt><dd>${e(latestJob.errorCode ?? 'None')}</dd></dl>${evidence('Recorded usage (null means unavailable)', latestJob.result?.usage ?? null)}` : '<p class="muted small-text">No provider call is recorded yet.</p>'}</section><section class="panel"><h2>Delivery & orchestration</h2><p class="muted small-text">Execution links are not available until actual n8n execution IDs are captured.</p>${evidence(
      'Outbox delivery',
      r.events.map(({ payload: _payload, ...event }) => event),
    )}${evidence('Workflow claims', r.workflows)}${r.scenarios.length ? evidence('Persisted fault configuration', r.scenarios) : ''}</section></div></div>`
  );
}
function approvalsPage() {
  const rows = state.approvals.filter(
    (a) =>
      state.filter === 'all' ||
      (state.filter === 'pending'
        ? effectiveApprovalStatus(a) === 'pending'
        : effectiveApprovalStatus(a) !== 'pending'),
  );
  return (
    heading(
      'HUMAN-IN-THE-LOOP',
      'Your judgment belongs here.',
      'Review the exact refund proposal. The backend—not the model—enforces your decision.',
      button('↻ Refresh', 'refresh'),
    ) +
    `<div class="notice"><span class="notice-icon" aria-hidden="true">◇</span><p><strong>Approval is not completion.</strong> An approved proposal still needs execution and independent billing verification. No real money moves in this lab.</p></div><div class="toolbar"><div class="filters" role="group" aria-label="Approval status">${[
      ['pending', 'Needs review'],
      ['history', 'Decision history'],
      ['all', 'All approvals'],
    ]
      .map(
        ([value, label]) =>
          `<button class="filter" data-filter="${value}" aria-pressed="${state.filter === value}">${label}</button>`,
      )
      .join(
        '',
      )}</div><span class="muted small-text">Latest 100 proposals · expired requests cannot be approved</span></div><section class="panel flush">${
      rows.length
        ? rows
            .map((a) => {
              const status = effectiveApprovalStatus(a);
              return `<article class="approval-card"><div><div class="approval-topline"><span class="eyebrow">REFUND PROPOSAL · ${e(shortId(a.id))}</span>${badge(status)}</div><h3>${e(a.ticket.customerRef)} · Duplicate-charge review</h3><p>${e(a.ticket.message)}</p><div class="metadata"><span>Payment <code>${e(a.action.parameters.paymentId)}</code></span><span>${status === 'pending' ? 'Expires' : 'Requested'} ${e(date(status === 'pending' ? a.expiresAt : a.requestedAt))}</span><a class="text-link" href="${routeLink('run', a.action.runId)}">Inspect evidence ↗</a></div>${a.decisionReason ? `<p class="small-text">Reviewer reason: ${e(a.decisionReason)}</p>` : ''}</div><div class="approval-value">${e(money(a.action.parameters.amountMinor, a.action.parameters.currency))}<small>Synthetic refund</small>${status === 'pending' ? button('Review proposal →', 'review', 'primary', `data-id="${e(a.id)}"`) : badge(a.action.businessOutcome)}</div></article>`;
            })
            .join('')
        : empty(
            state.filter === 'pending'
              ? 'Nothing waiting on your judgment'
              : 'No review history yet',
            'A qualifying duplicate-charge ticket creates a frozen refund proposal. Pending decisions will appear here.',
            button('Create a ticket', 'new-ticket', 'secondary'),
          )
    }</section>`
  );
}
const scenarios = [
  {
    id: 'fail-before-commit',
    title: 'Failure before the write',
    description:
      'The destination fails before storing a response. n8n retries the same logical action.',
    expected: 'Two attempts. One destination message. A verified outcome.',
    label: 'Bounded retry',
  },
  {
    id: 'commit-lost-response',
    title: 'The response goes missing',
    description:
      'The action commits, but its response is lost. The retry must reuse the same idempotency key.',
    expected:
      'A replay receipt—not a second message. Independent verification.',
    label: 'Idempotency',
  },
  {
    id: 'false-success',
    title: 'A convincing false success',
    description:
      'The simulated API reports success without storing the response. The verifier checks the actual destination.',
    expected:
      'Technical success. No destination message. Failed business outcome.',
    label: 'Verification',
  },
  {
    id: 'verification-unavailable',
    title: 'When the answer is unknown',
    description:
      'The action completes, but the first verification read is unavailable. Unknown must stay explicit.',
    expected: 'Unknown outcome, then a safe read-only reconciliation.',
    label: 'Recovery',
  },
];
function labPage() {
  return (
    heading(
      'CONTROLLED FAILURE · OBSERVABLE EVIDENCE',
      'Make it fail. Learn why.',
      'Four repeatable experiments for testing reliability beyond the happy path.',
      `<a class="button secondary" href="#tickets">Inspect tickets ↗</a>`,
    ) +
    `<div class="notice ${state.mode === 'LIVE AI MODE' ? 'warning' : ''}"><span class="notice-icon" aria-hidden="true">⌘</span><p><strong>Fixture-only experiments.</strong> Each run creates a new invoice-support ticket with explicit persisted fault configuration. It uses the existing n8n action workflow and never resets your data.${state.mode === 'LIVE AI MODE' ? ' Restart the API in fixture mode to enable these experiments.' : ''}</p></div><div class="scenario-grid">${scenarios.map((s, i) => `<article class="scenario-card"><div class="scenario-number"><span>EXPERIMENT 0${i + 1}</span>${badge(s.label, 'neutral')}</div><h2>${s.title}</h2><p>${s.description}</p><div class="scenario-expectation"><strong>EXPECTED, NOT YET OBSERVED</strong>${s.expected}</div>${button('Configure experiment <span aria-hidden="true">↗</span>', 'scenario', 'secondary', `data-id="${s.id}" ${state.mode !== 'FIXTURE MODE' ? 'disabled' : ''}`)}</article>`).join('')}</div><section class="panel feature-panel spaced"><span class="eyebrow">THE OPERATING PRINCIPLE</span><h2>Optimize for verified useful outcomes, not maximum automation.</h2><p>A workflow that escalates correctly may be better than one that automates more but produces unreliable outcomes.</p></section>`
  );
}
function definition(label, value, note) {
  return `<div class="metric-definition"><div><strong>${e(label)}</strong><p>${e(note)}</p></div><span class="value">${e(value)}</span></div>`;
}
function outcomesPage() {
  const m = state.metrics,
    rel = m.reliability;
  const minutesLabel = (value) =>
    value == null ? 'N/A' : `${Number(value).toFixed(2)} min`;
  return (
    heading(
      'AUTOMATION ECONOMICS',
      'Useful work. Measurable outcomes.',
      'Did this automation actually remove human work while still producing verified outcomes?',
      button('↻ Refresh', 'refresh'),
    ) +
    `<div class="toolbar"><div><h2>One cohort. Explicit denominators.</h2><span class="muted small-text">As of ${e(date(m.cohort.cutoff))} · no fixture/live mixing</span></div>${cohortControl()}</div>` +
    summaryMetrics() +
    `<div class="notice warning"><span class="notice-icon" aria-hidden="true">◇</span><p><strong>Verify outcomes. Measure human work separately.</strong> Effort requires explicit observations. Monetary cost remains unavailable. N/A means missing evidence—not zero effort, free inference, or savings.</p></div><div class="equal-columns"><section class="panel"><h2>Time & human effort</h2>${definition('End-to-end handling', duration(m.meanHandlingMs), 'Mean intake-to-last-verified-action time for fully resolved tickets only.')}${definition('Approval turnaround', duration(m.meanApprovalElapsedMs), 'Request to approved/rejected decision. Includes queue time; not active review time.')}${definition('Active human review', minutesLabel(m.activeReviewMinutes), 'Recorded operator-reported review subtotal; may have incomplete coverage. Not page-open time.')}${definition('Human minutes per ticket', minutesLabel(m.humanMinutesPerTicket), `${m.humanEffort?.observed?.completeTickets ?? 0}/${m.cohort.tickets} tickets have complete operator-reported coverage. Incomplete coverage stays N/A.`)}${definition('Estimated human minutes saved', minutesLabel(m.estimatedHumanMinutesSaved), `Measured matched baseline; ${m.humanEffort?.observed?.savings?.measured?.matchedResolvedTickets ?? 0} verified tickets. Negative values mean more work.`)}${definition('Synthetic-baseline savings estimate', minutesLabel(m.humanEffort?.observed?.savings?.synthetic?.minutesPerMatchedResolvedTicket), 'Operator-reported effort against an explicitly synthetic manual baseline. Not measured savings.')}${definition('Synthetic effort examples', m.humanEffort?.synthetic?.observedTickets ?? 0, 'Automated/test observations are excluded from measured labor and savings.')}</section><section class="panel"><h2>Reliability & recovery</h2>${definition('Failure rate', percent(rel.failureRate), `${rel.failedActions} currently failed actions / ${rel.attemptedActions} actions with an execution attempt.`)}${definition('Retry rate', percent(rel.retryRate), `${rel.retriedActions} actions with multiple attempts / ${rel.attemptedActions} attempted actions.`)}${definition('Recovered actions', rel.recoveredActions, 'Currently verified after a recorded execution failure, lost response, or unknown verification.')}${definition('Unknown outcomes', rel.currentUnknown, `${rel.everUnknown} runs have ever recorded unknown verification. Pending is a separate state.`)}${definition('Duplicate-prevention events', rel.duplicatePreventionEvents, 'Observed suppressed event deliveries plus idempotent action replays.')}</section><section class="panel"><h2>Provider economics</h2>${definition('Provider latency', duration(m.meanProviderLatencyMs), 'Mean recorded provider duration, including failed jobs. Fixture duration is not model latency.')}${definition('Model / runtime cost', 'N/A', 'No reliable monetary cost is recorded. Tokens alone are not a price.')}${definition('Cost per verified resolution', 'N/A', 'Requires complete, attributable cost data and a meaningful resolution denominator.')}</section><section class="panel feature-panel"><span class="eyebrow">READING THIS REPORT</span><h2>Count outcomes, not activity.</h2><p>${e(m.cohort.definition)}</p><p>Verified completion requires a resolved ticket with at least one action and every action verified. Fully automated additionally excludes tickets with human approval records. Escalation counts tickets currently routed to human follow-up.</p><p>These are current-state measurements, not a historical snapshot or proof of customer satisfaction. There are no dollar-savings estimates.</p><a class="text-link" href="#lab">Challenge the result in the lab ↗</a></section></div>`
  );
}
const pages = {
  overview: overviewPage,
  tickets: ticketsPage,
  ticket: ticketPage,
  run: runPage,
  approvals: approvalsPage,
  lab: labPage,
  outcomes: outcomesPage,
};
function render() {
  main.innerHTML = state.connected
    ? (pages[state.route] ?? overviewPage)()
    : welcomePage();
  connectState();
}
async function load({ quiet = false } = {}) {
  if (!state.connected) {
    render();
    return;
  }
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  if (!quiet) {
    main.setAttribute('aria-busy', 'true');
    main.innerHTML =
      '<div class="page-loader" role="status">Loading workspace evidence…</div>';
  }
  try {
    const tasks = [
      api('/api/v1/tickets', { signal }),
      api('/api/v1/approvals', { signal }),
      api(`/api/v1/metrics/outcomes?mode=${state.cohort}`, { signal }),
      api('/healthz', { signal }),
    ];
    if (['ticket', 'run'].includes(state.route))
      tasks.push(
        api(
          `/api/v1/${state.route === 'ticket' ? 'tickets' : 'runs'}/${encodeURIComponent(state.id)}`,
          { signal },
        ),
      );
    const [tickets, approvals, metrics, health, detail] =
      await Promise.all(tasks);
    if (signal.aborted) return;
    Object.assign(state, {
      tickets: tickets.tickets,
      approvals: approvals.approvals,
      metrics,
      mode: health.mode,
      detail,
    });
    // Ignore the observation timestamp so polling doesn't continually replace focused UI.
    const snapshot = JSON.stringify({
      tickets,
      approvals,
      mode: health.mode,
      metrics: { ...metrics, cohort: { ...metrics.cohort, cutoff: null } },
      detail,
      route: state.route,
      cohort: state.cohort,
    });
    if (!quiet || snapshot !== lastSnapshot) {
      lastSnapshot = snapshot;
      render();
    }
  } catch (error) {
    if (signal.aborted) return;
    if (quiet) {
      toast(
        'Refresh failed. Showing the last loaded evidence. Use Refresh to retry.',
      );
      return;
    }
    main.innerHTML =
      heading(
        'WORKSPACE CONNECTION',
        'Evidence is unavailable.',
        'No result is assumed when a request fails.',
      ) +
      `<section class="panel">${empty('Could not load this view', error.message, button('Try again', 'refresh', 'primary') + ' ' + button('Reconnect', 'connect'))}</section>`;
  } finally {
    if (!signal.aborted) main.removeAttribute('aria-busy');
  }
}
function route() {
  const [page, id = ''] = location.hash.slice(1).split('/');
  state.route = Object.hasOwn(pages, page) ? page : 'overview';
  state.id = id;
  state.filter = state.route === 'approvals' ? 'pending' : 'all';
  state.search = '';
  const nav = ['ticket', 'run'].includes(state.route) ? 'tickets' : state.route;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === nav) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const label = {
    overview: 'Overview',
    tickets: 'Tickets',
    ticket: 'Ticket detail',
    run: 'Run evidence',
    approvals: 'Approvals',
    lab: 'Reliability lab',
    outcomes: 'Outcomes',
  }[state.route];
  document.querySelector('#breadcrumb').textContent = label;
  document.title = `${label} · RelayDesk`;
  if (modal.open) modal.close();
  void load();
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function newTicketDialog() {
  if (!state.connected) return connectDialog();
  showModal(
    'Create a synthetic ticket',
    'START A WORKFLOW',
    `<p class="modal-intro">The backend stores the request and outbox event together. The outbox worker and n8n then pick it up. ${state.mode === 'LIVE AI MODE' ? '<strong>Live inference is enabled for this runtime.</strong>' : 'Fixture mode needs no model credentials.'}</p><form id="ticket-form"><div class="field"><label for="ticket-preset">Start from an example</label><select id="ticket-preset"><option value="invoice">Invoice download · automatic support</option><option value="duplicate">Duplicate charge · human approval</option><option value="account">Account mismatch · escalation</option><option value="ambiguous">Unclear charge · clarification</option><option value="custom">Write my own synthetic request</option></select></div><div class="field"><label for="customer-ref">Customer reference</label><input id="customer-ref" name="customerRef" value="CUSTOMER-001" pattern="[A-Za-z0-9_\\-]{1,64}" maxlength="64" required><small>CUSTOMER-001 and CUSTOMER-002 are seeded fictional customers.</small></div><div class="field"><label for="ticket-message">Customer message</label><textarea id="ticket-message" name="message" maxlength="8000" required>How can I download my invoice?</textarea><small>Use synthetic text only. Intake retries create separate tickets.</small></div><label class="check-label"><input type="checkbox" name="confirm" required><span>This request contains only synthetic data.${state.mode === 'LIVE AI MODE' ? ' I understand it will use live inference.' : ''}</span></label><p class="field-error" id="form-error" role="alert"></p><div class="form-actions"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button class="button primary" type="submit">Create ticket →</button></div></form>`,
  );
}
function reviewDialog(id) {
  const a = state.approvals.find((item) => item.id === id);
  if (!a || effectiveApprovalStatus(a) !== 'pending')
    return toast(
      'This request is no longer pending. Refresh to inspect its state.',
    );
  showModal(
    'Review the exact proposal',
    'HUMAN AUTHORIZATION',
    `<p class="modal-intro">A decision applies only to this frozen synthetic refund. Approval schedules an action; it does not certify success.</p><div class="proposal"><span class="eyebrow">PROPOSED REFUND</span><div class="amount">${e(money(a.action.parameters.amountMinor, a.action.parameters.currency))}</div><dl class="key-values compact"><dt>Customer</dt><dd>${e(a.action.parameters.customerId)}</dd><dt>Payment</dt><dd>${e(a.action.parameters.paymentId)}</dd><dt>Invoice</dt><dd>${e(a.action.parameters.invoiceId)}</dd><dt>Policy</dt><dd>${e(a.action.policyVersion)}</dd><dt>Expires</dt><dd>${e(date(a.expiresAt))}</dd></dl>${evidence('Bound proposal hash', a.proposalHash)}</div><form id="review-form" data-id="${e(a.id)}"><div class="field"><label for="review-decision">Your decision</label><select id="review-decision" name="decision" required><option value="">Choose a decision…</option><option value="approved">Approve this exact refund</option><option value="rejected">Reject this proposal</option></select></div><div class="field"><label for="review-reason">Reason for your decision</label><textarea id="review-reason" name="reason" minlength="1" maxlength="500" required placeholder="Record the evidence you reviewed and why this decision is appropriate."></textarea></div><label class="check-label"><input type="checkbox" required><span>I reviewed the customer, payment, amount, and policy evidence. This decision will be recorded in the audit trail.</span></label><p class="field-error" id="form-error" role="alert"></p><div class="form-actions"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button primary">Record decision</button></div></form>`,
  );
}
function effortDialog() {
  showModal(
    'Record active effort',
    'CUMULATIVE OBSERVATION · NOT WAIT TIME',
    `<p class="modal-intro">Record total active handling, review, follow-up and recovery for this ticket so far. A later snapshot replaces the previous total. Do not count queue time or an unattended open page. Automated test activity is synthetic, never human labor.</p>
    <form id="effort-form" data-ticket="${e(state.id)}" data-observation="${crypto.randomUUID()}">
    <div class="field"><label for="effort-source">Observation source</label><select id="effort-source" name="source"><option value="synthetic">Synthetic teaching example</option><option value="operator_reported">Operator-reported measurement</option></select></div>
    <div class="field"><label for="effort-total">Total active minutes</label><input id="effort-total" name="total" type="number" min="0" max="1440" step="0.01" required></div>
    <div class="field"><label for="effort-review">Review minutes included in total</label><input id="effort-review" name="review" type="number" min="0" max="1440" step="0.01" required></div>
    <div class="field"><label for="effort-note">Measurement method and scope</label><textarea id="effort-note" name="note" maxlength="300" required></textarea></div>
    <label class="check-label"><input type="checkbox" name="complete"><span>This snapshot covers all active work on the ticket so far. New work invalidates complete coverage.</span></label>
    <div class="field"><label for="effort-baseline-kind">Matched manual-only baseline</label><select id="effort-baseline-kind" name="baselineKind"><option value="none">Not available</option><option value="synthetic">Synthetic/configurable estimate</option><option value="measured">Measured on the same task and outcome</option></select></div>
    <div class="field"><label for="effort-baseline">Baseline minutes (when available)</label><input id="effort-baseline" name="baseline" type="number" min="0" max="1440" step="0.01"></div>
    <div class="field"><label for="effort-reference">Baseline method/version (when available)</label><input id="effort-reference" name="reference" maxlength="120"></div>
    <p class="field-error" id="form-error" role="alert"></p><div class="form-actions"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button class="button primary" type="submit">Save observation</button></div></form>`,
  );
}
function scenarioDialog(id) {
  const s = scenarios.find((item) => item.id === id);
  if (!s) return;
  showModal(
    s.title,
    'FIXTURE EXPERIMENT',
    `<p class="modal-intro">${e(s.description)}</p><div class="proposal"><span class="eyebrow">EXPERIMENT INPUT</span><p>“How can I download my invoice?”</p><p class="muted small-text">CUSTOMER-001 · Support-response action · Fixture mode</p><strong class="small-text">Expected: ${e(s.expected)}</strong></div><form id="scenario-form" data-id="${s.id}"><label class="check-label"><input type="checkbox" required><span>Create one synthetic ticket with this persisted fault. Existing data is preserved. The API, outbox worker, and imported n8n workflows must be running.</span></label><p class="field-error" id="form-error" role="alert"></p><div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit">Run experiment →</button></div></form>`,
  );
}
document.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.cohort) {
    state.cohort = target.dataset.cohort;
    await load();
    return;
  }
  if (target.dataset.filter) {
    state.filter = target.dataset.filter;
    render();
    main.querySelector(`[data-filter="${state.filter}"]`)?.focus();
    return;
  }
  const action = target.dataset.action;
  if (action === 'connect') connectDialog();
  if (action === 'close-modal') modal.close();
  if (action === 'refresh') await load();
  if (action === 'new-ticket') newTicketDialog();
  if (action === 'effort') effortDialog();
  if (action === 'review') reviewDialog(target.dataset.id);
  if (action === 'scenario') scenarioDialog(target.dataset.id);
  if (action === 'reconcile') {
    target.disabled = true;
    try {
      const result = await api(
        `/api/v1/runs/${encodeURIComponent(state.id)}/reconcile`,
        { method: 'POST' },
      );
      toast(`Reconciliation recorded: ${humanize(result.outcome)}.`);
      await load();
    } catch (error) {
      toast(error.message);
      target.disabled = false;
    }
  }
});
document.querySelector('#connect-button').addEventListener('click', () => {
  if (!state.connected) return connectDialog();
  controller?.abort();
  main.removeAttribute('aria-busy');
  state.token = '';
  state.connected = false;
  state.tickets = [];
  state.approvals = [];
  state.metrics = null;
  state.detail = null;
  lastSnapshot = '';
  render();
  toast('Disconnected. The token has been cleared from this tab.');
});
document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  main.focus();
});
document.addEventListener('input', (event) => {
  if (event.target.id !== 'ticket-search') return;
  state.search = event.target.value;
  const cursor = event.target.selectionStart;
  render();
  const input = document.querySelector('#ticket-search');
  input.focus();
  if (cursor !== null) input.setSelectionRange?.(cursor, cursor);
});
document.addEventListener('change', (event) => {
  if (event.target.id !== 'ticket-preset') return;
  const presets = {
    invoice: 'How can I download my invoice?',
    duplicate: 'I was charged twice this month.',
    account: 'My account still says Free even though I paid for Pro.',
    ambiguous: 'This charge looks wrong. Can you sort it out?',
    custom: '',
  };
  document.querySelector('#ticket-message').value =
    presets[event.target.value] ?? '';
});
modal.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const submit = form.querySelector('[type="submit"]');
  if (submit.disabled) return;
  submit.disabled = true;
  document.querySelector('#form-error').textContent = '';
  const ownsDialog = () => {
    if (form.isConnected && modal.open) return true;
    toast('Request completed after the dialog closed. Refresh the workspace to inspect its result before retrying.');
    return false;
  };
  try {
    if (form.id === 'connect-form') {
      const candidate = String(data.get('token')).trim();
      await api('/readyz', { headers: { Authorization: `Bearer ${candidate}` } });
      if (!form.isConnected || !modal.open) return;
      state.token = candidate;
      state.connected = true;
      modal.close();
      await load();
      toast('Connected to your local workspace.');
    } else if (form.id === 'ticket-form') {
      const result = await api('/api/v1/tickets', {
        method: 'POST',
        body: JSON.stringify({
          customerRef: String(data.get('customerRef')).trim(),
          message: String(data.get('message')).trim(),
        }),
      });
      if (!ownsDialog()) return;
      modal.close();
      location.hash = routeLink('ticket', result.ticketId);
      toast(
        'Ticket created. Waiting for the outbox worker and n8n to process it.',
      );
    } else if (form.id === 'effort-form') {
      const baselineKind = data.get('baselineKind');
      if (
        baselineKind !== 'none' &&
        (!String(data.get('baseline')).trim() ||
          !String(data.get('reference')).trim())
      )
        throw new Error(
          'Provide baseline minutes and its method/version, or choose Not available.',
        );
      await api(
        `/api/v1/tickets/${encodeURIComponent(form.dataset.ticket)}/effort`,
        {
          method: 'POST',
          body: JSON.stringify({
            observationId: form.dataset.observation,
            source: data.get('source'),
            totalMinutes: Number(data.get('total')),
            reviewMinutes: Number(data.get('review')),
            complete: data.get('complete') === 'on',
            note: String(data.get('note')).trim(),
            baseline:
              baselineKind === 'none'
                ? null
                : {
                    kind: baselineKind,
                    minutes: Number(data.get('baseline')),
                    reference: String(data.get('reference')).trim(),
                  },
          }),
        },
      );
      if (!ownsDialog()) return;
      modal.close();
      await load();
      toast('Effort observation saved with its measurement source.');
    } else if (form.id === 'review-form') {
      await api(
        `/api/v1/approvals/${encodeURIComponent(form.dataset.id)}/decision`,
        {
          method: 'POST',
          body: JSON.stringify({
            decision: data.get('decision'),
            reason: String(data.get('reason')).trim(),
          }),
        },
      );
      if (!ownsDialog()) return;
      modal.close();
      await load();
      toast(
        'Decision recorded. Inspect the run for the independently verified result.',
      );
    } else if (form.id === 'scenario-form') {
      const result = await api(
        `/api/v1/scenarios/${encodeURIComponent(form.dataset.id)}/start`,
        {
          method: 'POST',
          body: JSON.stringify({
            customerRef: 'CUSTOMER-001',
            message: 'How can I download my invoice?',
          }),
        },
      );
      if (!ownsDialog()) return;
      modal.close();
      location.hash = routeLink('run', result.runId);
      toast(
        'Experiment created. Its outcome will come from the actual workflow evidence.',
      );
    }
  } catch (error) {
    if (!form.isConnected || !modal.open) {
      if (form.id !== 'connect-form') toast('The closed request did not confirm success. Refresh and inspect the workspace before retrying.');
      return;
    }
    const output = form.querySelector('#form-error');
    if (output) output.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
window.addEventListener('hashchange', route);
setInterval(() => {
  // Don't disturb an operator who is typing, reviewing a dialog, or navigating by keyboard.
  const focusedControl =
    main.contains(document.activeElement) &&
    document.activeElement?.matches('a,button,input,select,textarea,summary');
  if (
    state.connected &&
    !document.hidden &&
    !modal.open &&
    !focusedControl &&
    !main.querySelector('details[open]') &&
    !main.hasAttribute('aria-busy')
  )
    void load({ quiet: true });
}, 8000);
async function boot() {
  try {
    const health = await fetch('/healthz', { cache: 'no-store' });
    if (!health.ok) throw new Error();
    state.mode = (await health.json()).mode;
  } catch {
    state.mode = null;
  }
  route();
}
void boot();
