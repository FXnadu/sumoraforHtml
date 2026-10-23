import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { AgentInfo, AiSessionEvent, PickedElement } from '../../../shared/types';
import type { NoteDeskPlugin, PluginContext } from '../../host/types';

/**
 * core.ai：右侧 AI 助手面板（docs/06）。
 * 应用自身不提供任何 AI 服务——后端是用户本机安装的 CLI Agent，
 * 本插件只负责对话 UI、会话管理与上下文（笔记路径 / 拾取元素）注入。
 * 遵守插件纪律：只依赖 plugins/host 与 shared/，内核状态一律经事件获知。
 *
 * 【恢复副本】原位于 src/plugins/builtins/ai/index.tsx，2026-10-24 误删后逐字恢复。
 */

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system' | 'error';
  text: string;
}

type Phase = 'idle' | 'starting' | 'running' | 'ended';

interface AiState {
  panelOpen: boolean;
  notePath: string | null;
  noteDirty: boolean;
  agents: AgentInfo[];
  agentsLoaded: boolean;
  /** 用户偏好（ctx.storage 持久化） */
  preferredAdapter: string | null;
  cwdScope: 'note-dir' | 'library-root';
  attachMode: 'path' | 'inline';
  inlineKB: number;
  privacyDismissed: boolean;
  /** 会话 */
  sessionId: string | null;
  phase: Phase;
  streaming: string;
  statusLine: string | null;
  messages: ChatMessage[];
  chips: PickedElement[];
  picking: boolean;
  lastError: string | null;
}

interface AiActions {
  setPanelOpen: (open: boolean) => void;
  setNote: (path: string | null) => void;
  setNoteDirty: (dirty: boolean) => void;
  setAgents: (agents: AgentInfo[]) => void;
  setPrefs: (patch: Partial<Pick<AiState, 'preferredAdapter' | 'cwdScope' | 'attachMode' | 'inlineKB' | 'privacyDismissed'>>) => void;
  setPhase: (phase: Phase, sessionId?: string | null) => void;
  appendDelta: (text: string) => void;
  completeAnswer: (text: string) => void;
  setStatusLine: (text: string | null) => void;
  pushMessage: (role: ChatMessage['role'], text: string) => void;
  addChip: (chip: PickedElement) => void;
  removeChip: (index: number) => void;
  clearChips: () => void;
  setPicking: (picking: boolean) => void;
  setError: (message: string | null) => void;
  resetSessionUi: () => void;
}

let nextMessageId = 1;

const useAiState = create<AiState & AiActions>((set) => ({
  panelOpen: false,
  notePath: null,
  noteDirty: false,
  agents: [],
  agentsLoaded: false,
  preferredAdapter: null,
  cwdScope: 'note-dir',
  attachMode: 'path',
  inlineKB: 64,
  privacyDismissed: false,
  sessionId: null,
  phase: 'idle',
  streaming: '',
  statusLine: null,
  messages: [],
  chips: [],
  picking: false,
  lastError: null,

  setPanelOpen: (open) => set({ panelOpen: open }),
  setNote: (path) => set({ notePath: path }),
  setNoteDirty: (dirty) => set({ noteDirty: dirty }),
  setAgents: (agents) => set({ agents, agentsLoaded: true }),
  setPrefs: (patch) => set(patch),
  setPhase: (phase, sessionId = null) => set({ phase, sessionId }),
  appendDelta: (text) => set((s) => ({ streaming: s.streaming + text })),
  completeAnswer: (text) =>
    set((s) => ({
      messages: [...s.messages, { id: nextMessageId++, role: 'assistant', text }],
      streaming: '',
      statusLine: null,
    })),
  setStatusLine: (text) => set({ statusLine: text }),
  pushMessage: (role, text) =>
    set((s) => ({ messages: [...s.messages, { id: nextMessageId++, role, text }] })),
  addChip: (chip) => set((s) => ({ chips: [...s.chips, chip] })),
  removeChip: (index) => set((s) => ({ chips: s.chips.filter((_, i) => i !== index) })),
  clearChips: () => set({ chips: [] }),
  setPicking: (picking) => set({ picking }),
  setError: (message) => set({ lastError: message }),
  resetSessionUi: () => set({ streaming: '', statusLine: null }),
}));

