// server/modules/analytics/watcher/projects.watcher.ts
import os from 'node:os';
import path from 'node:path';
import { FSWatcher, watch } from 'chokidar';

import { ingestJsonlFile } from '@/modules/analytics/services/ingest.service.js';

const DEBOUNCE_MS = 1_000;
const projectsRoot = path.join(os.homedir(), '.claude', 'projects');

let watcher: FSWatcher | null = null;
const pending = new Map<string, NodeJS.Timeout>();

const schedule = (filePath: string) => {
  const existing = pending.get(filePath);
  if (existing) clearTimeout(existing);
  pending.set(filePath, setTimeout(async () => {
    pending.delete(filePath);
    try {
      await ingestJsonlFile(filePath);
    } catch (err: any) {
      console.error('[analytics] ingest failed', filePath, err?.message);
    }
  }, DEBOUNCE_MS));
};

export async function startProjectsWatcher(): Promise<void> {
  if (watcher) return;
  watcher = watch(`${projectsRoot}/**/*.jsonl`, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
  });
  watcher
    .on('add', schedule)
    .on('change', schedule)
    .on('error', (err) => console.error('[analytics] watcher error', err));
  console.log('[analytics] watcher started for', projectsRoot);
}

export async function stopProjectsWatcher(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
}
