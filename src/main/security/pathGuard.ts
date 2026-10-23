import fs from 'node:fs';
import path from 'node:path';

/** 路径越界错误：任何文件 IO 前必须过 pathGuard，越界即抛错 */
export class PathOutsideLibraryError extends Error {
  constructor(
    public readonly target: string,
    public readonly root: string,
  ) {
    super(`Path outside library: ${target} (root: ${root})`);
    this.name = 'PathOutsideLibraryError';
  }
}

/**
 * 校验目标路径位于笔记库根目录内。
 * 覆盖三类穿越手法：`../`、符号链接、Windows 大小写变体。
 */
export function guardPath(root: string, relativeOrAbs: string): string {
  const rootResolved = path.resolve(root);
  const target = path.isAbsolute(relativeOrAbs)
    ? path.resolve(relativeOrAbs)
    : path.resolve(rootResolved, relativeOrAbs);

  assertInside(target, rootResolved);

  // 符号链接：解析真实路径后再次校验。
  // 目标文件可能尚不存在（新建/保存场景），此时对父目录做 realpath 校验，
  // 防止「库内的 symlink 目录指向库外」这类间接穿越。
  try {
    const realRoot = fs.realpathSync(rootResolved);
    try {
      assertInside(fs.realpathSync(target), realRoot);
    } catch (err) {
      if (err instanceof PathOutsideLibraryError) throw err;
      // 目标不存在：校验其父目录
      assertInside(fs.realpathSync(path.dirname(target)), realRoot);
    }
  } catch (err) {
    if (err instanceof PathOutsideLibraryError) throw err;
    // 连根目录都不存在：只剩前缀校验结果
  }

  return target;
}

function assertInside(target: string, root: string): void {
  const isWin = process.platform === 'win32';
  const t = isWin ? target.toLowerCase() : target;
  const r = isWin ? root.toLowerCase() : root;
  if (t === r) return;
  // 根目录 '/' 已自带分隔符，直接拼会变成 '//'，导致所有路径被判越界
  const prefix = r.endsWith(path.sep) ? r : r + path.sep;
  if (!t.startsWith(prefix)) {
    throw new PathOutsideLibraryError(target, root);
  }
}