function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? path;
}

/** 主进程侧错误以 [CODE] 前缀透传；转成用户能行动的提示 */
function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('[NOTE_DIRTY]')) return '当前笔记有未保存修改，请先保存（Ctrl+S）再开始 AI 会话';
  if (raw.includes('[AGENT_NOT_FOUND]')) return '本机未找到该 Agent，请安装后重试';
  if (raw.includes('[SESSION_EXISTS]')) return '已有活跃会话，请先结束当前会话';
  return raw;
}

/** 可用 Agent 里按偏好挑一个；没有偏好取第一个可用项 */
function pickAgent(state: AiState): AgentInfo | null {
  const available = state.agents.filter((a) => a.available);
  if (available.length === 0) return null;
  return available.find((a) => a.adapterId === state.preferredAdapter) ?? available[0];
}

const aiPlugin: NoteDeskPlugin = {
  manifest: {
    id: 'core.ai',
    name: 'AI 助手',
    version: '0.1.0',
    description: '右侧 AI 对话面板：复用本机安装的 CLI Agent（如 pi、Claude Code），附上当前笔记与选中元素作为上下文',
    apiVersion: 1,
    activation: 'onStart',
  },
  activate: (ctx) => {
    ctx.ui.registerSlot('right-panel', () => <AiPanel ctx={ctx} />);
    ctx.ui.registerSettingSection(() => <AiSettings ctx={ctx} />);

    // 内核事件 → 插件状态（不 import 内核 store，插件纪律）
    ctx.events.on('ai-panel:changed', ({ open }) => {
      useAiState.getState().setPanelOpen(open);
      if (open) void ensureSession(ctx);
    });
    ctx.events.on('note:opened', ({ path }) => {
      const state = useAiState.getState();
      // 会话绑定笔记：切换笔记自动结束旧会话（历史消息保留在面板里）
      if (state.sessionId && state.notePath && state.notePath !== path) {
        void ctx.ai.stop(state.sessionId);
        state.pushMessage('system', `笔记已切换到 ${baseName(path)}，上一会话已结束`);
      }
      state.setNote(path);
      if (useAiState.getState().panelOpen) void ensureSession(ctx);
    });
    ctx.events.on('note:closed', () => useAiState.getState().setNote(null));
    ctx.events.on('note:dirty-changed', ({ dirty }) => useAiState.getState().setNoteDirty(dirty));

    // Agent 会话事件流
    ctx.ai.onEvent(handleSessionEvent);

    // 偏好持久化加载
    void (async () => {
      const [preferredAdapter, cwdScope, attachMode, inlineKB, privacyDismissed] = await Promise.all([
        ctx.storage.get<string>('preferred-adapter'),
        ctx.storage.get<'note-dir' | 'library-root'>('cwd-scope'),
        ctx.storage.get<'path' | 'inline'>('attach-mode'),
        ctx.storage.get<number>('inline-kb'),
        ctx.storage.get<boolean>('privacy-dismissed'),
      ]);
      useAiState.getState().setPrefs({
        preferredAdapter: preferredAdapter ?? null,
        cwdScope: cwdScope ?? 'note-dir',
        attachMode: attachMode ?? 'path',
        inlineKB: typeof inlineKB === 'number' && inlineKB > 0 ? inlineKB : 64,
        privacyDismissed: privacyDismissed === true,
      });
    })();
  },
};

export default aiPlugin;

// ── 会话流程 ───────────────────────────────────────────────

async function detect(ctx: PluginContext): Promise<void> {
  try {
    useAiState.getState().setAgents(await ctx.ai.detect());
  } catch {
    useAiState.getState().setAgents([]);
  }
}

