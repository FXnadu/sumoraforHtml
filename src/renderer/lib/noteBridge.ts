import { WV } from '../../shared/ipc-channels';
import type { PickedElement, SerializeResponse } from '../../shared/types';

/** <webview> 元素在渲染进程可用的最小接口 */
export interface WebviewElement extends HTMLElement {
  send(channel: string, ...args: unknown[]): void;
  insertCSS(css: string): Promise<string>;
}

interface PendingRequest {
  resolve: (value: { html: string; signature: string }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let current: WebviewElement | null = null;
let nextId = 0;
const pending = new Map<number, PendingRequest>();

/** NotePane 挂载 / 卸载时登记当前 webview */
export function attachWebview(el: WebviewElement | null): void {
  current = el;
}

export function detachWebview(el: WebviewElement): void {
  if (current === el) {
    current = null;
    // 容器即将卸载：拾取等待必须落定，否则 Promise 悬挂
    handlePickResult(null);
  }
}

/** 请求 webview 序列化当前 DOM；失败或超时都 reject，绝不返回空内容 */
export function requestSerialize(): Promise<{ html: string; signature: string }> {
  const webview = current;
  if (!webview) return Promise.reject(new Error('笔记容器尚未就绪'));

  const requestId = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('序列化超时'));
    }, 10000);
    pending.set(requestId, { resolve, reject, timer });
    try {
      webview.send(WV.SERIALIZE, requestId);
    } catch (err) {
      clearTimeout(timer);
      pending.delete(requestId);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** 处理 webview 通过 ipc-message 上报的序列化结果 */
export function handleSerializeResponse(response: SerializeResponse): void {
  const entry = pending.get(response.requestId);
  if (!entry) return;
  pending.delete(response.requestId);
  clearTimeout(entry.timer);
  if (response.error || !response.html) {
    entry.reject(new Error(response.error ?? '序列化结果为空'));
    return;
  }
  entry.resolve({ html: response.html, signature: response.signature });
}

/** 开关编辑模式（默认开启） */
export function sendEditable(on: boolean): void {
  try {
    current?.send(WV.SET_EDITABLE, on);
  } catch {
    // webview 尚未挂载完成：等下一次 dom-ready 再发
  }
}

/** 保存成功后让 webview 重置自身脏标记 */
export function sendMarkClean(): void {
  try {
    current?.send(WV.MARK_CLEAN);
  } catch {
    // 忽略：容器正在销毁
  }
}

// ── 元素拾取（docs/06 §5）──────────────────────────────────

/** 拾取等待中的 resolve；同一时刻至多一个 */
let pendingPick: ((value: PickedElement | null) => void) | null = null;

/** 请求进入拾取模式；用户点选 / 按 Esc / 容器卸载时 resolve */
export function requestPick(): Promise<PickedElement | null> {
  const webview = current;
  if (!webview) return Promise.resolve(null);
  // 重复触发时先作废上一个等待
  pendingPick?.(null);
  return new Promise((resolve) => {
    pendingPick = resolve;
    try {
      webview.send(WV.AI_PICK_START);
    } catch {
      pendingPick = null;
      resolve(null);
    }
  });
}

/** webview 回传拾取结果（null 表示取消）；NotePane 在 ipc-message 里调用 */
export function handlePickResult(element: PickedElement | null): void {
  const resolve = pendingPick;
  pendingPick = null;
  resolve?.(element);
}

/** 容器卸载 / 面板收起时主动退出拾取 */
export function stopPick(): void {
  try {
    current?.send(WV.AI_PICK_STOP);
  } catch {
    // 忽略：容器正在销毁
  }
  handlePickResult(null);
}

/**
 * 【恢复副本】原位于 src/renderer/lib/noteBridge.ts，2026-10-24 误删后逐字恢复。
 * 此版本 = 误删前最终状态：在 M0/插件期地基上追加了文件尾部的「元素拾取」段
 * 与 detachWebview 里的拾取落定。若从旧基线恢复，重放这两处即可。
 */
