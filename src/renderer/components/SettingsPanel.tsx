import { useEffect, useState, useSyncExternalStore } from 'react';
import { emitKernelEvent } from '../../plugins/host/events';
import { getPluginStates, setPluginEnabled, subscribeRegistry, getRegistryVersion } from '../../plugins/host/registry';
import SlotHost from '../../plugins/host/slots';
import type { PluginRuntimeState } from '../../plugins/host/types';
import { useEditorStore } from '../store/editorStore';

/**
 * 设置面板：内核通用设置 + 插件启停 + 插件贡献的设置区块（settings-section 插槽）。
 */
export default function SettingsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const editMode = useEditorStore((s) => s.editMode);
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const [backupOnSave, setBackupOnSave] = useState(true);
  useSyncExternalStore(subscribeRegistry, getRegistryVersion);
  const pluginStates = getPluginStates();

  useEffect(() => {
    void window.noteDesk.getSettings().then((settings) => setBackupOnSave(settings.backupOnSave));
  }, []);

  const toggleEditMode = (): void => {
    const next = !editMode;
    setEditMode(next);
    void window.noteDesk.setSettings({ editMode: next }).then((settings) => {
      emitKernelEvent('settings:changed', { editMode: settings.editMode });
    });
  };

  const toggleBackup = (): void => {
    const next = !backupOnSave;
    setBackupOnSave(next);
    void window.noteDesk.setSettings({ backupOnSave: next }).then((settings) => {
      emitKernelEvent('settings:changed', { backupOnSave: settings.backupOnSave });
    });
  };

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="modal settings-modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal-title">设置</h2>
        <div className="settings-section">
          <h3 className="settings-section-title">通用</h3>
          <label className="settings-row">
            <span>
              <span className="settings-row-label">编辑模式</span>
              <span className="settings-row-desc">关闭后为纯阅读，点击文字不进入编辑</span>
            </span>
            <input type="checkbox" checked={editMode} onChange={toggleEditMode} />
          </label>
          <label className="settings-row">
            <span>
              <span className="settings-row-label">保存前备份（.bak）</span>
              <span className="settings-row-desc">保存时在原目录生成 .bak 备份文件</span>
            </span>
            <input type="checkbox" checked={backupOnSave} onChange={toggleBackup} />
          </label>
        </div>
        <div className="settings-section">
          <h3 className="settings-section-title">插件</h3>
          {pluginStates.length === 0 && <p className="settings-row-desc">当前没有注册的插件。</p>}
          {pluginStates.map((state) => (
            <PluginRow key={state.manifest.id} state={state} />
          ))}
        </div>
        <SlotHost slot="settings-section" />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function PluginRow({ state }: { state: PluginRuntimeState }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const toggle = (): void => {
    if (busy) return;
    setBusy(true);
    void setPluginEnabled(state.manifest.id, !state.enabled)
      .catch((err) => console.error('切换插件状态失败:', err))
      .finally(() => setBusy(false));
  };
  return (
    <label className="settings-row">
      <span>
        <span className="settings-row-label">{state.manifest.name}</span>
        <span className="settings-row-desc">
          {state.manifest.description ?? state.manifest.id}
          {state.failed ? '（本次激活失败，关闭后重新开启可重试）' : ''}
        </span>
      </span>
      <input type="checkbox" checked={state.enabled} disabled={busy} onChange={toggle} />
    </label>
  );
}
