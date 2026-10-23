import { useEffect, useRef } from 'react';
import { WV } from '../../shared/ipc-channels';
import type { PickedElementPayload, SerializeResponse } from '../../shared/types';
import { useEditorStore } from '../store/editorStore';
import type { WebviewElement } from '../lib/noteBridge';
import scrollbarCss from '../styles/scrollbar.css?inline';
import {
  attachWebview,
  detachWebview,
  handlePickResult,
  handleSerializeResponse,
  requestSerialize,
  sendEditable,
} from '../lib/noteBridge';

interface IpcMessageEvent extends Event {
  channel: string;
  args: unknown[];
}

/**
 * 笔记渲染容器。
 * 只作为浏览器窗口加载 note:// 地址；编辑能力由主进程强制挂载的 webview preload 提供，
 * 宿主本身不向笔记注入任何脚本。
 *
 * 【恢复副本】原位于 src/renderer/components/NotePane.tsx，2026-10-24 误删后逐字恢复。
 * 相对旧基线：import 增加 PickedElementPayload / handlePickResult；
 * 增加 handlePickResultMessage 辅助函数；ipc-message 分发增加 AI_PICKED / AI_PICK_CANCELLED 两支。
 */
export default function NotePane(): JSX.Element {
  const srcUrl = useEditorStore((s) => s.srcUrl);
  const status = useEditorStore((s) => s.status);
  const errorMessage = useEditorStore((s) => s.errorMessage);
  const editMode = useEditorStore((s) => s.editMode);
  const rawHtml = useEditorStore((s) => s.rawHtml);
  const webviewRef = useRef<HTMLWebViewElement | null>(null);
  // 浏览器调试模式没有 <webview>，改用 iframe 只读预览笔记外观
  const preview = window.noteDesk.preview === true;

  /** 拾取回传：补齐笔记路径交给桥，并恢复编辑模式 */
  const handlePickResultMessage = (payload: PickedElementPayload): void => {
    handlePickResult({ ...payload, notePath: useEditorStore.getState().currentPath ?? '' });
    sendEditable(useEditorStore.getState().editMode);
  };

  useEffect(() => {
    if (preview) return;
    const element = webviewRef.current;
    if (!element) return;
    const guest = element as unknown as WebviewElement;
    attachWebview(guest);

    const onDomReady = (): void => {
      // 只改滚动条外观，不向笔记 DOM 注入任何节点，不影响序列化与保存
      void guest.insertCSS(scrollbarCss).catch(() => undefined);
      const state = useEditorStore.getState();
      sendEditable(state.editMode);
      // 用浏览器侧签名覆盖基线：与保存时渲染进程算出的签名同源，避免跨引擎误报
      const absPath = state.currentPath;
      if (!absPath) return;
      void requestSerialize()
        .then(({ signature }) => useEditorStore.getState().applyWebviewBaseline(absPath, signature))
        .catch(() => undefined);
    };

    const onIpcMessage = (event: Event): void => {
      const message = event as IpcMessageEvent;
      if (message.channel === WV.DIRTY) {
        useEditorStore.getState().setDirty(true);
      } else if (message.channel === WV.SERIALIZED) {
        handleSerializeResponse(message.args[0] as SerializeResponse);
      } else if (message.channel === WV.SAVE_REQUEST) {
        void useEditorStore.getState().save();
      } else if (message.channel === WV.AI_PICKED) {
        handlePickResultMessage(message.args[0] as PickedElementPayload);
      } else if (message.channel === WV.AI_PICK_CANCELLED) {
        // 拾取结束（含保存触发的前置退出）：恢复编辑模式并落定等待
        handlePickResult(null);
        sendEditable(useEditorStore.getState().editMode);
      }
    };

    element.addEventListener('dom-ready', onDomReady);
    element.addEventListener('ipc-message', onIpcMessage);
    return () => {
      element.removeEventListener('dom-ready', onDomReady);
      element.removeEventListener('ipc-message', onIpcMessage);
      detachWebview(guest);
    };
  }, [srcUrl, preview]);

  // 编辑模式切换（webview 已加载时立即生效）
  useEffect(() => {
    sendEditable(editMode);
  }, [editMode]);

  if (status === 'idle') {
    return <Placeholder text="从左侧选择一篇笔记开始阅读或编辑" />;
  }
  if (status === 'loading') {
    return <Placeholder text="加载中…" />;
  }
  if (status === 'error') {
    return <Placeholder text={`打开失败：${errorMessage ?? '未知错误'}`} error />;
  }
  if (!srcUrl) {
    return <Placeholder text="没有可渲染的内容" />;
  }

  if (preview) {
    return (
      <iframe
        className="note-webview"
        title="笔记预览"
        srcDoc={rawHtml}
        // 预览只用于调样式：禁用脚本，也不会拿到宿主页面的权限
        sandbox=""
      />
    );
  }

  return (
    <webview
      ref={webviewRef}
      className="note-webview"
      src={srcUrl}
      webpreferences="contextIsolation=yes, sandbox=yes, nodeIntegration=no"
    />
  );
}

function Placeholder({ text, error }: { text: string; error?: boolean }): JSX.Element {
  return (
    <div className="note-placeholder">
      <p className={error ? 'note-error' : undefined}>{text}</p>
    </div>
  );
}
