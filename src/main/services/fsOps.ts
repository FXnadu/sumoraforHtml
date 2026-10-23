import path from 'node:path';
import fsp from 'node:fs/promises';
import { shell } from 'electron';
import type { FileOpResult } from '../../shared/types';
import { guardPath } from '../security/pathGuard';

/**
 * 文件管理操作（新建 / 重命名 / 移动 / 回收站 / 定位）。
 * 失败一律返回 FileOpResult，不抛异常。
 *
 * 【恢复副本】由未混淆编译产物逐行反构。
 */

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

function stemOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(0, index) : name;
}

function isNoteName(name: string): boolean {
  const lower = name.toLowerCase();
  return NOTE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

const NOTE_EXTENSIONS = ['.html', '.htm'];
const MAX_NAME_LENGTH = 120;
const INVALID_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/; // eslint-disable-line no-control-regex -- Windows 非法字符集，控制字符是有意为之
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function fail(code: 'PATH_OUTSIDE_LIBRARY' | 'INVALID_NAME' | 'ALREADY_EXISTS' | 'NOT_FOUND' | 'WRITE_FAILED', message: string): FileOpResult {
  return { ok: false, code, message };
}

function invalid(message: string): { ok: false; code: 'INVALID_NAME'; message: string } {
  return { ok: false, code: 'INVALID_NAME', message };
}

export function validateEntryName(
  raw: unknown,
): { ok: true; name: string } | { ok: false; code: 'INVALID_NAME'; message: string } {
  if (typeof raw !== 'string') return invalid('名称无效');
  const name = raw.trim();
  if (!name) return invalid('名称不能为空');
  if (name.length > MAX_NAME_LENGTH) {
    return invalid(`名称过长（最多 ${MAX_NAME_LENGTH} 个字符）`);
  }
  if (name.startsWith('.')) {
    return invalid('名称不能以 . 开头（隐藏项不会显示在文件树中）');
  }
  if (INVALID_NAME_CHARS.test(name)) {
    return invalid('名称不能包含 < > : " / \\ | ? * 等字符');
  }
  if (/[. ]$/.test(name)) return invalid('名称不能以空格或点结尾');
  if (process.platform === 'win32' && WINDOWS_RESERVED_NAME.test(name)) {
    return invalid('该名称是系统保留名，请换一个');
  }
  return { ok: true, name };
}

function normalizeNoteName(name: string): string {
  return isNoteName(name) ? name : `${name}.html`;
}

function noteTemplate(title: string): string {
  const escaped = escapeHtml(title);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escaped}</title>
</head>
<body>
<h1>${escaped}</h1>
<p>在这里开始写这篇笔记。</p>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mapFsError(err: unknown, fallback: string): FileOpResult {
  const code = (err as NodeJS.ErrnoException).code;
  switch (code) {
    case 'EEXIST':
      return fail('ALREADY_EXISTS', '已存在同名文件或文件夹');
    case 'ENOTEMPTY':
      return fail('ALREADY_EXISTS', '目标文件夹不为空');
    case 'ENOENT':
      return fail('NOT_FOUND', '目标不存在，可能已被移动或删除');
    case 'EACCES':
    case 'EPERM':
      return fail('WRITE_FAILED', '没有权限完成该操作');
    case 'EBUSY':
      return fail('WRITE_FAILED', '文件正被其它程序占用，请关闭后重试');
    case 'ENOSPC':
      return fail('WRITE_FAILED', '磁盘空间不足');
    default:
      return fail('WRITE_FAILED', `${fallback}：${String(err)}`);
  }
}

async function resolveDirectory(
  root: string,
  dirPath: unknown,
): Promise<{ ok: true; path: string } | FileOpResult> {
  if (typeof dirPath !== 'string' || dirPath === '') {
    return fail('NOT_FOUND', '目标文件夹不存在');
  }
  let safe: string;
  try {
    safe = guardPath(root, dirPath);
  } catch {
    return fail('PATH_OUTSIDE_LIBRARY', '路径越界：只能操作笔记库内的文件');
  }
  try {
    const stat = await fsp.stat(safe);
    if (!stat.isDirectory()) return fail('NOT_FOUND', '目标不是文件夹');
  } catch {
    return fail('NOT_FOUND', '目标文件夹不存在');
  }
  return { ok: true, path: safe };
}

export async function createFolder(root: string, parentPath: string, name: unknown): Promise<FileOpResult> {
  const parent = await resolveDirectory(root, parentPath);
  if (!parent.ok) return parent;
  const checked = validateEntryName(name);
  if (!checked.ok) return checked;
  const target = path.join(parent.path, checked.name);
  try {
    guardPath(root, target);
  } catch {
    return fail('PATH_OUTSIDE_LIBRARY', '路径越界：只能操作笔记库内的文件');
  }
  try {
    await fsp.mkdir(target);
    return { ok: true, path: target };
  } catch (err) {
    return mapFsError(err, `无法创建文件夹「${checked.name}」`);
  }
}

export async function createNote(root: string, parentPath: string, name: unknown): Promise<FileOpResult> {
  const parent = await resolveDirectory(root, parentPath);
  if (!parent.ok) return parent;
  const checked = validateEntryName(name);
  if (!checked.ok) return checked;
  const noteName = normalizeNoteName(checked.name);
  const target = path.join(parent.path, noteName);
  try {
    guardPath(root, target);
  } catch {
    return fail('PATH_OUTSIDE_LIBRARY', '路径越界：只能操作笔记库内的文件');
  }
  try {
    await fsp.writeFile(target, noteTemplate(stemOf(noteName)), { encoding: 'utf8', flag: 'wx' });
    return { ok: true, path: target };
  } catch (err) {
    return mapFsError(err, `无法创建笔记「${noteName}」`);
  }
}

export async function renameEntry(root: string, absPath: unknown, rawName: unknown): Promise<FileOpResult> {
  let source: string;
  try {
    if (typeof absPath !== 'string' || absPath === '') throw new Error('empty path');
    source = guardPath(root, absPath);
  } catch {
    return fail('PATH_OUTSIDE_LIBRARY', '路径越界：只能操作笔记库内的文件');
  }
  if (isSamePath(source, path.resolve(root))) {
    return fail('INVALID_NAME', '不能重命名笔记库根目录');
  }
  const checked = validateEntryName(rawName);
  if (!checked.ok) return checked;
  const target = path.join(path.dirname(source), checked.name);
  if (exactPath(source) === exactPath(target)) {
    return { ok: true, path: source };
  }
  try {
    guardPath(root, target);
  } catch {
    return fail('PATH_OUTSIDE_LIBRARY', '路径越界：只能操作笔记库内的文件');
  }
  const caseOnly = process.platform === 'win32' && isSamePath(source, target);
  if (!caseOnly) {
    try {
      await fsp.lstat(target);
      return fail('ALREADY_EXISTS', '已存在同名文件或文件夹');
    } catch {
      // 目标不存在，可以改名
    }
  }
  try {
    await fsp.rename(source, target);
    return { ok: true, path: target };
  } catch (err) {
    return mapFsError(err, `无法重命名「${path.basename(source)}」`);
  }
}

export async function moveEntry(
  root: string,
  absPath: unknown,
  targetDirPath: unknown,
): Promise<FileOpResult> {
  let source: string;
  try {
    if (typeof absPath !== 'string' || absPath === '') throw new Error('empty path');
    source = guardPath(root, absPath);
  } catch {
    return fail('PATH_OUTSIDE_LIBRARY', '路径越界：只能操作笔记库内的文件');
  }
  if (isSamePath(source, path.resolve(root))) {
    return fail('INVALID_NAME', '不能移动笔记库根目录');
  }
  const targetDir = await resolveDirectory(root, targetDirPath);
  if (!targetDir.ok) return targetDir;
  const target = path.join(targetDir.path, path.basename(source));
  if (isSamePath(target, source)) {
    return { ok: true, path: source };
  }
  if (isPathInside(target, source)) {
    return fail('INVALID_NAME', '不能把文件夹移动到它自己或子文件夹内');
  }
  try {
    guardPath(root, target);
  } catch {
    return fail('PATH_OUTSIDE_LIBRARY', '路径越界：只能操作笔记库内的文件');
  }
  try {
    await fsp.lstat(target);
    return fail('ALREADY_EXISTS', '目标文件夹中已存在同名的文件或文件夹');
  } catch {
    // 目标不存在，可以移动
  }
  try {
    await fsp.rename(source, target);
    return { ok: true, path: target };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      return fail('WRITE_FAILED', '不能跨磁盘移动，请先复制到目标磁盘再删除原文件');
    }
    return mapFsError(err, `无法移动「${path.basename(source)}」`);
  }
}

function exactPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

export async function revealEntry(root: string, absPath: unknown): Promise<FileOpResult> {
  let target: string;
  try {
    if (typeof absPath !== 'string' || absPath === '') throw new Error('empty path');
    target = guardPath(root, absPath);
  } catch {
    return fail('PATH_OUTSIDE_LIBRARY', '路径越界：只能操作笔记库内的文件');
  }
  try {
    const stat = await fsp.stat(target);
    if (stat.isDirectory() && isSamePath(target, path.resolve(root))) {
      const error = await shell.openPath(target);
      if (error) return fail('WRITE_FAILED', `无法打开文件夹：${error}`);
    } else {
      shell.showItemInFolder(target);
    }
  } catch (err) {
    return fail('NOT_FOUND', `无法定位该文件：${String(err)}`);
  }
  return { ok: true, path: target };
}

export async function trashEntry(root: string, absPath: unknown): Promise<FileOpResult> {
  let target: string;
  try {
    if (typeof absPath !== 'string' || absPath === '') throw new Error('empty path');
    target = guardPath(root, absPath);
  } catch {
    return fail('PATH_OUTSIDE_LIBRARY', '路径越界：只能操作笔记库内的文件');
  }
  if (isSamePath(target, path.resolve(root))) {
    return fail('INVALID_NAME', '不能删除笔记库根目录');
  }
  try {
    await shell.trashItem(target);
  } catch (err) {
    return fail('WRITE_FAILED', `移到回收站失败：${String(err)}`);
  }
  return { ok: true, path: target };
}
