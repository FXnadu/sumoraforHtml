import { ipcMain } from 'electron';
import { parseHTML } from 'linkedom';
import { CH } from '../../shared/ipc-channels';
import type { SaveRequest, SaveResult } from '../../shared/types';
import { canEncodeLosslessly } from '../../core/encoding';
import { signatureOf } from '../../core/structure-signature';
import { guardPath } from '../security/pathGuard';
import { getLibraryRoot } from '../services/settings';
import { getSettings } from '../services/settings';
import { listTree } from '../services/library';
import {
  createFolder,
  createNote,
  moveEntry,
  renameEntry,
  revealEntry,
  trashEntry,
} from '../services/fsOps';
import { EncodingLossyError, NoteReadError, readNote, writeNoteAtomic } from '../services/file';

/**
 * file 域 IPC：列表 / 读取 / 保存 / 文件管理操作。
 *
 * 【恢复副本】由未混淆编译产物逐行反构。
 */

function normalizeEol(text: string, eol: string): string {
  const unified = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return eol === '\n' ? unified : unified.replace(/\n/g, eol);
}

async function saveNote(root: string, req: Partial<SaveRequest>): Promise<SaveResult> {
  let safePath: string;
  try {
    safePath = guardPath(root, req.path ?? '');
  } catch {
    return { ok: false, code: 'PATH_OUTSIDE_LIBRARY', message: '路径越界', path: req.path ?? '' };
  }
  const { document } = parseHTML(req.html ?? '');
  const actual = document.documentElement ? signatureOf(document.documentElement) : '';
  if (actual !== req.baselineSignature && !req.structureChangeConfirmed) {
    return { ok: false, code: 'STRUCTURE_CHANGED', message: 'HTML 结构发生变化', path: safePath };
  }
  if (!req.structureChangeConfirmed && req.expectedSignature && req.expectedSignature !== actual) {
    return {
      ok: false,
      code: 'STRUCTURE_CHANGED',
      message: '渲染端与主进程的结构签名不一致',
      path: safePath,
    };
  }
  if (!canEncodeLosslessly(req.html ?? '', req.encoding ?? 'utf-8')) {
    return {
      ok: false,
      code: 'ENCODING_LOSSY',
      message: `无法以 ${req.encoding} 保真保存`,
      path: safePath,
    };
  }
  try {
    const backupPath = await writeNoteAtomic(
      root,
      safePath,
      normalizeEol(req.html ?? '', req.eol ?? '\n'),
      req.encoding ?? 'utf-8',
      { backup: req.backup, bom: req.hadBom },
    );
    return { ok: true, signature: actual, backupPath };
  } catch (err) {
    if (err instanceof EncodingLossyError) {
      return {
        ok: false,
        code: 'ENCODING_LOSSY',
        message: `无法以 ${err.encoding} 保真保存`,
        path: safePath,
      };
    }
    return { ok: false, code: 'WRITE_FAILED', message: String(err), path: safePath };
  }
}

function noLibrary(): SaveResult {
  return { ok: false, code: 'NOT_FOUND', message: '尚未选择笔记库', path: '' };
}

export function registerFileIpc(): void {
  ipcMain.handle(CH.FILE_LIST, async () => {
    const libraryRoot = getLibraryRoot();
    if (!libraryRoot) return [];
    return listTree(libraryRoot);
  });
  ipcMain.handle(CH.FILE_READ, async (_evt, absPath: unknown) => {
    const root = getLibraryRoot();
    if (!root) throw new Error('尚未选择笔记库');
    try {
      return await readNote(root, absPath as string);
    } catch (err) {
      if (err instanceof NoteReadError) throw new Error(`${err.code}: ${err.message}`);
      throw err;
    }
  });
  ipcMain.handle(CH.FILE_SAVE, async (_evt, req: unknown) => {
    const root = getLibraryRoot();
    const path = typeof (req as Partial<SaveRequest>)?.path === 'string' ? (req as Partial<SaveRequest>).path! : '';
    if (!root) {
      return { ok: false, code: 'WRITE_FAILED', message: '尚未选择笔记库', path };
    }
    const partial = req as Partial<SaveRequest>;
    if (!req || typeof partial.html !== 'string' || typeof partial.encoding !== 'string') {
      return { ok: false, code: 'WRITE_FAILED', message: '保存参数不完整', path };
    }
    return saveNote(root, { ...partial, backup: getSettings().backupOnSave } as SaveRequest);
  });
  ipcMain.handle(CH.FILE_CREATE_FOLDER, async (_evt, parentPath: string, name: unknown) => {
    const root = getLibraryRoot();
    if (!root) return noLibrary();
    return createFolder(root, parentPath, name);
  });
  ipcMain.handle(CH.FILE_CREATE_NOTE, async (_evt, parentPath: string, name: unknown) => {
    const root = getLibraryRoot();
    if (!root) return noLibrary();
    return createNote(root, parentPath, name);
  });
  ipcMain.handle(CH.FILE_RENAME, async (_evt, absPath: unknown, name: unknown) => {
    const root = getLibraryRoot();
    if (!root) return noLibrary();
    return renameEntry(root, absPath, name);
  });
  ipcMain.handle(CH.FILE_TRASH, async (_evt, absPath: unknown) => {
    const root = getLibraryRoot();
    if (!root) return noLibrary();
    return trashEntry(root, absPath);
  });
  ipcMain.handle(CH.FILE_MOVE, async (_evt, absPath: unknown, targetDirPath: unknown) => {
    const root = getLibraryRoot();
    if (!root) return noLibrary();
    return moveEntry(root, absPath, targetDirPath);
  });
  ipcMain.handle(CH.FILE_REVEAL, async (_evt, absPath: unknown) => {
    const root = getLibraryRoot();
    if (!root) return noLibrary();
    return revealEntry(root, absPath);
  });
}
