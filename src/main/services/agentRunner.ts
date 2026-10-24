import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentInfo, AiSessionEvent, AiSessionStartOptions } from '../../shared/types';
import { guardPath } from '../security/pathGuard';
import { isWindowDirty } from '../window-state';
import { getLibraryRoot } from './settings';
import { readNote } from './file';
import { detectableAdapters, getAdapter, type AgentAdapter } from './agentAdapters';

/**
 * Agent 子进程生命周期管理（docs/06 §4.3–4.4）。内核特权层：
 * 渲染进程只能经 ai:* IPC 触发，拿不到任何子进程句柄（约束 6）。
 *
 * 安全要点：
 * - spawn 一律 shell:false；.cmd/.bat 垫片经 cmd.exe /c 执行，命令与参数均来自
 *   白名单适配器的固定常量（启动前做元字符校验），用户输入只走 stdin 管道；
 * - cwd 只允许笔记所在目录或笔记库根（guardPath 校验，约束 5）；
 * - dirty 状态下拒绝开会话（约束 10，与插件侧拦截构成双保险）。
 *
 * 【恢复副本】原位于 src/main/services/agentRunner.ts，2026-10-24 误删后逐字恢复。
 * 依赖：../security/pathGuard.ts（guardPath）、../window-state.ts（isWindowDirty）、
 * ./settings.ts（getLibraryRoot）、./file.ts（readNote）——这些文件属被误删的项目地基，
 * 需从 GitHub M0 基线或另一会话恢复后本文件才能编译。
 */

/** 会话启动失败的机器可读原因（渲染层据此给出针对性提示） */
export class AgentSessionError extends Error {
  constructor(
    public readonly code:
      | 'AGENT_NOT_FOUND'
      | 'ADAPTER_UNKNOWN'
      | 'ADAPTER_PLACEHOLDER'
      | 'NOTE_OUTSIDE_LIBRARY'
      | 'NOTE_DIRTY'
      | 'SESSION_EXISTS'
      | 'SPAWN_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'AgentSessionError';
  }
}

type Emit = (event: AiSessionEvent) => void;

interface Session {
  id: string;
  adapter: AgentAdapter;
  child: ChildProcess;
  notePath: string;
  /** stdout 半行缓冲 */
  buffer: string;
}

const sessions = new Map<string, Session>();
let nextSessionId = 1;
let eventSink: Emit | null = null;

/** 主进程启动时注入事件出口（转发到主窗口 webContents） */
export function setAgentEventSink(emit: Emit): void {
  eventSink = emit;
}

function emit(event: AiSessionEvent): void {
  eventSink?.(event);
}

// ── 可执行文件解析 ─────────────────────────────────────────

interface ResolvedCommand {
  /** 可直接 spawn 的可执行文件（Windows 下 .cmd/.bat 为绝对路径） */
  exe: string;
  /** .cmd/.bat 垫片需要经 cmd.exe 执行 */
  kind: 'direct' | 'cmd-shim';
}

const SAFE_ARG = /^[A-Za-z0-9_./:-]{1,64}$/;

/** Windows GUI 启动时 PATH 可能缺用户级目录，补充探测常见安装位置 */
function windowsProbeDirs(): string[] {
  const dirs: string[] = [];
  if (process.env['APPDATA']) dirs.push(path.join(process.env['APPDATA'], 'npm'));
  if (process.env['USERPROFILE']) dirs.push(path.join(process.env['USERPROFILE'], '.local', 'bin'));
  return dirs;
}

