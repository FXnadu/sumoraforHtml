import { useDeferredValue, useMemo, useRef } from 'react';
import { highlightHtml } from '../lib/html-highlight';
import { useEditorStore } from '../store/editorStore';

/** 源码模式：行号槽 + 高亮层 + 透明 textarea 三层叠加。 */
export default function SourceEditor(): JSX.Element {
  const rawHtml = useEditorStore((s) => s.rawHtml);
  const updateSource = useEditorStore((s) => s.updateSource);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  // 高亮层与行号槽跟随延迟值：textarea 即时响应击键，
  // 全文重高亮被推迟到空闲时段，大文件打字不再被整段重算卡住
  const deferredHtml = useDeferredValue(rawHtml);
  const highlighted = useMemo(() => highlightHtml(deferredHtml), [deferredHtml]);
  const lineCount = useMemo(() => deferredHtml.split('\n').length, [deferredHtml]);

  const syncScroll = (event: React.UIEvent<HTMLTextAreaElement>): void => {
    const layer = highlightRef.current;
    if (layer) {
      layer.scrollTop = event.currentTarget.scrollTop;
      layer.scrollLeft = event.currentTarget.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
  };

  return (
    <div
      className="source-editor-wrap"
      style={{ '--source-gutter-digits': String(lineCount).length } as React.CSSProperties}
    >
      <div className="source-gutter" aria-hidden="true" ref={gutterRef}>
        {Array.from({ length: lineCount }, (_, index) => (
          <div key={index} className="source-gutter-line">
            {index + 1}
          </div>
        ))}
      </div>
      <pre
        className="source-highlight"
        aria-hidden="true"
        ref={highlightRef}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
      <textarea
        className="source-editor"
        aria-label="HTML 源码"
        spellCheck={false}
        wrap="off"
        value={rawHtml}
        onChange={(event) => updateSource(event.target.value)}
        onScroll={syncScroll}
      />
    </div>
  );
}
