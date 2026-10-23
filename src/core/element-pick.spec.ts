import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { buildPickedPayload, cleanPickedClone, EDITABLE_FLAG, PICK_LIMIT_BYTES } from './element-pick';

/** 【恢复副本】原位于 src/core/element-pick.spec.ts，2026-10-24 误删后逐字恢复。 */

function pick(html: string, selector: string): Element {
  const { document } = parseHTML(html);
  const el = document.querySelector(selector);
  if (!el) throw new Error(`fixture 缺少 ${selector}`);
  return el;
}

describe('element-pick', () => {
  it('剥离应用注入的属性（标记 + 注入的 contenteditable/spellcheck）', () => {
    const el = pick(
      `<html><body><table ${EDITABLE_FLAG}="1" contenteditable="plaintext-only" spellcheck="false" class="demo"><tr><td>文字</td></tr></table></body></html>`,
      'table',
    );
    const payload = buildPickedPayload(el);
    expect(payload.outerHTML).not.toContain(EDITABLE_FLAG);
    expect(payload.outerHTML).not.toContain('contenteditable');
    expect(payload.outerHTML).not.toContain('spellcheck');
    expect(payload.outerHTML).toContain('class="demo"');
    expect(payload.outerHTML).toContain('<td>文字</td>');
  });

  it('深层子元素上的注入属性同样被剥离', () => {
    const el = pick(
      `<html><body><div><p ${EDITABLE_FLAG}="1" contenteditable="plaintext-only">段落</p></div></body></html>`,
      'div',
    );
    const payload = buildPickedPayload(el);
    expect(payload.outerHTML).not.toContain(EDITABLE_FLAG);
    expect(payload.outerHTML).toContain('<p>段落</p>');
  });

  it('作者手写的 contenteditable（无注入标记）原样保留', () => {
    const el = pick(
      `<html><body><div contenteditable="true" spellcheck="yes">原生可编辑</div></body></html>`,
      'div',
    );
    const payload = buildPickedPayload(el);
    expect(payload.outerHTML).toContain('contenteditable="true"');
    expect(payload.outerHTML).toContain('spellcheck="yes"');
  });

  it('只克隆不改 live DOM', () => {
    const el = pick(
      `<html><body><p ${EDITABLE_FLAG}="1" contenteditable="plaintext-only">文本</p></body></html>`,
      'p',
    );
    cleanPickedClone(el);
    expect(el.getAttribute(EDITABLE_FLAG)).toBe('1');
    expect(el.getAttribute('contenteditable')).toBe('plaintext-only');
  });

  it('超限按字节截断并显式标记', () => {
    const big = '一'.repeat(PICK_LIMIT_BYTES); // 中文一字 3 字节，必超限
    const el = pick(`<html><body><pre>${big}</pre></body></html>`, 'pre');
    const payload = buildPickedPayload(el);
    expect(payload.truncated).toBe(true);
    expect(payload.sizeBytes).toBeGreaterThan(PICK_LIMIT_BYTES);
    expect(payload.outerHTML).toContain('已截断');
    // 截断后片段本身不超过上限（允许少量截断注释开销）
    expect(payload.outerHTML.length).toBeLessThan(PICK_LIMIT_BYTES + 200);
  });

  it('未超限时原样输出且不标记截断', () => {
    const el = pick('<html><body><ul><li>a</li><li>b</li></ul></body></html>', 'ul');
    const payload = buildPickedPayload(el);
    expect(payload.truncated).toBe(false);
    expect(payload.tagName).toBe('ul');
    expect(payload.outerHTML).toBe('<ul><li>a</li><li>b</li></ul>');
  });
});
