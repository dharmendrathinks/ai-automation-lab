import { expect, test } from 'vitest';
import { developmentCases } from '../../../fixtures/evaluation/development.js';
import { heldOutCases } from '../../../fixtures/evaluation/held-out.js';

test('evaluation has 20 development and 80 distinct held-out inputs, not repeated calls', () => {
  expect(developmentCases).toHaveLength(20); expect(heldOutCases).toHaveLength(80);
  const all = [...developmentCases, ...heldOutCases];
  expect(new Set(all.map(c => c.id)).size).toBe(100);
  expect(new Set(all.map(c => c.message.trim().toLowerCase())).size).toBe(100);
  for (const c of all) {
    expect(c.categories.length).toBeGreaterThan(0); expect(c.intents.length).toBeGreaterThan(0);
    if (c.action === 'investigate_refund') expect(c.review).toBe(true);
  }
});
