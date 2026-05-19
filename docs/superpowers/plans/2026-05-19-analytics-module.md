# Plan de Implementación: Módulo Analytics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir al fork `claudecode-controlpanel` (sobre `siteboon/claudecodeui`) un módulo Analytics que lee `~/.claude/projects/*.jsonl`, lo cachea en SQLite e instrumenta 5 vistas (Overview, Projects, Agents, Costs, Tools) accesibles desde el sidebar.

**Architecture:** Backend sigue la convención `server/modules/<dominio>/{routes,services,repositories}` con SQLite singleton compartido. Frontend sigue `src/components/<feature>/{view,hooks,charts,components}` con fetch directo vía hooks. Ingest incremental con watermark `(path, mtime, offset)` y file watcher `chokidar`.

**Tech Stack:** Node 22+, Express 4, better-sqlite3 12, TypeScript 5, React 18, Vite 7, Tailwind 3, lucide-react, recharts (nuevo), date-fns (nuevo). Tests con `node:test` builtin.

**Branch:** `feat/analytics` (ya creada y pusheada al fork con el spec).
**Spec base:** `docs/superpowers/specs/2026-05-19-analytics-module-design.md`.

---

## Convenciones del repo (importante leer antes de empezar)

- Backend mixed JS/TS: `server/index.js` registra rutas con `app.use('/api/<name>', authenticateToken, routes)`. Módulos nuevos van en `server/modules/<name>/` como `.ts`. Las imports internas TS usan extensión `.js` (NodeNext): `import { x } from '@/modules/foo/bar.service.js'`.
- Path alias `@/` → `server/` (resuelto por `tsc-alias` + `tsconfig.json`).
- Helpers compartidos: `AppError`, `asyncHandler`, `createApiSuccessResponse` están en `@/shared/utils.js`.
- DB singleton: `getConnection()` desde `@/modules/database/connection.js`. Las migraciones se centralizan en `@/modules/database/migrations.ts` (`runMigrations(db)`). No abrir conexiones propias.
- Tests: `node:test` builtin. Archivos `server/modules/<name>/tests/*.test.ts`. Se ejecutan con `tsx --test`.
- Frontend: navegación sin react-router-dom interno; un state `activeTab` en `AppContent.tsx` controla qué se muestra. Settings se abre como modal vía `onShowSettings`. **Analytics seguirá el mismo patrón modal/overlay** (no necesita ruta URL ni proyecto seleccionado).
- i18n: `react-i18next`, namespaces por feature. Añadiremos `analytics.json` por idioma. Si pereza, en MVP usar strings ES/EN inline y dejar i18n para refinamiento.
- Commits: convencionales (`feat(analytics): ...`, `test(analytics): ...`, `docs(analytics): ...`). Husky + lint-staged corren ESLint en pre-commit.
- Comandos clave:
  - `npm run dev` → arranca server + cliente en paralelo
  - `npm run typecheck` → TypeScript de cliente y server
  - `npm run lint` → ESLint
  - `npx tsx --test server/modules/analytics/tests/*.test.ts` → tests del módulo

---

## Hito 1 — Setup

### Tarea 1.1: Añadir dependencias y script de test

**Files:**
- Modify: `package.json`

- [ ] **Paso 1: Añadir dependencias runtime**

Run:
```bash
npm install recharts@^2.13.0 date-fns@^4.1.0
```
Expected: añade entradas a `dependencies` en `package.json` y a `package-lock.json`.

- [ ] **Paso 2: Añadir script `test` al `package.json`**

Edita `package.json`, en la sección `"scripts"` añade entre `"lint:fix"` y `"start"`:

```json
"test": "tsx --test server/modules/**/tests/*.test.ts",
"test:watch": "tsx --test --watch server/modules/**/tests/*.test.ts",
```

- [ ] **Paso 3: Verificar que `npm run test` no rompe**

Run: `npm run test 2>&1 | head -10`
Expected: imprime algo como `# tests 0` o `no test files found` — no error de sintaxis.

- [ ] **Paso 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(analytics): add recharts, date-fns deps and node:test script"
```

---

### Tarea 1.2: Crear estructura de carpetas vacías

**Files:**
- Create: `server/modules/analytics/.gitkeep`
- Create: `server/modules/analytics/services/.gitkeep`
- Create: `server/modules/analytics/repositories/.gitkeep`
- Create: `server/modules/analytics/watcher/.gitkeep`
- Create: `server/modules/analytics/tests/.gitkeep`
- Create: `src/components/analytics/view/tabs/.gitkeep`
- Create: `src/components/analytics/hooks/.gitkeep`
- Create: `src/components/analytics/charts/.gitkeep`
- Create: `src/components/analytics/components/.gitkeep`

- [ ] **Paso 1: Crear carpetas**

Run:
```bash
mkdir -p server/modules/analytics/{services,repositories,watcher,tests}
mkdir -p src/components/analytics/{view/tabs,hooks,charts,components}
for d in server/modules/analytics server/modules/analytics/services server/modules/analytics/repositories server/modules/analytics/watcher server/modules/analytics/tests src/components/analytics src/components/analytics/view src/components/analytics/view/tabs src/components/analytics/hooks src/components/analytics/charts src/components/analytics/components; do touch "$d/.gitkeep"; done
```

- [ ] **Paso 2: Verificar estructura**

Run: `find server/modules/analytics src/components/analytics -type d`
Expected: 11 directorios (5 backend + 6 frontend).

- [ ] **Paso 3: Commit**

```bash
git add server/modules/analytics src/components/analytics
git commit -m "feat(analytics): scaffold module directory structure"
```

---

## Hito 2 — Backend: tipos y schema SQLite

### Tarea 2.1: Definir tipos del módulo

**Files:**
- Create: `server/modules/analytics/types.ts`

- [ ] **Paso 1: Escribir `types.ts`**

```typescript
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
```

- [ ] **Paso 2: Verificar typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: 0 errors (o solo los preexistentes del repo, sin nada nuevo).

- [ ] **Paso 3: Commit**

```bash
git add server/modules/analytics/types.ts
git commit -m "feat(analytics): add module types"
```

---

### Tarea 2.2: Añadir schema SQLite

**Files:**
- Modify: `server/modules/database/schema.ts` (añadir constantes al final)
- Modify: `server/modules/database/migrations.ts` (invocar nuevas creates)

- [ ] **Paso 1: Añadir SQL al schema**

Abre `server/modules/database/schema.ts` y añade al final del archivo:

```typescript
// ---------------------------------------------------------------------------
// Analytics module schema (additive — never modifies upstream tables)
// ---------------------------------------------------------------------------

export const ANALYTICS_PROJECTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS analytics_projects (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    path        TEXT NOT NULL UNIQUE,
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL
);
`;

export const ANALYTICS_SESSIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS analytics_sessions (
    id                    TEXT PRIMARY KEY NOT NULL,
    project_id            TEXT REFERENCES analytics_projects(id) ON DELETE CASCADE,
    started_at            INTEGER NOT NULL,
    ended_at              INTEGER,
    model                 TEXT,
    tokens_input          INTEGER NOT NULL DEFAULT 0,
    tokens_output         INTEGER NOT NULL DEFAULT 0,
    tokens_cache_read     INTEGER NOT NULL DEFAULT 0,
    tokens_cache_create   INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd    REAL NOT NULL DEFAULT 0,
    message_count         INTEGER NOT NULL DEFAULT 0,
    tool_call_count       INTEGER NOT NULL DEFAULT 0,
    subagent_count        INTEGER NOT NULL DEFAULT 0,
    jsonl_path            TEXT NOT NULL,
    jsonl_mtime           INTEGER NOT NULL,
    jsonl_size            INTEGER NOT NULL
);
`;

