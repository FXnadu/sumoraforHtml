import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { signatureOf } from './structure-signature';

const sig = (html: string): string => {
  const { document } = parseHTML(html);
  return signatureOf(document.documentElement);
};

describe('structure-signature', () => {
  it('文本变化不改变签名', () => {
    expect(sig('<html><body><p>原文</p></body></html>')).toBe(
      sig('<html><body><p>改过的文字</p></body></html>'),
    );
  });

  it('属性变化不改变签名', () => {
    expect(sig('<html><body><p class="a">x</p></body></html>')).toBe(
      sig('<html><body><p class="b">x</p></body></html>'),
    );
  });

  it('增删标签会改变签名', () => {
    expect(sig('<html><body><p>x</p></body></html>')).not.toBe(
      sig('<html><body><p>x</p><p>y</p></body></html>'),
    );
  });

  it('嵌套层级变化会改变签名', () => {
    expect(sig('<html><body><ul><li>x</li></ul></body></html>')).not.toBe(
      sig('<html><body><li>x</li></body></html>'),
    );
  });

  it('兄弟重排 / 元素换父会改变签名（回归：H-1 假阴性）', () => {
    // span 从 div 的兄弟变为 div 的子元素：结构变了，签名必须不同
    expect(sig('<html><body><div><p>a</p></div><span>b</span></body></html>')).not.toBe(
      sig('<html><body><div><p>a</p><span>b</span></div></body></html>'),
    );
  });

  it('闭合标记参与签名：兄弟结构输出可区分', () => {
    expect(sig('<html><body><div><p>a</p></div><span>b</span></body></html>')).toBe(
      'html;body;div;p;/;/;span;/;/;/',
    );
  });
});
