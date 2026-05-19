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

export interface ProjectRow {
  id: string;
  name: string;
  path: string;
  last_seen: number;
  sessions: number;
  tokens: number;
  cost: number;
}

export interface ProjectsResponse {
  range: { from: number; to: number };
  projects: ProjectRow[];
}

export interface AgentRow {
  agent_name: string;
  invocations: number;
  avg_duration_ms: number;
  tool_calls: number;
}

export interface AgentsResponse {
  range: { from: number; to: number };
  agents: AgentRow[];
}
