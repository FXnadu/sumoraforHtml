import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { PickedElement } from '../../shared/types';
import { requestPick } from '../lib/noteBridge';
import { toMessage } from '../lib/ipcError';
import { useEditorStore } from '../store/editorStore';

/**
 * 内嵌终端面板：真实终端（PTY + xterm.js），用户自己的 CLI 在里面跑。
 * 应用不解析终端内容——只负责把会话开在笔记目录、转发输入输出，
 * 以及把「拾取的笔记元素」以文本形式插入终端（相当于粘贴给 CLI）。
 */

type Phase = 'starting' | 'running' | 'exited';

export default function TerminalPanel(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('starting');
  const [sessionInfo, setSessionInfo] = useState<{ cwd: string; command: string | null } | null>(null);
  const [chips, setChips] = useState<PickedElement[]>([]);
  const [picking, setPicking] = useState(false);
  /** 重启计数器：+1 即整块 effect 重建（杀旧会话、按当前笔记目录开新会话） */
  const [restartCount, setRestartCount] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const notePath = useEditorStore((s) => s.currentPath);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'Consolas, "Courier New", "Microsoft YaHei", monospace',
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try {
      fit.fit();
    } catch {
      // 容器还没布局好：ResizeObserver 会补一次
    }

    sessionIdRef.current = null;
    let disposed = false;
    const terminal = window.noteDesk.terminal;

    term.onData((data) => {
      if (sessionIdRef.current) terminal.input(sessionIdRef.current, data);
    });

    const offOutput = terminal.onOutput((event) => {
      if (event.sessionId === sessionIdRef.current) term.write(event.data);
    });
    const offExit = terminal.onExit((event) => {
      if (event.sessionId === sessionIdRef.current && !disposed) setPhase('exited');
    });

    // 面板尺寸变化 → xterm 自适应 + 通知 PTY
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        if (sessionIdRef.current) terminal.resize(sessionIdRef.current, term.cols, term.rows);
      } catch {
        // 容器不可见时 fit 会抛错，忽略
      }
    });
    observer.observe(container);

    // 创建会话：cwd = 当前笔记所在目录（主进程校验并兜底到笔记库根）
    void terminal
      .create(notePath ?? '', term.cols, term.rows)
      .then((info) => {
        if (disposed) {
          void terminal.kill(info.sessionId);
          return;
        }
        sessionIdRef.current = info.sessionId;
        setSessionInfo({ cwd: info.cwd, command: info.command });
        setPhase('running');
        term.focus();
      })
      .catch((err) => {
        if (!disposed) {
          term.write(`\r\n\x1b[31m终端创建失败：${toMessage(err)}\x1b[0m\r\n`);
          setPhase('exited');
        }
      });

    return () => {
      disposed = true;
      observer.disconnect();
      offOutput();
      offExit();
      if (sessionIdRef.current) void terminal.kill(sessionIdRef.current);
      sessionIdRef.current = null;
      term.dispose();
    };
    // notePath 只决定会话初始目录；切换笔记不自动重建（会话可能正聊到一半，用「重启」换目录）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restartCount]);

  const onPick = (): void => {
    setPicking(true);
    void requestPick()
      .then((element) => {
        if (element) setChips((prev) => [...prev, element]);
      })
      .finally(() => setPicking(false));
  };

  /**
   * 把「文件路径 + 选中元素的结构」键入终端（不带回车，用户确认后再发送）。
   * 第一行写明具体文件与元素标签，下面直接跟该元素的结构：
   * CLI 不用猜是哪个文件，也不用按文字提示模糊定位。
   */
  const insertChips = (): void => {
    if (chips.length === 0 || phase !== 'running' || !sessionIdRef.current) return;
    const blocks = chips.map((chip) => {
      const path = chip.notePath.replace(/\\/g, '/');
      return `笔记文件 "${path}" 中选中的 <${chip.tagName}>：\n${chip.outerHTML}`;
    });
    window.noteDesk.terminal.input(sessionIdRef.current, blocks.join('\n\n'));
    setChips([]);
  };

  return (
    <div className="term-panel-body">
      <header className="term-header">
        <span className="term-title" title={sessionInfo?.cwd ?? undefined}>
          终端{sessionInfo?.command ? ` · ${sessionInfo.command}` : ''}
        </span>
        <button
          type="button"
          className="term-btn"
          title="从当前笔记中选取元素，作为上下文插入终端"
          disabled={picking}
          onClick={onPick}
        >
          {picking ? '拾取中…' : '选元素'}
        </button>
        <button
          type="button"
          className="term-btn"
          title="把文件路径与选中元素的结构插入终端输入（不自动回车，确认后再发送）"
          disabled={chips.length === 0 || phase !== 'running'}
          onClick={insertChips}
        >
          插入{chips.length > 0 ? `（${chips.length}）` : ''}
        </button>
        <button
          type="button"
          className="term-btn"
          title="结束当前会话，按当前笔记所在目录重开"
          onClick={() => setRestartCount((count) => count + 1)}
        >
          重启
        </button>
      </header>

      {chips.length > 0 && (
        <div className="term-chips">
          {chips.map((chip, index) => (
            <span
              className="term-chip"
              key={`${chip.tagName}-${index}`}
              title={`${chip.notePath}\n内容开头：${textSnippet(chip.outerHTML) || '（无文本）'}`}
            >
              <span className="term-chip-file">{baseName(chip.notePath)}</span>
              <span className="term-chip-tag">&lt;{chip.tagName}&gt;</span>
              <button
                type="button"
                className="term-chip-remove"
                aria-label="移除引用"
                onClick={() => setChips((prev) => prev.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {phase === 'exited' && <p className="term-exited">会话已结束，点「重启」重开</p>}

      <div className="term-xterm" ref={containerRef} />
    </div>
  );
}

/** 从 outerHTML 提取纯文本开头的短提示（供 CLI 在文件内定位元素），无文本则空串 */
function textSnippet(outerHTML: string): string {
  const text = outerHTML
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return '';
  const clipped = text.slice(0, 40);
  return (text.length > 40 ? `${clipped}…` : clipped).replace(/"/g, "'");
}

function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? path;
}
