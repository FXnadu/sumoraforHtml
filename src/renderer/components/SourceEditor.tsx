import { useMemo, useRef } from 'react';
import { highlightHtml } from '../lib/html-highlight';
import { useEditorStore } from '../store/editorStore';

/** 源码模式：行号槽 + 高亮层 + 透明 textarea 三层叠加。 */
export default function SourceEditor(): JSX.Element {
  const rawHtml = useEditorStore((s) => s.rawHtml);
  const updateSource = useEditorStore((s) => s.updateSource);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const highlighted = useMemo(() => highlightHtml(rawHtml), [rawHtml]);
  const lineCount = useMemo(() => rawHtml.split('\n').length, [rawHtml]);

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
