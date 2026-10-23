import { ipcMain } from 'electron';
import { CH } from '../../shared/ipc-channels';
import type { AiSessionStartOptions } from '../../shared/types';
import { AgentSessionError, detectAgents, sendMessage, startSession, stopSession } from '../services/agentRunner';

/**
 * AI 域 IPC（docs/06 §3.1）。所有参数按不可信输入校验；
 * AgentSessionError 保留 code 透传给渲染层，便于给出针对性提示。
 *
 * 【恢复副本】原位于 src/main/ipc/ai.ipc.ts，2026-10-24 误删后逐字恢复。
 */

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
  ipcMain.handle(CH.AI_DETECT, () => detectAgents());

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
