// server/modules/analytics/analytics.routes.ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import express, { type Request, type Response } from 'express';

import { aggregatorService, resolveRange } from '@/modules/analytics/services/aggregator.service.js';
import { ingestJsonlFile } from '@/modules/analytics/services/ingest.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';
import { getConnection } from '@/modules/database/connection.js';

const walkJsonl = async (dir: string): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) result.push(...await walkJsonl(full));
    else if (e.isFile() && e.name.endsWith('.jsonl')) result.push(full);
  }
  return result;
};

const router = express.Router();

const readRange = (req: Request) => {
  const range = (req.query.range as string | undefined) ?? '7d';
  const from = req.query.from as string | undefined;
  const to   = req.query.to as string | undefined;
  if (range !== 'today' && range !== '7d' && range !== '30d' && range !== 'custom') {
    throw new AppError(`Unsupported range "${range}".`, { code: 'INVALID_RANGE', statusCode: 400 });
  }
  return resolveRange(range, from, to);
};

router.get('/overview', asyncHandler(async (req: Request, res: Response) => {
  const range = readRange(req);
  res.json(createApiSuccessResponse(aggregatorService.overview(range)));
}));

router.get('/projects', asyncHandler(async (req: Request, res: Response) => {
  const range = readRange(req);
  res.json(createApiSuccessResponse({ range, projects: aggregatorService.projects(range) }));
}));

router.get('/agents', asyncHandler(async (req: Request, res: Response) => {
  const range = readRange(req);
  res.json(createApiSuccessResponse({ range, agents: aggregatorService.agents(range) }));
}));

router.get('/health', asyncHandler(async (_req: Request, res: Response) => {
  const db = getConnection();
  const log = db.prepare(`
    SELECT COUNT(*) AS files,
           COALESCE(MAX(last_ingest), 0) AS last_ingest,
           COALESCE(SUM(error_count), 0) AS errors
    FROM analytics_ingest_log
  `).get() as any;
  const sessions = db.prepare('SELECT COUNT(*) AS n FROM analytics_sessions').get() as any;
  res.json(createApiSuccessResponse({ ...log, sessions: sessions.n }));
}));

router.post('/reindex', asyncHandler(async (_req: Request, res: Response) => {
  const db = getConnection();
  db.exec('UPDATE analytics_ingest_log SET last_offset = 0, last_mtime = 0, error_count = 0');
  db.exec('DELETE FROM analytics_events');
  db.exec('DELETE FROM analytics_sessions');
  db.exec('DELETE FROM analytics_projects');

  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  let files: string[] = [];
  try { files = await walkJsonl(projectsRoot); } catch { /* dir doesn't exist */ }
  const results = await Promise.all(files.map(f => ingestJsonlFile(f)));
  res.json(createApiSuccessResponse({
    cleared: true,
    scanned: files.length,
    newEvents: results.reduce((s, r) => s + r.newEvents, 0),
    errors: results.reduce((s, r) => s + r.errors, 0),
  }));
}));

export default router;
export { ingestJsonlFile }; // re-exposed for the bootstrap helper
