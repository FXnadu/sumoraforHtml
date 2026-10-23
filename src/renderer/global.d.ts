import type {
  AgentInfo,
  AiSessionEvent,
  AiSessionStartOptions,
  FileChangeEvent,
  FileNode,
  FileOpResult,
  MenuCommand,
  PickNoteResult,
  ReadResult,
  SaveRequest,
  SaveResult,
  Settings,
} from '../shared/types';

/** AI 域具名 API（docs/06）：进程能力全部收在主进程 */
export interface NoteDeskAiApi {
  detect: () => Promise<AgentInfo[]>;
  startSession: (options: AiSessionStartOptions) => Promise<{ sessionId: string }>;
  send: (sessionId: string, text: string) => void;
  stop: (sessionId: string) => Promise<void>;
  onEvent: (cb: (event: AiSessionEvent) => void) => () => void;
}

/** 宿主界面通过 contextBridge 暴露的 API
 *
 * 【恢复副本】原位于 src/renderer/global.d.ts，2026-10-24 误删后逐字恢复。
 * 相对旧基线：import 增加三个 AI 类型；新增 NoteDeskAiApi 接口与 ai 字段。 */
export interface NoteDeskApi {
  /** 仅浏览器调试模式（dev 且无 preload）为 true，正常 Electron 运行时不存在 */
  preview?: boolean;
  pickLibrary: () => Promise<string | null>;
  pickNote: () => Promise<PickNoteResult | null>;
  listFiles: () => Promise<FileNode[]>;
  readFile: (absPath: string) => Promise<ReadResult>;
  saveFile: (req: SaveRequest) => Promise<SaveResult>;
  createFolder: (parentPath: string, name: string) => Promise<FileOpResult>;
  createNote: (parentPath: string, name: string) => Promise<FileOpResult>;
  renameEntry: (absPath: string, name: string) => Promise<FileOpResult>;
  trashEntry: (absPath: string) => Promise<FileOpResult>;
  moveEntry: (absPath: string, targetDirPath: string) => Promise<FileOpResult>;
  revealEntry: (absPath: string) => Promise<FileOpResult>;
  getSettings: () => Promise<Settings>;
  setSettings: (patch: Partial<Settings>) => Promise<Settings>;
  getPluginState: () => Promise<{ enabled: Record<string, boolean> }>;
  setPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  pluginStorageGet: (pluginId: string, key: string) => Promise<unknown>;
  pluginStorageSet: (pluginId: string, key: string, value: unknown) => Promise<void>;
  setDirty: (dirty: boolean) => void;
  onMenuCommand: (cb: (command: MenuCommand) => void) => () => void;
  onFileChange: (cb: (e: FileChangeEvent) => void) => () => void;
  ai: NoteDeskAiApi;
}

declare global {
  interface Window {
    noteDesk: NoteDeskApi;
  }
}
