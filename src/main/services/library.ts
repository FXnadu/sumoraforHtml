import path from 'node:path';
import fsp from 'node:fs/promises';
import type { FileNode } from '../../shared/types';

/** 笔记库目录树列举。
 *
 * 【恢复副本】由未混淆编译产物逐行反构。 */

const IGNORE_DIRS = [
  'node_modules',
  '.git',
  '.svn',
  '.obsidian',
  '.vscode',
  'dist',
  'build',
  'out',
  'coverage',
];

const NOTE_EXTENSIONS = ['.html', '.htm'];

function isNoteFile(name: string): boolean {
  const lower = name.toLowerCase();
  return NOTE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isIgnoredDir(name: string): boolean {
  return name.startsWith('.') || IGNORE_DIRS.includes(name);
}

const collator = new Intl.Collator('zh-CN');

export async function listTree(root: string): Promise<FileNode[]> {
  const walk = async (dir: string): Promise<FileNode[]> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const dirs: FileNode[] = [];
    const files: FileNode[] = [];
    const subDirs = await Promise.all(
      entries.map(async (entry): Promise<FileNode | null> => {
        if (isIgnoredDir(entry.name)) return null;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return { path: abs, name: entry.name, type: 'dir', children: await walk(abs) };
        }
        if (entry.isFile() && isNoteFile(entry.name)) {
          files.push({ path: abs, name: entry.name, type: 'file' });
          return null;
        }
        if (entry.isSymbolicLink() && isNoteFile(entry.name)) {
          try {
            if ((await fsp.stat(abs)).isFile()) {
              files.push({ path: abs, name: entry.name, type: 'file' });
            }
          } catch {
            // 悬空符号链接：忽略
          }
        }
        return null;
      }),
    );
    for (const node of subDirs) {
      if (node) dirs.push(node);
    }
    const byName = (a: FileNode, b: FileNode): number => collator.compare(a.name, b.name);
    return [...dirs.sort(byName), ...files.sort(byName)];
  };
  return walk(path.resolve(root));
}
