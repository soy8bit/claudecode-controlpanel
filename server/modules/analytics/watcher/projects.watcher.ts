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

const isJsonl = (filePath: string) => filePath.endsWith('.jsonl');

export async function startProjectsWatcher(): Promise<void> {
  if (watcher) return;
  // Watch the directory recursively and filter by extension at the callback level.
  // We deliberately avoid a glob string here because mixing Windows-style backslashes
  // with forward-slash glob patterns silently broke discovery on Windows.
  watcher = watch(projectsRoot, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
  });
  watcher
    .on('add', (filePath) => { if (isJsonl(filePath)) schedule(filePath); })
    .on('change', (filePath) => { if (isJsonl(filePath)) schedule(filePath); })
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
