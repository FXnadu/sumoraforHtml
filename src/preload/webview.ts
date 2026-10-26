import { ipcRenderer } from 'electron';
import { collectEditable } from '../core/editable-rules';
import { buildPickedPayload, EDITABLE_FLAG } from '../core/element-pick';
import { serializeDocument } from '../core/html-serialize';
import { signatureOf } from '../core/structure-signature';
import type { SerializeResponse } from '../shared/types';

/**
 * 笔记渲染容器（webview）注入脚本。
 *
 * 约束（详见 docs/03-实现方案.md 第 5 节）：
 * - composition 期间不得做任何拦截，否则中文输入会被破坏
 * - 只把可编辑块标记为可编辑，不增删标签
 * - 序列化前必须摘掉注入属性，保存的内容不能带上 contenteditable 等标记
 *
 * 消息名与 shared/ipc-channels.ts 的 WV 保持一致；这里单独定义是为了让
 * 沙箱 preload 只依赖 electron 一个模块，不产生需要额外 require 的分包。
 */

const WV = {
  SET_EDITABLE: 'note:set-editable',
  SERIALIZE: 'note:serialize',
  SERIALIZED: 'note:serialized',
  MARK_CLEAN: 'note:mark-clean',
  DIRTY: 'note:dirty',
  SAVE_REQUEST: 'note:save-request',
  AI_PICK_START: 'ai:pick-start',
  AI_PICK_STOP: 'ai:pick-stop',
  AI_PICKED: 'ai:picked',
  AI_PICK_CANCELLED: 'ai:pick-cancelled',
} as const;

/** 注入标记常量统一来自 core/element-pick（EDITABLE_FLAG，同一来源避免漂移） */
/** 文本节点类型常量（与 core/editable-rules 保持一致） */
const TEXT_NODE = 3;

/** 注入前的原始属性，关闭编辑模式或序列化时用于精确还原 */
interface OriginalAttrs {
  contenteditable: string | null;
  spellcheck: string | null;
}

const originals = new WeakMap<HTMLElement, OriginalAttrs>();
let dirty = false;
let composing = false;

function injectEditable(el: HTMLElement): void {
  if (!originals.has(el)) {
    originals.set(el, {
      contenteditable: el.getAttribute('contenteditable'),
      spellcheck: el.getAttribute('spellcheck'),
    });
  }
  el.setAttribute('contenteditable', 'plaintext-only');
  el.setAttribute('spellcheck', 'false');
  el.setAttribute(EDITABLE_FLAG, '1');
}

function restoreEditable(el: HTMLElement): void {
  const original = originals.get(el);
  if (original) {
    if (original.contenteditable === null) el.removeAttribute('contenteditable');
    else el.setAttribute('contenteditable', original.contenteditable);
    if (original.spellcheck === null) el.removeAttribute('spellcheck');
    else el.setAttribute('spellcheck', original.spellcheck);
  } else {
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
  }
  el.removeAttribute(EDITABLE_FLAG);
}

function setEditable(on: boolean): void {
  const body = document.body;
  if (!body) return;
  if (on) {
    for (const el of collectEditable(body)) {
      if (el.getAttribute(EDITABLE_FLAG)) continue;
      injectEditable(el);
    }
  } else {
    for (const el of Array.from(body.querySelectorAll<HTMLElement>(`[${EDITABLE_FLAG}]`))) {
      restoreEditable(el);
    }
  }
}

/** 序列化期间临时还原原始属性，避免注入标记被写回笔记文件 */
function serializeClean(): { html: string; signature: string } {
  // 拾取进行中触发保存：先退出拾取（还原高亮样式、删除标签节点），
  // 并通知宿主取消等待中的拾取（约束 8：注入物绝不落盘）
  if (picking) {
    setPicking(false);
    ipcRenderer.sendToHost(WV.AI_PICK_CANCELLED);
  }

  const marked = Array.from(document.querySelectorAll<HTMLElement>(`[${EDITABLE_FLAG}]`));
  const snapshots = marked.map((el) => ({
    el,
    contenteditable: el.getAttribute('contenteditable'),
    spellcheck: el.getAttribute('spellcheck'),
  }));

  for (const { el } of snapshots) {
    const original = originals.get(el);
    if (original?.contenteditable != null) el.setAttribute('contenteditable', original.contenteditable);
    else el.removeAttribute('contenteditable');
    if (original?.spellcheck != null) el.setAttribute('spellcheck', original.spellcheck);
    else el.removeAttribute('spellcheck');
    el.removeAttribute(EDITABLE_FLAG);
  }

  try {
    const html = serializeDocument(document, '\n');
    const signature = document.documentElement ? signatureOf(document.documentElement) : '';
    return { html, signature };
  } finally {
    for (const { el, contenteditable, spellcheck } of snapshots) {
      if (contenteditable === null) el.removeAttribute('contenteditable');
      else el.setAttribute('contenteditable', contenteditable);
      if (spellcheck === null) el.removeAttribute('spellcheck');
      else el.setAttribute('spellcheck', spellcheck);
      el.setAttribute(EDITABLE_FLAG, '1');
    }
  }
}

