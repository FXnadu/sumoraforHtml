/** 结构签名（core 纯逻辑）：只看标签名的开/闭序列，文本与属性变化不改变签名。
 *
 * 【恢复副本】由未混淆编译产物（out/preload/webview.js）逐行反构，
 * 语义与原 src/core/structure-signature.ts 一致（fixture 见 structure-signature.spec.ts）。 */

/** 根元素的结构签名；兄弟重排 / 换父 / 增删标签都会改变结果 */
export function signatureOf(root: Element): string {
  const parts: string[] = [];
  const walk = (el: Element): void => {
    parts.push(el.tagName.toLowerCase());
    for (const child of Array.from(el.children)) walk(child);
    parts.push('/');
  };
  walk(root);
  return parts.join(';');
}
