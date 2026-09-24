import { expect, test } from 'vitest';
import {
  duration,
  effectiveApprovalStatus,
  escapeHtml,
  money,
  percent,
  statusTone,
} from './format.js';

test('escapes untrusted customer and evidence content for markup and attributes', () => {
  expect(escapeHtml('<img src=x onerror="alert(1)"> & \'')).toBe(
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;',
  );
  expect(escapeHtml(null)).toBe('');
});
test('missing measurements stay N/A, while observed zero is shown as zero', () => {
  expect(percent(null)).toBe('N/A');
  expect(percent(0)).toBe('0%');
  expect(duration(null)).toBe('N/A');
  expect(duration(0)).toBe('0 ms');
  expect(duration(65_000)).toBe('1.1 min');
  expect(duration(7_200_000)).toBe('2.0 h');
  expect(money(null)).toBe('N/A');
  expect(money(2900, 'USD')).toBe('$29.00');
});
test('expired pending proposals cannot appear reviewable', () => {
  const approval = { status: 'pending', expiresAt: '2026-09-23T12:00:00Z' };
  expect(
    effectiveApprovalStatus(approval, Date.parse('2026-09-23T12:00:00Z')),
  ).toBe('expired');
  expect(
    effectiveApprovalStatus(approval, Date.parse('2026-09-23T11:00:00Z')),
  ).toBe('pending');
  expect(
    effectiveApprovalStatus(
      { ...approval, status: 'approved' },
      Date.parse('2026-09-24T12:00:00Z'),
    ),
  ).toBe('approved');
});
test('unknown and pending are not rendered as verified success', () => {
  expect(statusTone('unknown')).toBe('amber');
  expect(statusTone('pending_approval')).toBe('amber');
  expect(statusTone('verified')).toBe('green');
  expect(statusTone('failed')).toBe('red');
});
