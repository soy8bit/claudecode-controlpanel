// server/modules/analytics/tests/jsonl-parser.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseJsonlFile } from '@/modules/analytics/services/jsonl-parser.service.js';

const writeFixture = async (lines: object[]): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'analytics-parser-'));
  const file = path.join(dir, 'session.jsonl');
  await fs.writeFile(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return file;
};

test('parser: extracts user/assistant messages and tokens', async () => {
  const file = await writeFixture([
    { type: 'user', message: { role: 'user', content: 'hi' }, timestamp: '2026-05-19T10:00:00.000Z', sessionId: 's1', cwd: '/repo' },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }], model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } }, timestamp: '2026-05-19T10:00:01.000Z' },
  ]);

  const { meta, events } = await parseJsonlFile(file, 0);

  assert.equal(meta.sessionId, 's1');
  assert.equal(meta.projectPath, '/repo');
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'user_message');
  assert.equal(events[1].type, 'assistant_message');
  assert.equal(events[1].tokensInput, 100);
  assert.equal(events[1].tokensOutput, 50);
  assert.equal(events[1].tokensCacheRead, 10);
  assert.equal(events[1].tokensCacheCreate, 5);
  assert.equal(events[1].model, 'claude-sonnet-4-6');
});

test('parser: extracts tool_use and tool_result', async () => {
  const file = await writeFixture([
    { type: 'user', message: { role: 'user', content: 'go' }, timestamp: '2026-05-19T10:00:00.000Z', sessionId: 's2', cwd: '/p' },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/x' } }] }, timestamp: '2026-05-19T10:00:01.000Z' },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false }] }, timestamp: '2026-05-19T10:00:02.000Z' },
  ]);

  const { events } = await parseJsonlFile(file, 0);
  const toolUse   = events.find(e => e.type === 'tool_use');
  const toolResult = events.find(e => e.type === 'tool_result');
  assert.ok(toolUse,    'tool_use event missing');
  assert.equal(toolUse!.toolName, 'Read');
  assert.ok(toolResult, 'tool_result event missing');
  assert.equal(toolResult!.isError, false);
});

test('parser: detects sub-agent invocations via Task tool', async () => {
  const file = await writeFixture([
    { type: 'assistant', sessionId: 's3', cwd: '/p', timestamp: '2026-05-19T10:00:00.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Task', input: { subagent_type: 'code-reviewer', description: 'review' } }] } },
  ]);
  const { events } = await parseJsonlFile(file, 0);
  const sub = events.find(e => e.type === 'subagent_start');
  assert.ok(sub);
  assert.equal(sub!.agentName, 'code-reviewer');
});

test('parser: tolerates malformed JSON lines', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'analytics-parser-'));
  const file = path.join(dir, 'broken.jsonl');
  await fs.writeFile(
    file,
    `{"type":"user","sessionId":"s4","cwd":"/p","timestamp":"2026-05-19T10:00:00.000Z","message":{"role":"user","content":"ok"}}\n{ this is not valid json\n{"type":"user","sessionId":"s4","cwd":"/p","timestamp":"2026-05-19T10:00:01.000Z","message":{"role":"user","content":"second"}}\n`,
    'utf8',
  );
  const { events } = await parseJsonlFile(file, 0);
  assert.equal(events.length, 2, 'should skip the malformed line and keep the other two');
});

test('parser: respects startOffset for incremental reads', async () => {
  const file = await writeFixture([
    { type: 'user', sessionId: 's5', cwd: '/p', timestamp: '2026-05-19T10:00:00.000Z', message: { role: 'user', content: 'a' } },
    { type: 'user', sessionId: 's5', cwd: '/p', timestamp: '2026-05-19T10:00:01.000Z', message: { role: 'user', content: 'b' } },
  ]);

  const first = await parseJsonlFile(file, 0);
  assert.equal(first.events.length, 2);

  // Second call from the second event's offset should only get the second line.
  const second = await parseJsonlFile(file, first.events[1].rawOffset);
  assert.equal(second.events.length, 1);
});
