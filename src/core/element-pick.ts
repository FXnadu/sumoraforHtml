import type { PickedElementPayload } from '../shared/types';

/**
 * 元素拾取的纯逻辑（docs/06 §5）：从 live DOM 取元素并清洗成可发送片段。
 * 放在 core/ 是为了单测（linkedom）与 webview preload 共用同一实现。
 *
 * 清洗规则：
 * - 只删应用注入的属性：带 EDITABLE_FLAG 的元素去掉 contenteditable / spellcheck / 标记本身；
 *   作者手写的 contenteditable（无标记）原样保留；
 * - outerHTML 超限按字节截断（约束 16），截断片段以显式注释收尾。
 *
 * 【恢复副本】此文件原位于 src/core/element-pick.ts，2026-10-24 误删后由
 * ZCode 会话上下文逐字恢复。相对路径供拼回项目时参考，请连同目录结构移动。
 */

export const EDITABLE_FLAG = 'data-note-editable';
export const PICK_LIMIT_BYTES = 32 * 1024;

const PICK_INJECTED_ATTRS = [EDITABLE_FLAG, 'contenteditable', 'spellcheck'] as const;

/** 克隆并剥离应用注入的属性（只动带 EDITABLE_FLAG 的元素，不碰作者手写属性） */
export function cleanPickedClone(element: Element): Element {
  const clone = element.cloneNode(true) as Element;
  // 根元素只有自带注入标记才清洗，作者手写的 contenteditable 必须原样保留
  const marked: Element[] = clone.hasAttribute(EDITABLE_FLAG)
    ? [clone, ...Array.from(clone.querySelectorAll<HTMLElement>(`[${EDITABLE_FLAG}]`))]
    : Array.from(clone.querySelectorAll<HTMLElement>(`[${EDITABLE_FLAG}]`));
  for (const el of marked) {
    for (const attr of PICK_INJECTED_ATTRS) el.removeAttribute(attr);
  }
  return clone;
}

/** 序列化并截断；返回可直接回传给宿主的载荷 */
export function buildPickedPayload(element: Element): PickedElementPayload {
  const html = cleanPickedClone(element).outerHTML;
  const bytes = byteLength(html);
  if (bytes <= PICK_LIMIT_BYTES) {
    return { tagName: element.tagName.toLowerCase(), outerHTML: html, truncated: false, sizeBytes: bytes };
  }
  const cut = truncateToBytes(html, PICK_LIMIT_BYTES);
  return {
    tagName: element.tagName.toLowerCase(),
    outerHTML: `${cut}\n<!-- 已截断：原始 ${(bytes / 1024).toFixed(1)}KB -->`,
    truncated: true,
    sizeBytes: bytes,
  };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 按字节长度安全截 UTF-8（不切多字节字符中间） */
function truncateToBytes(text: string, limitBytes: number): string {
  let chars = Math.floor((limitBytes / Math.max(1, byteLength(text))) * text.length);
  while (chars > 0 && byteLength(text.slice(0, chars)) > limitBytes) chars -= 1;
  return text.slice(0, Math.max(0, chars));
}
