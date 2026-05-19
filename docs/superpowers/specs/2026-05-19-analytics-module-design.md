# Módulo Analytics — Diseño

**Fecha:** 2026-05-19
**Estado:** Aprobado por el usuario, pendiente de plan de implementación
**Rama de trabajo:** `feat/analytics`
**Fork base:** `siteboon/claudecodeui` (AGPL-3.0-or-later) v1.32.0

## 1. Contexto

Este repositorio es un fork de `siteboon/claudecodeui` (también conocido como CloudCLI). El upstream ya cubre las áreas pesadas de un panel de control para Claude Code: gestión de sesiones, terminal integrada, chat, file/git explorer, gestión de agentes/MCP/skills/plugins, multi-CLI (Claude/Codex/Gemini/Cursor), auth, i18n.

El **único hueco funcional** respecto a lo que el usuario pidió es un módulo de **analítica de uso** (estadísticas, coste, tokens, herramientas, sub-agentes). Este spec describe ese módulo.

## 2. Objetivo

Añadir un módulo `Analytics` que muestre estadísticas globales y por sub-agente del uso de Claude Code, leyendo los logs JSONL de `~/.claude/projects/`. La pieza diferencial frente a dashboards existentes (cc-lens, sniffly) es el desglose por **sub-agente invocado**, que ningún proyecto open source cubre bien.

**Despliegue:** local, Windows, una sola persona. No se expone a internet → la AGPL no genera obligaciones de publicación.

## 3. Alcance

### En scope (MVP)
- 5 vistas: Overview, Projects, Agents, Costs, Tools
- Pipeline de ingest incremental basado en watermark `(path, mtime, offset)`
- Cache en SQLite (reutiliza `better-sqlite3` ya en deps del upstream)
- Filtros temporales: hoy, 7d, 30d, custom range
- Cálculo de coste por modelo con tabla de pricing in-code
- Stats por sub-agente (la pieza diferencial)
- Solo proveedor **Claude Code** en MVP (lectura de `~/.claude/projects/*.jsonl`)

### Fuera de scope (post-MVP)
- Soporte de Codex/Gemini/Cursor (los providers existen en upstream, se extenderán después)
- Notificaciones push de alertas de gasto
- Export a CSV/JSON
- Comparación entre periodos
- Live updates por WebSocket (refresh manual basta en MVP)
- Branding/tema custom

## 4. Requisitos no funcionales

- **No bloquear** el server existente: ingest en worker async, sin tocar rutas existentes.
- **Performance**: dashboards <500 ms para 1000 sesiones cacheadas.
- **Sin telemetría externa**: todo lectura local de `~/.claude/`.
- **Tolerante a cambios de formato JSONL**: parser ignora campos desconocidos, no falla si Claude Code cambia su esquema interno.
- **Sesiones grandes**: lectura JSONL en streaming, sin cargar archivos enteros en memoria.

## 5. Arquitectura

Sigue las convenciones de organización del upstream (`server/modules/<dominio>/` con `routes`, `services`, `repositories`).

### 5.1 Backend — `server/modules/analytics/`

```
server/modules/analytics/
├── analytics.routes.ts            ← endpoints REST /api/analytics/*
├── services/
│   ├── jsonl-parser.service.ts    ← parser por líneas, tolerante a esquemas
│   ├── ingest.service.ts          ← orquesta scan inicial + incremental
│   ├── aggregator.service.ts      ← queries SQL agregadas para las vistas
│   └── pricing.service.ts         ← tabla model→precio + cálculo de coste
├── repositories/
│   └── analytics.repository.ts    ← capa SQLite (CRUD + queries agregadas)
├── watcher/
│   └── projects.watcher.ts        ← chokidar sobre ~/.claude/projects/
├── types.ts                       ← tipos TS compartidos (eventos, sesiones)
└── README.md                      ← docs del módulo
```

### 5.2 Frontend — `src/components/analytics/`

