/** 可编辑块判定（core 纯逻辑，被 webview 注入层使用）。
 *
 * 【恢复副本】由未混淆编译产物（out/preload/webview.js 头部）逐行反构，
 * 语义与原 src/core/editable-rules.ts 一致。 */

/** 不进入编辑的标签：脚本样式类 + 结构保持类 */
export const EXCLUDED_TAGS = [
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'MATH',
  'IFRAME',
  'TEXTAREA',
  'PRE',
  'CODE',
] as const;

const EXCLUDED = new Set<string>(EXCLUDED_TAGS);

/** 文本节点类型常量 */
const TEXT_NODE = 3;

/** 块级标签：子树里出现任何一个就不把当前元素当编辑块 */
const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DETAILS',
  'DIALOG',
  'DIV',
  'DL',
  'DT',
  'DD',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'SECTION',
  'SUMMARY',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'TR',
  'UL',
]);

/** 交互控件：永远不进编辑 */
const INTERACTIVE_TAGS = new Set([
  'BUTTON',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'AUDIO',
  'VIDEO',
  'CANVAS',
  'EMBED',
  'OBJECT',
]);

/** 子树禁入标签的组合选择器（块级 + 排除 + 交互）：querySelector 首个命中即停，
 * 替代逐元素 querySelectorAll('*') 全量展开，大文档从近似平方级降为近似线性 */
const BLOCKED_DESCENDANT_SELECTOR = [
  ...BLOCK_TAGS,
  ...EXCLUDED,
  ...INTERACTIVE_TAGS,
]
  .map((tag) => tag.toLowerCase())
  .join(',');

/** 是否为可编辑块：自身有直接文本、子树无块级/排除/交互标签 */
export function isEditableBlock(el: HTMLElement): boolean {
  if (el.tagName === 'BODY' || el.tagName === 'HTML') return false;
  if (EXCLUDED.has(el.tagName) || INTERACTIVE_TAGS.has(el.tagName)) return false;
  if (el.getAttribute('contenteditable') === 'false') return false;

  const children = Array.from(el.childNodes);
  const hasDirectText = children.some(
    (n) => n.nodeType === TEXT_NODE && (n.textContent ?? '').trim() !== '',
  );
  if (!hasDirectText) return false;

  if (el.querySelector(BLOCKED_DESCENDANT_SELECTOR)) return false;
  return true;
}

/** 收集 root 下全部可编辑块（命中即不再下钻） */
export function collectEditable(root: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];
  const visit = (el: HTMLElement): void => {
    if (EXCLUDED.has(el.tagName) || INTERACTIVE_TAGS.has(el.tagName)) return;
    if (el.getAttribute('contenteditable') === 'false') return;
    if (isEditableBlock(el)) {
      result.push(el);
      return;
    }
    for (const child of Array.from(el.children)) visit(child as HTMLElement);
  };
  for (const child of Array.from(root.children)) visit(child as HTMLElement);
  return result;
}
