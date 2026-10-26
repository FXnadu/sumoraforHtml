import type { FileNode, ReadResult, Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';

/**
 * 浏览器调试模式（npm run dev:web）的 noteDesk 假实现。
 * 【恢复副本·简化重建版】原文件含内存文件树 / 拖拽重排等完整逻辑，误删后
 * 未完整恢复；此版本只保证类型完整与基本可用（预览样式用），行为从简。
 */

const ROOT = '/mock-library';

const files = new Map<string, string>([
  [
    `${ROOT}/示例笔记.html`,
    '<!doctype html>\n<html lang="zh-CN">\n<head><meta charset="utf-8"><title>示例</title></head>\n<body>\n<h1>示例笔记</h1>\n<p>这是一段可以直接点击编辑的文字。</p>\n<table><tr><td>单元格</td></tr></table>\n</body>\n</html>\n',
  ],
]);

let settings: Settings = { ...DEFAULT_SETTINGS, libraryRoot: ROOT };

const pluginEnabled = new Map<string, boolean>();
const pluginStorage = new Map<string, unknown>();

function listTree(): FileNode[] {
  return [...files.keys()].map((path) => ({
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    type: 'file' as const,
  }));
}

/** 安装到 window.noteDesk，让渲染进程与 Electron 下的行为保持一致 */
export function installBrowserMock(): void {
  window.noteDesk = {
    preview: true,

    pickLibrary: async () => ROOT,
    pickNote: async () => null,

    listFiles: async () => listTree(),

    readFile: async (absPath): Promise<ReadResult> => {
      const html = files.get(absPath);
      if (html === undefined) throw new Error(`文件不存在：${absPath}`);
      return {
        path: absPath,
        html,
        encoding: 'utf-8',
        eol: '\n',
        hadBom: false,
        baselineSignature: '',
      };
    },

    saveFile: async (req) => {
      files.set(req.path, req.html);
      return { ok: true, signature: '' };
    },

    createFolder: async (parentPath) => ({ ok: true, path: `${parentPath}/新建文件夹` }),
    createNote: async (parentPath, name) => {
      const path = `${parentPath}/${name.endsWith('.html') ? name : `${name}.html`}`;
      files.set(path, '');
      return { ok: true, path };
    },
    renameEntry: async (absPath, name) => ({ ok: true, path: `${absPath.slice(0, absPath.lastIndexOf('/'))}/${name}` }),
    trashEntry: async (absPath) => {
      files.delete(absPath);
      return { ok: true, path: absPath };
    },
    moveEntry: async (absPath, targetDirPath) => ({
      ok: true,
      path: `${targetDirPath}/${absPath.slice(absPath.lastIndexOf('/') + 1)}`,
    }),
    revealEntry: async (absPath) => ({ ok: true, path: absPath }),

    getSettings: async () => settings,
    setSettings: async (patch) => {
      settings = { ...settings, ...patch };
      return settings;
    },

    setDirty: () => undefined,
    onMenuCommand: () => () => undefined,
    onFileChange: () => () => undefined,

    // 浏览器预览模式没有本地 PTY：会话不可创建，与宿主侧安全兜底一致
    terminal: {
      create: async () => {
        throw new Error('当前环境不可用（浏览器预览模式）');
      },
      input: () => undefined,
      resize: () => undefined,
      kill: async () => undefined,
      onOutput: () => () => undefined,
      onExit: () => () => undefined,
    },

    getPluginState: async () => ({
      enabled: Object.fromEntries(pluginEnabled),
    }),
    setPluginEnabled: async (pluginId, enabled) => {
      pluginEnabled.set(pluginId, enabled);
    },
    pluginStorageGet: async (pluginId, key) => pluginStorage.get(`plugin:${pluginId}:${key}`) ?? null,
    pluginStorageSet: async (pluginId, key, value) => {
      pluginStorage.set(`plugin:${pluginId}:${key}`, value ?? null);
    },
  };
}
