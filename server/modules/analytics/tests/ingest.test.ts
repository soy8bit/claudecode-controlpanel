// server/modules/analytics/tests/ingest.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ingestJsonlFile } from '@/modules/analytics/services/ingest.service.js';
import { getConnection, closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';

const setup = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'analytics-ingest-'));
  process.env.DATABASE_PATH = path.join(dir, 'test.db');
  closeConnection();
  await initializeDatabase();
  return dir;
};

test('ingest: imports a fresh JSONL and aggregates session totals', async () => {
  const dir = await setup();
  const jsonl = path.join(dir, 'sess.jsonl');
  await fs.writeFile(jsonl,
    JSON.stringify({ type: 'user', sessionId: 'sess-a', cwd: '/repo', timestamp: '2026-05-19T10:00:00.000Z', message: { role: 'user', content: 'hi' } }) + '\n' +
    JSON.stringify({ type: 'assistant', sessionId: 'sess-a', cwd: '/repo', timestamp: '2026-05-19T10:00:01.000Z', message: { role: 'assistant', model: 'claude-sonnet-4-6', usage: { input_tokens: 1_000_000, output_tokens: 0 }, content: 'ok' } }) + '\n',
    'utf8',
  );

  const result = await ingestJsonlFile(jsonl);
  assert.equal(result.errors, 0);
  assert.ok(result.newEvents >= 2);

  const db = getConnection();
  const sess = db.prepare('SELECT * FROM analytics_sessions WHERE id = ?').get('sess-a') as any;
  assert.equal(sess.tokens_input, 1_000_000);
  assert.equal(Math.round(sess.estimated_cost_usd), 3);
});

test('ingest: second call with no new bytes is a no-op', async () => {
  const dir = await setup();
  const jsonl = path.join(dir, 'sess.jsonl');
  await fs.writeFile(jsonl,
    JSON.stringify({ type: 'user', sessionId: 's-b', cwd: '/r', timestamp: '2026-05-19T10:00:00.000Z', message: { role: 'user', content: 'hi' } }) + '\n',
    'utf8',
  );
  const r1 = await ingestJsonlFile(jsonl);
  const r2 = await ingestJsonlFile(jsonl);
  assert.ok(r1.newEvents >= 1);
  assert.equal(r2.newEvents, 0);
});

test('ingest: appended lines are picked up incrementally', async () => {
  const dir = await setup();
  const jsonl = path.join(dir, 'sess.jsonl');
  await fs.writeFile(jsonl,
    JSON.stringify({ type: 'user', sessionId: 's-c', cwd: '/r', timestamp: '2026-05-19T10:00:00.000Z', message: { role: 'user', content: 'one' } }) + '\n',
    'utf8',
  );
  await ingestJsonlFile(jsonl);
  await fs.appendFile(jsonl,
    JSON.stringify({ type: 'user', sessionId: 's-c', cwd: '/r', timestamp: '2026-05-19T10:00:05.000Z', message: { role: 'user', content: 'two' } }) + '\n',
    'utf8',
  );
  const r2 = await ingestJsonlFile(jsonl);
  assert.equal(r2.newEvents, 1, 'should only ingest the one new line');
});