```
src/components/analytics/
├── view/
│   ├── AnalyticsView.tsx              ← shell con tabs internos
│   └── tabs/
│       ├── OverviewTab.tsx
│       ├── ProjectsTab.tsx
│       ├── AgentsTab.tsx
│       ├── CostsTab.tsx
│       └── ToolsTab.tsx
├── hooks/
│   ├── useAnalyticsData.ts            ← fetch + cache + react query-style
│   ├── useDateRange.ts                ← preset + custom range
│   └── useLiveRefresh.ts              ← polling opcional cada 30s
├── charts/                            ← componentes Recharts envueltos
│   ├── SparklineCard.tsx
│   ├── TrendChart.tsx
│   ├── BreakdownPie.tsx
│   └── RankingBar.tsx
├── components/
│   ├── DateRangePicker.tsx
│   ├── MetricCard.tsx
│   └── ProjectGrid.tsx
├── types.ts
└── index.ts
```

### 5.3 Punto de integración

- **Sidebar**: nuevo item "Analytics" (icono `lucide-react/BarChart3`), paralelo a Sessions/Files/Git/MCP/Plugins.
- **Routing**: nueva ruta `/analytics` en `App.tsx`.
- **Bootstrap del server**: `server/index.ts` invoca `analytics.routes.ts` y arranca `ingest.service.bootstrap()` + `projects.watcher.start()` tras el server listen.

## 6. Esquema SQLite

Tablas nuevas en la base ya existente del upstream (sin tocar tablas existentes; namespace de tablas con prefijo `analytics_` para evitar colisiones).

```sql
CREATE TABLE analytics_projects (
  id              TEXT PRIMARY KEY,           -- hash del path
  name            TEXT NOT NULL,
  path            TEXT NOT NULL,
  first_seen      INTEGER NOT NULL,            -- unix ms
  last_seen       INTEGER NOT NULL
);

CREATE TABLE analytics_sessions (
  id                       TEXT PRIMARY KEY,   -- session_id del JSONL
  project_id               TEXT REFERENCES analytics_projects(id),
  started_at               INTEGER NOT NULL,
  ended_at                 INTEGER,
  model                    TEXT,
  tokens_input             INTEGER DEFAULT 0,
  tokens_output            INTEGER DEFAULT 0,
  tokens_cache_read        INTEGER DEFAULT 0,
  tokens_cache_create      INTEGER DEFAULT 0,
  estimated_cost_usd       REAL DEFAULT 0,
  message_count            INTEGER DEFAULT 0,
  tool_call_count          INTEGER DEFAULT 0,
  subagent_count           INTEGER DEFAULT 0,
  jsonl_path               TEXT NOT NULL,
  jsonl_mtime              INTEGER NOT NULL,
  jsonl_size               INTEGER NOT NULL
);

CREATE TABLE analytics_events (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id               TEXT NOT NULL REFERENCES analytics_sessions(id),
  ts                       INTEGER NOT NULL,
  type                     TEXT NOT NULL,      -- user_msg, assistant_msg, tool_use, tool_result, subagent_start, subagent_end
  tool_name                TEXT,
  agent_name               TEXT,               -- nombre del sub-agente si aplica
  model                    TEXT,
  tokens_input             INTEGER,
  tokens_output            INTEGER,
  tokens_cache_read        INTEGER,
  tokens_cache_create      INTEGER,
  duration_ms              INTEGER,
  is_error                 INTEGER DEFAULT 0,
  raw_offset               INTEGER             -- offset en el JSONL para debug
);

CREATE INDEX idx_analytics_events_session ON analytics_events(session_id);
CREATE INDEX idx_analytics_events_ts ON analytics_events(ts);
CREATE INDEX idx_analytics_events_tool ON analytics_events(tool_name);
CREATE INDEX idx_analytics_events_agent ON analytics_events(agent_name);
CREATE INDEX idx_analytics_sessions_project ON analytics_sessions(project_id);
CREATE INDEX idx_analytics_sessions_started ON analytics_sessions(started_at);

-- Watermark para ingest incremental
CREATE TABLE analytics_ingest_log (
  jsonl_path     TEXT PRIMARY KEY,
  last_offset    INTEGER NOT NULL DEFAULT 0,
  last_mtime     INTEGER NOT NULL,
  last_ingest    INTEGER NOT NULL,
  error_count    INTEGER DEFAULT 0
);
```

