// server/modules/analytics/services/ingest.service.ts
import path from 'node:path';
import { stat } from 'node:fs/promises';

import { analyticsRepository } from '@/modules/analytics/repositories/analytics.repository.js';
import { parseJsonlFile } from '@/modules/analytics/services/jsonl-parser.service.js';
import { calculateSessionCost } from '@/modules/analytics/services/pricing.service.js';
import type { IngestResult } from '@/modules/analytics/types.js';

export async function ingestJsonlFile(jsonlPath: string): Promise<IngestResult> {
  const now = Date.now();
  let stats;
  try {
    stats = await stat(jsonlPath);
  } catch {
    return { jsonlPath, newEvents: 0, newOffset: 0, errors: 1 };
  }

  const log = analyticsRepository.getIngestLog(jsonlPath);
  const startOffset = log?.last_offset ?? 0;

  // Cheap skip if nothing new since last ingest.
  if (log && log.last_mtime === stats.mtimeMs && startOffset >= stats.size) {
    return { jsonlPath, newEvents: 0, newOffset: startOffset, errors: 0 };
  }

  let parsed;
  try {
    parsed = await parseJsonlFile(jsonlPath, startOffset);
  } catch {
    analyticsRepository.upsertIngestLog(jsonlPath, startOffset, stats.mtimeMs, now, 1);
    return { jsonlPath, newEvents: 0, newOffset: startOffset, errors: 1 };
  }

  if (!parsed.meta.sessionId) {
    // Could not derive a sessionId — record the offset to avoid re-reading.
    analyticsRepository.upsertIngestLog(jsonlPath, parsed.endOffset, stats.mtimeMs, now, 1);
    return { jsonlPath, newEvents: 0, newOffset: parsed.endOffset, errors: 1 };
  }

  const projectName = parsed.meta.projectPath ? path.basename(parsed.meta.projectPath) : 'unknown';
  if (parsed.meta.projectPath) {
    analyticsRepository.upsertProject({ path: parsed.meta.projectPath, name: projectName, nowMs: now });
  }
  analyticsRepository.upsertSession(parsed.meta, jsonlPath, stats.mtimeMs, stats.size);
  analyticsRepository.insertEvents(parsed.meta.sessionId, parsed.events);
  analyticsRepository.recomputeSessionAggregates(parsed.meta.sessionId);

  const eventsForCost = analyticsRepository.loadEventsForCost(parsed.meta.sessionId).map(r => ({
    model: r.model ?? undefined,
    tokensInput: r.tokens_input ?? undefined,
    tokensOutput: r.tokens_output ?? undefined,
    tokensCacheRead: r.tokens_cache_read ?? undefined,
    tokensCacheCreate: r.tokens_cache_create ?? undefined,
  }));
  analyticsRepository.setSessionCost(parsed.meta.sessionId, calculateSessionCost(eventsForCost));

  analyticsRepository.upsertIngestLog(jsonlPath, parsed.endOffset, stats.mtimeMs, now, 0);

  return { jsonlPath, newEvents: parsed.events.length, newOffset: parsed.endOffset, errors: 0 };
}
