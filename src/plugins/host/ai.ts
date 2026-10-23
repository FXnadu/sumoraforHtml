import type { AgentInfo, AiSessionEvent, AiSessionStartOptions, PickedElement } from '../../shared/types';
import type { PluginAiApi } from './types';

/**
 * ctx.ai 的实现：包装 preload 暴露的 window.noteDesk.ai 具名 API（与 ctx.files 同一模式）。
 * 元素拾取依赖渲染层内核的 webview 桥（noteBridge），宿主模块不反向 import 内核，
 * 由内核启动时经 setAiPickProvider 注入实现。
 *
 * 【恢复副本】原位于 src/plugins/host/ai.ts，2026-10-24 误删后逐字恢复。
 */

let pickProvider: (() => Promise<PickedElement | null>) | null = null;

/** 内核在启动时调用：注入拾取实现（renderer/lib/noteBridge 的 requestPick） */
export function setAiPickProvider(provider: () => Promise<PickedElement | null>): void {
  pickProvider = provider;
}

/** 浏览器调试模式（dev:web，无 preload）没有 ai 命名空间：全部走安全兜底 */
const bridge = (): Window['noteDesk']['ai'] | null => window.noteDesk.ai ?? null;

export const aiApi: PluginAiApi = {
  detect: (): Promise<AgentInfo[]> => bridge()?.detect() ?? Promise.resolve([]),

  startSession: (options: AiSessionStartOptions): Promise<{ sessionId: string }> =>
    bridge()?.startSession(options) ?? Promise.reject(new Error('当前环境不可用（浏览器预览模式）')),

  send: (sessionId: string, text: string): void => {
    bridge()?.send(sessionId, text);
  },

  stop: (sessionId: string): Promise<void> => bridge()?.stop(sessionId) ?? Promise.resolve(),

  onEvent: (cb: (event: AiSessionEvent) => void): (() => void) =>
    bridge()?.onEvent(cb) ?? (() => undefined),

  pickElement: (): Promise<PickedElement | null> =>
    pickProvider ? pickProvider() : Promise.resolve(null),
};
