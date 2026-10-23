import type { NoteDeskPlugin } from '../host/types';
import aiPlugin from './ai';

/**
 * 内置插件清单。
 * core.ai：右侧 AI 助手面板（本地 CLI Agent 壳，docs/06）。
 *
 * 【恢复副本】原位于 src/plugins/builtins/index.ts，2026-10-24 误删后逐字恢复。
 * 注意：误删前此文件还登记了 search / recent / theme-dark 三个内置插件
 * （另一会话的工作），本副本只含 core.ai——恢复基线后请把其余插件的
 * 登记行补回来。
 */
export const BUILTIN_PLUGINS: NoteDeskPlugin[] = [aiPlugin];
