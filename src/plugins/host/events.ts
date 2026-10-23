import type { KernelEventMap, KernelEventName } from './types';

/**
 * 内核事件总线：内核 store 单向发出，插件只读订阅。
 * 处理器按 owner 登记（内核或插件 id），供禁用插件时整体注销、
 * 惰性激活时把触发事件回放给刚激活的插件（保证不漏第一条）。
 */

type AnyHandler = (payload: unknown) => void;

interface HandlerEntry {
  owner: string;
  handler: AnyHandler;
}

const handlers = new Map<KernelEventName, HandlerEntry[]>();

function invoke(entry: HandlerEntry, type: KernelEventName, payload: unknown): void {
  try {
    entry.handler(payload);
  } catch (err) {
    console.error(`[plugins] 事件处理出错（${type}，${entry.owner}）`, err);
  }
}

/** 内核侧调用：发出一条事件 */
export function emitKernelEvent<K extends KernelEventName>(
  type: K,
  payload: KernelEventMap[K],
): void {
  const list = handlers.get(type);
  if (!list) return;
  for (const entry of [...list]) invoke(entry, type, payload);
}

/** 订阅事件；返回取消函数。owner 用于按插件整体注销 */
export function onKernelEvent<K extends KernelEventName>(
  type: K,
  cb: (payload: KernelEventMap[K]) => void,
  owner = 'kernel',
): () => void {
  const entry: HandlerEntry = { owner, handler: cb as AnyHandler };
  const list = handlers.get(type) ?? [];
  list.push(entry);
  handlers.set(type, list);
  return () => {
    const current = handlers.get(type);
    if (!current) return;
    const index = current.indexOf(entry);
    if (index >= 0) current.splice(index, 1);
  };
}

/** 把一条已发生的事件只回放给指定 owner 的处理器（onNoteOpened 惰性激活用） */
export function replayKernelEventToOwner<K extends KernelEventName>(
  owner: string,
  type: K,
  payload: KernelEventMap[K],
): void {
  const list = handlers.get(type);
  if (!list) return;
  for (const entry of [...list]) {
    if (entry.owner === owner) invoke(entry, type, payload);
  }
}

/** 注销某 owner 的全部事件订阅（禁用插件时清理） */
export function offKernelEventsOf(owner: string): void {
  for (const [type, list] of handlers) {
    handlers.set(
      type,
      list.filter((entry) => entry.owner !== owner),
    );
  }
}
