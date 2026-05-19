// src/components/analytics/utils/pricing-client.ts
import type { ModelPricing } from './pricing-types';

export const MODEL_PRICING_CLIENT: Record<string, ModelPricing> = {
  'claude-opus-4-7':   { input: 15.0, output: 75.0, cacheRead: 1.5,  cacheCreate: 18.75 },
  'claude-sonnet-4-6': { input:  3.0, output: 15.0, cacheRead: 0.3,  cacheCreate:  3.75 },
  'claude-haiku-4-5':  { input:  1.0, output:  5.0, cacheRead: 0.1,  cacheCreate:  1.25 },
};
