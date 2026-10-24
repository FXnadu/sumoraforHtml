import type { ReactNode } from 'react';
import type {
  AgentInfo,
  AiSessionEvent,
  AiSessionStartOptions,
  FileNode,
  PickedElement,
  Settings,
} from '../../shared/types';

/**
 * 插件 API 契约（apiVersion 1）。
 * 插件与宿主之间的唯一通道是 PluginContext；内置插件被 ESLint 约束只能
 * 依赖本目录与 shared/，不得 import 内核 store / main / preload / core。
 *
 * 【恢复副本】原位于 src/plugins/host/types.ts，2026-10-24 误删后逐字恢复。
 * 相对旧基线：① import 增加 AI 类型；② UiSlotId 增加 'right-panel'；
 * ③ KernelEventMap 增加 'ai-panel:changed'；④ 新增 PluginAiApi 接口，
 * PluginContext 增加 ai 字段。
 */

/** 插件可声明的权限（P4 运行时插件才生效；v1 内置插件恒为空） */
export type PluginPermission = 'read:library' | 'storage' | 'ui';

/** 插件清单：身份 + 激活时机 + 权限声明 */
export interface PluginManifest {
  /** 唯一键，点分小写风格如 'core.search'；同时是存储与启停的命名空间 */
  id: string;
  name: string;
  version: string;
  description?: string;
  /** 宿主 API 大版本；1.x 内只加不破（见 ADR-0004） */
  apiVersion: 1;
  /** 启动即激活 / 命令首次触发时激活 / 打开首篇笔记时激活 */
  activation: 'onStart' | 'onCommand' | 'onNoteOpened';
  /** activation 为 onCommand 时：声明要注册的命令 id（宿主据此装惰性占位） */
  commands?: string[];
  permissions?: PluginPermission[];
}

/** UI 插槽：内核固定的挂载点，插件只能往这些位置贡献界面 */
export type UiSlotId =
  | 'sidebar-header'
  | 'sidebar-panel'
  | 'status-bar'
  | 'note-toolbar'
  | 'settings-section'
  | 'right-panel';

/** 右键菜单贡献项 */
export interface MenuItemContribution {
  id: string;
  label: string;
  danger?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void | Promise<void>;
}

/** 插槽贡献项的可选项 */
export interface SlotContributionOptions {
  /** sidebar-panel 的折叠标题；缺省用插件 id */
  title?: string;
  /** 排序权重，默认 100，小的在前 */
  order?: number;
}

/** 内核事件表：内核 store 发出（events.ts），插件只读 */
export interface KernelEventMap {
  'library:changed': { root: string };
  'note:opened': { path: string; libraryRoot: string };
  'note:closed': { path: string };
  'note:dirty-changed': { path: string | null; dirty: boolean };
  'note:saved': { path: string; backupPath?: string };
  'note:save-failed': { path: string | null; message: string };
  'settings:changed': Partial<Settings>;
  /** 右侧 AI 面板开合（内核 App 状态变化时发出，插件据此懒启动会话） */
  'ai-panel:changed': { open: boolean };
}

export type KernelEventName = keyof KernelEventMap;

/** 插件可用的文件 API：只读（列目录、读内容；不给保存与删除） */
export interface PluginFileApi {
  listFiles(): Promise<FileNode[]>;
  readNote(absPath: string): Promise<{ path: string; html: string; encoding: string }>;
}

/** 本地 CLI Agent 能力（docs/06）：进程在主进程，插件只经此受控 API 触达 */
export interface PluginAiApi {
  /** 探测本机可用 Agent（含版本与安装位置） */
  detect(): Promise<AgentInfo[]>;
  /** 开启会话；cwd 与上下文由内核解析校验，dirty 笔记会被拒绝 */
  startSession(options: AiSessionStartOptions): Promise<{ sessionId: string }>;
  /** 追加一条用户消息（写入 Agent stdin） */
  send(sessionId: string, text: string): void;
  /** 结束会话并杀进程树 */
  stop(sessionId: string): Promise<void>;
  /** 订阅会话事件流；返回取消函数 */
  onEvent(cb: (event: AiSessionEvent) => void): () => void;
  /** 进入元素拾取：用户点击元素或放弃后 resolve（实现由内核注入，见 ai.ts） */
  pickElement(): Promise<PickedElement | null>;
  /** 兜底：在系统终端里以笔记目录为 cwd 启动本地 Agent（cwd 由内核校验） */
  openTerminal(command: string, notePath: string): Promise<{ ok: boolean }>;
}

/** 插件运行时上下文：宿主在 activate 时注入 */
export interface PluginContext {
  manifest: PluginManifest;
  commands: {
    /** 注册命令；实际命令 id 自动加 '<插件id>:' 前缀，避免与内核及其他插件冲突 */
    register(id: string, handler: (args?: unknown) => unknown): void;
    /** 执行任意命令（含内核命令，如 'kernel.open-note'） */
    execute<T = unknown>(id: string, args?: unknown): Promise<T>;
  };
  events: {
    on<K extends KernelEventName>(type: K, cb: (payload: KernelEventMap[K]) => void): () => void;
  };
  ui: {
    registerSlot(slot: UiSlotId, render: () => ReactNode, options?: SlotContributionOptions): void;
    registerContextMenuItem(target: 'note' | 'dir' | 'blank', item: MenuItemContribution): void;
    registerSettingSection(render: () => ReactNode): void;
  };
  files: PluginFileApi;
  ai: PluginAiApi;
  /** 插件私有持久化：主进程按 plugin:<id>:<key> 隔离在 plugins.json */
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
  };
}

export interface NoteDeskPlugin {
  manifest: PluginManifest;
  activate(ctx: PluginContext): void | Promise<void>;
  /** 被禁用时调用：清理副作用（如恢复主题） */
  deactivate?(): void;
}

/** 设置面板「插件」页的展示状态 */
export interface PluginRuntimeState {
  manifest: PluginManifest;
  /** 用户是否启用（不含激活失败） */
  enabled: boolean;
  /** 本次会话内激活是否失败 */
  failed: boolean;
}
