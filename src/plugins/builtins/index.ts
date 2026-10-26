import type { NoteDeskPlugin } from '../host/types';

/**
 * 内置插件清单。core.ai（AI 对话面板）已按「与用户工具解耦」的定位移除：
 * AI/CLI 入口改为状态栏「>_」按钮，直接在系统终端打开笔记目录，
 * 命令由用户在设置里自行配置（见 main/ipc/terminal.ipc.ts）。
 * 插件宿主本身保留，后续内置插件在此登记即可。
 */
export const BUILTIN_PLUGINS: NoteDeskPlugin[] = [];
