// server/modules/analytics/services/aggregator.service.ts
import { getConnection } from '@/modules/database/connection.js';
import type { DateRange, OverviewResponse } from '@/modules/analytics/types.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function resolveRange(range: string, fromQ?: string, toQ?: string): DateRange {
  const now = Date.now();
  if (range === 'custom') {
    const from = fromQ ? Date.parse(fromQ) : now - 30 * DAY_MS;
    const to   = toQ   ? Date.parse(toQ)   : now;
    return { from, to };
  }
  const map: Record<string, number> = { today: DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS };
  const span = map[range] ?? 7 * DAY_MS;
  return { from: now - span, to: now };
}

export const aggregatorService = {
  overview(range: DateRange): OverviewResponse {
    const db = getConnection();
    const totals = db.prepare(`
      SELECT
        COUNT(DISTINCT s.id) AS sessions,
        COALESCE(SUM(CASE WHEN e.type IN ('user_message','assistant_message') THEN 1 ELSE 0 END), 0) AS messages,
        COALESCE(SUM(e.tokens_input), 0)        AS tokens_input,
        COALESCE(SUM(e.tokens_output), 0)       AS tokens_output,
        COALESCE(SUM(e.tokens_cache_read), 0)   AS tokens_cache_read,
        COALESCE(SUM(e.tokens_cache_create), 0) AS tokens_cache_create
      FROM analytics_events e
      JOIN analytics_sessions s ON s.id = e.session_id
      WHERE e.ts >= ? AND e.ts < ?
    `).get(range.from, range.to) as any;

    const cost = db.prepare(`
      SELECT COALESCE(SUM(estimated_cost_usd), 0) AS cost
      FROM analytics_sessions
      WHERE started_at >= ? AND started_at < ?
    `).get(range.from, range.to) as any;

    // Sparkline: bucketed by day (or hour if range <= 2 days).
    const spanMs = range.to - range.from;
    const bucketMs = spanMs <= 2 * DAY_MS ? HOUR_MS : DAY_MS;

    const sparkRows = db.prepare(`
      SELECT
        (e.ts / ?) * ? AS bucket,
        COALESCE(SUM(CASE WHEN e.type IN ('user_message','assistant_message') THEN 1 ELSE 0 END), 0) AS msgs,
        COALESCE(SUM(COALESCE(e.tokens_input,0) + COALESCE(e.tokens_output,0)), 0) AS toks
      FROM analytics_events e
      WHERE e.ts >= ? AND e.ts < ?
      GROUP BY bucket
      ORDER BY bucket ASC
    `).all(bucketMs, bucketMs, range.from, range.to) as Array<{ bucket: number; msgs: number; toks: number }>;

    const costByDay = db.prepare(`
      SELECT (started_at / ?) * ? AS bucket, COALESCE(SUM(estimated_cost_usd), 0) AS cost
      FROM analytics_sessions
      WHERE started_at >= ? AND started_at < ?
      GROUP BY bucket
    `).all(bucketMs, bucketMs, range.from, range.to) as Array<{ bucket: number; cost: number }>;

    const costMap = new Map(costByDay.map(r => [r.bucket, r.cost]));
    const sparkline = sparkRows.map(r => ({
      ts: r.bucket,
      messages: r.msgs,
      tokens: r.toks,
      cost: costMap.get(r.bucket) ?? 0,
    }));

    return {
      range,
      sessions: totals.sessions,
      messages: totals.messages,
      tokensInput: totals.tokens_input,
      tokensOutput: totals.tokens_output,
      tokensCacheRead: totals.tokens_cache_read,
      tokensCacheCreate: totals.tokens_cache_create,
      estimatedCostUsd: cost.cost,
      sparkline,
    };
  },

  projects(range: DateRange) {
    const db = getConnection();
    return db.prepare(`
      SELECT
        p.id, p.name, p.path, p.last_seen,
        COUNT(s.id) AS sessions,
        COALESCE(SUM(s.tokens_input + s.tokens_output), 0) AS tokens,
        COALESCE(SUM(s.estimated_cost_usd), 0) AS cost
      FROM analytics_projects p
      LEFT JOIN analytics_sessions s
        ON s.project_id = p.id AND s.started_at >= ? AND s.started_at < ?
      GROUP BY p.id
      HAVING sessions > 0
      ORDER BY cost DESC
    `).all(range.from, range.to);
  },

  agents(range: DateRange) {
    const db = getConnection();
    // For each subagent_start, find the matching subagent_end OR the next event
    // in the same session, and sum token cost / count tool_use events between them.
    return db.prepare(`
      WITH starts AS (
        SELECT id, session_id, ts, agent_name
        FROM analytics_events
        WHERE type = 'subagent_start' AND ts >= ? AND ts < ?
      ),
      bounded AS (
        SELECT
          s.agent_name,
          s.session_id,
          s.ts AS start_ts,
          (SELECT MIN(e.ts) FROM analytics_events e
             WHERE e.session_id = s.session_id AND e.ts > s.ts AND e.type = 'subagent_end') AS end_ts
        FROM starts s
      )
      SELECT
        agent_name,
        COUNT(*) AS invocations,
        COALESCE(AVG(CASE WHEN end_ts IS NOT NULL THEN end_ts - start_ts END), 0) AS avg_duration_ms,
        (SELECT COUNT(*) FROM analytics_events e2
           JOIN starts s2 ON s2.agent_name = bounded.agent_name AND s2.session_id = e2.session_id
           WHERE e2.type = 'tool_use' AND e2.ts >= s2.ts) AS tool_calls
      FROM bounded
      GROUP BY agent_name
      ORDER BY invocations DESC
    `).all(range.from, range.to);
  },

  tools(range: DateRange) {
    const db = getConnection();
    return db.prepare(`
      SELECT
        tool_name,
        COUNT(*) AS calls,
        SUM(is_error) AS errors
      FROM analytics_events
      WHERE type = 'tool_use'
        AND tool_name IS NOT NULL
        AND ts >= ? AND ts < ?
      GROUP BY tool_name
      ORDER BY calls DESC
    `).all(range.from, range.to);
  },

  costs(range: DateRange) {
    const db = getConnection();
    const byModel = db.prepare(`
      SELECT
        COALESCE(e.model, 'unknown') AS model,
        COALESCE(SUM(e.tokens_input), 0)        AS tokens_input,
        COALESCE(SUM(e.tokens_output), 0)       AS tokens_output,
        COALESCE(SUM(e.tokens_cache_read), 0)   AS tokens_cache_read,
        COALESCE(SUM(e.tokens_cache_create), 0) AS tokens_cache_create
      FROM analytics_events e
      WHERE e.ts >= ? AND e.ts < ?
        AND (e.tokens_input IS NOT NULL OR e.tokens_output IS NOT NULL)
      GROUP BY model
      ORDER BY (tokens_input + tokens_output) DESC
    `).all(range.from, range.to);

    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(estimated_cost_usd), 0) AS cost,
        COALESCE(SUM(tokens_cache_read), 0) AS cache_read_tokens
      FROM analytics_sessions
      WHERE started_at >= ? AND started_at < ?
    `).get(range.from, range.to) as any;

    return { byModel, totalCost: totals.cost, cacheReadTokens: totals.cache_read_tokens };
  },
};
