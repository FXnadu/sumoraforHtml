import { useState } from 'react';
import type { FileNode } from '../../shared/types';
import { useEditorStore } from '../store/editorStore';
import { useLibraryStore } from '../store/libraryStore';

/** 树形视图：目录展开/折叠 + 拖拽移动（拖到目录或树根空白处）。 */

const DRAG_MIME = 'application/x-note-path';

function comparablePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isSamePath(a: string, b: string): boolean {
  return comparablePath(a) === comparablePath(b);
}

function isPathInside(target: string, base: string): boolean {
  const t = comparablePath(target);
  const b = comparablePath(base);
  if (!t) return false;
  if (!b) return t.startsWith('/');
  return t === b || t.startsWith(`${b}/`);
}

function parentPathOf(value: string): string {
  const posix = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const index = posix.lastIndexOf('/');
  if (index < 0) return value;
  if (index === 0) return '/';
  const parent = posix.slice(0, index);
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}/` : parent;
}

export default function FileTree({
  onContextMenu,
}: {
  onContextMenu: (event: React.MouseEvent, node: FileNode) => void;
}): JSX.Element {
  const tree = useLibraryStore((s) => s.tree);
  const root = useLibraryStore((s) => s.root);
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropDir, setDropDir] = useState<string | null>(null);

  const startDrag = (event: React.DragEvent, node: FileNode): void => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_MIME, node.path);
    event.dataTransfer.setData('text/plain', node.path);
    setDragPath(node.path);
  };

  const endDrag = (): void => {
    setDragPath(null);
    setDropDir(null);
  };

  const moveTo = async (targetDir: string): Promise<void> => {
    const source = dragPath;
    endDrag();
    if (!source) return;
    await useLibraryStore.getState().moveEntry(source, targetDir);
  };

  const handleRootDragOver = (event: React.DragEvent): void => {
    if (event.target !== event.currentTarget || !root || !dragPath) return;
    if (isSamePath(parentPathOf(dragPath), root)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropDir(root);
  };

  const handleRootDrop = (event: React.DragEvent): void => {
    if (event.target !== event.currentTarget || !root) return;
    event.preventDefault();
    void moveTo(root);
  };

  return (
    <div
      className={`tree${dropDir && root && isSamePath(dropDir, root) ? ' root-drop' : ''}`}
      role="tree"
      onDragOver={handleRootDragOver}
      onDragLeave={() => setDropDir(null)}
      onDrop={handleRootDrop}
    >
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          dragPath={dragPath}
          dropDir={dropDir}
          onDragStart={startDrag}
          onDragEnd={endDrag}
          onDragOverDir={(dirPath) => setDropDir(dirPath)}
          onDropDir={(dirPath) => void moveTo(dirPath)}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

interface TreeNodeProps {
  node: FileNode;
  dragPath: string | null;
  dropDir: string | null;
  onDragStart: (event: React.DragEvent, node: FileNode) => void;
  onDragEnd: () => void;
  onDragOverDir: (dirPath: string | null) => void;
  onDropDir: (dirPath: string) => void;
  onContextMenu: (event: React.MouseEvent, node: FileNode) => void;
}

function TreeNode({
  node,
  dragPath,
  dropDir,
  onDragStart,
  onDragEnd,
  onDragOverDir,
  onDropDir,
  onContextMenu,
}: TreeNodeProps): JSX.Element {
  const root = useLibraryStore((s) => s.root);
  const selectedPath = useLibraryStore((s) => s.selectedPath);
  const select = useLibraryStore((s) => s.select);
  const currentPath = useEditorStore((s) => s.currentPath);
  const open = useEditorStore((s) => s.open);
  const [expanded, setExpanded] = useState(true);
  const selected = node.path === selectedPath;
  const dragging = dragPath === node.path;

  const handleContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    select(node.path);
    onContextMenu(event, node);
  };

  const canDropHere = Boolean(
    dragPath &&
      node.type === 'dir' &&
      !isSamePath(dragPath, node.path) &&
      !isPathInside(node.path, dragPath) &&
      !isSamePath(parentPathOf(dragPath), node.path),
  );

  const dirDragProps = canDropHere
    ? {
        onDragOver: (event: React.DragEvent): void => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          onDragOverDir(node.path);
        },
        onDragLeave: () => onDragOverDir(null),
        onDrop: (event: React.DragEvent): void => {
          event.preventDefault();
          event.stopPropagation();
          onDropDir(node.path);
        },
      }
    : {};

  if (node.type === 'file') {
    const active = node.path === currentPath;
    return (
      <button
        type="button"
        role="treeitem"
        aria-selected={active}
        className={itemClass('file', active, selected, dragging)}
        title={node.path}
        draggable
        onDragStart={(event) => onDragStart(event, node)}
        onDragEnd={onDragEnd}
        onClick={() => {
          select(node.path);
          if (root) void open(node.path, root);
        }}
        onContextMenu={handleContextMenu}
      >
        <span className="tree-chevron placeholder" aria-hidden="true" />
        <span className="tree-label">{node.name}</span>
      </button>
    );
  }

  return (
    <div role="group" className="tree-group">
      <button
        type="button"
        className={`${itemClass('dir', false, selected, dragging)}${canDropHere && dropDir === node.path ? ' drop-target' : ''}`}
        onClick={() => {
          select(node.path);
          setExpanded((value) => !value);
        }}
        onContextMenu={handleContextMenu}
        aria-expanded={expanded}
        title={node.path}
        draggable
        onDragStart={(event) => onDragStart(event, node)}
        onDragEnd={onDragEnd}
        {...dirDragProps}
      >
        <span className="tree-chevron">{expanded ? '▾' : '▸'}</span>
        <span className="tree-label">{node.name}</span>
      </button>
      {expanded && node.children && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              dragPath={dragPath}
              dropDir={dropDir}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOverDir={onDragOverDir}
              onDropDir={onDropDir}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function itemClass(kind: string, active: boolean, selected: boolean, dragging: boolean): string {
  return `tree-item ${kind}${active ? ' active' : ''}${selected && !active ? ' selected' : ''}${dragging ? ' dragging' : ''}`;
}
