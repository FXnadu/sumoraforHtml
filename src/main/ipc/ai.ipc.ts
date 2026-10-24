import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { app, ipcMain } from 'electron';
import { CH } from '../../shared/ipc-channels';
import type { AgentInfo, AiSessionStartOptions } from '../../shared/types';
import {
  AgentSessionError,
  detectAgents,
  sendMessage,
  startSession,
  stopSession,
} from '../services/agentRunner';
import { guardPath } from '../security/pathGuard';
import { getLibraryRoot } from '../services/settings';

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

  /**
   * 兜底入口：在系统终端里以笔记目录为 cwd 启动本地 Agent。
   * cwd 必须过 pathGuard（渲染层入参不可信）；Windows 用 cmd start 弹独立窗口。
   */
  ipcMain.handle(CH.AI_OPEN_TERMINAL, (_evt, payload: unknown) => {
    const v = payload as { command?: unknown; notePath?: unknown } | null;
    const command = v && typeof v['command'] === 'string' ? v['command'] : 'pi';
    const notePath = v && typeof v['notePath'] === 'string' ? v['notePath'] : '';
    if (!/^[A-Za-z0-9_./:-]{1,64}$/.test(command)) throw new Error('非法命令名');

    let cwd: string | null = null;
    const root = getLibraryRoot();
    if (root && notePath) {
      try {
        cwd = path.dirname(guardPath(root, notePath));
      } catch {
        cwd = null;
      }
    }
    if (!cwd) cwd = root ?? path.join(app.getPath('home'));

    appendAiLog(`open-terminal => command=${command} cwd=${cwd}`);
    if (process.platform === 'win32') {
      const line = `start "" /D "${cwd}" cmd /k ${command}`;
      const child = spawn(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', line], {
        windowsVerbatimArguments: true,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return { ok: true };
    }
    const terminal = process.env['TERM_PROGRAM'] ?? 'x-terminal-emulator';
    const child = spawn(terminal, ['-e', command], { cwd, detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  });
}

/** 把 AgentSessionError 转成渲染层可识别的错误标记 */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof AgentSessionError) return `[${err.code}] ${err.message}`;
  return String(err);
}
