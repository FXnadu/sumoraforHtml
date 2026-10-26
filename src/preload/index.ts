import { contextBridge, ipcRenderer } from 'electron';
import { CH } from '../shared/ipc-channels';
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

/**
 * 宿主界面 API。最小暴露原则：只暴露具名函数，不暴露 ipcRenderer 本体。
 * 注意：watch:* 的主进程 handler 尚未注册（S6 接入），请勿提前调用。
 */
contextBridge.exposeInMainWorld('noteDesk', {
  pickLibrary: (): Promise<string | null> => ipcRenderer.invoke(CH.PICK_LIBRARY),
  pickNote: (): Promise<PickNoteResult | null> => ipcRenderer.invoke(CH.NOTE_PICK),

  listFiles: (): Promise<FileNode[]> => ipcRenderer.invoke(CH.FILE_LIST),
  readFile: (absPath: string): Promise<ReadResult> => ipcRenderer.invoke(CH.FILE_READ, absPath),
  saveFile: (req: SaveRequest): Promise<SaveResult> => ipcRenderer.invoke(CH.FILE_SAVE, req),

  // ── 文件管理 ─────────────────────────────
  createFolder: (parentPath: string, name: string): Promise<FileOpResult> =>
    ipcRenderer.invoke(CH.FILE_CREATE_FOLDER, parentPath, name),
  createNote: (parentPath: string, name: string): Promise<FileOpResult> =>
    ipcRenderer.invoke(CH.FILE_CREATE_NOTE, parentPath, name),
  renameEntry: (absPath: string, name: string): Promise<FileOpResult> =>
    ipcRenderer.invoke(CH.FILE_RENAME, absPath, name),
  /** 移到系统回收站（可恢复） */
  trashEntry: (absPath: string): Promise<FileOpResult> =>
    ipcRenderer.invoke(CH.FILE_TRASH, absPath),
  /** 移动到笔记库内的另一个文件夹 */
  moveEntry: (absPath: string, targetDirPath: string): Promise<FileOpResult> =>
    ipcRenderer.invoke(CH.FILE_MOVE, absPath, targetDirPath),
  /** 在系统文件管理器中定位文件/文件夹 */
  revealEntry: (absPath: string): Promise<FileOpResult> =>
    ipcRenderer.invoke(CH.FILE_REVEAL, absPath),

  getSettings: (): Promise<Settings> => ipcRenderer.invoke(CH.SETTINGS_GET),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(CH.SETTINGS_SET, patch),

  // ── 插件（启停状态 + 私有存储，键名空间隔离见 pluginStore） ─────
  getPluginState: (): Promise<{ enabled: Record<string, boolean> }> =>
    ipcRenderer.invoke(CH.PLUGIN_STATE_GET),
  setPluginEnabled: (pluginId: string, enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(CH.PLUGIN_SET_ENABLED, pluginId, enabled),
  pluginStorageGet: (pluginId: string, key: string): Promise<unknown> =>
    ipcRenderer.invoke(CH.PLUGIN_STORAGE_GET, pluginId, key),
  pluginStorageSet: (pluginId: string, key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke(CH.PLUGIN_STORAGE_SET, pluginId, key, value),

  /** 同步「有未保存修改」状态，主进程据此在关闭窗口时提醒 */
  setDirty: (dirty: boolean): void => {
    ipcRenderer.send(CH.APP_SET_DIRTY, dirty);
  },

  // ── 内嵌终端（PTY）：进程属内核，命令来自用户设置，渲染层只收发数据 ──
  terminal: {
    create: (notePath: string, cols: number, rows: number): Promise<TermSessionInfo> =>
      ipcRenderer.invoke(CH.TERM_CREATE, { notePath, cols, rows }),
    input: (sessionId: string, data: string): void => {
      ipcRenderer.send(CH.TERM_INPUT, { sessionId, data });
    },
    resize: (sessionId: string, cols: number, rows: number): void => {
      ipcRenderer.send(CH.TERM_RESIZE, { sessionId, cols, rows });
    },
    kill: (sessionId: string): Promise<void> => ipcRenderer.invoke(CH.TERM_KILL, sessionId),
    onOutput: (cb: (event: TermOutputEvent) => void): (() => void) => {
      const handler = (_evt: unknown, event: TermOutputEvent): void => cb(event);
      ipcRenderer.on(CH.TERM_OUTPUT, handler);
      return () => ipcRenderer.removeListener(CH.TERM_OUTPUT, handler);
    },
    onExit: (cb: (event: TermExitEvent) => void): (() => void) => {
      const handler = (_evt: unknown, event: TermExitEvent): void => cb(event);
      ipcRenderer.on(CH.TERM_EXIT, handler);
      return () => ipcRenderer.removeListener(CH.TERM_EXIT, handler);
    },
  },

  onMenuCommand: (cb: (command: MenuCommand) => void): (() => void) => {
    const handler = (_evt: unknown, command: MenuCommand): void => cb(command);
    ipcRenderer.on(CH.MENU_COMMAND, handler);
    return () => ipcRenderer.removeListener(CH.MENU_COMMAND, handler);
  },

  onFileChange: (cb: (e: FileChangeEvent) => void): (() => void) => {
    const handler = (_evt: unknown, e: FileChangeEvent): void => cb(e);
    ipcRenderer.on(CH.WATCH_CHANGED, handler);
    return () => ipcRenderer.removeListener(CH.WATCH_CHANGED, handler);
  },
});
