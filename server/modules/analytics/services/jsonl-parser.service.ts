// server/modules/analytics/services/jsonl-parser.service.ts
import { readFile, stat } from 'node:fs/promises';

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
 * Reads a JSONL session file starting at `startOffset`, tolerating malformed
 * lines and returning the meta + parsed events plus the final byte offset.
 * Uses readFile + manual CRLF-aware line splitting to avoid offset drift on
 * Windows-written files with \r\n line endings.
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

  // Read the new bytes only (typically << 100MB for a single session file).
  const buf = await readFile(filePath);
  const slice = buf.subarray(startOffset);

  // Inner helper — contains all parse/emit logic, called once per line.
  const processLine = (line: string, rawOffset: number): void => {
    if (!line) return; // skip empty lines

    let raw: RawLine;
    try {
      raw = JSON.parse(line);
    } catch {
      return; // skip malformed
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
      return;
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
      return;
    }

    if (baseType === 'system') {
      events.push({ ts, type: 'system', rawOffset });
      return;
    }

    // Unknown type — skip silently (tolerant to schema changes).
  };

  // Manual CRLF-aware line splitting.
  // We scan for LF (0x0a) bytes. If the byte before LF is CR (0x0d) the line
  // content ends before the CR. This correctly handles both \n and \r\n files
  // without offset drift.
  let lineStart = 0;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] !== 0x0a /* \n */) continue;
    // Found end of line at index i (LF).
    // The line content ends before \r if CRLF, otherwise before \n.
    const lineEnd = i > 0 && slice[i - 1] === 0x0d /* \r */ ? i - 1 : i;
    const lineBytes = slice.subarray(lineStart, lineEnd);
    const rawOffset = startOffset + lineStart;

    processLine(lineBytes.toString('utf8'), rawOffset);

    lineStart = i + 1;
  }

  // Handle a final line that has no trailing newline.
  if (lineStart < slice.length) {
    const lineBytes = slice.subarray(lineStart);
    const rawOffset = startOffset + lineStart;
    processLine(lineBytes.toString('utf8'), rawOffset);
    lineStart = slice.length;
  }

  const endOffset = startOffset + lineStart;

  return {
    meta: {
      sessionId: sessionId ?? '',
      projectPath: projectPath ?? '',
      startedAt: startedAt ?? Date.now(),
      endedAt,
      model: sessionModel,
    },
    events,
    endOffset,
  };
}
