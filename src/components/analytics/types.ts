// src/components/analytics/types.ts
export type RangePreset = 'today' | '7d' | '30d' | 'custom';

export interface OverviewSparkPoint {
  ts: number;
  messages: number;
  tokens: number;
  cost: number;
}

export interface OverviewResponse {
  range: { from: number; to: number };
  sessions: number;
  messages: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheCreate: number;
  estimatedCostUsd: number;
  sparkline: OverviewSparkPoint[];
}

export type AnalyticsTab = 'overview' | 'projects' | 'agents' | 'costs' | 'tools';
