// Escape every API-sourced value before inserting template markup.
export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
export const humanize = (value) =>
  String(value ?? 'not recorded')
    .replaceAll('_', ' ')
    .replaceAll('.', ' · ');
export const percent = (value) =>
  value == null ? 'N/A' : `${Math.round(value * 100)}%`;
export function duration(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'N/A';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}
export const money = (minor, currency = 'USD') =>
  typeof minor === 'number' && Number.isFinite(minor)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
        minor / 100,
      )
    : 'N/A';
export const shortId = (id) =>
  String(id ?? '')
    .slice(0, 8)
    .toUpperCase();
export function statusTone(status) {
  if (
    [
      'resolved',
      'verified',
      'approved',
      'completed',
      'committed',
      'idempotent_replay',
      'delivered',
    ].includes(status)
  )
    return 'green';
  if (
    [
      'failed',
      'rejected',
      'expired',
      'failed_before_commit',
      'success_without_mutation',
    ].includes(status)
  )
    return 'red';
  if (
    [
      'pending_approval',
      'pending',
      'unknown',
      'human_follow_up',
      'awaiting_customer',
      'committed_response_lost',
    ].includes(status)
  )
    return 'amber';
  return 'neutral';
}
export const effectiveApprovalStatus = (approval, now = Date.now()) =>
  approval.status === 'pending' && new Date(approval.expiresAt).getTime() <= now
    ? 'expired'
    : approval.status;
