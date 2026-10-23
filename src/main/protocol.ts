import path from 'node:path';
import fsp from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import iconv from 'iconv-lite';
import { detectEncoding } from '../core/encoding';
import { guardPath } from './security/pathGuard';
import { getLibraryRoot } from './services/settings';

/**
 * note:// 自定义协议：把笔记库根目录映射为安全 URL 空间。
 * 处理器内部再次过 pathGuard，拒绝库外路径与非法扩展名；HTML 响应强制
 * 携带严格 CSP（脚本一律不执行）。
 *
 * 【恢复副本】由未混淆编译产物逐行反构。
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const TEXT_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json']);

const NOTE_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'img-src note: data:',
  "style-src note: data: 'unsafe-inline'",
  'font-src note: data:',
  'media-src note: data:',
].join('; ');

function textResponse(body: string, status: number, extra?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...extra },
  });
}

export function registerNoteProtocol(): void {
  protocol.handle('note', async (request) => {
    try {
      const root = getLibraryRoot();
      if (!root) return textResponse('Library not set', 404);
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (!rel) return textResponse('Bad Request', 400);
      let abs: string;
      try {
        abs = guardPath(root, rel);
      } catch {
        return textResponse('Forbidden', 403);
      }
      const ext = path.extname(abs).toLowerCase();
      if (!ext || !(ext in MIME)) {
        return textResponse('Unsupported resource type', 404);
      }
      if (TEXT_EXTENSIONS.has(ext)) {
        let buf: Buffer;
        try {
          buf = await fsp.readFile(abs);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') return textResponse('Not Found', 404);
          if (code === 'EACCES' || code === 'EPERM') return textResponse('Forbidden', 403);
          return textResponse('Read Failed', 500);
        }
        const encoding = detectEncoding(buf);
        let text: string;
        try {
          text = (encoding === 'utf-8' ? buf.toString('utf8') : iconv.decode(buf, encoding)).replace(
            /^\uFEFF/,
            '',
          );
        } catch {
          text = iconv.decode(buf, 'gb18030').replace(/^\uFEFF/, '');
        }
        const headers: Record<string, string> = { 'content-type': MIME[ext]! };
        if (ext === '.html' || ext === '.htm') headers['content-security-policy'] = NOTE_CSP;
        return new Response(text, { status: 200, headers });
      }
      let response: Response;
      try {
        response = await net.fetch(pathToFileURL(abs).href);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return textResponse('Not Found', 404);
        if (code === 'EACCES' || code === 'EPERM') return textResponse('Forbidden', 403);
        return textResponse('Read Failed', 500);
      }
      if (!response.ok && response.status !== 206) {
        return textResponse(response.statusText || 'Not Found', response.status);
      }
      const headers = new Headers(response.headers);
      headers.set('content-type', MIME[ext]!);
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return textResponse('Internal Error', 500);
    }
  });
}
