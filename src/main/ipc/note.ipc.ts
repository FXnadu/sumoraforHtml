import path from 'node:path';
import { dialog, ipcMain } from 'electron';
import { CH } from '../../shared/ipc-channels';
import type { PickNoteResult } from '../../shared/types';
import { guardPath } from '../security/pathGuard';
import { getLibraryRoot, setSettings } from '../services/settings';

/**
 * note 域 IPC：打开笔记（库外文件经确认后可切换库根）。
 *
 * 【恢复副本】由未混淆编译产物逐行反构。
 */

const NOTE_FILTERS = [{ name: 'HTML 笔记', extensions: ['html', 'htm'] }];

export function registerNoteIpc(): void {
  ipcMain.handle(CH.NOTE_PICK, async (): Promise<PickNoteResult | null> => {
    const root = getLibraryRoot();
    const result = await dialog.showOpenDialog({
      title: '打开笔记',
      defaultPath: root ?? undefined,
      properties: ['openFile'],
      filters: NOTE_FILTERS,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const chosen = result.filePaths[0];
    if (!root) {
      return switchLibrary(path.dirname(chosen), chosen);
    }
    try {
      return { path: guardPath(root, chosen), libraryRoot: root, switchedLibrary: false };
    } catch {
      const dir = path.dirname(chosen);
      const answer = await dialog.showMessageBox({
        type: 'question',
        buttons: ['切换笔记库', '取消'],
        defaultId: 0,
        cancelId: 1,
        message: '该文件不在当前笔记库中',
        detail: `是否将「${dir}」设为笔记库并打开该文件？`,
      });
      if (answer.response !== 0) return null;
      return switchLibrary(dir, chosen);
    }
  });
}

function switchLibrary(dir: string, chosen: string): PickNoteResult {
  setSettings({ libraryRoot: dir });
  return {
    path: guardPath(dir, chosen),
    libraryRoot: dir,
    switchedLibrary: true,
  };
}
