import { useCallback, useEffect, useState } from 'react';
import type { FileNode } from '../../shared/types';
import { executeMenuItem, getContextMenuItems } from '../../plugins/host/registry';
import SlotHost, { useSlotEmpty } from '../../plugins/host/slots';
import { useEditorStore } from '../store/editorStore';
import { useLibraryStore } from '../store/libraryStore';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import FileList from './FileList';
import FileTree from './FileTree';
import NamePromptDialog from './NamePromptDialog';

/** 侧栏：库标题 + 文件树/列表 + 右键菜单 + 新建/重命名弹窗 + 操作提示。 */
export default function Sidebar(): JSX.Element {
  const root = useLibraryStore((s) => s.root);
  const tree = useLibraryStore((s) => s.tree);
  const loading = useLibraryStore((s) => s.loading);
  const error = useLibraryStore((s) => s.error);
  const viewMode = useLibraryStore((s) => s.viewMode);
  const opMessage = useLibraryStore((s) => s.opMessage);
  const opFailed = useLibraryStore((s) => s.opFailed);
  const setViewMode = useLibraryStore((s) => s.setViewMode);
  const select = useLibraryStore((s) => s.select);
  const pickLibrary = useLibraryStore((s) => s.pickLibrary);
  const clearOpMessage = useLibraryStore((s) => s.clearOpMessage);

  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const headerSlotEmpty = useSlotEmpty('sidebar-header');

  useEffect(() => {
    if (!opMessage) return;
    const timer = window.setTimeout(() => clearOpMessage(), 6000);
    return () => window.clearTimeout(timer);
  }, [opMessage, clearOpMessage]);

  const closeMenu = useCallback(() => setMenu(null), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  const openNodeMenu = useCallback((event: React.MouseEvent, node: FileNode) => {
    event.preventDefault();
    event.stopPropagation();
    const libraryRoot = useLibraryStore.getState().root;
    if (!libraryRoot) return;
    setMenu({
      node,
      dirPath: node.type === 'dir' ? node.path : parentPathOf(node.path),
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const openBlankMenu = useCallback((event: React.MouseEvent) => {
    const libraryRoot = useLibraryStore.getState().root;
    if (!libraryRoot) return;
    if (event.target instanceof Element && event.target.closest('input, textarea')) return;
    event.preventDefault();
    setMenu({ node: null, dirPath: libraryRoot, x: event.clientX, y: event.clientY });
  }, []);

  const confirmTrash = async (node: FileNode): Promise<void> => {
    const suffix = node.type === 'dir' ? '\n该文件夹内的所有笔记也会一起移入回收站。' : '';
    if (!window.confirm(`确定把「${node.name}」移到回收站吗？${suffix}`)) return;
    await useLibraryStore.getState().trashEntry(node);
  };

  const runCommand = async (id: string, target: MenuTarget): Promise<void> => {
    const library = useLibraryStore.getState();
    const node = target.node;
    switch (id) {
      case 'new-note':
        setDialog({ kind: 'newNote', dirPath: target.dirPath });
        return;
      case 'new-folder':
        setDialog({ kind: 'newFolder', dirPath: target.dirPath });
        return;
      case 'rename':
        if (node) setDialog({ kind: 'rename', node });
        return;
      case 'trash':
        if (node) await confirmTrash(node);
        return;
      case 'reveal':
        await library.revealEntry(node ? node.path : target.dirPath);
        return;
      case 'refresh':
        await library.refresh();
        return;
      case 'view-tree':
        setViewMode('tree');
        return;
      case 'view-list':
        setViewMode('list');
        return;
      case 'open':
        if (node && library.root) {
          library.select(node.path);
          await useEditorStore.getState().open(node.path, library.root);
        }
        return;
      default:
        executeMenuItem(id);
        return;
    }
  };

  const submitDialog = async (value: string): Promise<string | null> => {
    if (!dialog) return '操作已取消';
    const library = useLibraryStore.getState();
    const outcome =
      dialog.kind === 'newFolder'
        ? await library.createFolder(dialog.dirPath, value)
        : dialog.kind === 'newNote'
          ? await library.createNote(dialog.dirPath, value)
          : await library.renameEntry(dialog.node, value);
    return outcome.ok ? null : outcome.message ?? '操作失败';
  };

  const dialogConfig = dialog ? dialogConfigFor(dialog) : null;

  return (
    <>
      {!headerSlotEmpty && (
        <header className="sidebar-header">
          <SlotHost slot="sidebar-header" />
        </header>
      )}

      <div
        className="explorer"
        onContextMenu={openBlankMenu}
        onClick={(event) => {
          if (event.target === event.currentTarget) select(null);
        }}
      >
        {renderBody()}
      </div>

      <div className="sidebar-slots">
        <SlotHost slot="sidebar-panel" />
      </div>

      {opMessage && (
        <div className={`sidebar-message${opFailed ? ' error' : ''}`} role="status">
          <span className="sidebar-message-text">{opMessage}</span>
          <button type="button" className="icon-btn" aria-label="关闭提示" onClick={clearOpMessage}>
            ×
          </button>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItemsFor(menu)}
          onSelect={(id) => {
            void runCommand(id, menu);
          }}
          onClose={closeMenu}
        />
      )}

      {dialog && dialogConfig && (
        <NamePromptDialog
          key={dialog.kind === 'rename' ? `rename:${dialog.node.path}` : `${dialog.kind}:${dialog.dirPath}`}
          title={dialogConfig.title}
          label={dialogConfig.label}
          hint={dialogConfig.hint}
          initialValue={dialogConfig.initialValue}
          selectBaseName={dialogConfig.selectBaseName}
          confirmText={dialogConfig.confirmText}
          onConfirm={submitDialog}
          onClose={closeDialog}
        />
      )}
    </>
  );

  function renderBody(): JSX.Element {
    if (!root) {
      return (
        <div className="sidebar-empty">
          <p>还没有选择笔记库文件夹。</p>
          <button type="button" className="btn" onClick={() => void pickLibrary()}>
            选择文件夹
          </button>
        </div>
      );
    }
    if (error) return <div className="tree-error">{error}</div>;
    if (loading && tree.length === 0) return <div className="tree-empty">扫描中…</div>;
    if (tree.length === 0) {
      return (
        <div className="sidebar-empty">
          <p>该文件夹内还没有 HTML 笔记。</p>
          <button type="button" className="btn" onClick={() => setDialog({ kind: 'newNote', dirPath: root })}>
            新建笔记
          </button>
        </div>
      );
    }
    return viewMode === 'tree' ? (
      <FileTree onContextMenu={openNodeMenu} />
    ) : (
      <FileList onContextMenu={openNodeMenu} />
    );
  }
}

interface MenuTarget {
  node: FileNode | null;
  dirPath: string;
  x: number;
  y: number;
}

type DialogTarget =
  | { kind: 'newNote'; dirPath: string }
  | { kind: 'newFolder'; dirPath: string }
  | { kind: 'rename'; node: FileNode };

function parentPathOf(value: string): string {
  const posix = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const index = posix.lastIndexOf('/');
  if (index < 0) return value;
  if (index === 0) return '/';
  const parent = posix.slice(0, index);
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}/` : parent;
}

function menuItemsFor(target: MenuTarget): ContextMenuItem[] {
  const node = target.node;
  let kernelItems: ContextMenuItem[];
  if (!node) {
    kernelItems = [
      { id: 'new-note', label: '新建笔记' },
      { id: 'new-folder', label: '新建文件夹' },
      { id: 'reveal', label: '在文件管理器中打开笔记库', separatorBefore: true },
      { id: 'refresh', label: '刷新' },
    ];
  } else if (node.type === 'dir') {
    kernelItems = [
      { id: 'new-note', label: '新建笔记' },
      { id: 'new-folder', label: '新建文件夹' },
      { id: 'reveal', label: '打开文件夹位置', separatorBefore: true },
      { id: 'rename', label: '重命名' },
      { id: 'trash', label: '移到回收站', danger: true },
      { id: 'refresh', label: '刷新', separatorBefore: true },
    ];
  } else {
    kernelItems = [
      { id: 'open', label: '打开' },
      { id: 'reveal', label: '打开文件位置' },
      { id: 'rename', label: '重命名', separatorBefore: true },
      { id: 'trash', label: '移到回收站', danger: true },
      { id: 'refresh', label: '刷新', separatorBefore: true },
    ];
  }
  const viewItems: ContextMenuItem[] = [
    { id: 'view-tree', label: '树形视图', separatorBefore: true },
    { id: 'view-list', label: '列表视图' },
  ];
  const kind = !node ? 'blank' : node.type === 'dir' ? 'dir' : 'note';
  const pluginItems = getContextMenuItems(kind);
  if (pluginItems.length === 0) return [...kernelItems, ...viewItems];
  return [
    ...kernelItems,
    ...viewItems,
    ...pluginItems.map((item) => ({
      id: item.id,
      label: item.label,
      danger: item.danger,
      // 插件项默认与内核项隔开，除非插件明确要求紧贴
      separatorBefore: item.separatorBefore ?? true,
    })),
  ];
}

function dialogConfigFor(dialog: DialogTarget): {
  title: string;
  label?: string;
  hint?: string;
  initialValue: string;
  selectBaseName: boolean;
  confirmText: string;
} {
  if (dialog.kind === 'newFolder') {
    return {
      title: '新建文件夹',
      label: '文件夹名称',
      hint: '将创建在当前目录下',
      initialValue: '新建文件夹',
      selectBaseName: false,
      confirmText: '创建',
    };
  }
  if (dialog.kind === 'newNote') {
    return {
      title: '新建笔记',
      label: '笔记名称',
      hint: '未填写扩展名时自动补 .html',
      initialValue: '新建笔记',
      selectBaseName: false,
      confirmText: '创建',
    };
  }
  return {
    title: '重命名',
    label: '新名称',
    initialValue: dialog.node.name,
    selectBaseName: dialog.node.type === 'file',
    confirmText: '重命名',
  };
}
