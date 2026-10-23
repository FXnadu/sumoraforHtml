import { create } from 'zustand';
import type { FileNode, FileOpResult, SidebarView } from '../../shared/types';
import { emitKernelEvent } from '../../plugins/host/events';
import { toMessage } from '../lib/ipcError';
import { useEditorStore } from './editorStore';

/** 笔记库 store：根目录、文件树、文件管理操作。
 *
 * 【恢复副本】由未混淆编译产物逐行反构（语义与原文件一致）。 */

const NOTE_EXTENSIONS = ['.html', '.htm'];

function comparablePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isPathInside(target: string, base: string): boolean {
  const t = comparablePath(target);
  const b = comparablePath(base);
  if (!t) return false;
  if (!b) return t.startsWith('/');
  return t === b || t.startsWith(`${b}/`);
}

function replacePrefix(target: string, base: string, replacement: string): string | null {
  const t = target.replace(/\\/g, '/');
  const b = base.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!b) return null;
  const tl = t.toLowerCase();
  const bl = b.toLowerCase();
  if (tl !== bl && !tl.startsWith(`${bl}/`)) return null;
  const rest = t.slice(b.length);
  return replacement.replace(/\\/g, '/').replace(/\/+$/, '') + rest;
}

function fileNameOf(value: string): string {
  const posix = value.replace(/\\/g, '/');
  return posix.slice(posix.lastIndexOf('/') + 1);
}

function isNoteName(name: string): boolean {
  const lower = name.toLowerCase();
  return NOTE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

const VIEW_MODE_KEY = 'noteDesk.sidebarView';

function readViewMode(): SidebarView {
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'tree';
  } catch {
    return 'tree';
  }
}

function persistViewMode(mode: SidebarView): void {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // localStorage 不可用：仅本次会话生效
  }
}

async function safeCall(
  call: () => Promise<FileOpResult>,
): Promise<FileOpResult> {
  try {
    return await call();
  } catch (err) {
    return { ok: false, code: 'WRITE_FAILED', message: toMessage(err) };
  }
}

interface LibraryState {
  root: string | null;
  tree: FileNode[];
  loading: boolean;
  error: string | null;
  viewMode: SidebarView;
  selectedPath: string | null;
  opMessage: string | null;
  opFailed: boolean;

  init: () => Promise<void>;
  pickLibrary: () => Promise<void>;
  refresh: () => Promise<void>;
  setViewMode: (mode: SidebarView) => void;
  select: (path: string | null) => void;
  clearOpMessage: () => void;
  createFolder: (parentPath: string, name: string) => Promise<{ ok: boolean; message?: string }>;
  createNote: (parentPath: string, name: string) => Promise<{ ok: boolean; message?: string }>;
  renameEntry: (node: FileNode, name: string) => Promise<{ ok: boolean; message?: string }>;
  moveEntry: (sourcePath: string, targetDirPath: string) => Promise<{ ok: boolean; message?: string }>;
  trashEntry: (node: FileNode) => Promise<{ ok: boolean; message?: string }>;
  revealEntry: (absPath: string) => Promise<{ ok: boolean; message?: string }>;
}

