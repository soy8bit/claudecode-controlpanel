// server/modules/analytics/repositories/analytics.repository.ts
import crypto from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';
import type { ParsedEvent, ParsedSessionMeta } from '@/modules/analytics/types.js';

const projectIdFromPath = (p: string): string =>
  crypto.createHash('sha1').update(p).digest('hex').slice(0, 16);

export const analyticsRepository = {
  upsertProject(p: { path: string; name: string; nowMs: number }): string {
    const id = projectIdFromPath(p.path);
    const db = getConnection();
    db.prepare(`
      INSERT INTO analytics_projects (id, name, path, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen, name = excluded.name
    `).run(id, p.name, p.path, p.nowMs, p.nowMs);
    return id;
  },

  upsertSession(meta: ParsedSessionMeta, jsonlPath: string, jsonlMtime: number, jsonlSize: number): void {
    const db = getConnection();
    const projectId = meta.projectPath ? projectIdFromPath(meta.projectPath) : null;
    db.prepare(`
      INSERT INTO analytics_sessions (
        id, project_id, started_at, ended_at, model,
        jsonl_path, jsonl_mtime, jsonl_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        ended_at    = excluded.ended_at,
        model       = COALESCE(excluded.model, analytics_sessions.model),
        jsonl_mtime = excluded.jsonl_mtime,
        jsonl_size  = excluded.jsonl_size
    `).run(
      meta.sessionId, projectId, meta.startedAt, meta.endedAt ?? null,
      meta.model ?? null, jsonlPath, jsonlMtime, jsonlSize,
    );
  },

  insertEvents(sessionId: string, events: ParsedEvent[]): void {
    if (events.length === 0) return;
    const db = getConnection();
    const stmt = db.prepare(`
      INSERT INTO analytics_events (
        session_id, ts, type, tool_name, agent_name, model,
        tokens_input, tokens_output, tokens_cache_read, tokens_cache_create,
        duration_ms, is_error, raw_offset
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((rows: ParsedEvent[]) => {
      for (const e of rows) {
        stmt.run(
          sessionId, e.ts, e.type,
          e.toolName ?? null, e.agentName ?? null, e.model ?? null,
          e.tokensInput ?? null, e.tokensOutput ?? null,
          e.tokensCacheRead ?? null, e.tokensCacheCreate ?? null,
          e.durationMs ?? null,
          e.isError ? 1 : 0,
          e.rawOffset,
        );
      }
    });
    insertMany(events);
  },

  recomputeSessionAggregates(sessionId: string): void {
    const db = getConnection();
    db.prepare(`
      UPDATE analytics_sessions SET
        tokens_input        = COALESCE((SELECT SUM(tokens_input)         FROM analytics_events WHERE session_id = ?), 0),
        tokens_output       = COALESCE((SELECT SUM(tokens_output)        FROM analytics_events WHERE session_id = ?), 0),
        tokens_cache_read   = COALESCE((SELECT SUM(tokens_cache_read)    FROM analytics_events WHERE session_id = ?), 0),
        tokens_cache_create = COALESCE((SELECT SUM(tokens_cache_create)  FROM analytics_events WHERE session_id = ?), 0),
        message_count       = (SELECT COUNT(*) FROM analytics_events WHERE session_id = ? AND type IN ('user_message','assistant_message')),
        tool_call_count     = (SELECT COUNT(*) FROM analytics_events WHERE session_id = ? AND type = 'tool_use'),
        subagent_count      = (SELECT COUNT(*) FROM analytics_events WHERE session_id = ? AND type = 'subagent_start')
      WHERE id = ?
    `).run(sessionId, sessionId, sessionId, sessionId, sessionId, sessionId, sessionId, sessionId);
  },

  setSessionCost(sessionId: string, cost: number): void {
    const db = getConnection();
    db.prepare('UPDATE analytics_sessions SET estimated_cost_usd = ? WHERE id = ?').run(cost, sessionId);
  },

  getIngestLog(jsonlPath: string): { last_offset: number; last_mtime: number } | undefined {
    const db = getConnection();
    return db.prepare('SELECT last_offset, last_mtime FROM analytics_ingest_log WHERE jsonl_path = ?')
      .get(jsonlPath) as { last_offset: number; last_mtime: number } | undefined;
  },

  upsertIngestLog(jsonlPath: string, lastOffset: number, lastMtime: number, nowMs: number, errors = 0): void {
    const db = getConnection();
    db.prepare(`
      INSERT INTO analytics_ingest_log (jsonl_path, last_offset, last_mtime, last_ingest, error_count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jsonl_path) DO UPDATE SET
        last_offset = excluded.last_offset,
        last_mtime  = excluded.last_mtime,
        last_ingest = excluded.last_ingest,
        error_count = analytics_ingest_log.error_count + excluded.error_count
    `).run(jsonlPath, lastOffset, lastMtime, nowMs, errors);
  },

  loadEventsForCost(sessionId: string): Array<{ model: string | null; tokens_input: number | null; tokens_output: number | null; tokens_cache_read: number | null; tokens_cache_create: number | null }> {
    const db = getConnection();
    return db.prepare(`
      SELECT model, tokens_input, tokens_output, tokens_cache_read, tokens_cache_create
      FROM analytics_events
      WHERE session_id = ?
        AND (tokens_input IS NOT NULL OR tokens_output IS NOT NULL
             OR tokens_cache_read IS NOT NULL OR tokens_cache_create IS NOT NULL)
    `).all(sessionId) as any[];
  },
};
