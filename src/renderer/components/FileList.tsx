import { useMemo, useState } from 'react';
import type { FileNode } from '../../shared/types';
import { useEditorStore } from '../store/editorStore';
import { useLibraryStore } from '../store/libraryStore';

const collator = new Intl.Collator('zh-CN');

/** 平铺列表视图：带关键字筛选，目录列显示相对路径。 */
export default function FileList({
  onContextMenu,
}: {
  onContextMenu: (event: React.MouseEvent, node: FileNode) => void;
}): JSX.Element {
  const tree = useLibraryStore((s) => s.tree);
  const root = useLibraryStore((s) => s.root);
  const selectedPath = useLibraryStore((s) => s.selectedPath);
  const select = useLibraryStore((s) => s.select);
  const currentPath = useEditorStore((s) => s.currentPath);
  const open = useEditorStore((s) => s.open);
  const [keyword, setKeyword] = useState('');

  const files = useMemo(() => flattenFiles(tree), [tree]);
  const visible = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) return files;
    return files.filter(
      (file) =>
        file.name.toLowerCase().includes(query) ||
        dirLabelOf(root, file.path).toLowerCase().includes(query),
    );
  }, [files, keyword, root]);

  return (
    <div className="file-list">
      <input
        className="file-filter-input"
        type="search"
        value={keyword}
        placeholder="筛选笔记…"
        aria-label="筛选笔记"
        onChange={(event) => setKeyword(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setKeyword('');
        }}
      />
      {visible.length === 0 ? (
        <div className="tree-empty">
          {files.length === 0 ? '该文件夹内没有 HTML 笔记' : '没有匹配的笔记'}
        </div>
      ) : (
        <div className="file-rows" role="list">
          {visible.map((file) => {
            const active = file.path === currentPath;
            const selected = file.path === selectedPath;
            return (
              <button
                key={file.path}
                type="button"
                role="listitem"
                className={`file-row${active ? ' active' : ''}${selected && !active ? ' selected' : ''}`}
                title={file.path}
                onClick={() => {
                  select(file.path);
                  if (root) void open(file.path, root);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  select(file.path);
                  onContextMenu(event, file);
                }}
              >
                <span className="file-row-name">{file.name}</span>
                <span className="file-row-dir">{dirLabelOf(root, file.path) || '笔记库根目录'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = [];
  const walk = (list: FileNode[]): void => {
    for (const node of list) {
      if (node.type === 'file') files.push(node);
      else if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return files.sort((a, b) => collator.compare(a.path, b.path));
}

function dirLabelOf(root: string | null, filePath: string): string {
  if (!root) return '';
  const parts = relativePathFrom(root, filePath).split('/');
  parts.pop();
  return parts.join('/');
}

function relativePathFrom(base: string, target: string): string {
  const a = base.replace(/\\/g, '/').split('/').filter(Boolean);
  const b = target.replace(/\\/g, '/').split('/').filter(Boolean);
  if (a.length === 0 || b.length === 0) return b.join('/');
  if (a[0].toLowerCase() !== b[0].toLowerCase()) return b.join('/');
  let i = 0;
  while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i += 1;
  return b.slice(i).join('/');
}