Migración: archivo SQL en `server/modules/analytics/migrations/001_init.sql`, aplicado al arrancar el módulo si las tablas no existen.

## 7. API REST

Todos bajo `/api/analytics/`. Respuestas JSON. Parámetro común `range` con valores `today | 7d | 30d | custom` (si `custom`, además `from` y `to` en ISO).

| Método | Endpoint | Propósito |
|---|---|---|
| GET | `/overview?range=` | Cards principales + sparklines |
| GET | `/projects?range=` | Grid de proyectos con métricas |
| GET | `/agents?range=` | Stats por sub-agente |
| GET | `/costs?range=&group_by=model\|project` | Coste agregado |
| GET | `/tools?range=` | Ranking herramientas + errores |
| GET | `/sessions?project_id=&limit=&offset=` | Tabla sesiones recientes |
| GET | `/session/:id` | Detalle de una sesión (chart de tokens, lista de events) |
| POST | `/reindex` | Re-scan completo (admin / debug) |
| GET | `/health` | Estado del ingest (last_ingest, error_count) |

## 8. Pipeline de ingest

1. **Bootstrap**: al arrancar el server, `ingest.service.bootstrap()` lista todos los `~/.claude/projects/*.jsonl`.
2. **Por archivo**: si `(path, mtime)` difiere de `analytics_ingest_log` → abrir archivo, hacer `seek(last_offset)`, leer línea a línea, parsear cada JSON, hacer upsert en `analytics_sessions` y append en `analytics_events`, actualizar `analytics_ingest_log`.
3. **Watcher**: tras el scan inicial, arranca `chokidar.watch('~/.claude/projects/**/*.jsonl')`. Los eventos `add` y `change` disparan el mismo flujo incremental, debounced 1 segundo para agrupar bursts.
4. **Cálculo de coste**: al cerrar una sesión (o al re-agregar), `pricing.service.calculate(session)` recorre eventos, multiplica por la tabla `MODEL_PRICING`, actualiza `estimated_cost_usd`.

### Tolerancia a errores
- Parser por línea: si una línea no es JSON válido, se loguea y se salta (no rompe el archivo entero).
- Si una sesión no tiene `session_id`, se genera fallback `sha1(jsonl_path + start_offset)`.
- Modelos no presentes en tabla de pricing → coste = 0 + warning en log; sesión sigue ingestada.

## 9. Cálculo de coste

Tabla in-code en `pricing.service.ts`:

```ts
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7':      { input: 15.00, output: 75.00, cache_read: 1.50, cache_create: 18.75 },
  'claude-sonnet-4-6':    { input:  3.00, output: 15.00, cache_read: 0.30, cache_create:  3.75 },
  'claude-haiku-4-5':     { input:  1.00, output:  5.00, cache_read: 0.10, cache_create:  1.25 },
  // precios USD por 1M tokens; actualizable manualmente
};
```

El usuario podrá ajustar valores editando esa tabla. (Sí, esto es deuda asumida — se podría externalizar a un JSON editable desde la UI en una iteración posterior.)

## 10. Frontend — vistas del MVP

### 10.1 OverviewTab
- 4 cards arriba: Sesiones · Mensajes · Tokens totales · Coste estimado. Cada card con sparkline mini.
- 1 gráfico grande: uso a lo largo del tiempo (line chart con tokens/messages).
- 1 grid debajo: top 5 proyectos por coste.
- 1 tabla: últimas 10 sesiones.

