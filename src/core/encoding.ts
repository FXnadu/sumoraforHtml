import iconv from 'iconv-lite';

/** 编码嗅探与安全转码（core 纯逻辑，主进程使用）。
 *
 * 【恢复副本】由未混淆编译产物（out/main/index.js）逐行反构。 */

export function detectEncoding(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le';
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be';
  const utf16 = sniffBomlessUtf16(buf);
  if (utf16) return utf16;
  if (isStrictUtf8(buf)) return 'utf-8';
  const head = buf.subarray(0, 2048).toString('latin1').replace(/<!--[\s\S]*?-->/g, '');
  const meta = /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(head);
  if (meta?.[1]) {
    const normalized = normalizeCharset(meta[1]);
    if (normalized !== 'utf-8') return normalized;
  }
  return 'gb18030';
}

export function detectEol(text: string): '\r\n' | '\n' | '\r' {
  const s = text.slice(0, 65536);
  const crlf = (s.match(/\r\n/g) ?? []).length;
  const lf = (s.match(/(?<!\r)\n/g) ?? []).length;
  const cr = (s.match(/(?!\n)\r/g) ?? []).length;
  if (crlf === 0 && lf === 0 && cr === 0) return '\n';
  if (crlf >= lf && crlf >= cr) return '\r\n';
  if (cr > lf) return '\r';
  return '\n';
}

export function canEncodeLosslessly(text: string, encoding: string): boolean {
  if (isUnicode(encoding)) return true;
  try {
    return iconv.decode(iconv.encode(text, encoding), encoding) === text;
  } catch {
    return false;
  }
}

export function encodeText(text: string, encoding: string): Buffer {
  return encoding === 'utf-8' ? Buffer.from(text, 'utf8') : Buffer.from(iconv.encode(text, encoding));
}

export function decodeBuffer(buf: Buffer, encoding: string): string {
  if (encoding === 'utf-8' || encoding === 'utf8') return buf.toString('utf8');
  try {
    return iconv.decode(buf, encoding);
  } catch {
    return isStrictUtf8(buf) ? buf.toString('utf8') : iconv.decode(buf, 'gb18030');
  }
}

function isUnicode(encoding: string): boolean {
  const e = encoding.toLowerCase();
  return e === 'utf-8' || e === 'utf8' || e.startsWith('utf-16');
}

function normalizeCharset(charset: string): string {
  const c = charset.toLowerCase();
  if (c === 'gb2312' || c === 'gbk') return 'gb18030';
  if (c === 'utf8') return 'utf-8';
  return c;
}

function isStrictUtf8(buf: Buffer): boolean {
  return Buffer.compare(Buffer.from(buf.toString('utf8'), 'utf8'), buf) === 0;
}

function sniffBomlessUtf16(buf: Buffer): string | null {
  const len = Math.min(buf.length, 1024) & -2;
  if (len < 8) return null;
  let nullEven = 0;
  let nullOdd = 0;
  for (let i = 0; i < len; i += 2) {
    if (buf[i] === 0) nullEven += 1;
    if (buf[i + 1] === 0) nullOdd += 1;
  }
  const pairs = len / 2;
  const threshold = Math.max(4, pairs * 0.2);
  if (nullOdd >= threshold && nullEven <= pairs * 0.05) return 'utf-16le';
  if (nullEven >= threshold && nullOdd <= pairs * 0.05) return 'utf-16be';
  return null;
}
