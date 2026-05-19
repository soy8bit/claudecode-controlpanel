// server/modules/analytics/services/pricing.service.ts
import type { ModelPricing } from '@/modules/analytics/types.js';

// Prices in USD per 1,000,000 tokens. Update manually as Anthropic publishes
// new tiers. Unknown models fall back to 0 cost + a warning at ingest time.
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7':   { input: 15.0, output: 75.0, cacheRead: 1.5,  cacheCreate: 18.75 },
  'claude-sonnet-4-6': { input:  3.0, output: 15.0, cacheRead: 0.3,  cacheCreate:  3.75 },
  'claude-haiku-4-5':  { input:  1.0, output:  5.0, cacheRead: 0.1,  cacheCreate:  1.25 },
};

export interface CostInputs {
  model?: string;
  tokensInput?: number;
  tokensOutput?: number;
  tokensCacheRead?: number;
  tokensCacheCreate?: number;
}

const PER_MILLION = 1_000_000;

export function calculateEventCost(inputs: CostInputs): number {
  if (!inputs.model) return 0;

  // Match exact id first, then by prefix (e.g. "claude-sonnet-4-6-20251101").
  const pricing =
    MODEL_PRICING[inputs.model] ??
    Object.entries(MODEL_PRICING).find(([id]) => inputs.model!.startsWith(id))?.[1];

  if (!pricing) return 0;

  return (
    ((inputs.tokensInput        ?? 0) * pricing.input) / PER_MILLION +
    ((inputs.tokensOutput       ?? 0) * pricing.output) / PER_MILLION +
    ((inputs.tokensCacheRead    ?? 0) * pricing.cacheRead) / PER_MILLION +
    ((inputs.tokensCacheCreate  ?? 0) * pricing.cacheCreate) / PER_MILLION
  );
}

export function calculateSessionCost(events: CostInputs[]): number {
  return events.reduce((sum, e) => sum + calculateEventCost(e), 0);
}
