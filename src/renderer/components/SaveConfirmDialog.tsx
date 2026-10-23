import { useEditorStore } from '../store/editorStore';

/** 结构变化确认弹窗：用户点「仍然保存」后带确认位重试。 */
export default function SaveConfirmDialog(): JSX.Element | null {
  const pending = useEditorStore((s) => s.pendingStructureConfirm);
  const confirm = useEditorStore((s) => s.confirmStructureSave);
  const cancel = useEditorStore((s) => s.cancelStructureSave);
  if (!pending) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="save-confirm-title">
      <div className="modal">
        <h2 id="save-confirm-title" className="modal-title">
          HTML 结构发生变化
        </h2>
        <p className="modal-text">
          本次修改改变了笔记的标签结构（例如增删段落）。继续保存可能影响原有排版； 保存前会自动生成 .bak
          备份。
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={cancel}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={() => void confirm()}>
            仍然保存
          </button>
        </div>
      </div>
    </div>
  );
}
