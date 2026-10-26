import type {
  FileChangeEvent,
  FileNode,
  FileOpResult,
  MenuCommand,
  PickNoteResult,
  ReadResult,
  SaveRequest,
  SaveResult,
  Settings,
  TermExitEvent,
  TermOutputEvent,
  TermSessionInfo,
} from '../shared/types';

/** 内嵌终端 API：PTY 进程全部收在主进程，渲染层只收发数据 */
export interface NoteDeskTerminalApi {
  create: (notePath: string, cols: number, rows: number) => Promise<TermSessionInfo>;
  input: (sessionId: string, data: string) => void;
  resize: (sessionId: string, cols: number, rows: number) => void;
  kill: (sessionId: string) => Promise<void>;
  onOutput: (cb: (event: TermOutputEvent) => void) => () => void;
  onExit: (cb: (event: TermExitEvent) => void) => () => void;
}

/** 宿主界面通过 contextBridge 暴露的 API */
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
  terminal: NoteDeskTerminalApi;
}

declare global {
  interface Window {
    noteDesk: NoteDeskApi;
  }
}
