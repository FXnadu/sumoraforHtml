import { describe, expect, it } from 'vitest';
import type { AgentParsedEvent } from './agentAdapters';
import {
  claudeCodeAdapter,
  detectableAdapters,
  genericJsonlAdapter,
  piAdapter,
} from './agentAdapters';

/**
 * claude-code fixture 依据 stream-json 模式的公开事件形态编写；
 * pi fixture 依据其官方 docs/json.md / docs/rpc.md 与本机 1.4.0 实测记录编写。
 * 接入真实 CLI 后如格式有出入，先改这里的 fixture 再改解析器（docs/06 §8）。
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
    expect(detectableAdapters().map((a) => a.id)).toEqual(['claude-code', 'pi']);
  });
});

describe('pi 适配器（RPC 模式）', () => {
  function feedPi(lines: string[]): AgentParsedEvent[][] {
    const parser = piAdapter.createParser();
    return lines.map((line) => parser.feed(line));
  }

  it('命令失败响应映射为 error（本机实测的错误形状）', () => {
    const events = feedPi([
      JSON.stringify({
        id: 'p1',
        type: 'response',
        command: 'prompt',
        success: false,
        error: 'No API key found for the selected model.\n\nUse /login to log into a provider via OAuth or API key.',
      }),
    ]);
    expect(events[0]).toEqual([
      { type: 'error', message: 'No API key found for the selected model.\n\nUse /login to log into a provider via OAuth or API key.' },
    ]);
  });

  it('prompt 成功响应与其他命令响应映射为 status / 忽略', () => {
    const events = feedPi([
      JSON.stringify({ id: 'p1', type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } }),
      JSON.stringify({ id: 's1', type: 'response', command: 'get_state', success: true, data: { model: {} } }),
    ]);
    expect(events[0]).toEqual([{ type: 'status', text: '已接收提问' }]);
    expect(events[1]).toEqual([]);
  });

  it('text_delta 流式增量与思考状态', () => {
    const events = feedPi([
      JSON.stringify({
        type: 'message_update',
        usage: {},
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '你好' },
      }),
      JSON.stringify({
        type: 'message_update',
        usage: {},
        assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: '想想' },
      }),
    ]);
    expect(events[0]).toEqual([{ type: 'delta', text: '你好' }]);
    expect(events[1]).toEqual([{ type: 'status', text: '思考中…' }]);
  });

  it('工具调用映射为 status', () => {
    const events = feedPi([
      JSON.stringify({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'read', args: {} }),
    ]);
    expect(events[0]).toEqual([{ type: 'status', text: '工具调用：read' }]);
  });

  it('message_end 权威全文 + agent_settled 触发 complete（字符串 content）', () => {
    const events = feedPi([
      JSON.stringify({ type: 'message_update', usage: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '流式' } }),
      JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: '完整回答' } }),
      JSON.stringify({ type: 'agent_settled', aborted: false }),
    ]);
    expect(events[1]).toEqual([]);
    // complete 取 message_end 的权威全文，而非流式拼接
    expect(events[2]).toEqual([{ type: 'complete', text: '完整回答' }]);
  });

  it('content 为内容块数组时拼接全部 text 块', () => {
    const events = feedPi([
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '第一段' },
            { type: 'tool_use', id: 't', name: 'read' },
            { type: 'text', text: '第二段' },
          ],
        },
      }),
      JSON.stringify({ type: 'agent_settled', aborted: false }),
    ]);
    expect(events[1]).toEqual([{ type: 'complete', text: '第一段第二段' }]);
  });

  it('settled 后 lastText 清空：下一段运行不残留旧答案', () => {
    const events = feedPi([
      JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: '第一次' } }),
      JSON.stringify({ type: 'agent_settled', aborted: false }),
      JSON.stringify({ type: 'agent_settled', aborted: false }),
    ]);
    expect(events[1]).toEqual([{ type: 'complete', text: '第一次' }]);
    expect(events[2]).toEqual([{ type: 'complete', text: '' }]);
  });

  it('user 消息的 message_end 与未知记录一律忽略；auto_retry 映射 status', () => {
    const events = feedPi([
      JSON.stringify({ type: 'message_end', message: { role: 'user', content: '提问' } }),
      JSON.stringify({ type: 'queue_update', steering: [], followUp: [] }),
      '不是 JSON',
      JSON.stringify({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: '529' }),
    ]);
    expect(events[0]).toEqual([]);
    expect(events[1]).toEqual([]);
    expect(events[2]).toEqual([]);
    expect(events[3]).toEqual([{ type: 'status', text: '模型繁忙，自动重试…' }]);
  });

  it('encodeMessage 生成 prompt 命令行且带自增 id', () => {
    const a = JSON.parse(piAdapter.encodeMessage('你好'));
    const b = JSON.parse(piAdapter.encodeMessage('第二条'));
    expect(a).toEqual({ id: 'm1', type: 'prompt', message: '你好' });
    expect(b.id).toBe('m2');
    expect(b.message).toBe('第二条');
  });

  it('启动参数全部通过安全校验（spawn 白名单前提）', () => {
    for (const arg of piAdapter.buildArgs()) {
      expect(arg).toMatch(/^[A-Za-z0-9_./:-]+$/);
    }
  });
});
