// server/modules/analytics/tests/pricing.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateEventCost, calculateSessionCost } from '@/modules/analytics/services/pricing.service.js';

test('pricing: calculates input/output cost for known model', () => {
  const cost = calculateEventCost({
    model: 'claude-sonnet-4-6',
    tokensInput: 1_000_000,
    tokensOutput: 0,
    tokensCacheRead: 0,
    tokensCacheCreate: 0,
  });
  assert.equal(cost, 3.0);
});

test('pricing: combines all four token kinds', () => {
  const cost = calculateEventCost({
    model: 'claude-sonnet-4-6',
    tokensInput: 1_000_000,
    tokensOutput: 1_000_000,
    tokensCacheRead: 1_000_000,
    tokensCacheCreate: 1_000_000,
  });
  // 3 + 15 + 0.30 + 3.75
  assert.equal(Math.round(cost * 100) / 100, 22.05);
});

test('pricing: unknown model returns 0', () => {
  const cost = calculateEventCost({
    model: 'unknown-model-xyz',
    tokensInput: 1_000_000,
  });
  assert.equal(cost, 0);
});

test('pricing: undefined fields treated as 0', () => {
  const cost = calculateEventCost({ model: 'claude-haiku-4-5' });
  assert.equal(cost, 0);
});

test('pricing: session cost sums event costs', () => {
  const total = calculateSessionCost([
    { model: 'claude-sonnet-4-6', tokensInput: 500_000 },
    { model: 'claude-sonnet-4-6', tokensOutput: 200_000 },
  ]);
  // 1.5 + 3 = 4.5
  assert.equal(total, 4.5);
});