/** Windows cmd 垫片只接受不含空白/元字符的固定参数；用户内容永远不进命令行 */
function spawnResolved(
  resolved: ResolvedCommand,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): ChildProcess {
  for (const arg of args) {
    if (!SAFE_ARG.test(arg)) throw new AgentSessionError('SPAWN_FAILED', `适配器参数含非法字符：${arg}`);
  }
  if (resolved.kind === 'cmd-shim') {
    const comspec = process.env['ComSpec'] ?? 'cmd.exe';
    const line = `"${resolved.exe}" ${args.join(' ')}`;
    return spawn(comspec, ['/d', '/s', '/c', line], {
      cwd,
      env: env ? { ...process.env, ...env } : undefined,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  return spawn(resolved.exe, args, {
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * 用 --version 真实验证可执行性。spawn 的 ENOENT 是异步 error 事件，
 * 同步 try/catch 判断不了「命令是否存在」，必须等事件。
 * 返回 null 表示该候选不可用（不存在或 5 秒无响应）。
 */
function tryRunVersion(resolved: ResolvedCommand, piEnv?: Record<string, string>): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnResolved(resolved, ['--version'], process.cwd(), piEnv);
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      // 能挂着跑 5 秒说明进程存在，只是 --version 不退出：按可用、无版本处理
      finish('');
    }, 5000);
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.on('error', () => finish(null));
    child.on('close', () => finish(firstLine(out) ?? ''));
  });
}

/** 定位命令：直接 spawn 得到确认（Windows 下再探测常见安装目录的 .cmd/.bat 垫片） */
async function locateAgent(
  command: string,
  env?: Record<string, string>,
): Promise<{ resolved: ResolvedCommand; version: string | null } | null> {
  const version = await tryRunVersion({ exe: command, kind: 'direct' }, env);
  if (version !== null) return { resolved: { exe: command, kind: 'direct' }, version };

  if (process.platform === 'win32') {
    for (const dir of windowsProbeDirs()) {
      for (const ext of ['.cmd', '.bat']) {
        const candidate = path.join(dir, `${command}${ext}`);
        if (!fs.existsSync(candidate)) continue;
        const shimVersion = await tryRunVersion({ exe: candidate, kind: 'cmd-shim' }, env);
        if (shimVersion !== null) return { resolved: { exe: candidate, kind: 'cmd-shim' }, version: shimVersion };
      }
    }
  }
  return null;
}

// ── 探测 ───────────────────────────────────────────────────

/** 逐一探测适配器可用性；探测即真实 spawn --version，不猜 PATH */
export async function detectAgents(): Promise<AgentInfo[]> {
  const results: AgentInfo[] = [];
  for (const adapter of detectableAdapters()) {
    const located = adapter.command ? await locateAgent(adapter.command, adapter.env) : null;
    if (!located) {
      results.push({ adapterId: adapter.id, name: adapter.name, available: false });
      continue;
    }
    results.push({
      adapterId: adapter.id,
      name: adapter.name,
      available: true,
      version: located.version ?? undefined,
      source: located.resolved.kind === 'cmd-shim' ? located.resolved.exe : undefined,
    });
  }
  return results;
}

function firstLine(text: string): string | null {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '');
  if (!line) return null;
  const trimmed = line.trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

// ── 会话管理 ───────────────────────────────────────────────

/** 活跃会话 id；v1 全局至多一个（docs/06 §4.3） */
export function activeSessionId(): string | null {
  return sessions.size === 0 ? null : [...sessions.keys()][0] ?? null;
}

export async function startSession(options: AiSessionStartOptions): Promise<{ sessionId: string }> {
  const existing = activeSessionId();
  if (existing) throw new AgentSessionError('SESSION_EXISTS', '已有活跃会话，请先结束');

  const adapter = getAdapter(options.adapterId);
  if (!adapter) throw new AgentSessionError('ADAPTER_UNKNOWN', `未知适配器：${options.adapterId}`);
  if (adapter.command === null) {
    throw new AgentSessionError('ADAPTER_PLACEHOLDER', '该适配器为协议占位，不可直接启动');
  }

  const root = getLibraryRoot();
  if (!root) throw new AgentSessionError('NOTE_OUTSIDE_LIBRARY', '尚未选择笔记库');
  try {
    guardPath(root, options.notePath);
  } catch {
    throw new AgentSessionError('NOTE_OUTSIDE_LIBRARY', '笔记不在当前笔记库内');
  }

  // 约束 10：dirty 笔记不得开会话（Agent 以磁盘状态为准）
  if (isWindowDirty()) throw new AgentSessionError('NOTE_DIRTY', '当前笔记有未保存修改，请先保存');

  const cwd =
    options.cwdScope === 'library-root' ? path.resolve(root) : path.dirname(path.resolve(options.notePath));

  const located = await locateAgent(adapter.command, adapter.env);
  if (!located) {
    throw new AgentSessionError('AGENT_NOT_FOUND', `本机未找到 ${adapter.name}，请先安装并确保其在 PATH 中`);
  }
  const resolved = located.resolved;

  const sessionId = `ai-${nextSessionId++}`;
  let child: ChildProcess;
  try {
    child = spawnResolved(resolved, adapter.buildArgs(), cwd, adapter.env);
  } catch (err) {
    throw new AgentSessionError('SPAWN_FAILED', `启动 ${adapter.name} 失败：${String(err)}`);
  }

  const session: Session = { id: sessionId, adapter, child, notePath: options.notePath, buffer: '' };
  sessions.set(sessionId, session);

  const parser = adapter.createParser();
  child.stdout?.on('data', (chunk: Buffer) => {
    session.buffer += chunk.toString('utf8');
    let index: number;
    while ((index = session.buffer.indexOf('\n')) >= 0) {
      const line = session.buffer.slice(0, index);
      session.buffer = session.buffer.slice(index + 1);
      for (const parsed of parser.feed(line)) {
        emit({ ...parsed, sessionId } as AiSessionEvent);
      }
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = firstLine(chunk.toString('utf8'));
    if (text) emit({ type: 'status', sessionId, text: `${adapter.name}: ${text}` });
  });
  child.on('error', (err) => {
    emit({ type: 'error', sessionId, message: `Agent 进程异常：${String(err)}` });
  });
  child.on('exit', (code) => {
    sessions.delete(sessionId);
    emit({ type: 'exit', sessionId, code });
  });

  emit({ type: 'started', sessionId });

  // 会话首条上下文（docs/06 §4.3）：默认只附路径与元信息，Agent 自行读盘
  void writeContextMessage(sessionId, options);

  return { sessionId };
}

async function writeContextMessage(sessionId: string, options: AiSessionStartOptions): Promise<void> {
  let context: string;
  try {
    const root = getLibraryRoot();
    if (!root) return;
    const note = await readNote(root, options.notePath);
    const sizeKB = (Buffer.byteLength(note.html, 'utf8') / 1024).toFixed(1);
    context = `（系统上下文）用户正在 HTML 笔记应用中打开笔记：${note.path}（${sizeKB} KB，${note.encoding}）。`;
    if (options.attach.mode === 'inline') {
      const limit = Math.max(1, options.attach.maxInlineKB ?? 64) * 1024;
      const html = note.html.length > limit ? `${note.html.slice(0, limit)}\n…（已截断）` : note.html;
      context += `全文内容如下：\n\n${html}`;
    } else {
      context += '请先读取该文件了解内容，再回答后续问题。';
    }
  } catch (err) {
    context = `（系统上下文）用户正在查看笔记：${options.notePath}（读取元信息失败：${String(err)}）。`;
  }
  sendMessage(sessionId, context);
}

export function sendMessage(sessionId: string, text: string): void {
  const session = sessions.get(sessionId);
  if (!session || !session.child.stdin?.writable) return;
  try {
    session.child.stdin.write(session.adapter.encodeMessage(text));
  } catch (err) {
    emit({ type: 'error', sessionId, message: `写入 Agent 失败：${String(err)}` });
  }
}

/** 结束会话并杀掉整棵进程树（Windows 下 Agent 常派生子进程，约束 12） */
export function stopSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  killTree(session.child);
  sessions.delete(sessionId);
}

export function stopAllSessions(): void {
  for (const session of sessions.values()) killTree(session.child);
  sessions.clear();
}

function killTree(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      return;
    } catch {
      // taskkill 不可用时退回常规 kill
    }
  }
  try {
    child.kill();
  } catch {
    // 进程可能已退出
  }
}