async function ensureSession(ctx: PluginContext): Promise<void> {
  const state = useAiState.getState();
  if (state.phase === 'starting' || state.phase === 'running') return;
  if (!state.panelOpen || !state.notePath) return;

  if (state.noteDirty) {
    state.pushMessage('error', '当前笔记有未保存修改，请先保存（Ctrl+S），AI 会话以磁盘内容为准');
    return;
  }

  if (!state.agentsLoaded) await detect(ctx);
  const agent = pickAgent(useAiState.getState());
  if (!agent) {
    // 空态由面板渲染安装引导，这里不再追加消息
    return;
  }

  useAiState.getState().setPhase('starting');
  try {
    const { sessionId } = await ctx.ai.startSession({
      adapterId: agent.adapterId,
      notePath: useAiState.getState().notePath ?? '',
      cwdScope: useAiState.getState().cwdScope,
      attach: {
        mode: useAiState.getState().attachMode,
        maxInlineKB: useAiState.getState().inlineKB,
      },
    });
    useAiState.getState().setPhase('running', sessionId);
    useAiState.getState().pushMessage(
      'system',
      `已连接 ${agent.name}，上下文：${baseName(useAiState.getState().notePath ?? '')}` +
        '。若 Agent 直接修改了笔记文件，重新打开该笔记即可查看最新内容。',
    );
  } catch (err) {
    useAiState.getState().setPhase('idle');
    useAiState.getState().pushMessage('error', friendlyError(err));
  }
}

function handleSessionEvent(event: AiSessionEvent): void {
  const state = useAiState.getState();
  // 已切换/结束的旧会话事件直接丢弃
  if (event.sessionId !== state.sessionId) return;

  switch (event.type) {
    case 'delta':
      scheduleStreamFlush(event.text);
      break;
    case 'status':
      state.setStatusLine(event.text);
      break;
    case 'complete': {
      cancelStreamFlush();
      const merged = state.streaming + streamBuffer;
      streamBuffer = '';
      state.completeAnswer(event.text || merged);
      break;
    }
    case 'error':
      useAiState.getState().pushMessage('error', event.message);
      break;
    case 'exit':
      cancelStreamFlush();
      streamBuffer = '';
      useAiState.getState().setPhase('ended');
      useAiState.getState().resetSessionUi();
      useAiState.getState().pushMessage('system', '会话已结束');
      break;
    case 'started':
      break;
  }
}

/** 流式增量按 50ms 合并渲染（约束 17），避免词级事件打爆 React */
let streamBuffer = '';
let flushTimer: ReturnType<typeof setInterval> | null = null;

function scheduleStreamFlush(text: string): void {
  streamBuffer += text;
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    const chunk = streamBuffer;
    streamBuffer = '';
    if (chunk) useAiState.getState().appendDelta(chunk);
    else if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  }, 50);
}