export const ANALYTICS_EVENTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS analytics_events (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id            TEXT NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
    ts                    INTEGER NOT NULL,
    type                  TEXT NOT NULL,
    tool_name             TEXT,
    agent_name            TEXT,
    model                 TEXT,
    tokens_input          INTEGER,
    tokens_output         INTEGER,
    tokens_cache_read     INTEGER,
    tokens_cache_create   INTEGER,
    duration_ms           INTEGER,
    is_error              INTEGER NOT NULL DEFAULT 0,
    raw_offset            INTEGER NOT NULL
);
`;

export const ANALYTICS_INGEST_LOG_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS analytics_ingest_log (
    jsonl_path     TEXT PRIMARY KEY NOT NULL,
    last_offset    INTEGER NOT NULL DEFAULT 0,
    last_mtime     INTEGER NOT NULL,
    last_ingest    INTEGER NOT NULL,
    error_count    INTEGER NOT NULL DEFAULT 0
);
`;

export const ANALYTICS_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_analytics_events_session ON analytics_events(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_ts ON analytics_events(ts);
CREATE INDEX IF NOT EXISTS idx_analytics_events_tool ON analytics_events(tool_name);
CREATE INDEX IF NOT EXISTS idx_analytics_events_agent ON analytics_events(agent_name);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_project ON analytics_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_started ON analytics_sessions(started_at);
`;
```

- [ ] **Paso 2: Invocar las creates desde migrations.ts**

Abre `server/modules/database/migrations.ts`. Al inicio del archivo añade al import existente:

```typescript
import {
  APP_CONFIG_TABLE_SCHEMA_SQL,
  LAST_SCANNED_AT_SQL,
  PROJECTS_TABLE_SCHEMA_SQL,
  PUSH_SUBSCRIPTIONS_TABLE_SCHEMA_SQL,
  SESSIONS_TABLE_SCHEMA_SQL,
  USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL,
  VAPID_KEYS_TABLE_SCHEMA_SQL,
  // analytics
  ANALYTICS_PROJECTS_TABLE_SCHEMA_SQL,
  ANALYTICS_SESSIONS_TABLE_SCHEMA_SQL,
  ANALYTICS_EVENTS_TABLE_SCHEMA_SQL,
  ANALYTICS_INGEST_LOG_TABLE_SCHEMA_SQL,
  ANALYTICS_INDEXES_SQL,
} from '@/modules/database/schema.js';
```

Luego dentro de `runMigrations`, después de `db.exec(LAST_SCANNED_AT_SQL);` y antes de `console.log('Database migrations completed successfully');`, añade:

```typescript
    // Analytics module tables (additive, prefixed to avoid collisions)
    db.exec(ANALYTICS_PROJECTS_TABLE_SCHEMA_SQL);
    db.exec(ANALYTICS_SESSIONS_TABLE_SCHEMA_SQL);
    db.exec(ANALYTICS_EVENTS_TABLE_SCHEMA_SQL);
    db.exec(ANALYTICS_INGEST_LOG_TABLE_SCHEMA_SQL);
    db.exec(ANALYTICS_INDEXES_SQL);
```

- [ ] **Paso 3: Arrancar server y verificar que las tablas se crean**

Run en una terminal: `npm run dev` (déjalo correr unos segundos hasta ver el log "Database migrations completed successfully", luego Ctrl+C).

Run en otra terminal:
```bash
sqlite3 ~/.cloudcli/auth.db ".tables" 2>&1 | tr ' ' '\n' | grep analytics
```
Expected: lista que incluye `analytics_projects`, `analytics_sessions`, `analytics_events`, `analytics_ingest_log`.

(Nota Windows: la ruta puede ser `%USERPROFILE%\.cloudcli\auth.db`. Si `sqlite3` no está instalado, omitir este paso y comprobar visualmente abriendo el archivo con DB Browser.)

- [ ] **Paso 4: Commit**

```bash
git add server/modules/database/schema.ts server/modules/database/migrations.ts
git commit -m "feat(analytics): add SQLite schema and migration hooks"
```

---

## Hito 3 — Backend: pricing y parser

### Tarea 3.1: Pricing service

**Files:**
- Create: `server/modules/analytics/services/pricing.service.ts`
- Create: `server/modules/analytics/tests/pricing.test.ts`

- [ ] **Paso 1: Escribir el test PRIMERO**

```typescript
// server/modules/analytics/tests/pricing.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateEventCost, calculateSessionCost } from '@/modules/analytics/services/pricing.service.js';

test('pricing: calculates input/output cost for known model', () => {
  const cost = calculateEventCost({
    model: 'claude-sonnet-4-6',
    tokensInput: 1_000_000,
    tokensOutput: 0,
    tokensCacheRead: 0,
    tokensCacheCreate: 0,
  });
  assert.equal(cost, 3.0);
});

test('pricing: combines all four token kinds', () => {
  const cost = calculateEventCost({
    model: 'claude-sonnet-4-6',
    tokensInput: 1_000_000,
    tokensOutput: 1_000_000,
    tokensCacheRead: 1_000_000,
    tokensCacheCreate: 1_000_000,
  });
  // 3 + 15 + 0.30 + 3.75
  assert.equal(Math.round(cost * 100) / 100, 22.05);
});

test('pricing: unknown model returns 0', () => {
  const cost = calculateEventCost({
    model: 'unknown-model-xyz',
    tokensInput: 1_000_000,
  });
  assert.equal(cost, 0);
});

test('pricing: undefined fields treated as 0', () => {
  const cost = calculateEventCost({ model: 'claude-haiku-4-5' });
  assert.equal(cost, 0);
});

test('pricing: session cost sums event costs', () => {
  const total = calculateSessionCost([
    { model: 'claude-sonnet-4-6', tokensInput: 500_000 },
    { model: 'claude-sonnet-4-6', tokensOutput: 200_000 },
  ]);
  // 1.5 + 3 = 4.5
  assert.equal(total, 4.5);
});
```

- [ ] **Paso 2: Ejecutar el test y comprobar que falla**

Run: `npm run test 2>&1 | tail -15`
Expected: errores tipo `Cannot find module '@/modules/analytics/services/pricing.service.js'`.

- [ ] **Paso 3: Implementar el servicio**

```typescript
// server/modules/analytics/services/pricing.service.ts
import type { ModelPricing } from '@/modules/analytics/types.js';

// Prices in USD per 1,000,000 tokens. Update manually as Anthropic publishes
// new tiers. Unknown models fall back to 0 cost + a warning at ingest time.
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7':   { input: 15.0, output: 75.0, cacheRead: 1.5,  cacheCreate: 18.75 },
  'claude-sonnet-4-6': { input:  3.0, output: 15.0, cacheRead: 0.3,  cacheCreate:  3.75 },
  'claude-haiku-4-5':  { input:  1.0, output:  5.0, cacheRead: 0.1,  cacheCreate:  1.25 },
};

export interface CostInputs {
  model?: string;
  tokensInput?: number;
  tokensOutput?: number;
  tokensCacheRead?: number;
  tokensCacheCreate?: number;
}

const PER_MILLION = 1_000_000;

export function calculateEventCost(inputs: CostInputs): number {
  if (!inputs.model) return 0;

  // Match exact id first, then by prefix (e.g. "claude-sonnet-4-6-20251101").
  const pricing =
    MODEL_PRICING[inputs.model] ??
    Object.entries(MODEL_PRICING).find(([id]) => inputs.model!.startsWith(id))?.[1];

  if (!pricing) return 0;

  return (
    ((inputs.tokensInput        ?? 0) * pricing.input) / PER_MILLION +
    ((inputs.tokensOutput       ?? 0) * pricing.output) / PER_MILLION +
    ((inputs.tokensCacheRead    ?? 0) * pricing.cacheRead) / PER_MILLION +
    ((inputs.tokensCacheCreate  ?? 0) * pricing.cacheCreate) / PER_MILLION
  );
}

export function calculateSessionCost(events: CostInputs[]): number {
  return events.reduce((sum, e) => sum + calculateEventCost(e), 0);
}
```

- [ ] **Paso 4: Re-ejecutar los tests y comprobar que pasan**

Run: `npm run test 2>&1 | tail -10`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Paso 5: Commit**

```bash
git add server/modules/analytics/services/pricing.service.ts server/modules/analytics/tests/pricing.test.ts
git commit -m "feat(analytics): add pricing service with model→cost calculator"
```

---

### Tarea 3.2: JSONL parser service

**Files:**
- Create: `server/modules/analytics/services/jsonl-parser.service.ts`
- Create: `server/modules/analytics/tests/jsonl-parser.test.ts`

- [ ] **Paso 1: Escribir el test PRIMERO**

```typescript
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

  // Second call from the first event's end offset should only get the second line.
  const offset = first.events[0].rawOffset + JSON.stringify({ type: 'user', sessionId: 's5', cwd: '/p', timestamp: '2026-05-19T10:00:00.000Z', message: { role: 'user', content: 'a' } }).length + 1;
  const second = await parseJsonlFile(file, offset);
  assert.equal(second.events.length, 1);
});
```

- [ ] **Paso 2: Comprobar que falla**

Run: `npm run test 2>&1 | tail -10`
Expected: módulo no encontrado.

- [ ] **Paso 3: Implementar el parser**

```typescript
// server/modules/analytics/services/jsonl-parser.service.ts
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import readline from 'node:readline';

import type { EventType, ParsedEvent, ParsedSessionMeta } from '@/modules/analytics/types.js';

interface RawLine {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  message?: any;
  durationMs?: number;
}

export interface ParseResult {
  meta: ParsedSessionMeta;
  events: ParsedEvent[];
  endOffset: number;
}

const toUnixMs = (iso: string | undefined): number => {
  if (!iso) return Date.now();
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Date.now() : t;
};

/**
 * Streams a JSONL session file starting at `startOffset`, tolerating malformed
 * lines and returning the meta + parsed events plus the final byte offset.
 */
export async function parseJsonlFile(filePath: string, startOffset: number): Promise<ParseResult> {
  const stats = await stat(filePath);
  const total = stats.size;

  let sessionId: string | undefined;
  let projectPath: string | undefined;
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  let sessionModel: string | undefined;

  const events: ParsedEvent[] = [];

  if (startOffset >= total) {
    return {
      meta: {
        sessionId: sessionId ?? '',
        projectPath: projectPath ?? '',
        startedAt: startedAt ?? Date.now(),
        endedAt,
        model: sessionModel,
      },
      events,
      endOffset: total,
    };
  }

  const stream = createReadStream(filePath, { start: startOffset, encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let cursor = startOffset;

  for await (const line of rl) {
    const rawOffset = cursor;
    // +1 for the newline that readline strips.
    cursor += Buffer.byteLength(line, 'utf8') + 1;

    if (!line.trim()) continue;

    let raw: RawLine;
    try {
      raw = JSON.parse(line);
    } catch {
      continue; // skip malformed
    }

    if (!sessionId && raw.sessionId)   sessionId   = raw.sessionId;
    if (!projectPath && raw.cwd)       projectPath = raw.cwd;
    const ts = toUnixMs(raw.timestamp);
    if (!startedAt) startedAt = ts;
    endedAt = ts;

    const baseType = raw.type;
    const message = raw.message;
    const usage = message?.usage;
    if (message?.model && !sessionModel) sessionModel = message.model;

    if (baseType === 'user' && message) {
      const content = message.content;
      // tool_result lives inside user-role messages
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_result') {
            events.push({
              ts,
              type: 'tool_result',
              isError: Boolean(block.is_error),
              rawOffset,
            });
          }
        }
      } else {
        events.push({ ts, type: 'user_message', rawOffset });
      }
      continue;
    }

    if (baseType === 'assistant' && message) {
      const content = message.content;
      // tool_use blocks live inside assistant content
      let emittedToolUse = false;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_use') {
            emittedToolUse = true;
            const toolName = String(block.name ?? '');
            if (toolName === 'Task') {
              events.push({
                ts,
                type: 'subagent_start',
                agentName: String(block.input?.subagent_type ?? 'unknown'),
                model: message.model,
                rawOffset,
              });
            } else {
              events.push({
                ts,
                type: 'tool_use',
                toolName,
                model: message.model,
                rawOffset,
              });
            }
          }
        }
      }

      // Always emit one assistant_message with the token usage, so we can
      // attribute cost even when content was a tool_use array.
      events.push({
        ts,
        type: 'assistant_message',
        model: message.model,
        tokensInput:       usage?.input_tokens,
        tokensOutput:      usage?.output_tokens,
        tokensCacheRead:   usage?.cache_read_input_tokens,
        tokensCacheCreate: usage?.cache_creation_input_tokens,
        durationMs:        raw.durationMs,
        rawOffset,
      });
      continue;
    }

    if (baseType === 'system') {
      events.push({ ts, type: 'system', rawOffset });
      continue;
    }

    // Unknown type — skip silently (tolerant to schema changes).
  }

  return {
    meta: {
      sessionId: sessionId ?? '',
      projectPath: projectPath ?? '',
      startedAt: startedAt ?? Date.now(),
      endedAt,
      model: sessionModel,
    },
    events,
    endOffset: cursor,
  };
}
```

- [ ] **Paso 4: Re-ejecutar los tests**

Run: `npm run test 2>&1 | tail -15`
Expected: `# pass 10` (5 pricing + 5 parser), `# fail 0`.

(Si algún test falla, leer el output y ajustar — los offsets exactos pueden requerir tuning porque `readline` puede o no incluir el `\r` en Windows. Si en Windows `crlfDelay: Infinity` no basta, el conteo de `Buffer.byteLength(line) + 1` puede necesitar `+2`. Ajustar y re-correr.)

- [ ] **Paso 5: Commit**

```bash
git add server/modules/analytics/services/jsonl-parser.service.ts server/modules/analytics/tests/jsonl-parser.test.ts
git commit -m "feat(analytics): add JSONL parser with subagent detection"
```

---

## Hito 4 — Backend: repository, ingest, aggregator

### Tarea 4.1: Repository

**Files:**
- Create: `server/modules/analytics/repositories/analytics.repository.ts`

- [ ] **Paso 1: Implementar el repository**

```typescript
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
        model       = COALESCE(analytics_sessions.model, excluded.model),
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
```

- [ ] **Paso 2: Verificar typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: 0 errores nuevos.

- [ ] **Paso 3: Commit**

```bash
git add server/modules/analytics/repositories/analytics.repository.ts
git commit -m "feat(analytics): add repository with upserts and watermark"
```

---

### Tarea 4.2: Ingest service

**Files:**
- Create: `server/modules/analytics/services/ingest.service.ts`
- Create: `server/modules/analytics/tests/ingest.test.ts`

- [ ] **Paso 1: Escribir el test PRIMERO**

```typescript
// server/modules/analytics/tests/ingest.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ingestJsonlFile } from '@/modules/analytics/services/ingest.service.js';
import { getConnection, closeConnection } from '@/modules/database/connection.js';
import { runMigrations } from '@/modules/database/migrations.js';

const setup = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'analytics-ingest-'));
  process.env.DATABASE_PATH = path.join(dir, 'test.db');
  closeConnection();
  runMigrations(getConnection());
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
```

- [ ] **Paso 2: Comprobar que falla**

Run: `npm run test 2>&1 | tail -15`
Expected: módulo no encontrado.

- [ ] **Paso 3: Implementar el ingest**

```typescript
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
  } catch (err) {
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
```

- [ ] **Paso 4: Ejecutar tests**

Run: `npm run test 2>&1 | tail -15`
Expected: `# pass 13` (acumulados), `# fail 0`.

- [ ] **Paso 5: Commit**

```bash
git add server/modules/analytics/services/ingest.service.ts server/modules/analytics/tests/ingest.test.ts
git commit -m "feat(analytics): add incremental ingest with watermark"
```

---

### Tarea 4.3: Aggregator (queries para Overview)

**Files:**
- Create: `server/modules/analytics/services/aggregator.service.ts`

- [ ] **Paso 1: Implementar el aggregator**

```typescript
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
        COUNT(*) AS msgs,
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
};
```

- [ ] **Paso 2: Verificar typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: 0 errores nuevos.

- [ ] **Paso 3: Commit**

```bash
git add server/modules/analytics/services/aggregator.service.ts
git commit -m "feat(analytics): add aggregator with overview query"
```

---

## Hito 5 — Backend: rutas y registro

### Tarea 5.1: Rutas y registro en server/index.js

**Files:**
- Create: `server/modules/analytics/analytics.routes.ts`
- Modify: `server/index.js`

- [ ] **Paso 1: Crear el router**

```typescript
// server/modules/analytics/analytics.routes.ts
import express, { type Request, type Response } from 'express';

import { aggregatorService, resolveRange } from '@/modules/analytics/services/aggregator.service.js';
import { ingestJsonlFile } from '@/modules/analytics/services/ingest.service.js';
import { analyticsRepository } from '@/modules/analytics/repositories/analytics.repository.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';
import { getConnection } from '@/modules/database/connection.js';

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
  // Reindex is wired up by the watcher module — this stub triggers a manual scan
  // by clearing the ingest log offsets so the next scan re-reads from offset 0.
  const db = getConnection();
  db.exec('UPDATE analytics_ingest_log SET last_offset = 0, last_mtime = 0, error_count = 0');
  db.exec('DELETE FROM analytics_events');
  db.exec('DELETE FROM analytics_sessions');
  db.exec('DELETE FROM analytics_projects');
  // Caller is expected to wait for the watcher debounce to repopulate;
  // a full sync endpoint can be added later if needed.
  res.json(createApiSuccessResponse({ cleared: true }));
}));

export default router;
export { ingestJsonlFile }; // re-exposed for the bootstrap helper
```

- [ ] **Paso 2: Registrar la ruta en `server/index.js`**

Abre `server/index.js`. Cerca del bloque de imports (alrededor de la línea 67 donde está `import providerRoutes ...`), añade:

```javascript
import analyticsRoutes from './modules/analytics/analytics.routes.js';
```

Luego, en el bloque de `app.use('/api/...', ...)` (alrededor de la línea 186, después del registro de `providerRoutes`), añade:

```javascript
// Analytics API Routes (protected)
app.use('/api/analytics', authenticateToken, analyticsRoutes);
```

- [ ] **Paso 3: Smoke check — el server arranca y devuelve overview vacío**

Run en una terminal: `npm run dev`. Espera al log "SERVER_PORT".

Run en otra (sustituye `<TOKEN>` por un JWT válido — el más simple es loguearse en `http://localhost:3001` y copiar el token de localStorage):
```bash
curl -s -H "Authorization: Bearer <TOKEN>" "http://localhost:3001/api/analytics/overview?range=7d"
```
Expected: `{"data":{"range":{...},"sessions":0,"messages":0,...}}` (todos los contadores en 0 porque aún no hay ingest).

Detener `npm run dev`.

- [ ] **Paso 4: Commit**

```bash
git add server/modules/analytics/analytics.routes.ts server/index.js
git commit -m "feat(analytics): wire /api/analytics router with overview/health/reindex"
```

---

### Tarea 5.2: Watcher de chokidar + bootstrap

**Files:**
- Create: `server/modules/analytics/watcher/projects.watcher.ts`
- Create: `server/modules/analytics/index.ts`
- Modify: `server/index.js`

- [ ] **Paso 1: Implementar watcher e index**

```typescript
// server/modules/analytics/watcher/projects.watcher.ts
import os from 'node:os';
import path from 'node:path';
import chokidar from 'chokidar';

import { ingestJsonlFile } from '@/modules/analytics/services/ingest.service.js';

const DEBOUNCE_MS = 1_000;
const projectsRoot = path.join(os.homedir(), '.claude', 'projects');

let watcher: chokidar.FSWatcher | null = null;
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
  watcher = chokidar.watch(`${projectsRoot}/**/*.jsonl`, {
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
```

```typescript
// server/modules/analytics/index.ts
export { startProjectsWatcher, stopProjectsWatcher } from '@/modules/analytics/watcher/projects.watcher.js';
```

- [ ] **Paso 2: Arrancar el watcher al boot**

En `server/index.js`, cerca del registro de WebSocket / final del bootstrap (busca la sección que llama a `server.listen(...)`; algo después de `initializeSessionsWatcher` si existe), añade el import al inicio:

```javascript
import { startProjectsWatcher, stopProjectsWatcher } from './modules/analytics/index.js';
```

Y donde el server escucha (justo después del `server.listen(...)` callback):

```javascript
        startProjectsWatcher().catch((err) => {
            console.error('[analytics] failed to start watcher', err);
        });
```

Asegúrate también de invocar `stopProjectsWatcher()` en el bloque de shutdown (busca `process.on('SIGTERM'`/`'SIGINT'` o `closeSessionsWatcher`):

```javascript
        await stopProjectsWatcher();
```

- [ ] **Paso 3: Smoke check — el watcher procesa una sesión real**

Run: `npm run dev` y espera al log `[analytics] watcher started for ...`.

En otra terminal arranca Claude Code una vez en cualquier proyecto, manda un par de mensajes, déjalo cerrar.

Vuelve a llamar:
```bash
curl -s -H "Authorization: Bearer <TOKEN>" "http://localhost:3001/api/analytics/overview?range=today"
```
Expected: `sessions >= 1`, `messages >= 2`, `tokensInput > 0`.

Detener `npm run dev`.

- [ ] **Paso 4: Commit**

```bash
git add server/modules/analytics/watcher server/modules/analytics/index.ts server/index.js
git commit -m "feat(analytics): add chokidar watcher with debounced ingest and bootstrap"
```

---

## Hito 6 — Frontend: Overview

### Tarea 6.1: Tipos y hook de fetch

**Files:**
- Create: `src/components/analytics/types.ts`
- Create: `src/components/analytics/hooks/useAnalyticsData.ts`

- [ ] **Paso 1: Tipos frontend (espejo de los del backend)**

```typescript
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
```

- [ ] **Paso 2: Hook de fetch**

```typescript
// src/components/analytics/hooks/useAnalyticsData.ts
import { useCallback, useEffect, useState } from 'react';

const tokenFromStorage = (): string | null => {
  try { return localStorage.getItem('auth-token'); } catch { return null; }
};

export interface UseAnalyticsDataState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useAnalyticsData<T>(endpoint: string, range: string, fromIso?: string, toIso?: string): UseAnalyticsDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams({ range });
    if (range === 'custom' && fromIso) params.set('from', fromIso);
    if (range === 'custom' && toIso)   params.set('to', toIso);

    const token = tokenFromStorage();
    fetch(`/api/analytics/${endpoint}?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(json => { if (!cancelled) setData(json.data as T); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [endpoint, range, fromIso, toIso, tick]);

  return { data, isLoading, error, refresh };
}
```

- [ ] **Paso 3: Typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: 0 errores nuevos.

- [ ] **Paso 4: Commit**

```bash
git add src/components/analytics/types.ts src/components/analytics/hooks/useAnalyticsData.ts
git commit -m "feat(analytics): add frontend types and useAnalyticsData hook"
```

---

### Tarea 6.2: Componentes base (MetricCard, formato)

**Files:**
- Create: `src/components/analytics/components/MetricCard.tsx`
- Create: `src/components/analytics/utils/format.ts`

- [ ] **Paso 1: Utils de formato**

```typescript
// src/components/analytics/utils/format.ts
export const fmtInt = (n: number) => n.toLocaleString('en-US');

export const fmtTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
```

- [ ] **Paso 2: MetricCard**

```tsx
// src/components/analytics/components/MetricCard.tsx
import React from 'react';

interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  loading?: boolean;
}

