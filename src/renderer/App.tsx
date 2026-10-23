import { useEffect, useState } from 'react';
import NotePane from './components/NotePane';
import SaveConfirmDialog from './components/SaveConfirmDialog';
import SettingsPanel from './components/SettingsPanel';
import Sidebar from './components/Sidebar';
import SourceEditor from './components/SourceEditor';
import { BUILTIN_PLUGINS } from '../plugins/builtins';
import { executeCommand } from '../plugins/host/commands';
import { setAiPickProvider } from '../plugins/host/ai';
import { emitKernelEvent } from '../plugins/host/events';
import { initRegistry, registerBuiltin } from '../plugins/host/registry';
import SlotHost, { useSlotEmpty } from '../plugins/host/slots';
import { registerKernelCommands } from './lib/kernelCommands';
import { requestPick } from './lib/noteBridge';
import { useEditorStore } from './store/editorStore';
import { useLibraryStore } from './store/libraryStore';

/**
 * 【恢复副本】原位于 src/renderer/App.tsx，2026-10-24 误删后逐字恢复。
 * 此版本 = 误删前最终状态（含 AI 右栏 / 三列布局）。
 * 注意：误删前的最终版状态栏还包含一个「侧边栏切换」SVG 按钮（另一个会话
 * 在我最后一次写入后加的），本副本以我最后写入的版本为准——恢复基线后
 * 如缺该按钮，把它从旧版挪回来即可，与本文件功能不冲突。
 */

export default function App(): JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const init = useLibraryStore((s) => s.init);
  const initEditor = useEditorStore((s) => s.init);
  const sourceMode = useEditorStore((s) => s.sourceMode);
  const noteStatus = useEditorStore((s) => s.status);
  const toggleSource = useEditorStore((s) => s.toggleSource);
  // 无插件贡献时右栏容器整个不渲染（禁用 core.ai 后不留空位，约束 14）
  const aiSlotEmpty = useSlotEmpty('right-panel');

  useEffect(() => {
    void init();
    void initEditor();
  }, [init, initEditor]);

  // 插件宿主：登记内置插件并按 activation 策略激活（清单见 plugins/builtins/index.ts）
  useEffect(() => {
    for (const plugin of BUILTIN_PLUGINS) registerBuiltin(plugin);
    void initRegistry();
  }, []);

  // 元素拾取实现注入插件宿主：宿主不反向依赖渲染层内核（见 plugins/host/ai.ts）
  useEffect(() => {
    setAiPickProvider(() => requestPick());
  }, []);

  // 右栏开合变化通知插件（core.ai 据此懒启动会话）
  useEffect(() => {
    emitKernelEvent('ai-panel:changed', { open: aiPanelOpen });
  }, [aiPanelOpen]);

  // 内核命令注册：菜单命令与插件可调用的能力（重复调用幂等覆盖）
  useEffect(() => {
    registerKernelCommands({
      toggleSidebar: () => setSidebarCollapsed((collapsed) => !collapsed),
      openSettings: () => setSettingsOpen(true),
      toggleAiPanel: () => setAiPanelOpen((open) => !open),
    });
  }, []);

  // 原生菜单命令统一查命令注册表执行，主进程只负责下发
  useEffect(() => {
    return window.noteDesk.onMenuCommand((command) => {
      void executeCommand(command).catch((err) => console.error('菜单命令执行失败:', err));
    });
  }, []);

  const aiPanelVisible = aiPanelOpen && !aiSlotEmpty;

  return (
    <div
      className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}${aiPanelVisible ? ' ai-open' : ''}`}
    >
      <aside className="sidebar">
        <Sidebar />
      </aside>

      <main className="content">{sourceMode ? <SourceEditor /> : <NotePane />}</main>

      {aiPanelVisible && (
        <aside className="ai-panel" aria-label="AI 助手">
          <SlotHost slot="right-panel" />
        </aside>
      )}

      <footer className="status-bar">
        <button
          type="button"
          className="status-btn"
          title="显示 / 隐藏侧边栏"
          aria-label="显示 / 隐藏侧边栏"
          aria-pressed={!sidebarCollapsed}
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
            <path d="M6 2.5v11" />
          </svg>
        </button>
        <button
          type="button"
          className={`status-btn${sourceMode ? ' active' : ''}`}
          title={sourceMode ? '禁用源代码模式' : '启用源代码模式'}
          aria-label={sourceMode ? '禁用源代码模式' : '启用源代码模式'}
          aria-pressed={sourceMode}
          disabled={noteStatus !== 'ready'}
          onClick={() => void toggleSource()}
        >
          {'</>'}
        </button>
        <button
          type="button"
          className={`status-btn push-right${aiPanelVisible ? ' active' : ''}`}
          title={aiPanelVisible ? '收起 AI 助手' : '展开 AI 助手'}
          aria-label={aiPanelVisible ? '收起 AI 助手' : '展开 AI 助手'}
          aria-pressed={aiPanelVisible}
          disabled={aiSlotEmpty}
          onClick={() => setAiPanelOpen((open) => !open)}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M8 1.5l1.4 3.4 3.6.4-2.7 2.5.8 3.7L8 9.9l-3.1 1.6.8-3.7L3 5.3l3.6-.4z" />
            <path d="M13.5 11.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" />
          </svg>
        </button>
      </footer>

      <SaveConfirmDialog />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
