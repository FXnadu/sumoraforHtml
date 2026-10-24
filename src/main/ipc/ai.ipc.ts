import fs from 'node:fs';
import path from 'node:path';
import { app, ipcMain } from 'electron';
import { CH } from '../../shared/ipc-channels';
import type { AgentInfo, AiSessionStartOptions } from '../../shared/types';
import { AgentSessionError, detectAgents, sendMessage, startSession, stopSession } from '../services/agentRunner';

/**
 * AI 域 IPC（docs/06 §3.1）。所有参数按不可信输入校验；
 * AgentSessionError 保留 code 透传给渲染层，便于给出针对性提示。
 */

/** 排障日志（userData/ai-detect.log）：GUI 进程 console 不可见，落文件取证 */
function appendAiLog(message: string): void {
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'ai-detect.log'),
      `${new Date().toISOString()} ${message}\n`,
      'utf8',
    );
  } catch {
    // 日志失败不影响功能
  }
}

function describeAgents(agents: AgentInfo[]): string {
  return (
    agents
      .map((a) => `${a.adapterId}:${a.available ? `ok(${a.version ?? '无版本'})` : '不可用'}`)
      .join(', ') || '(空)'
  );
}

function isStartOptions(value: unknown): value is AiSessionStartOptions {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['adapterId'] === 'string' &&
    typeof v['notePath'] === 'string' &&
    (v['cwdScope'] === 'note-dir' || v['cwdScope'] === 'library-root') &&
    typeof v['attach'] === 'object' &&
    v['attach'] !== null &&
    ((v['attach'] as Record<string, unknown>)['mode'] === 'path' ||
      (v['attach'] as Record<string, unknown>)['mode'] === 'inline')
  );
}

export function registerAiIpc(): void {
  // 启动自检：不依赖 UI 触发，直接探测一次落日志，排障有据
  void detectAgents()
    .then((agents) => appendAiLog(`startup detect => ${describeAgents(agents)}`))
    .catch((err) => appendAiLog(`startup detect 失败 => ${String(err)}`));

  ipcMain.handle(CH.AI_DETECT, async () => {
    const agents = await detectAgents();
    appendAiLog(`detect => ${describeAgents(agents)}`);
    return agents;
  });

  ipcMain.handle(CH.AI_SESSION_START, async (_evt, options: unknown) => {
    if (!isStartOptions(options)) throw new Error('参数不完整');
    try {
      return await startSession(options);
    } catch (err) {
      // invoke 的 rejection 只有 message 可传：code 以前缀形式透传给渲染层
      throw new Error(aiErrorMessage(err));
    }
  });

  ipcMain.on(CH.AI_SESSION_SEND, (_evt, payload: unknown) => {
    const v = payload as { sessionId?: unknown; text?: unknown } | null;
    if (!v || typeof v['sessionId'] !== 'string' || typeof v['text'] !== 'string') return;
    sendMessage(v['sessionId'], v['text']);
  });

  ipcMain.handle(CH.AI_SESSION_STOP, (_evt, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('参数不完整');
    stopSession(sessionId);
  });
}

/** 把 AgentSessionError 转成渲染层可识别的错误标记 */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof AgentSessionError) return `[${err.code}] ${err.message}`;
  return String(err);
}
