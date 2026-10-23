import { useEffect, useRef, useState } from 'react';
import { toMessage } from '../lib/ipcError';

interface NamePromptDialogProps {
  title: string;
  label?: string;
  hint?: string;
  initialValue?: string;
  selectBaseName?: boolean;
  confirmText?: string;
  /** 返回错误文案表示校验失败（弹窗保持打开）；null/undefined 表示成功关闭 */
  onConfirm: (name: string) => Promise<string | null>;
  onClose: () => void;
}

/** 名称输入弹窗：新建 / 重命名共用。 */
export default function NamePromptDialog({
  title,
  label,
  hint,
  initialValue = '',
  selectBaseName = false,
  confirmText = '确定',
  onConfirm,
  onClose,
}: NamePromptDialogProps): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (selectBaseName) {
      const dot = initialValue.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 ? dot : initialValue.length);
    } else {
      input.select();
    }
  }, [initialValue, selectBaseName]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [busy, onClose]);

  const submit = async (): Promise<void> => {
    const name = value.trim();
    if (!name) {
      setError('请输入名称');
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const message = await onConfirm(name);
      if (message) {
        setError(message);
        setBusy(false);
        return;
      }
      onClose();
    } catch (err) {
      setError(toMessage(err));
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="modal name-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 id="name-dialog-title" className="modal-title">
          {title}
        </h2>
        {label && (
          <label className="modal-label" htmlFor="name-dialog-input">
            {label}
          </label>
        )}
        <input
          id="name-dialog-input"
          ref={inputRef}
          className="modal-input"
          value={value}
          disabled={busy}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
        />
        {hint && !error && <p className="modal-hint">{hint}</p>}
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn primary" disabled={busy || !value.trim()}>
            {busy ? '处理中…' : confirmText}
          </button>
        </div>
      </form>
    </div>
  );
}