export const useLibraryStore = create<LibraryState>((set, get) => {
  const report = (
    message: string,
    failed: boolean,
  ): { ok: boolean; message: string } => {
    set({ opMessage: message, opFailed: failed });
    return { ok: !failed, message };
  };
  return {
    root: null,
    tree: [],
    loading: false,
    error: null,
    viewMode: readViewMode(),
    selectedPath: null,
    opMessage: null,
    opFailed: false,

    init: async () => {
      const settings = await window.noteDesk.getSettings();
      if (settings.libraryRoot) {
        set({ root: settings.libraryRoot });
        await get().refresh();
      }
    },

    pickLibrary: async () => {
      const root = await window.noteDesk.pickLibrary();
      if (!root) return;
      set({ root, selectedPath: null, opMessage: null, opFailed: false });
      await get().refresh();
    },

    refresh: async () => {
      const { root } = get();
      if (!root) return;
      set({ loading: true, error: null });
      try {
        const tree = await window.noteDesk.listFiles();
        set({ tree, loading: false });
        emitKernelEvent('library:changed', { root });
      } catch (err) {
        set({ error: toMessage(err), loading: false });
      }
    },

    setViewMode: (mode) => {
      persistViewMode(mode);
      set({ viewMode: mode });
    },

    select: (path) => set({ selectedPath: path }),

    clearOpMessage: () => set({ opMessage: null, opFailed: false }),

    createFolder: async (parentPath, name) => {
      const result = await safeCall(() => window.noteDesk.createFolder(parentPath, name));
      if (!result.ok) return report(result.message, true);
      await get().refresh();
      const message = `已新建文件夹「${fileNameOf(result.path)}」`;
      set({ opMessage: message, opFailed: false, selectedPath: result.path });
      return { ok: true, message };
    },

    createNote: async (parentPath, name) => {
      const result = await safeCall(() => window.noteDesk.createNote(parentPath, name));
      if (!result.ok) return report(result.message, true);
      await get().refresh();
      const message = `已新建笔记「${fileNameOf(result.path)}」`;
      set({ opMessage: message, opFailed: false, selectedPath: result.path });
      const root = get().root;
      if (root) await useEditorStore.getState().open(result.path, root);
      return { ok: true, message };
    },

    renameEntry: async (node, name) => {
      const editor = useEditorStore.getState();
      const affected = editor.currentPath ? isPathInside(editor.currentPath, node.path) : false;
      if (affected && editor.dirty) {
        return report('当前笔记有未保存的修改，请先保存后再重命名', true);
      }
      const result = await safeCall(() => window.noteDesk.renameEntry(node.path, name));
      if (!result.ok) return report(result.message, true);
      await get().refresh();
      const message = `已重命名为「${fileNameOf(result.path)}」`;
      set({ opMessage: message, opFailed: false, selectedPath: result.path });
      const root = get().root;
      const current = useEditorStore.getState().currentPath;
      if (affected && root && current) {
        const nextPath = replacePrefix(current, node.path, result.path);
        if (nextPath && isNoteName(nextPath)) {
          await useEditorStore.getState().open(nextPath, root);
        } else {
          useEditorStore.getState().close();
        }
      }
      return { ok: true, message };
    },

    moveEntry: async (sourcePath, targetDirPath) => {
      const editor = useEditorStore.getState();
      const affected = editor.currentPath ? isPathInside(editor.currentPath, sourcePath) : false;
      if (affected && editor.dirty) {
        return report('当前笔记有未保存的修改，请先保存后再移动', true);
      }
      const result = await safeCall(() => window.noteDesk.moveEntry(sourcePath, targetDirPath));
      if (!result.ok) return report(result.message, true);
      await get().refresh();
      set({ opMessage: null, opFailed: false, selectedPath: result.path });
      const root = get().root;
      const current = useEditorStore.getState().currentPath;
      if (affected && root && current) {
        const nextPath = replacePrefix(current, sourcePath, result.path);
        if (nextPath) await useEditorStore.getState().open(nextPath, root);
      }
      const message = `已移动「${fileNameOf(sourcePath)}」`;
      set({ opMessage: message, opFailed: false });
      return { ok: true, message };
    },

    trashEntry: async (node) => {
      const editor = useEditorStore.getState();
      const affected = editor.currentPath ? isPathInside(editor.currentPath, node.path) : false;
      if (affected) {
        editor.close();
        if (useEditorStore.getState().currentPath) return report('已取消', true);
      }
      const result = await safeCall(() => window.noteDesk.trashEntry(node.path));
      if (!result.ok) return report(result.message, true);
      const selected = get().selectedPath;
      if (selected && isPathInside(selected, node.path)) set({ selectedPath: null });
      await get().refresh();
      const message = `已把「${node.name}」移到回收站`;
      set({ opMessage: message, opFailed: false });
      return { ok: true, message };
    },

    revealEntry: async (absPath) => {
      const result = await safeCall(() => window.noteDesk.revealEntry(absPath));
      if (!result.ok) return report(result.message, true);
      return report('已在文件管理器中定位', false);
    },
  };
});
