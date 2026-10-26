import { lazy, Suspense, useEffect, useState } from 'react';
import NotePane from './components/NotePane';
import SaveConfirmDialog from './components/SaveConfirmDialog';
import SettingsPanel from './components/SettingsPanel';
import Sidebar from './components/Sidebar';
import SourceEditor from './components/SourceEditor';
import { BUILTIN_PLUGINS } from '../plugins/builtins';
import { executeCommand } from '../plugins/host/commands';
import { initRegistry, registerBuiltin } from '../plugins/host/registry';
import { registerKernelCommands } from './lib/kernelCommands';
import { useEditorStore } from './store/editorStore';
import { useLibraryStore } from './store/libraryStore';

// 终端面板懒加载：xterm（约几百 KB）拆出主包，不打开终端就不加载
const TerminalPanel = lazy(() => import('./components/TerminalPanel'));

export default function App(): JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const init = useLibraryStore((s) => s.init);
  const initEditor = useEditorStore((s) => s.init);
  const sourceMode = useEditorStore((s) => s.sourceMode);
  const noteStatus = useEditorStore((s) => s.status);
  const toggleSource = useEditorStore((s) => s.toggleSource);

  useEffect(() => {
    void init();
    void initEditor();
  }, [init, initEditor]);

  // 插件宿主：登记内置插件并按 activation 策略激活（清单见 plugins/builtins/index.ts）
  useEffect(() => {
    for (const plugin of BUILTIN_PLUGINS) registerBuiltin(plugin);
    void initRegistry();
  }, []);

  // 内核命令注册：菜单命令与插件可调用的能力（重复调用幂等覆盖）
  useEffect(() => {
    registerKernelCommands({
      toggleSidebar: () => setSidebarCollapsed((collapsed) => !collapsed),
      openSettings: () => setSettingsOpen(true),
      toggleTerminal: () => setTerminalOpen((open) => !open),
    });
  }, []);

  // 原生菜单命令统一查命令注册表执行，主进程只负责下发
  useEffect(() => {
    return window.noteDesk.onMenuCommand((command) => {
      void executeCommand(command).catch((err) => console.error('菜单命令执行失败:', err));
    });
  }, []);

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}${terminalOpen ? ' term-open' : ''}`}>
      <aside className="sidebar">
        <Sidebar />
      </aside>

      <main className="content">{sourceMode ? <SourceEditor /> : <NotePane />}</main>

      {terminalOpen && (
        <aside className="term-panel" aria-label="终端">
          <Suspense fallback={<div className="term-loading">终端加载中…</div>}>
            <TerminalPanel />
          </Suspense>
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
          className={`status-btn push-right${terminalOpen ? ' active' : ''}`}
          title={terminalOpen ? '收起终端面板' : '展开终端面板（运行你自己的 CLI）'}
          aria-label={terminalOpen ? '收起终端面板' : '展开终端面板'}
          aria-pressed={terminalOpen}
          onClick={() => setTerminalOpen((open) => !open)}
        >
          {'>_'}
        </button>
      </footer>

      <SaveConfirmDialog />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
