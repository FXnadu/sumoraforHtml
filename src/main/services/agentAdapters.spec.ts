import { describe, expect, it } from 'vitest';
import type { AgentParsedEvent } from './agentAdapters';
import { claudeCodeAdapter, detectableAdapters, genericJsonlAdapter } from './agentAdapters';

/**
 * claude-code fixture 依据 stream-json 模式的公开事件形态编写；
 * 接入真实 CLI 后如格式有出入，先改这里的 fixture 再改解析器（docs/06 §8）。
 *
 * 【恢复副本】原位于 src/main/services/agentAdapters.spec.ts，2026-10-24 误删后逐字恢复。
 */

function feedAll(lines: string[]): AgentParsedEvent[][] {
  const parser = claudeCodeAdapter.createParser();
  return lines.map((line) => parser.feed(line));
}

describe('claude-code 适配器', () => {
  it('init 系统事件映射为 status', () => {
    const events = feedAll([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc', tools: [] }),
    ]);
    expect(events).toEqual([[{ type: 'status', text: 'Agent 会话已连接' }]]);
  });

  it('stream_event 文本增量映射为 delta', () => {
    const events = feedAll([
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } },
      }),
    ]);
    expect(events).toEqual([[{ type: 'delta', text: '你好' }]]);
  });

  it('assistant 工具调用映射为 status，流式路径下的文本不重复发 delta', () => {
    const events = feedAll([
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '正在查' } },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 't1', name: 'Read', input: {} },
            { type: 'text', text: '正在查' },
          ],
        },
      }),
    ]);
    expect(events[1]).toEqual([{ type: 'status', text: '工具调用：Read' }]);
  });

  it('无流式增量时 assistant 全量文本作为回退 delta', () => {
    const events = feedAll([
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: '整段回答' }] },
      }),
    ]);
    expect(events[0]).toEqual([{ type: 'delta', text: '整段回答' }]);
  });

  it('result 成功事件映射为 complete，文本取 result 字段', () => {
    const events = feedAll([
      JSON.stringify({ type: 'result', subtype: 'success', result: '最终回答', is_error: false }),
    ]);
    expect(events[0]).toEqual([{ type: 'complete', text: '最终回答' }]);
  });

  it('result 缺 result 字段时用已累积文本兜底', () => {
    const events = feedAll([
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '流式内容' } },
      }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ]);
    expect(events[1]).toEqual([{ type: 'complete', text: '流式内容' }]);
  });

  it('result 错误事件同时产生 error 与 complete', () => {
    const events = feedAll([JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '出错了' })]);
    expect(events[0]).toEqual([
      { type: 'error', message: '出错了' },
      { type: 'complete', text: '出错了' },
    ]);
  });

  it('未知类型 / 非法 JSON / 空行一律静默容错（约束 15）', () => {
    const parser = claudeCodeAdapter.createParser();
    expect(parser.feed('')).toEqual([]);
    expect(parser.feed('不是 JSON')).toEqual([]);
    expect(parser.feed(JSON.stringify({ type: 'mystery' }))).toEqual([]);
    expect(parser.feed(JSON.stringify([1, 2]))).toEqual([]);
    expect(parser.feed('null')).toEqual([]);
  });

  it('encodeMessage 生成 stream-json 用户消息行', () => {
    const line = claudeCodeAdapter.encodeMessage('你好');
    expect(JSON.parse(line)).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '你好' }] },
    });
    expect(line.endsWith('\n')).toBe(true);
  });

  it('启动参数不含空白与元字符（spawn 安全前提）', () => {
    for (const arg of claudeCodeAdapter.buildArgs()) {
      expect(arg).toMatch(/^[A-Za-z0-9_./:-]+$/);
    }
  });
});

describe('generic-jsonl 适配器', () => {
  it('delta / status / result / error 全事件映射', () => {
    const parser = genericJsonlAdapter.createParser();
    expect(parser.feed(JSON.stringify({ type: 'delta', text: 'a' }))).toEqual([{ type: 'delta', text: 'a' }]);
    expect(parser.feed(JSON.stringify({ type: 'status', text: '思考中' }))).toEqual([
      { type: 'status', text: '思考中' },
    ]);
    expect(parser.feed(JSON.stringify({ type: 'result', text: '完成' }))).toEqual([
      { type: 'complete', text: '完成' },
    ]);
    expect(parser.feed(JSON.stringify({ type: 'error', message: '坏了' }))).toEqual([
      { type: 'error', message: '坏了' },
    ]);
    expect(parser.feed('garbage')).toEqual([]);
  });

  it('占位适配器不参与探测', () => {
    expect(genericJsonlAdapter.command).toBeNull();
    expect(detectableAdapters().map((a) => a.id)).toEqual(['claude-code']);
  });
});
