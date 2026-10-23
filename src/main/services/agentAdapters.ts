import type { AiSessionEvent } from '../../shared/types';

/**
 * 本地 CLI Agent 适配器（docs/06 §4）。
 * 适配器只做两件事：把用户消息编码成 stdin 行、把 stdout 行解析成归一化事件。
 * 解析器必须容错：未知行返回空数组，绝不抛异常（约束 15），否则一条
 * 意外的输出就会杀死整个会话。
 *
 * 注意：claude-code 的行格式来自 stream-json 模式的公开文档形态，
 * fixture（agentAdapters.spec.ts）以真实会话录制为准，版本漂移时改 fixture 与解析器。
 *
 * 【恢复副本】原位于 src/main/services/agentAdapters.ts，2026-10-24 误删后逐字恢复。
 */

/** 解析层的事件（无 sessionId，由 runner 统一盖章）；分配式 Omit 保留联合各成员的字段 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type AgentParsedEvent = DistributiveOmit<AiSessionEvent, 'sessionId'>;

export interface AgentSessionParser {
  /** 解析 stdout 一行；返回 0..n 个归一化事件 */
  feed(line: string): AgentParsedEvent[];
}

export interface AgentAdapter {
  id: string;
  name: string;
  /** 可执行文件名；null 表示协议占位适配器，不参与探测与直接启动 */
  command: string | null;
  /** 固定启动参数。禁止包含用户输入与空白/元字符（runner 启动时校验，约束 4） */
  buildArgs(): string[];
  /** 用户消息编码为写入 stdin 的一行 */
  encodeMessage(text: string): string;
  /** 每个会话独立的解析器实例（有轮内状态） */
  createParser(): AgentSessionParser;
}

function safeJsonParse(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// ── claude-code：官方 stream-json 输入输出模式 ─────────────────────

interface ClaudeParserState {
  /** 本轮是否已收到流式增量；旧版只发 assistant 全量消息，用作回退路径 */
  sawStreamDelta: boolean;
  /** 回退路径累积的文本，result 缺失 result 字段时兜底 */
  fallbackText: string;
}

function createClaudeParser(): AgentSessionParser {
  const state: ClaudeParserState = { sawStreamDelta: false, fallbackText: '' };

  return {
    feed(line: string): AgentParsedEvent[] {
      const obj = safeJsonParse(line);
      if (!obj) return [];
      const type = asString(obj['type']);

      if (type === 'system') {
        const subtype = asString(obj['subtype']);
        if (subtype === 'init') return [{ type: 'status', text: 'Agent 会话已连接' }];
        return [];
      }

      if (type === 'stream_event') {
        const event = obj['event'];
        if (typeof event !== 'object' || event === null) return [];
        const evt = event as Record<string, unknown>;
        if (asString(evt['type']) !== 'content_block_delta') return [];
        const delta =
          typeof evt['delta'] === 'object' && evt['delta'] !== null
            ? (evt['delta'] as Record<string, unknown>)
            : null;
        const text = delta ? asString(delta['text']) : null;
        if (text == null) return [];
        state.sawStreamDelta = true;
        state.fallbackText += text;
        return [{ type: 'delta', text }];
      }

      if (type === 'assistant') {
        // 无流式增量的版本在这里给出整段消息；有流式时跳过避免重复
        const message = obj['message'];
        if (typeof message !== 'object' || message === null) return [];
        const content = (message as Record<string, unknown>)['content'];
        if (!Array.isArray(content)) return [];
        const events: AgentParsedEvent[] = [];
        for (const block of content) {
          if (typeof block !== 'object' || block === null) continue;
          const b = block as Record<string, unknown>;
          if (asString(b['type']) === 'tool_use') {
            events.push({ type: 'status', text: `工具调用：${asString(b['name']) ?? '未知工具'}` });
          } else if (asString(b['type']) === 'text') {
            const text = asString(b['text']);
            if (text != null && !state.sawStreamDelta) {
              state.fallbackText += text;
              events.push({ type: 'delta', text });
            }
          }
        }
        return events;
      }

      if (type === 'result') {
        const resultText = asString(obj['result']) ?? state.fallbackText;
        const isError = obj['is_error'] === true || asString(obj['subtype']) === 'error_max_turns';
        state.sawStreamDelta = false;
        state.fallbackText = '';
        if (isError) {
          return [
            { type: 'error', message: resultText || 'Agent 返回错误结果' },
            { type: 'complete', text: resultText },
          ];
        }
        return [{ type: 'complete', text: resultText }];
      }

      // 未知行：静默容错（约束 15）
      return [];
    },
  };
}

export const claudeCodeAdapter: AgentAdapter = {
  id: 'claude-code',
  name: 'Claude Code',
  command: 'claude',
  buildArgs: () => ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
  encodeMessage: (text: string): string =>
    `${JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
    })}\n`,
  createParser: createClaudeParser,
};

// ── generic-jsonl：本应用定义的最小 JSON 行协议（占位，验证适配层抽象） ──
// 约定：stdin 每行 {"type":"user","text":"…"}
//       stdout 每行 {"type":"delta"|"status"|"result"|"error","text"|"message":"…"}
// 后续接入 codex / gemini / pi 等即按此抽象各写一个 adapter，内核与 UI 零改动。

function createGenericParser(): AgentSessionParser {
  return {
    feed(line: string): AgentParsedEvent[] {
      const obj = safeJsonParse(line);
      if (!obj) return [];
      const type = asString(obj['type']);
      if (type === 'delta' || type === 'status') {
        const text = asString(obj['text']);
        return text == null ? [] : [{ type, text }];
      }
      if (type === 'result') {
        return [{ type: 'complete', text: asString(obj['text']) ?? '' }];
      }
      if (type === 'error') {
        return [{ type: 'error', message: asString(obj['message']) ?? '未知错误' }];
      }
      return [];
    },
  };
}

export const genericJsonlAdapter: AgentAdapter = {
  id: 'generic-jsonl',
  name: '通用 JSON 行协议（预留）',
  command: null,
  buildArgs: () => [],
  encodeMessage: (text: string): string =>
    `${JSON.stringify({ type: 'user', text })}\n`,
  createParser: createGenericParser,
};

const adapters: AgentAdapter[] = [claudeCodeAdapter, genericJsonlAdapter];

export function getAdapter(id: string): AgentAdapter | null {
  return adapters.find((adapter) => adapter.id === id) ?? null;
}

/** 参与探测的适配器（command 非 null） */
export function detectableAdapters(): AgentAdapter[] {
  return adapters.filter((adapter) => adapter.command !== null);
}
