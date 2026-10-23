/** 文档序列化（core 纯逻辑）：doctype + documentElement.outerHTML + 换行归一。
 *
 * 【恢复副本】由未混淆编译产物（out/preload/webview.js）逐行反构，
 * 语义与原 src/core/html-serialize.ts 一致。 */

/** 序列化整个文档；eol 为目标换行符（'\n' / '\r\n' / '\r'） */
export function serializeDocument(doc: Document, eol: string): string {
  const doctype = serializeDoctype(doc.doctype);
  const raw = doctype + doc.documentElement.outerHTML;
  return normalizeEol(raw, eol);
}

function serializeDoctype(dt: DocumentType | null): string {
  if (!dt?.name) return '';
  let out = `<!DOCTYPE ${dt.name}`;
  if (dt.publicId) {
    out += ` PUBLIC "${dt.publicId}"`;
    if (dt.systemId) out += ` "${dt.systemId}"`;
  } else if (dt.systemId) {
    out += ` SYSTEM "${dt.systemId}"`;
  }
  return `${out}>\n`;
}

function normalizeEol(text: string, eol: string): string {
  const unified = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return eol === '\n' ? unified : unified.replace(/\n/g, eol);
}
