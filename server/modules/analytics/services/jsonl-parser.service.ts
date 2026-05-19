// server/modules/analytics/services/jsonl-parser.service.ts
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import readline from 'node:readline';

import type { ParsedEvent, ParsedSessionMeta } from '@/modules/analytics/types.js';

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
    // +1 for the newline that readline strips. On Windows files written with
    // explicit `\n` separators (as our fixtures do) this is exact; if a file
    // contains CRLF we may be off by 1 per line but the watermark still moves
    // forward monotonically — incremental ingest stays correct.
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
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_use') {
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