function cancelStreamFlush(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

/** XML 包装属性值里的引号/反斜杠做最小转义（Windows 路径含反斜杠） */
function escapeAttr(value: string): string {
  return value.replace(/\\/g, '/').replace(/"/g, "'");
}

function composeUserMessage(text: string, chips: PickedElement[]): string {
  if (chips.length === 0) return text;
  const blocks = chips
    .map(
      (chip) =>
        `<selected-element path="${escapeAttr(chip.notePath)}" tag="${chip.tagName}"${chip.truncated ? ' truncated="true"' : ''}>\n${chip.outerHTML}\n</selected-element>`,
    )
    .join('\n');
  return `${text}\n\n${blocks}`;
}

// ── 面板 UI ────────────────────────────────────────────────

function AiPanel({ ctx }: { ctx: PluginContext }): JSX.Element {
  const state = useAiState();
  const [input, setInput] = useState('');
  const messagesRef = useRef<HTMLDivElement | null>(null);

  // 消息流变化时滚到底部
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages.length, state.streaming]);

  const agent = pickAgent(state);
  const canChat = state.phase === 'running' && !!state.sessionId;

  const onSend = (): void => {
    const text = input.trim();
    if (!text || !canChat || !state.sessionId) return;
    useAiState.getState().pushMessage('user', text);
    ctx.ai.send(state.sessionId, composeUserMessage(text, state.chips));
    setInput('');
    useAiState.getState().clearChips();
  };

  const onPick = (): void => {
    useAiState.getState().setPicking(true);
    void ctx.ai
      .pickElement()
      .then((element) => {
        if (element) useAiState.getState().addChip(element);
      })
      .finally(() => useAiState.getState().setPicking(false));
  };

  const onEnd = (): void => {
    if (state.sessionId) void ctx.ai.stop(state.sessionId);
  };

  const onRestart = (): void => {
    useAiState.setState({ messages: [], chips: [] });
    useAiState.getState().setPhase('idle');
    void ensureSession(ctx);
  };

  return (
    <div className="ai-chat">
      <header className="ai-chat-header">
        <span className="ai-chat-title" title={state.notePath ?? undefined}>
          AI 助手{state.notePath ? ` · ${baseName(state.notePath)}` : ''}
        </span>
        <select
          className="ai-chat-agent-select"
          title="选择本机 Agent"
          value={agent?.adapterId ?? ''}
          onChange={(event) => {
            useAiState.getState().setPrefs({ preferredAdapter: event.target.value || null });
            void ctx.storage.set('preferred-adapter', event.target.value || null);
          }}
        >
          {state.agents.filter((a) => a.available).length === 0 && <option value="">未检测到 Agent</option>}
          {state.agents
            .filter((a) => a.available)
            .map((a) => (
              <option key={a.adapterId} value={a.adapterId}>
                {a.name}
              </option>
            ))}
        </select>
        {canChat ? (
          <button type="button" className="ai-empty-btn" title="结束当前会话" onClick={onEnd}>
            结束
          </button>
        ) : (
          <button
            type="button"
            className="ai-empty-btn"
            title="开始会话"
            disabled={!state.notePath || state.noteDirty}
            onClick={onRestart}
          >
            开始
          </button>
        )}
      </header>

      {!state.privacyDismissed && (
        <p className="ai-notice">
          AI 能力来自你本机安装的 CLI Agent，对话内容仅在本机与该 Agent 访问的服务之间流转；本应用不提供也不经手任何
          AI 服务。
          <button
            type="button"
            className="ai-notice-close"
            aria-label="知道了"
            onClick={() => {
              useAiState.getState().setPrefs({ privacyDismissed: true });
              void ctx.storage.set('privacy-dismissed', true);
            }}
          >
            知道了
          </button>
        </p>
      )}

      {state.phase === 'idle' && state.messages.length === 0 && !state.notePath ? (
        <EmptyState kind="no-note" ctx={ctx} />
      ) : state.agentsLoaded && state.agents.every((a) => !a.available) ? (
        <EmptyState kind="no-agent" ctx={ctx} />
      ) : (
        <>
          <div className="ai-chat-messages" ref={messagesRef}>
            {state.messages.map((message) => (
              <div key={message.id} className={`ai-msg ${message.role}`}>
                {message.text}
              </div>
            ))}
            {state.streaming !== '' && <div className="ai-msg assistant">{state.streaming}</div>}
            {state.statusLine && state.streaming === '' && (
              <div className="ai-msg system">{state.statusLine}</div>
            )}
          </div>

          <div className="ai-composer">
            {state.chips.length > 0 && (
              <div className="ai-chips">
                {state.chips.map((chip, index) => (
                  <span className="ai-chip" key={`${chip.tagName}-${index}`} title={chip.outerHTML.slice(0, 200)}>
                    <span className="ai-chip-tag">&lt;{chip.tagName}&gt;</span>
                    <span className="ai-chip-size">{(chip.sizeBytes / 1024).toFixed(1)}KB</span>
                    <button
                      type="button"
                      className="ai-chip-remove"
                      aria-label="移除引用"
                      onClick={() => useAiState.getState().removeChip(index)}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="ai-composer-row">
              <textarea
                className="ai-input"
                placeholder={canChat ? '向 Agent 提问…（可先在笔记里选中元素作为上下文）' : '会话未开始'}
                value={input}
                disabled={!canChat}
                rows={2}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    onSend();
                  }
                }}
              />
              <button type="button" className="ai-empty-btn" title="从笔记中选取元素" disabled={!canChat || state.picking} onClick={onPick}>
                {state.picking ? '拾取中…' : '选元素'}
              </button>
              <button type="button" className="ai-send-btn" disabled={!canChat || input.trim() === ''} onClick={onSend}>
                发送
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ kind, ctx }: { kind: 'no-note' | 'no-agent'; ctx: PluginContext }): JSX.Element {
  const [checking, setChecking] = useState(false);
  if (kind === 'no-note') {
    return (
      <div className="ai-empty">
        <h3>AI 助手</h3>
        <p>从左侧打开一篇笔记后，这里可以和本机安装的 CLI Agent 对话，自动附上当前笔记作为上下文。</p>
      </div>
    );
  }
  return (
    <div className="ai-empty">
      <h3>未检测到可用的本地 Agent</h3>
      <p>
        本应用的 AI 能力完全来自你本机安装的 CLI Agent（应用自身不提供 AI 服务）。已支持：
        <br />
        pi coding agent：<code>npm install -g @earendil-works/pi-coding-agent</code>（装好后运行一次
        <code>pi</code> 并 <code>/login</code> 登录模型服务）
        <br />
        Claude Code：<code>npm install -g @anthropic-ai/claude-code</code>
        <br />
        Windows 下若已安装仍检测不到，请确认其目录（如 <code>%APPDATA%\npm</code>、
        <code>%USERPROFILE%\.local\bin</code>）在 PATH 中后重试。
      </p>
      <div className="ai-empty-actions">
        <button
          type="button"
          className="ai-empty-btn"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            void detect(ctx).finally(() => setChecking(false));
          }}
        >
          {checking ? '检测中…' : '重新检测'}
        </button>
      </div>
    </div>
  );
}

// ── 设置区块（docs/06 A5）─────────────────────────────────

function AiSettings({ ctx }: { ctx: PluginContext }): JSX.Element | null {
  const state = useAiState();
  if (!state.agentsLoaded) return null;
  const available = state.agents.filter((a) => a.available);

  const save = (patch: Partial<AiState>, key: string, value: unknown): void => {
    useAiState.getState().setPrefs(patch);
    void ctx.storage.set(key, value);
  };

  return (
    <>
      <h3 className="settings-section-title">AI 助手</h3>
      <label className="settings-row">
        <span>默认 Agent</span>
        <select
          value={state.preferredAdapter ?? ''}
          disabled={available.length === 0}
          onChange={(event) => save({ preferredAdapter: event.target.value || null }, 'preferred-adapter', event.target.value || null)}
        >
          {available.length === 0 && <option value="">未检测到</option>}
          {available.map((a) => (
            <option key={a.adapterId} value={a.adapterId}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-row">
        <span>Agent 工作目录</span>
        <select
          value={state.cwdScope}
          onChange={(event) => save({ cwdScope: event.target.value as 'note-dir' | 'library-root' }, 'cwd-scope', event.target.value)}
        >
          <option value="note-dir">笔记所在目录（推荐）</option>
          <option value="library-root">整个笔记库</option>
        </select>
      </label>
      <label className="settings-row">
        <span>笔记上下文</span>
        <select
          value={state.attachMode}
          onChange={(event) => save({ attachMode: event.target.value as 'path' | 'inline' }, 'attach-mode', event.target.value)}
        >
          <option value="path">只附文件路径（Agent 自行读取）</option>
          <option value="inline">内联全文</option>
        </select>
      </label>
      {state.attachMode === 'inline' && (
        <label className="settings-row">
          <span>内联上限（KB）</span>
          <input
            type="number"
            min={1}
            max={512}
            value={state.inlineKB}
            onChange={(event) => {
              const kb = Math.max(1, Math.min(512, Number(event.target.value) || 64));
              save({ inlineKB: kb }, 'inline-kb', kb);
            }}
          />
        </label>
      )}
      <p className="settings-row-desc">会话以磁盘内容为准：有未保存修改时需先保存再开始会话。</p>
    </>
  );
}
