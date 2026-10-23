/** 源码模式的 HTML 语法高亮（纯函数，输出带 tok-* 类名的安全 HTML）。
 *
 * 【恢复副本】由未混淆编译产物逐行反构。 */

const TOKEN_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/?[a-zA-Z][^>]*>/g;
const ATTR_RE = /\s+|[a-zA-Z_:@][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function span(kind: string, text: string): string {
  return `<span class="tok-${kind}">${escapeHtml(text)}</span>`;
}

function highlightTag(raw: string): string {
  const match = /^(<\/?)([a-zA-Z][\w:.-]*)([\s\S]*?)(\/?>)$/.exec(raw);
  if (!match) return escapeHtml(raw);
  const [, open, name, attrs, close] = match;
  return span('punct', open) + span('tag', name) + highlightAttrs(attrs) + span('punct', close);
}

function highlightAttrs(attrs: string): string {
  let out = '';
  let last = 0;
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(attrs)) !== null) {
    if (match.index > last) out += escapeHtml(attrs.slice(last, match.index));
    const token = match[0];
    if (/^\s+$/.test(token)) {
      out += token;
    } else {
      const eq = token.indexOf('=');
      if (eq === -1) {
        out += span('attr', token);
      } else {
        out += span('attr', token.slice(0, eq)) + span('punct', '=') + span('string', token.slice(eq + 1));
      }
    }
    last = ATTR_RE.lastIndex;
  }
  return out + escapeHtml(attrs.slice(last));
}

export function highlightHtml(source: string): string {
  let out = '';
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(source)) !== null) {
    out += escapeHtml(source.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('<!--')) {
      out += span('comment', token);
    } else if (token.startsWith('<![')) {
      out += span('meta', token);
    } else if (/^<[!?]/.test(token)) {
      out += span('meta', token);
    } else {
      out += highlightTag(token);
    }
    last = TOKEN_RE.lastIndex;
  }
  return out + escapeHtml(source.slice(last)) + '\n';
}
