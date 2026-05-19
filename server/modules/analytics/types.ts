// server/modules/analytics/types.ts
export type EventType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_use'
  | 'tool_result'
  | 'subagent_start'
  | 'subagent_end'
  | 'system';

export interface ParsedEvent {
  ts: number;                       // unix ms
  type: EventType;
  toolName?: string;
  agentName?: string;
  model?: string;
  tokensInput?: number;
  tokensOutput?: number;
  tokensCacheRead?: number;
  tokensCacheCreate?: number;
  durationMs?: number;
  isError?: boolean;
  rawOffset: number;                // byte offset en el JSONL
}

export interface ParsedSessionMeta {
  sessionId: string;
  projectPath: string;
  startedAt: number;
  endedAt?: number;
  model?: string;
}

export interface ModelPricing {
  input: number;                    // USD per 1M tokens
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

export interface IngestResult {
  jsonlPath: string;
  newEvents: number;
  newOffset: number;
  errors: number;
}

export interface DateRange {
  from: number;                     // unix ms inclusive
  to: number;                       // unix ms exclusive
}

export interface OverviewResponse {
  range: DateRange;
  sessions: number;
  messages: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheCreate: number;
  estimatedCostUsd: number;
  sparkline: Array<{ ts: number; messages: number; tokens: number; cost: number }>;
}