/** 单击落在内联子标签上时，event.target 可能是子元素；统一向上找编辑块 */
function editableHostOf(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest<HTMLElement>(`[${EDITABLE_FLAG}]`) ?? null;
}

/**
 * 插入是否安全：折叠光标任意位置都安全（只新增文本）；
 * 非折叠选区只有完全落在同一个文本节点内才安全，否则会带走内联标签。
 */
function insertionIsSafe(host: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return false;
  if (selection.isCollapsed) return true;
  return range.startContainer === range.endContainer && range.startContainer.nodeType === TEXT_NODE;
}

/**
 * 删除是否安全（FR-17：不得跨越元素边界删除/合并）：
 * - 非折叠选区：只在同一个文本节点内允许，避免把 <b>/<span> 整段删掉；
 * - 折叠光标：退格要求光标前还有字符，前向删除要求光标后还有字符；
 *   光标停在文本节点边界（0 或末尾）时一律拦截，防止和相邻元素/段落合并。
 */
function deletionIsSafe(host: HTMLElement, inputType: string): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return false;

  if (!selection.isCollapsed) {
    return range.startContainer === range.endContainer && range.startContainer.nodeType === TEXT_NODE;
  }

  const node = range.startContainer;
  if (node.nodeType !== TEXT_NODE) return false;

  if (inputType === 'deleteContentBackward') return range.startOffset > 0;
  if (inputType === 'deleteContentForward') {
    return range.startOffset < (node.textContent?.length ?? 0);
  }
  return false;
}

/** 一律拦截的输入类型：会新增标签 / 改变结构，或无法安全推算删除范围 */
const BLOCKED_INPUT_TYPES = new Set([
  'insertParagraph',
  'insertLineBreak',
  'insertHorizontalRule',
  'insertOrderedList',
  'insertUnorderedList',
  'deleteByDrag',
  'deleteWordBackward',
  'deleteWordForward',
  'deleteSoftLineBackward',
  'deleteSoftLineForward',
  'deleteHardLineBackward',
  'deleteHardLineForward',
]);

// IME 组合输入期间放行一切输入事件
document.addEventListener('compositionstart', () => (composing = true), true);
document.addEventListener('compositionend', () => (composing = false), true);

document.addEventListener(
  'beforeinput',
  (event) => {
    if (composing) return;
    const host = editableHostOf(event.target as Node | null);
    if (!host) return;

    const type = event.inputType;

    // 回车 / 换行 / 列表 / 格式 / 跨元素拖拽：都会改结构，直接拦截
    if (BLOCKED_INPUT_TYPES.has(type) || type.startsWith('format')) {
      event.preventDefault();
      return;
    }

    // 粘贴 / 拖放一律只保留纯文本
    if (type === 'insertFromPaste' || type === 'insertFromDrop') {
      if (!insertionIsSafe(host)) {
        event.preventDefault();
        return;
      }
      const text = event.dataTransfer?.getData('text/plain');
      // 拿不到剪贴板内容时交给浏览器按 plaintext-only 处理，避免粘贴静默失效
      if (text == null) return;
      event.preventDefault();
      const singleLine = text.replace(/\s+/g, ' ');
      if (singleLine) document.execCommand('insertText', false, singleLine);
      return;
    }

    // 用输入法之外的普通文字替换选区时，同样要防止跨元素替换
    if (type === 'insertText' || type === 'insertReplacementText') {
      if (!insertionIsSafe(host)) event.preventDefault();
      return;
    }

    // 删除：只允许发生在单个文本节点内部（FR-17 的第一道防线）
    if (
      type === 'deleteContentBackward' ||
      type === 'deleteContentForward' ||
      type === 'deleteContent' ||
      type === 'deleteByCut'
    ) {
      if (!deletionIsSafe(host, type)) event.preventDefault();
    }
  },
  true,
);