export default function MetricCard({ label, value, hint, icon, loading }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">
        {loading ? <span className="inline-block h-7 w-20 animate-pulse rounded bg-muted" /> : value}
      </div>
      {hint && !loading && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
```

- [ ] **Paso 3: Commit**

```bash
git add src/components/analytics/components src/components/analytics/utils
git commit -m "feat(analytics): add MetricCard and format helpers"
```

---

### Tarea 6.3: OverviewTab con chart

**Files:**
- Create: `src/components/analytics/charts/TrendChart.tsx`
- Create: `src/components/analytics/view/tabs/OverviewTab.tsx`

- [ ] **Paso 1: Componente de gráfico**

```tsx
// src/components/analytics/charts/TrendChart.tsx
import React from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { OverviewSparkPoint } from '../types';

interface TrendChartProps {
  data: OverviewSparkPoint[];
  metric: 'messages' | 'tokens' | 'cost';
  height?: number;
}

const FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export default function TrendChart({ data, metric, height = 240 }: TrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.4} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
        <XAxis dataKey="ts" tickFormatter={(v) => FORMATTER.format(new Date(v))} fontSize={11} />
        <YAxis fontSize={11} />
        <Tooltip
          labelFormatter={(v) => FORMATTER.format(new Date(Number(v)))}
          formatter={(value) => [String(value), metric]}
        />
        <Area type="monotone" dataKey={metric} stroke="currentColor" fill="url(#trend-fill)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Paso 2: OverviewTab**

```tsx
// src/components/analytics/view/tabs/OverviewTab.tsx
import React from 'react';
import { Activity, DollarSign, MessageSquare, Layers } from 'lucide-react';

import MetricCard from '../../components/MetricCard';
import TrendChart from '../../charts/TrendChart';
import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import type { OverviewResponse, RangePreset } from '../../types';
import { fmtInt, fmtTokens, fmtUsd } from '../../utils/format';

interface OverviewTabProps {
  range: RangePreset;
  fromIso?: string;
  toIso?: string;
}

export default function OverviewTab({ range, fromIso, toIso }: OverviewTabProps) {
  const { data, isLoading, error } = useAnalyticsData<OverviewResponse>('overview', range, fromIso, toIso);

  if (error) return <div className="rounded border border-destructive p-4 text-destructive">{error}</div>;

  const totalTokens = (data?.tokensInput ?? 0) + (data?.tokensOutput ?? 0);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Sessions"        value={fmtInt(data?.sessions ?? 0)}        icon={<Layers size={16} />}     loading={isLoading} />
        <MetricCard label="Messages"        value={fmtInt(data?.messages ?? 0)}        icon={<MessageSquare size={16} />} loading={isLoading} />
        <MetricCard label="Tokens"          value={fmtTokens(totalTokens)}             icon={<Activity size={16} />}   loading={isLoading} hint={`${fmtTokens(data?.tokensInput ?? 0)} in · ${fmtTokens(data?.tokensOutput ?? 0)} out`} />
        <MetricCard label="Estimated cost"  value={fmtUsd(data?.estimatedCostUsd ?? 0)} icon={<DollarSign size={16} />} loading={isLoading} hint={`cache: ${fmtTokens(data?.tokensCacheRead ?? 0)} read · ${fmtTokens(data?.tokensCacheCreate ?? 0)} create`} />
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 text-sm font-medium">Activity over time</div>
        {isLoading || !data ? (
          <div className="h-60 animate-pulse rounded bg-muted" />
        ) : (
          <div className="text-primary">
            <TrendChart data={data.sparkline} metric="messages" />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Paso 3: Commit**

```bash
git add src/components/analytics/charts src/components/analytics/view/tabs/OverviewTab.tsx
git commit -m "feat(analytics): add OverviewTab with metric cards and trend chart"
```

---

### Tarea 6.4: AnalyticsView (shell con tabs) + DateRangePicker

**Files:**
- Create: `src/components/analytics/components/DateRangePicker.tsx`
- Create: `src/components/analytics/view/AnalyticsView.tsx`
- Create: `src/components/analytics/index.ts`

- [ ] **Paso 1: DateRangePicker (solo presets en MVP)**

```tsx
// src/components/analytics/components/DateRangePicker.tsx
import React from 'react';

import type { RangePreset } from '../types';

interface Props {
  value: RangePreset;
  onChange: (next: RangePreset) => void;
}

const OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d',    label: '7 days' },
  { value: '30d',   label: '30 days' },
];

export default function DateRangePicker({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-xs">
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={
            'rounded px-2.5 py-1 transition-colors ' +
            (value === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted')
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Paso 2: AnalyticsView (shell con tabs internos)**

```tsx
// src/components/analytics/view/AnalyticsView.tsx
import React, { useState } from 'react';
import { X } from 'lucide-react';

import DateRangePicker from '../components/DateRangePicker';
import OverviewTab from './tabs/OverviewTab';
import type { AnalyticsTab, RangePreset } from '../types';

interface Props {
  onClose: () => void;
}

const TABS: { id: AnalyticsTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'projects', label: 'Projects' },
  { id: 'agents',   label: 'Agents' },
  { id: 'costs',    label: 'Costs' },
  { id: 'tools',    label: 'Tools' },
];

export default function AnalyticsView({ onClose }: Props) {
  const [tab, setTab] = useState<AnalyticsTab>('overview');
  const [range, setRange] = useState<RangePreset>('7d');

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">Analytics</h2>
          <nav className="flex items-center gap-1">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                disabled={t.id !== 'overview'}
                onClick={() => setTab(t.id)}
                className={
                  'rounded px-3 py-1 text-sm transition-colors ' +
                  (tab === t.id
                    ? 'bg-muted font-medium'
                    : t.id === 'overview'
                      ? 'text-muted-foreground hover:bg-muted'
                      : 'text-muted-foreground/40 cursor-not-allowed')
                }
                title={t.id === 'overview' ? '' : 'Coming in next milestone'}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <DateRangePicker value={range} onChange={setRange} />
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted-foreground hover:bg-muted">
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        {tab === 'overview' && <OverviewTab range={range} />}
      </div>
    </div>
  );
}
```

- [ ] **Paso 3: Barrel export**

```typescript
// src/components/analytics/index.ts
export { default as AnalyticsView } from './view/AnalyticsView';
```

- [ ] **Paso 4: Typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: 0 errores nuevos.

- [ ] **Paso 5: Commit**

```bash
git add src/components/analytics
git commit -m "feat(analytics): add AnalyticsView shell with DateRangePicker"
```

---

### Tarea 6.5: Integración en sidebar + AppContent

**Files:**
- Modify: `src/components/app/AppContent.tsx`
- Modify: `src/components/sidebar/view/subcomponents/SidebarContent.tsx` (o donde estén las acciones del footer)
- Modify: `src/components/sidebar/view/subcomponents/SidebarCollapsed.tsx`

- [ ] **Paso 1: Localizar dónde se monta Settings**

Run:
```bash
grep -n "onShowSettings\|showSettings" src/components/app/AppContent.tsx
```
Expected: ~6-10 líneas mostrando cómo `showSettings` se gestiona como state en `AppContent` y se propaga a `Sidebar`. Replicaremos exactamente el mismo patrón con `showAnalytics`.

- [ ] **Paso 2: Añadir state y prop drilling en `AppContent.tsx`**

Edita `src/components/app/AppContent.tsx`. Cerca del `useState` que controla `showSettings` (aproximadamente al inicio del componente), añade:

```tsx
const [showAnalytics, setShowAnalytics] = useState(false);
```

En el JSX, encuentra dónde se renderiza `<Sidebar ...`. Añade dos props:

```tsx
onShowAnalytics={() => setShowAnalytics(true)}
```

Justo antes del cierre del componente, después del último elemento (probablemente cerca de donde Settings se monta como modal), añade:

```tsx
{showAnalytics && (
  <AnalyticsView onClose={() => setShowAnalytics(false)} />
)}
```

Y añade el import al inicio del archivo:

```tsx
import { AnalyticsView } from '../analytics';
```

- [ ] **Paso 3: Propagar `onShowAnalytics` por los tipos del Sidebar**

Abre `src/components/sidebar/types/types.ts`. Localiza la interfaz `SidebarProps` y añade el campo opcional:

```typescript
onShowAnalytics?: () => void;
```

Abre `src/components/sidebar/view/Sidebar.tsx`. En la firma del componente (alrededor de la línea 24), añade `onShowAnalytics` al destructuring de props:

```tsx
function Sidebar({
  /* ... existing fields ... */
  onShowSettings,
  onShowAnalytics,
  /* ... */
}: SidebarProps) {
```

Y propágalo a `SidebarContent` y `SidebarCollapsed`:

```tsx
<SidebarContent
  /* ... existing props ... */
  onShowSettings={onShowSettings}
  onShowAnalytics={onShowAnalytics}
  /* ... */
/>
```

```tsx
<SidebarCollapsed
  onExpand={handleExpandSidebar}
  onShowSettings={onShowSettings}
  onShowAnalytics={onShowAnalytics}
  /* ... */
/>
```

- [ ] **Paso 4: Botón en `SidebarContent` y `SidebarCollapsed`**

Abre `src/components/sidebar/view/subcomponents/SidebarContent.tsx`. Busca dónde está el botón que invoca `onShowSettings` (probablemente en el footer/bottom bar). Justo a su lado (delante), añade un botón análogo:

```tsx
{onShowAnalytics && (
  <button
    type="button"
    onClick={onShowAnalytics}
    aria-label="Open Analytics"
    title="Analytics"
    className="rounded p-1.5 text-muted-foreground hover:bg-muted"
  >
    <BarChart3 size={18} />
  </button>
)}
```

Añade el import al inicio del archivo:

```tsx
import { BarChart3 } from 'lucide-react';
```

Añade el campo `onShowAnalytics?: () => void;` al type/interface `SidebarContentProps` (ver inicio del archivo).

Repite el patrón en `SidebarCollapsed.tsx`.

- [ ] **Paso 5: Smoke check visual**

Run: `npm run dev`. Abre `http://localhost:3001` en el navegador. Loguéate.

Expected:
- Aparece un icono de gráfico de barras en el footer del sidebar.
- Al hacer click se abre AnalyticsView en overlay.
- La pestaña Overview muestra los métricos (con los datos que el watcher haya ingestado).
- Las otras pestañas (Projects/Agents/Costs/Tools) aparecen deshabilitadas con tooltip "Coming in next milestone".
- La `X` cierra el overlay.

- [ ] **Paso 6: Commit**

```bash
git add src/components/app/AppContent.tsx src/components/sidebar
git commit -m "feat(analytics): expose Analytics modal from sidebar"
```

---

## Hito 7 — Tabs adicionales

A partir de aquí cada tab repite el patrón: endpoint nuevo → tipo en `types.ts` → componente Tab → habilitar en `AnalyticsView`. Para no duplicar pasos, abajo va el detalle mínimo de cada uno con su código.

### Tarea 7.1: Projects tab

**Files:**
- Modify: `server/modules/analytics/services/aggregator.service.ts` (añadir método)
- Modify: `server/modules/analytics/analytics.routes.ts` (endpoint /projects)
- Modify: `src/components/analytics/types.ts`
- Create: `src/components/analytics/view/tabs/ProjectsTab.tsx`
- Modify: `src/components/analytics/view/AnalyticsView.tsx` (montar tab)

- [ ] **Paso 1: Aggregator — listar proyectos del rango**

En `aggregator.service.ts`, añade al objeto `aggregatorService`:

```typescript
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
```

- [ ] **Paso 2: Endpoint /projects**

En `analytics.routes.ts`, añade:

```typescript
router.get('/projects', asyncHandler(async (req: Request, res: Response) => {
  const range = readRange(req);
  res.json(createApiSuccessResponse({ range, projects: aggregatorService.projects(range) }));
}));
```

- [ ] **Paso 3: Tipos frontend**

En `src/components/analytics/types.ts`, añade:

```typescript
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
```

- [ ] **Paso 4: ProjectsTab**

```tsx
// src/components/analytics/view/tabs/ProjectsTab.tsx
import React from 'react';

import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import type { ProjectsResponse, RangePreset } from '../../types';
import { fmtInt, fmtTokens, fmtUsd } from '../../utils/format';

interface Props { range: RangePreset; }

export default function ProjectsTab({ range }: Props) {
  const { data, isLoading, error } = useAnalyticsData<ProjectsResponse>('projects', range);

  if (error)     return <div className="p-4 text-destructive">{error}</div>;
  if (isLoading) return <div className="p-4 text-muted-foreground">Loading…</div>;
  if (!data || data.projects.length === 0) return <div className="p-4 text-muted-foreground">No project activity in this range.</div>;

  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.projects.map(p => (
        <div key={p.id} className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="truncate text-sm font-semibold" title={p.path}>{p.name}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground" title={p.path}>{p.path}</div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div><dt className="text-muted-foreground">Sessions</dt><dd className="tabular-nums">{fmtInt(p.sessions)}</dd></div>
            <div><dt className="text-muted-foreground">Tokens</dt><dd className="tabular-nums">{fmtTokens(p.tokens)}</dd></div>
            <div><dt className="text-muted-foreground">Cost</dt><dd className="tabular-nums">{fmtUsd(p.cost)}</dd></div>
          </dl>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Paso 5: Habilitar tab en `AnalyticsView.tsx`**

En `AnalyticsView.tsx`:
1. Añade `import ProjectsTab from './tabs/ProjectsTab';`
2. Cambia el `disabled={t.id !== 'overview'}` por `disabled={!['overview','projects'].includes(t.id)}` (o quita la prop disabled cuando todos los tabs estén listos).
3. Añade el render condicional:

```tsx
{tab === 'projects' && <ProjectsTab range={range} />}
```

- [ ] **Paso 6: Smoke + Commit**

Run: `npm run dev`. Verifica visualmente que la tab Projects muestra cards. Detener server.

```bash
git add server/modules/analytics src/components/analytics
git commit -m "feat(analytics): add Projects tab"
```

---

### Tarea 7.2: Agents tab (pieza diferencial)

**Files:**
- Modify: `server/modules/analytics/services/aggregator.service.ts`
- Modify: `server/modules/analytics/analytics.routes.ts`
- Modify: `src/components/analytics/types.ts`
- Create: `src/components/analytics/view/tabs/AgentsTab.tsx`
- Modify: `src/components/analytics/view/AnalyticsView.tsx`

- [ ] **Paso 1: Aggregator — stats por sub-agente**

En `aggregator.service.ts`, añade:

```typescript
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
```

(Nota: para MVP el coste por agente no se computa exactamente — requiere atribuir tokens al span del sub-agente, que no es trivial. Lo dejamos para post-MVP.)

- [ ] **Paso 2: Endpoint /agents**

En `analytics.routes.ts`:

```typescript
router.get('/agents', asyncHandler(async (req: Request, res: Response) => {
  const range = readRange(req);
  res.json(createApiSuccessResponse({ range, agents: aggregatorService.agents(range) }));
}));
```

- [ ] **Paso 3: Tipos + AgentsTab**

En `types.ts`:

```typescript
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
```

```tsx
// src/components/analytics/view/tabs/AgentsTab.tsx
import React from 'react';

import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import type { AgentsResponse, RangePreset } from '../../types';
import { fmtInt } from '../../utils/format';

interface Props { range: RangePreset; }

const fmtDuration = (ms: number) => {
  if (!ms) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
};

export default function AgentsTab({ range }: Props) {
  const { data, isLoading, error } = useAnalyticsData<AgentsResponse>('agents', range);

  if (error)     return <div className="p-4 text-destructive">{error}</div>;
  if (isLoading) return <div className="p-4 text-muted-foreground">Loading…</div>;
  if (!data || data.agents.length === 0) return <div className="p-4 text-muted-foreground">No sub-agent activity in this range.</div>;

  return (
    <div className="p-4">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2 pr-4">Sub-agent</th>
            <th className="py-2 pr-4 text-right">Invocations</th>
            <th className="py-2 pr-4 text-right">Avg duration</th>
            <th className="py-2 pr-4 text-right">Tool calls</th>
          </tr>
        </thead>
        <tbody>
          {data.agents.map(a => (
            <tr key={a.agent_name} className="border-t border-border">
              <td className="py-2 pr-4 font-medium">{a.agent_name}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{fmtInt(a.invocations)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{fmtDuration(a.avg_duration_ms)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{fmtInt(a.tool_calls)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Paso 4: Habilitar tab en `AnalyticsView.tsx`**

Importa y añade el render:

```tsx
import AgentsTab from './tabs/AgentsTab';
// ...
{tab === 'agents' && <AgentsTab range={range} />}
```

Y amplía la condición `disabled` para incluir `'agents'`.

- [ ] **Paso 5: Smoke + Commit**

```bash
git add server/modules/analytics src/components/analytics
git commit -m "feat(analytics): add Agents tab with per-subagent stats"
```

---

### Tarea 7.3: Costs tab

**Files:**
- Modify: `server/modules/analytics/services/aggregator.service.ts`
- Modify: `server/modules/analytics/analytics.routes.ts`
- Modify: `src/components/analytics/types.ts`
- Create: `src/components/analytics/charts/BreakdownPie.tsx`
- Create: `src/components/analytics/view/tabs/CostsTab.tsx`
- Modify: `src/components/analytics/view/AnalyticsView.tsx`

- [ ] **Paso 1: Aggregator**

```typescript
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
```

- [ ] **Paso 2: Endpoint**

```typescript
router.get('/costs', asyncHandler(async (req: Request, res: Response) => {
  const range = readRange(req);
  res.json(createApiSuccessResponse({ range, ...aggregatorService.costs(range) }));
}));
```

- [ ] **Paso 3: Tipos**

```typescript
export interface CostsByModel {
  model: string;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  tokens_cache_create: number;
}

export interface CostsResponse {
  range: { from: number; to: number };
  byModel: CostsByModel[];
  totalCost: number;
  cacheReadTokens: number;
}
```

- [ ] **Paso 4: Chart de pie**

```tsx
// src/components/analytics/charts/BreakdownPie.tsx
import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

interface Slice { name: string; value: number }
interface Props { data: Slice[]; height?: number }

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7'];

export default function BreakdownPie({ data, height = 220 }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" outerRadius={80} label={(d) => d.name}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Paso 5: CostsTab**

```tsx
// src/components/analytics/view/tabs/CostsTab.tsx
import React from 'react';

import MetricCard from '../../components/MetricCard';
import BreakdownPie from '../../charts/BreakdownPie';
import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import { MODEL_PRICING_CLIENT } from '../../utils/pricing-client';
import type { CostsResponse, RangePreset } from '../../types';
import { fmtTokens, fmtUsd } from '../../utils/format';

interface Props { range: RangePreset; }

export default function CostsTab({ range }: Props) {
  const { data, isLoading, error } = useAnalyticsData<CostsResponse>('costs', range);
  if (error)     return <div className="p-4 text-destructive">{error}</div>;
  if (isLoading || !data) return <div className="p-4 text-muted-foreground">Loading…</div>;

  // Compute per-model cost client-side using the same pricing table.
  const slices = data.byModel.map(m => {
    const p = MODEL_PRICING_CLIENT[m.model] ?? Object.entries(MODEL_PRICING_CLIENT).find(([k]) => m.model.startsWith(k))?.[1];
    const cost = p
      ? (m.tokens_input * p.input + m.tokens_output * p.output + m.tokens_cache_read * p.cacheRead + m.tokens_cache_create * p.cacheCreate) / 1_000_000
      : 0;
    return { name: m.model, value: cost };
  }).filter(s => s.value > 0);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Total cost"        value={fmtUsd(data.totalCost)} />
        <MetricCard label="Cache reads"       value={fmtTokens(data.cacheReadTokens)} hint="tokens served from cache" />
        <MetricCard label="Models seen"       value={String(data.byModel.length)} />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 text-sm font-medium">Cost by model</div>
        {slices.length === 0 ? <div className="text-muted-foreground">No paid tokens in this range.</div> : <BreakdownPie data={slices} />}
      </div>
    </div>
  );
}
```

- [ ] **Paso 6: Tabla de pricing en cliente (espejo del backend)**

```typescript
// src/components/analytics/utils/pricing-client.ts
import type { ModelPricing } from './pricing-types';

export const MODEL_PRICING_CLIENT: Record<string, ModelPricing> = {
  'claude-opus-4-7':   { input: 15.0, output: 75.0, cacheRead: 1.5,  cacheCreate: 18.75 },
  'claude-sonnet-4-6': { input:  3.0, output: 15.0, cacheRead: 0.3,  cacheCreate:  3.75 },
  'claude-haiku-4-5':  { input:  1.0, output:  5.0, cacheRead: 0.1,  cacheCreate:  1.25 },
};
```

```typescript
// src/components/analytics/utils/pricing-types.ts
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}
```

- [ ] **Paso 7: Habilitar tab + Commit**

Importa `CostsTab` en `AnalyticsView.tsx`, añade `{tab === 'costs' && <CostsTab range={range} />}`.

```bash
git add server/modules/analytics src/components/analytics
git commit -m "feat(analytics): add Costs tab with model breakdown"
```

---

### Tarea 7.4: Tools tab

**Files:**
- Modify: `server/modules/analytics/services/aggregator.service.ts`
- Modify: `server/modules/analytics/analytics.routes.ts`
- Modify: `src/components/analytics/types.ts`
- Create: `src/components/analytics/view/tabs/ToolsTab.tsx`
- Modify: `src/components/analytics/view/AnalyticsView.tsx`

- [ ] **Paso 1: Aggregator**

```typescript
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
```

- [ ] **Paso 2: Endpoint + tipos**

```typescript
router.get('/tools', asyncHandler(async (req: Request, res: Response) => {
  const range = readRange(req);
  res.json(createApiSuccessResponse({ range, tools: aggregatorService.tools(range) }));
}));
```

```typescript
export interface ToolRow { tool_name: string; calls: number; errors: number }
export interface ToolsResponse { range: { from: number; to: number }; tools: ToolRow[] }
```

- [ ] **Paso 3: ToolsTab**

```tsx
// src/components/analytics/view/tabs/ToolsTab.tsx
import React from 'react';

import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import type { ToolsResponse, RangePreset } from '../../types';
import { fmtInt } from '../../utils/format';

interface Props { range: RangePreset; }

export default function ToolsTab({ range }: Props) {
  const { data, isLoading, error } = useAnalyticsData<ToolsResponse>('tools', range);
  if (error)     return <div className="p-4 text-destructive">{error}</div>;
  if (isLoading || !data) return <div className="p-4 text-muted-foreground">Loading…</div>;

  const max = data.tools.reduce((m, t) => Math.max(m, t.calls), 1);

  return (
    <div className="p-4">
      <ul className="space-y-2">
        {data.tools.map(t => (
          <li key={t.tool_name} className="flex items-center gap-3">
            <span className="w-32 truncate text-sm font-medium">{t.tool_name}</span>
            <div className="flex-1 rounded bg-muted">
              <div
                className="h-2 rounded bg-primary"
                style={{ width: `${(t.calls / max) * 100}%` }}
              />
            </div>
            <span className="w-16 text-right text-xs tabular-nums">{fmtInt(t.calls)}</span>
            <span className="w-20 text-right text-xs tabular-nums text-destructive">
              {t.errors ? `${fmtInt(t.errors)} err` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Paso 4: Habilitar tab + Commit**

```bash
git add server/modules/analytics src/components/analytics
git commit -m "feat(analytics): add Tools tab with ranking and errors"
```

Tras esta tarea, quita el `disabled` por defecto de los tabs en `AnalyticsView.tsx` ya que todos están conectados.

---

## Hito 8 — Refinamiento

### Tarea 8.1: Manejar el modo "vacío" cuando no hay datos

**Files:**
- Modify: `src/components/analytics/view/tabs/OverviewTab.tsx`

- [ ] **Paso 1: Mensaje claro cuando `sessions === 0`**

Justo después del `if (error) ...`, antes del render principal, añade:

```tsx
if (!isLoading && data && data.sessions === 0) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="text-base font-medium">No activity in this range</div>
      <div className="text-sm text-muted-foreground">
        Start a Claude Code session and come back — the watcher picks it up within a minute.
      </div>
    </div>
  );
}
```

- [ ] **Paso 2: Commit**

```bash
git add src/components/analytics/view/tabs/OverviewTab.tsx
git commit -m "feat(analytics): show empty-state on Overview when no data"
```

---

### Tarea 8.2: Mejorar performance — índice extra y `EXPLAIN QUERY PLAN`

**Files:**
- Modify: `server/modules/database/schema.ts`
- Modify: `server/modules/database/migrations.ts`

- [ ] **Paso 1: Añadir índice compuesto para queries de sparkline**

En `schema.ts`, dentro de `ANALYTICS_INDEXES_SQL`, añade una línea más:

```sql
CREATE INDEX IF NOT EXISTS idx_analytics_events_ts_type ON analytics_events(ts, type);
```

(Migra automáticamente porque `ANALYTICS_INDEXES_SQL` se ejecuta cada boot con `IF NOT EXISTS`.)

- [ ] **Paso 2: Validar con EXPLAIN**

Run en el sqlite cli sobre `~/.cloudcli/auth.db`:

```sql
EXPLAIN QUERY PLAN
SELECT COUNT(DISTINCT s.id) FROM analytics_events e JOIN analytics_sessions s ON s.id = e.session_id WHERE e.ts >= 1747600000000 AND e.ts < 1747700000000;
```

Expected: la línea sobre `analytics_events` debe usar el índice `idx_analytics_events_ts` o `idx_analytics_events_ts_type`.

- [ ] **Paso 3: Commit**

```bash
git add server/modules/database/schema.ts
git commit -m "perf(analytics): add composite index (ts,type) for sparkline queries"
```

---

### Tarea 8.3: Smoke E2E con datos reales

- [ ] **Paso 1: Reindex desde cero**

Arranca server (`npm run dev`). Con el token de auth llama:

```bash
curl -X POST -H "Authorization: Bearer <TOKEN>" http://localhost:3001/api/analytics/reindex
```

Espera al menos 30 segundos a que el watcher re-procese todo.

- [ ] **Paso 2: Verifica con /health**

```bash
curl -s -H "Authorization: Bearer <TOKEN>" http://localhost:3001/api/analytics/health
```

Expected: `files > 0`, `errors == 0` (o pequeño), `sessions > 0`.

- [ ] **Paso 3: Verifica en UI**

Abre `http://localhost:3001`, abre Analytics. Cambia entre los 5 tabs y los 3 presets de fecha. Comprueba que ninguno rompe y que los números cuadran con tu intuición.

- [ ] **Paso 4: `npm run lint` y `npm run typecheck` finales**

Run: `npm run lint && npm run typecheck`
Expected: 0 errores.

- [ ] **Paso 5: Commit final si quedó algo + push**

```bash
git status
# (si hay algo): git add -A && git commit -m "chore(analytics): final lint/typecheck cleanup"
git push origin feat/analytics
```

---

## Hito 9 — Rebase con upstream y PR opcional

### Tarea 9.1: Sincronizar con upstream

- [ ] **Paso 1: Fetch + rebase**

```bash
git fetch upstream
git rebase upstream/main
```

Si hay conflictos, los esperables son en:
- `package.json` (sus deps nuevas vs las tuyas)
- `server/index.js` (registros de rutas)
- `server/modules/database/migrations.ts` y `schema.ts` (creates encima de los tuyos)

Resuelve manteniendo ambos: las creates de analytics son aditivas.

- [ ] **Paso 2: Re-ejecutar tests + typecheck**

```bash
npm run test && npm run typecheck && npm run lint
```

Expected: todo verde.

- [ ] **Paso 3: Force-push al fork (es histórico personal)**

```bash
git push --force-with-lease origin feat/analytics
```

---

## Verificación final ("done")

Replica del Hito 15 del spec:

- [ ] Sidebar muestra el botón Analytics y abre la vista.
- [ ] `OverviewTab` carga en <500 ms con datos reales.
- [ ] Las 5 tabs renderizan sin error.
- [ ] Ingest incremental: al crear una sesión nueva con Claude Code aparece en el dashboard en <30 s.
- [ ] Cálculo de coste consistente con `/cost` del CLI (±5%).
- [ ] `AgentsTab` muestra sub-agentes invocados con sus stats.
- [ ] `git rebase upstream/main` no rompe nada.
