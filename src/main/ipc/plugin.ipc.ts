import { ipcMain } from 'electron';
import { CH } from '../../shared/ipc-channels';
import {
  getPluginState,
  getPluginStorage,
  setPluginEnabled,
  setPluginStorage,
} from '../services/pluginStore';

/**
 * 注册 plugin 域 IPC：插件启停状态与私有存储。
 * 存储键的命名空间隔离在 pluginStore 内强制执行，渲染进程传什么 key
 * 都只会落在 plugin:<id>:<key> 下。
 */
export function registerPluginIpc(): void {
  ipcMain.handle(CH.PLUGIN_STATE_GET, () => getPluginState());

  ipcMain.handle(CH.PLUGIN_SET_ENABLED, (_evt, pluginId: unknown, enabled: unknown) => {
    if (typeof pluginId !== 'string' || typeof enabled !== 'boolean') {
      throw new Error('参数不完整');
    }
    setPluginEnabled(pluginId, enabled);
  });

  ipcMain.handle(CH.PLUGIN_STORAGE_GET, (_evt, pluginId: unknown, key: unknown) => {
    if (typeof pluginId !== 'string' || typeof key !== 'string') {
      throw new Error('参数不完整');
    }
    return getPluginStorage(pluginId, key);
  });

  ipcMain.handle(
    CH.PLUGIN_STORAGE_SET,
    (_evt, pluginId: unknown, key: unknown, value: unknown) => {
      if (typeof pluginId !== 'string' || typeof key !== 'string') {
        throw new Error('参数不完整');
      }
      setPluginStorage(pluginId, key, value);
    },
  );
}
