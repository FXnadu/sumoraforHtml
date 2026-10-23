import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { FileNode } from '../../../shared/types';
import type { NoteDeskPlugin, PluginContext } from '../../host/types';

/** 文件名搜索（FR-06）：侧栏头部入口 + 过滤面板，命中后经内核命令打开笔记。
 * 【恢复副本】此插件在误删前源码中存在但尚未登记进 BUILTIN_PLUGINS。 */
interface SearchState {
  open: boolean;
  query: string;
  setOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
}

const useSearchState = create<SearchState>((set) => ({
  open: false,
  query: '',
  setOpen: (open) => set({ open }),
  setQuery: (query) => set({ query }),
}));

function flattenFiles(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    if (node.type === 'file') out.push(node);
    else flattenFiles(node.children ?? [], out);
  }
  return out;
}

function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? path;
}

const searchPlugin: NoteDeskPlugin = {
  manifest: {
    id: 'core.search',
    name: '文件名搜索',
    version: '0.1.0',
    description: '在侧栏按文件名过滤当前笔记库并快速打开',
    apiVersion: 1,
    activation: 'onStart',
  },
  activate: (ctx) => {
    ctx.ui.registerSlot('sidebar-header', () => <SearchButton />, { order: 10 });
    ctx.ui.registerSlot('sidebar-panel', () => <SearchPanel ctx={ctx} />, {
      title: '搜索',
      order: 10,
    });
  },
};

export default searchPlugin;

function SearchButton(): JSX.Element {
  const open = useSearchState((s) => s.open);
  const setOpen = useSearchState((s) => s.setOpen);
  return (
    <button
      type="button"
      className={`icon-btn${open ? ' active' : ''}`}
      title="搜索笔记"
      aria-pressed={open}
      onClick={() => setOpen(!open)}
    >
      🔍
    </button>
  );
}

function SearchPanel({ ctx }: { ctx: PluginContext }): JSX.Element | null {
  const open = useSearchState((s) => s.open);
  const query = useSearchState((s) => s.query);
  const setQuery = useSearchState((s) => s.setQuery);
  const [files, setFiles] = useState<FileNode[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const reload = (): void => {
      void ctx.files
        .listFiles()
        .then((tree) => {
          if (alive) setFiles(flattenFiles(tree));
        })
        .catch(() => {
          if (alive) setFiles([]);
        });
    };
    reload();
    // 选库 / 重扫 / 新建删除后刷新候选列表
    const off = ctx.events.on('library:changed', reload);
    return () => {
      alive = false;
      off();
    };
  }, [ctx, open]);

  if (!open) return null;

  const keyword = query.trim().toLowerCase();
  const matches =
    keyword === ''
      ? []
      : (files ?? []).filter((file) => file.name.toLowerCase().includes(keyword)).slice(0, 50);

  return (
    <div>
      <input
        className="plugin-input"
        type="search"
        placeholder="按文件名搜索…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {keyword === '' ? (
        <p className="plugin-empty">输入关键字后在当前笔记库中过滤。</p>
      ) : (
        <div className="plugin-list">
          {files === null && <p className="plugin-empty">加载中…</p>}
          {files !== null && matches.length === 0 && <p className="plugin-empty">没有匹配的笔记。</p>}
          {matches.map((file) => (
            <button
              key={file.path}
              type="button"
              className="plugin-list-item"
              title={file.path}
              onClick={() => void ctx.commands.execute('kernel.open-note', { path: file.path })}
            >
              {baseName(file.path)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
