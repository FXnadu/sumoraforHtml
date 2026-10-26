import path from 'node:path';
import { app } from 'electron';
import { spawn, type IPty } from 'node-pty';
import type { TermExitEvent, TermOutputEvent, TermSessionInfo } from '../../shared/types';
import { guardPath } from '../security/pathGuard';
import { getSettings } from './settings';

/**
 * 内嵌终端的 PTY 会话管理（内核特权层）。
 * 应用与用户工具完全解耦：不探测、不解析、不理解任何 CLI Agent 的输出，
 * 只提供真实终端（ConPTY），用户自己的 CLI 在里面跑，输入输出原样转发。
 *
 * 安全要点：
 * - 启动命令来自主进程 settings.json（用户本人填写、白名单校验），渲染层只能触发不能指定；
 * - cwd 只允许笔记所在目录或笔记库根（guardPath 校验）；
 * - 渲染层拿不到任何进程句柄，只能经 term:* IPC 收发数据。
 */

/** 输出合并窗口：对齐帧率，把零碎输出攒成一次 IPC，刷屏命令不再打爆渲染层 */
const FLUSH_INTERVAL_MS = 16;

interface Session {
  id: string;
  pty: IPty;
  /** 待转发的输出缓冲（FLUSH_INTERVAL_MS 内合并为一次事件） */
  buffer: string;
  flushTimer: NodeJS.Timeout | null;
}

const sessions = new Map<string, Session>();
let nextId = 1;
let eventSink: ((event: TermOutputEvent | TermExitEvent) => void) | null = null;

/** 主进程启动时注入事件出口（转发到主窗口 webContents） */
export function setTermEventSink(emit: (event: TermOutputEvent | TermExitEvent) => void): void {
  eventSink = emit;
}

function emit(event: TermOutputEvent | TermExitEvent): void {
  eventSink?.(event);
}

/** 把会话缓冲中的输出一次性转发（缓冲为空时是空操作） */
function flushSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
  }
  if (session.buffer === '') return;
  const data = session.buffer;
  session.buffer = '';
  emit({ sessionId, data });
}

function clampSize(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** 创建 PTY 会话；cwd 取笔记所在目录（须在库内）→ 笔记库根 → 用户主目录 */
export function createSession(options: { notePath: string; cols: number; rows: number }): TermSessionInfo {
  const settings = getSettings();
  const command = settings.cliCommand.trim();

  let cwd: string | null = null;
  if (settings.libraryRoot && options.notePath !== '') {
    try {
      cwd = path.dirname(guardPath(settings.libraryRoot, options.notePath));
    } catch {
      cwd = null;
    }
  }
  cwd ??= settings.libraryRoot ?? app.getPath('home');

  const cols = clampSize(options.cols, 20, 500);
  const rows = clampSize(options.rows, 5, 300);

  let file: string;
  let args: string[];
  if (process.platform === 'win32') {
    // /k：CLI 退出后窗口留在命令行，方便看输出、重试
    file = process.env['ComSpec'] ?? 'cmd.exe';
    args = command ? ['/d', '/k', command] : ['/d', '/k'];
  } else {
    file = process.env['SHELL'] ?? '/bin/bash';
    args = command ? ['-l', '-c', `${command}; exec $SHELL -l`] : ['-l'];
  }

  const id = `term-${nextId++}`;
  const pty = spawn(file, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: process.env as Record<string, string>,
  });

  sessions.set(id, { id, pty, buffer: '', flushTimer: null });
  pty.onData((data) => {
    const session = sessions.get(id);
    if (!session) return;
    session.buffer += data;
    if (session.flushTimer) return;
    session.flushTimer = setTimeout(() => {
      session.flushTimer = null;
      flushSession(id);
    }, FLUSH_INTERVAL_MS);
  });
  pty.onExit(({ exitCode }) => {
    // 先把残余输出发完再发退出事件，保证渲染层不丢尾帧
    flushSession(id);
    sessions.delete(id);
    emit({ sessionId: id, code: exitCode });
  });

  return { sessionId: id, cwd, command: command || null };
}

export function writeSession(sessionId: string, data: string): void {
  sessions.get(sessionId)?.pty.write(data);
}

export function resizeSession(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  try {
    session.pty.resize(clampSize(cols, 20, 500), clampSize(rows, 5, 300));
  } catch {
    // 进程可能刚退出
  }
}

export function killSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  flushSession(sessionId);
  sessions.delete(sessionId);
  try {
    session.pty.kill();
  } catch {
    // 进程可能已退出
  }
}

/** 退出应用前杀掉全部 PTY，防孤儿 */
export function killAllSessions(): void {
  for (const id of [...sessions.keys()]) killSession(id);
}