### 10.2 ProjectsTab
- Grid de cards por proyecto: nombre, path, sesiones, coste total, último uso, top 3 tools, badges (MCP/agents/skills).
- Búsqueda + sort.
- Click en card → drilldown a SessionDetail.

### 10.3 AgentsTab (pieza diferencial)
- Lista de sub-agentes invocados (agrupado por `agent_name`).
- Por agente: número de invocaciones, coste agregado, duración media, tools más usadas, modelos.
- Drill: ver sesiones donde se invocó ese agente.

### 10.4 CostsTab
- Total estimado del rango.
- Cache savings: `(cache_read_tokens × price_input) - (cache_read_tokens × price_cache_read)`.
- Donut: coste por modelo.
- Bar chart: coste por proyecto.
- Línea temporal de gasto acumulado.

### 10.5 ToolsTab
- Ranking horizontal de tools (Read, Edit, Bash, ...).
- Por tool: cantidad de calls, error rate, tiempo medio.
- Sección dedicada a MCP servers (qué servers usados, qué tools por server).

## 11. Stack adicional

Dependencias nuevas (mínimas):

| Paquete | Para | Tamaño |
|---|---|---|
| `recharts` | Gráficos React | ~70 KB gzipped |
| `date-fns` | Manejo de fechas modular | ~12 KB por función importada |

Todo lo demás (Express, SQLite, Tailwind, lucide-react, chokidar, TS) ya está en el upstream.

## 12. Estrategia con upstream

- `main` se mantiene como mirror de `upstream/main`.
- Todo el trabajo en `feat/analytics`.
- Rebase periódico (semanal o ante cada release de upstream): `git fetch upstream && git rebase upstream/main` desde `feat/analytics`.
- Conflictos esperados solo en: `App.tsx` (nueva ruta), `Sidebar.tsx` (nuevo item), `server/index.ts` (nuevo módulo registrado), `package.json` (deps nuevas).
- Si en algún momento queremos contribuir a upstream: PR desde `feat/analytics` o subset.

## 13. Hitos de implementación

1. **Setup** — rama, deps (`recharts`, `date-fns`), estructura de carpetas, migración SQL.
2. **Backend MVP** — parser JSONL, ingest inicial, repository, endpoint `/overview`.
3. **Frontend MVP** — sidebar item + `OverviewTab` con datos reales.
4. **Pipeline incremental** — watcher chokidar, ingest log, debounce.
5. **Tabs adicionales** — Projects → Agents → Costs → Tools (en ese orden).
6. **Refinamiento** — UX, edge cases, performance, tests del parser.

(El detalle de pasos lo desarrolla el plan de implementación, no este spec.)

## 14. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Esquema JSONL cambia entre versiones de Claude Code | Parser tolerante a campos desconocidos; tests con fixtures de varias versiones |
| Sesiones >100 MB en JSONL | Lectura streaming línea-a-línea, no `fs.readFile` |
| Precios de modelos desactualizados | Tabla in-code visible y editable; warning en log si modelo no está |
| Tabla SQLite crece sin límite | A futuro: TTL configurable o compactación mensual (post-MVP) |
| Conflictos con upstream al rebase | Cambios concentrados en pocos archivos compartidos; rebase frecuente |
| AGPL si se expone públicamente | Despliegue solo local en MVP; documentar la implicación |

## 15. Criterio de "done" para el MVP

- [ ] Sidebar muestra item "Analytics" y abre la vista.
- [ ] `OverviewTab` carga en <500 ms con los datos reales del usuario.
- [ ] Las 5 tabs renderizan sin error con datos reales del usuario.
- [ ] Ingest incremental funcionando: al crear una sesión nueva con Claude Code, aparece en el dashboard en <30 s.
- [ ] Cálculo de coste consistente con el `/cost` del CLI de Claude Code (±5%).
- [ ] `AgentsTab` muestra sub-agentes invocados con sus stats.
- [ ] `git rebase upstream/main` no rompe nada.
