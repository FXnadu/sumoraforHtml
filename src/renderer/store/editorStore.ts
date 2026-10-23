import { create } from 'zustand';
import type { SaveResult } from '../../shared/types';
import { emitKernelEvent } from '../../plugins/host/events';
import { requestSerialize, sendMarkClean } from '../lib/noteBridge';

/** 编辑器 store：当前笔记的全部状态与保存闭环。
 *
 * 【恢复副本】由未混淆编译产物逐行反构（语义与原文件一致）。 */

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface EditorState {
  status: Status;
  /** 当前打开的笔记绝对路径 */
  currentPath: string | null;
  /** 渲染容器加载地址（note:// 形式） */
  srcUrl: string | null;
  encoding: string;
  eol: '\r\n' | '\n' | '\r';
  hadBom: boolean;
  /** 加载时计算的基线签名（保存前比对结构是否变化） */
  baselineSignature: string;
  errorMessage: string | null;

  /** 设置中的编辑模式开关 */
  editMode: boolean;
  /** 源码模式：直接编辑文件原文，而不是渲染后的内容 */
  sourceMode: boolean;
  /** 磁盘原文；阅读模式保存成功后同步为最新内容，供源码模式使用 */
  rawHtml: string;
  /** 源码模式保存时的基线签名（主进程按原文计算，与保存时的算法同源） */
  sourceBaselineSignature: string;
  /** 当前笔记是否有未保存修改 */
  dirty: boolean;
  saving: boolean;
  /** 保存结果 / 失败原因 */
  saveMessage: string | null;
  /** 结构变化时是否等待用户确认 */
  pendingStructureConfirm: boolean;

  init: () => Promise<void>;
  /** 设置面板切换编辑模式（持久化由调用方经 settings:set 完成） */
  setEditMode: (editMode: boolean) => void;
  /** 打开笔记：读取 → 计算基线签名 → 生成 note:// 地址 */
  open: (absPath: string, libraryRoot: string) => Promise<void>;
  /** webview 加载完成后上报的浏览器侧基线签名（与保存时的签名同源） */
  applyWebviewBaseline: (absPath: string, signature: string) => void;
  setDirty: (dirty: boolean) => void;
  /** 源码模式下的编辑：改原文并标记脏 */
  updateSource: (html: string) => void;
  /** 在阅读模式与源码模式之间切换（有未保存修改时先保存） */
  toggleSource: () => Promise<void>;
  /** 保存当前笔记；confirmed 表示用户已确认结构变化 */
  save: (confirmed?: boolean) => Promise<void>;
  confirmStructureSave: () => Promise<void>;
  cancelStructureSave: () => void;
  close: () => void;
}

/** 把 dirty 状态同步给主进程，用于关闭窗口前提醒 */
function syncMainDirty(dirty: boolean): void {
  window.noteDesk.setDirty(dirty);
}

/** 把库内绝对路径转换为 note:// 地址（每段 encodeURIComponent，分隔符统一 /） */
export function toNoteUrl(libraryRoot: string, absPath: string): string {
  const rel = relativePath(libraryRoot, absPath);
  const encoded = rel.split(/[\\/]+/).filter(Boolean).map(encodeURIComponent).join('/');
  return `note://library/${encoded}`;
}

/** path.relative 的纯前端实现（渲染进程不引入 node:path） */
function relativePath(root: string, target: string): string {
  const norm = (p: string): string[] => p.replace(/\\/g, '/').split('/').filter(Boolean);
  const a = norm(root);
  const b = norm(target);
  if (a[0]?.toLowerCase() !== b[0]?.toLowerCase()) return b.join('/');
  let i = 0;
  while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i += 1;
  return b.slice(i).join('/');
}

function failureText(result: Extract<SaveResult, { ok: false }>): string {
  const labels: Record<string, string> = {
    PATH_OUTSIDE_LIBRARY: '路径越界',
    STRUCTURE_CHANGED: 'HTML 结构发生变化',
    ENCODING_LOSSY: '编码无法保真',
    WRITE_FAILED: '写入失败',
    NOT_FOUND: '文件不存在',
  };
  return `保存失败（${labels[result.code] ?? result.code}）：${result.message}`;
}