document.addEventListener(
  'input',
  () => {
    if (dirty) return;
    dirty = true;
    ipcRenderer.sendToHost(WV.DIRTY);
  },
  true,
);

// webview 聚焦时应用菜单的加速键可能不生效，这里补一条 Ctrl/Cmd+S 兜底
document.addEventListener(
  'keydown',
  (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      ipcRenderer.sendToHost(WV.SAVE_REQUEST);
    }
  },
  true,
);

// ── 元素拾取模式 ─────────────────────────────────────────
// 高亮只改内联样式并逐元素快照还原；悬浮标签是唯一注入节点，退出时必删。
// 两者都不允许进入序列化输出（serializeClean 前强制退出拾取）。

interface PickStyleSnapshot {
  outline: string;
  outlineOffset: string;
  cursor: string;
}

let picking = false;
let pickHovered: HTMLElement | null = null;
let pickLabel: HTMLDivElement | null = null;
const pickSnapshots = new WeakMap<HTMLElement, PickStyleSnapshot>();

function pickHighlight(el: HTMLElement | null): void {
  if (el === pickHovered) return;
  if (pickHovered) restorePickStyle(pickHovered);
  pickHovered = el;
  if (!el) return;
  pickSnapshots.set(el, {
    outline: el.style.outline,
    outlineOffset: el.style.outlineOffset,
    cursor: el.style.cursor,
  });
  el.style.outline = '2px solid #2f6feb';
  el.style.outlineOffset = '-1px';
  el.style.cursor = 'crosshair';
  updatePickLabel(el);
}

function restorePickStyle(el: HTMLElement): void {
  const snapshot = pickSnapshots.get(el);
  if (snapshot) {
    el.style.outline = snapshot.outline;
    el.style.outlineOffset = snapshot.outlineOffset;
    el.style.cursor = snapshot.cursor;
  }
}

function updatePickLabel(el: HTMLElement): void {
  if (!pickLabel) return;
  const rect = el.getBoundingClientRect();
  pickLabel.textContent = `${el.tagName.toLowerCase()} · ${Math.round(rect.width)}×${Math.round(rect.height)}（点击选中，Esc 取消）`;
  pickLabel.style.left = `${Math.max(4, rect.left)}px`;
  pickLabel.style.top = `${Math.max(4, rect.top - 24)}px`;
}

function onPickHover(event: MouseEvent): void {
  const target = event.target;
  pickHighlight(target instanceof HTMLElement && target !== document.body ? target : null);
}

function onPickClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const payload = buildPickedPayload(target);
  setPicking(false);
  ipcRenderer.sendToHost(WV.AI_PICKED, payload);
}

function onPickKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  setPicking(false);
  ipcRenderer.sendToHost(WV.AI_PICK_CANCELLED);
}

function setPicking(on: boolean): void {
  if (on === picking) return;
  picking = on;
  if (on) {
    // 拾取与编辑互斥（约束 9）：先挂起编辑注入，宿主在拾取结束后重发编辑状态
    setEditable(false);
    pickLabel = document.createElement('div');
    pickLabel.setAttribute('data-note-pick-label', '1');
    pickLabel.style.cssText =
      'position:fixed;z-index:2147483647;pointer-events:none;font:12px/20px system-ui,sans-serif;' +
      'padding:0 6px;border-radius:4px;background:#2f6feb;color:#fff;white-space:nowrap;';
    document.documentElement.appendChild(pickLabel);
    document.addEventListener('mouseover', onPickHover, true);
    document.addEventListener('click', onPickClick, true);
    document.addEventListener('keydown', onPickKeydown, true);
  } else {
    document.removeEventListener('mouseover', onPickHover, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKeydown, true);
    pickHighlight(null);
    pickLabel?.remove();
    pickLabel = null;
  }
}

ipcRenderer.on(WV.AI_PICK_START, () => setPicking(true));
ipcRenderer.on(WV.AI_PICK_STOP, () => setPicking(false));

ipcRenderer.on(WV.SET_EDITABLE, (_event, on: boolean) => setEditable(on));

ipcRenderer.on(WV.MARK_CLEAN, () => {
  dirty = false;
});

ipcRenderer.on(WV.SERIALIZE, (_event, requestId: number) => {
  let response: SerializeResponse;
  try {
    const { html, signature } = serializeClean();
    response = { requestId, html, signature };
  } catch (err) {
    response = { requestId, html: '', signature: '', error: String(err) };
  }
  ipcRenderer.sendToHost(WV.SERIALIZED, response);
});
