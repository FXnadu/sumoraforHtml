import path from 'node:path';
import fsp from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { decodeBuffer, detectEol, detectEncoding, canEncodeLosslessly, encodeText } from '../../core/encoding';
import { signatureOf } from '../../core/structure-signature';
import type { ReadResult } from '../../shared/types';
import { guardPath } from '../security/pathGuard';

/**
 * 笔记读取与原子保存（保存链路核心：签名 → 备份 → 原子写 → 编码回写）。
 *
 * 【恢复副本】由未混淆编译产物逐行反构。
 */

export class NoteReadError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly filePath: string,
  ) {
    super(message);
    this.name = 'NoteReadError';
  }
}

export class EncodingLossyError extends Error {
  constructor(
    public readonly encoding: string,
    public readonly filePath: string,
  ) {
    super(`无法以 ${encoding} 保真保存：内容包含该编码无法表示的字符`);
    this.name = 'EncodingLossyError';
  }
}

const BOMS: Record<string, Buffer> = {
  'utf-8': Buffer.from([0xef, 0xbb, 0xbf]),
  'utf-16le': Buffer.from([0xff, 0xfe]),
  'utf-16be': Buffer.from([0xfe, 0xff]),
};

export async function readNote(root: string, absPath: string): Promise<ReadResult> {
  let safePath: string;
  try {
    safePath = guardPath(root, absPath);
  } catch {
    throw new NoteReadError('OUTSIDE_LIBRARY', '路径越界', absPath);
  }
  let buf: Buffer;
  try {
    buf = await fsp.readFile(safePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'NOT_FOUND' : 'READ_FAILED';
    throw new NoteReadError(code, `读取失败：${String(err)}`, safePath);
  }
  const encoding = detectEncoding(buf);
  const hadBom = hasBom(buf, encoding);
  const html = stripBom(decodeBuffer(buf, encoding));
  const { document } = parseHTML(html);
  return {
    path: safePath,
    html,
    encoding,
    // EOL 必须基于解码后的文本判断：UTF-16 字节流中 NUL 会夹在 \r\n 之间
    eol: detectEol(html),
    hadBom,
    baselineSignature: document.documentElement ? signatureOf(document.documentElement) : '',
  };
}

export async function writeNoteAtomic(
  root: string,
  absPath: string,
  text: string,
  encoding: string,
  options: { backup?: boolean; bom?: boolean } = {},
): Promise<string | undefined> {
  const safePath = guardPath(root, absPath);
  if (!canEncodeLosslessly(text, encoding)) {
    throw new EncodingLossyError(encoding, safePath);
  }
  let backupPath: string | undefined;
  if (options.backup) {
    backupPath = `${safePath}.bak`;
    try {
      await fsp.copyFile(safePath, backupPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        backupPath = undefined;
      } else {
        throw new BackupFailedError(safePath, err);
      }
    }
  }
  const bom = options.bom ? BOMS[encoding] : undefined;
  const body = encodeText(text, encoding);
  const finalBuf = bom ? Buffer.concat([bom, body]) : body;
  const tmp = path.join(
    path.dirname(safePath),
    `.${path.basename(safePath)}.tmp-${process.pid}-${Date.now()}`,
  );
  let mode: number | undefined;
  try {
    mode = (await fsp.stat(safePath)).mode;
  } catch {
    mode = undefined;
  }
  try {
    await fsp.writeFile(tmp, finalBuf);
    if (mode !== undefined) await fsp.chmod(tmp, mode);
    await fsp.rename(tmp, safePath);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => undefined);
    throw err;
  }
  return backupPath;
}

export class BackupFailedError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly cause: unknown,
  ) {
    super(`备份失败，已取消保存：${String(cause)}`);
    this.name = 'BackupFailedError';
  }
}

function hasBom(buf: Buffer, encoding: string): boolean {
  const bom = BOMS[encoding];
  if (!bom || buf.length < bom.length) return false;
  return buf.subarray(0, bom.length).equals(bom);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