export const useEditorStore = create<EditorState>((set, get) => {
  /** 打开笔记的令牌：防止并发打开时旧请求覆盖新状态 */
  let openToken = 0;
  return {
    status: 'idle',
    currentPath: null,
    srcUrl: null,
    encoding: 'utf-8',
    eol: '\n',
    hadBom: false,
    baselineSignature: '',
    errorMessage: null,

    editMode: true,
    sourceMode: false,
    rawHtml: '',
    sourceBaselineSignature: '',
    dirty: false,
    saving: false,
    saveMessage: null,
    pendingStructureConfirm: false,

    init: async () => {
      const settings = await window.noteDesk.getSettings();
      set({ editMode: settings.editMode });
    },

    setEditMode: (editMode) => set({ editMode }),

    open: async (absPath, libraryRoot) => {
      const state = get();
      if (state.currentPath === absPath && state.status === 'ready') return;
      if (state.dirty && absPath !== state.currentPath) {
        const ok = window.confirm('当前笔记有未保存的修改，切换后修改将丢失。仍要切换吗？');
        if (!ok) return;
        syncMainDirty(false);
      }
      const token = ++openToken;
      set({
        status: 'loading',
        currentPath: absPath,
        srcUrl: null,
        errorMessage: null,
        dirty: false,
        saving: false,
        saveMessage: null,
        pendingStructureConfirm: false,
        rawHtml: '',
        sourceBaselineSignature: '',
      });
      try {
        const result = await window.noteDesk.readFile(absPath);
        if (token !== openToken) return;
        set({
          status: 'ready',
          srcUrl: toNoteUrl(libraryRoot, absPath),
          encoding: result.encoding,
          eol: result.eol,
          hadBom: result.hadBom,
          baselineSignature: result.baselineSignature,
          sourceBaselineSignature: result.baselineSignature,
          rawHtml: result.html,
        });
        emitKernelEvent('note:opened', { path: absPath, libraryRoot });
      } catch (err) {
        if (token !== openToken) return;
        set({ status: 'error', errorMessage: String(err), srcUrl: null, sourceMode: false });
      }
    },

    applyWebviewBaseline: (absPath, signature) => {
      if (!signature) return;
      if (get().currentPath !== absPath || get().status !== 'ready') return;
      set({ baselineSignature: signature });
    },

    setDirty: (dirty) => {
      if (get().dirty === dirty) return;
      set({ dirty });
      syncMainDirty(dirty);
      emitKernelEvent('note:dirty-changed', { path: get().currentPath, dirty });
    },

    updateSource: (html) => {
      if (get().rawHtml === html) return;
      set({ rawHtml: html });
      get().setDirty(true);
    },

    toggleSource: async () => {
      const state = get();
      if (!state.currentPath || state.status !== 'ready' || state.saving) return;
      const enteringSource = !state.sourceMode;
      if (state.dirty) {
        const ok = window.confirm(
          enteringSource
            ? '进入源码模式前需要保存当前修改，现在保存吗？'
            : '返回阅读模式前需要保存源码修改，现在保存吗？',
        );
        if (!ok) return;
        await get().save();
        const after = get();
        if (after.dirty || after.saving || after.pendingStructureConfirm) return;
      }
      if (enteringSource) {
        set({ sourceMode: true });
        return;
      }
      const base = get().srcUrl?.split('?')[0] ?? null;
      set({ sourceMode: false, srcUrl: base ? `${base}?v=${Date.now()}` : null });
    },

    save: async (confirmed = false) => {
      const state = get();
      if (!state.currentPath || state.status !== 'ready' || state.saving) return;
      if (!state.dirty) {
        set({ saveMessage: '没有需要保存的修改' });
        return;
      }
      const absPath = state.currentPath;
      const isSource = state.sourceMode;
      set({ saving: true, saveMessage: null });
      let payload: { html: string; signature: string };
      if (isSource || window.noteDesk.preview === true) {
        payload = { html: state.rawHtml, signature: '' };
      } else {
        try {
          payload = await requestSerialize();
        } catch (err) {
          if (get().currentPath === absPath) {
            set({ saving: false, saveMessage: `保存失败：${String(err)}` });
          }
          return;
        }
        if (get().currentPath !== absPath) return;
      }
      let result: SaveResult;
      try {
        result = await window.noteDesk.saveFile({
          path: absPath,
          html: payload.html,
          expectedSignature: payload.signature,
          baselineSignature: isSource ? get().sourceBaselineSignature : get().baselineSignature,
          structureChangeConfirmed: confirmed,
          encoding: get().encoding,
          eol: get().eol,
          hadBom: get().hadBom,
          backup: true,
        });
      } catch (err) {
        if (get().currentPath === absPath) {
          set({ saving: false, saveMessage: `保存失败：${String(err)}` });
        }
        return;
      }
      if (get().currentPath !== absPath) return;
      if (!result.ok) {
        if (result.code === 'STRUCTURE_CHANGED' && !confirmed) {
          set({
            saving: false,
            pendingStructureConfirm: true,
            saveMessage: '检测到 HTML 结构变化，等待确认',
          });
          emitKernelEvent('note:save-failed', { path: absPath, message: result.message });
          return;
        }
        set({ saving: false, saveMessage: failureText(result) });
        emitKernelEvent('note:save-failed', { path: absPath, message: result.message });
        return;
      }
      set({
        saving: false,
        dirty: false,
        status: 'ready',
        baselineSignature: result.signature,
        sourceBaselineSignature: result.signature,
        rawHtml: payload.html,
        pendingStructureConfirm: false,
        saveMessage: result.backupPath ? `已保存，备份：${result.backupPath}` : '已保存',
      });
      syncMainDirty(false);
      sendMarkClean();
      emitKernelEvent('note:saved', { path: absPath, backupPath: result.backupPath });
    },

    confirmStructureSave: async () => {
      set({ pendingStructureConfirm: false });
      await get().save(true);
    },

    cancelStructureSave: () => {
      set({ pendingStructureConfirm: false, saveMessage: '已取消保存' });
    },

    close: () => {
      if (get().dirty) {
        const ok = window.confirm('当前笔记有未保存的修改，关闭后修改将丢失。仍要关闭吗？');
        if (!ok) return;
      }
      const closedPath = get().currentPath;
      openToken += 1;
      set({
        status: 'idle',
        currentPath: null,
        srcUrl: null,
        errorMessage: null,
        sourceMode: false,
        rawHtml: '',
        sourceBaselineSignature: '',
        dirty: false,
        saving: false,
        saveMessage: null,
        pendingStructureConfirm: false,
      });
      if (closedPath) emitKernelEvent('note:closed', { path: closedPath });
      syncMainDirty(false);
    },
  };
});
