import { dialog, ipcMain } from 'electron';
import { CH } from '../../shared/ipc-channels';
import type { Settings, TermExitEvent, TermOutputEvent } from '../../shared/types';
import { registerFileIpc } from './file.ipc';
import { registerNoteIpc } from './note.ipc';
import { registerPluginIpc } from './plugin.ipc';
import { registerTerminalIpc, validateCliCommand } from './terminal.ipc';
import { getSettings, setSettings } from '../services/settings';
import { setTermEventSink } from '../services/ptyHost';
import { setWindowDirty } from '../window-state';

/** 统一注册所有 IPC handler。sendTermEvent 由 index.ts 提供，指向主窗口。 */
export function registerAllIpc(options: {
  sendTermEvent: (event: TermOutputEvent | TermExitEvent) => void;
}): void {
  registerFileIpc();
  registerNoteIpc();
  registerPluginIpc();
  registerTerminalIpc();
  setTermEventSink(options.sendTermEvent);

  ipcMain.handle(CH.PICK_LIBRARY, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '选择笔记库文件夹',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const root = result.filePaths[0];
    setSettings({ libraryRoot: root });
    return root;
  });

  ipcMain.handle(CH.SETTINGS_GET, () => getSettings());
  ipcMain.handle(CH.SETTINGS_SET, (_evt, patch: Partial<Settings>) => {
    // 白名单：libraryRoot 是安全信任锚，只能经主进程的文件对话框写入。
    // 若放行，被注入的渲染代码可把库根指向任意磁盘目录，读遍用户文件。
    const safe: Partial<Settings> = {};
    if (patch && typeof patch === 'object') {
      if (typeof patch.editMode === 'boolean') safe.editMode = patch.editMode;
      if (typeof patch.autoSave === 'boolean') safe.autoSave = patch.autoSave;
      if (typeof patch.backupOnSave === 'boolean') safe.backupOnSave = patch.backupOnSave;
      if (typeof patch.cliCommand === 'string') safe.cliCommand = validateCliCommand(patch.cliCommand);
    }
    return setSettings(safe);
  });

  // 渲染进程同步「有未保存修改」状态，主进程据此在关闭窗口时弹确认
  ipcMain.on(CH.APP_SET_DIRTY, (_evt, dirty: unknown) => {
    setWindowDirty(dirty === true);
  });
}
