import { registerCommand } from '../../plugins/host/commands';
import { toMessage } from './ipcError';
import type { PickNoteResult } from '../../shared/types';
import { useEditorStore } from '../store/editorStore';
import { useLibraryStore } from '../store/libraryStore';
/**
 * 内核命令注册表：原生菜单命令与插件可调用的内核能力统一注册到这里。
 * 菜单命令 id 与 MenuCommand 字符串一致；暴露给插件的能力用 'kernel.' 前缀。
 */
export function registerKernelCommands(options: {
  toggleSidebar: () => void;
  openSettings: () => void;
  toggleTerminal: () => void;
}): void {
  registerCommand('open-note', 'kernel', () => pickAndOpenNote());
  registerCommand('open-folder', 'kernel', () => useLibraryStore.getState().pickLibrary());
  registerCommand('save', 'kernel', () => useEditorStore.getState().save());
  registerCommand('close-note', 'kernel', () => useEditorStore.getState().close());
  registerCommand('refresh-library', 'kernel', () => useLibraryStore.getState().refresh());
  registerCommand('toggle-source', 'kernel', () => useEditorStore.getState().toggleSource());
  registerCommand('toggle-sidebar', 'kernel', options.toggleSidebar);
  registerCommand('toggle-terminal', 'kernel', options.toggleTerminal);
  registerCommand('open-settings', 'kernel', options.openSettings);

  // 插件可调用的内核能力：在当前笔记库内打开指定笔记（recent / search 都用它）
  registerCommand('kernel.open-note', 'kernel', (args) => {
    const path = (args as { path?: unknown } | undefined)?.path;
    if (typeof path !== 'string') return;
    const root = useLibraryStore.getState().root;
    if (!root) return;
    useLibraryStore.getState().select(path);
    void useEditorStore.getState().open(path, root);
  });

  // 插件可调用的内核能力：查询当前笔记状态（激活晚于 note:opened 时做初始同步）
  registerCommand(
    'kernel.get-note-state',
    'kernel',
    (): { path: string | null; dirty: boolean } => {
      const state = useEditorStore.getState();
      return { path: state.currentPath, dirty: state.dirty };
    },
  );
}

async function pickAndOpenNote(): Promise<void> {
  try {
    const result = await window.noteDesk.pickNote();
    if (!result) return;
    await applyPickedNote(result, result.switchedLibrary);
  } catch (err) {
    window.alert(toMessage(err));
  }
}

async function applyPickedNote(result: PickNoteResult, shouldRefresh: boolean): Promise<void> {
  if (result.switchedLibrary) {
    useLibraryStore.setState({ root: result.libraryRoot });
  }
  if (shouldRefresh) {
    await useLibraryStore.getState().refresh();
  }
  await useEditorStore.getState().open(result.path, result.libraryRoot);
}
