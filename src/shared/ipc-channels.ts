/** IPC channel 常量。新增 channel 必须同步更新架构文档中的契约表。
 *
 * 【恢复副本】原位于 src/shared/ipc-channels.ts，2026-10-24 误删后逐字恢复。
 * 此版本 = 误删前最终状态（含 AI 侧边栏通道）。 */

export const CH = {
  PICK_LIBRARY: 'dialog:pickLibrary',
  NOTE_PICK: 'note:pick',
  FILE_LIST: 'file:list',
  FILE_READ: 'file:read',
  FILE_SAVE: 'file:save',
  FILE_CREATE_FOLDER: 'file:createFolder',
  FILE_CREATE_NOTE: 'file:createNote',
  FILE_RENAME: 'file:rename',
  FILE_TRASH: 'file:trash',
  FILE_MOVE: 'file:move',
  FILE_REVEAL: 'file:reveal',
  WATCH_START: 'watch:start',
  WATCH_STOP: 'watch:stop',
  WATCH_CHANGED: 'watch:changed',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  PLUGIN_STATE_GET: 'plugin:state-get',
  PLUGIN_SET_ENABLED: 'plugin:set-enabled',
  PLUGIN_STORAGE_GET: 'plugin:storage-get',
  PLUGIN_STORAGE_SET: 'plugin:storage-set',
  MENU_COMMAND: 'menu:command',
  APP_SET_DIRTY: 'app:set-dirty',
  // AI 侧边栏（本地 CLI Agent 壳，docs/06）：进程能力属内核，界面属 core.ai 插件
  AI_DETECT: 'ai:detect',
  AI_SESSION_START: 'ai:session-start',
  AI_SESSION_SEND: 'ai:session-send',
  AI_SESSION_STOP: 'ai:session-stop',
  AI_EVENT: 'ai:event',
  // 兜底入口：在系统终端中以笔记目录为 cwd 启动本地 Agent
  AI_OPEN_TERMINAL: 'ai:open-terminal',
} as const;

export type ChannelName = (typeof CH)[keyof typeof CH];

/** 宿主窗口 ↔ 笔记 webview 的消息名（webview.send / ipcRenderer.sendToHost）。 */
export const WV = {
  SET_EDITABLE: 'note:set-editable',
  SERIALIZE: 'note:serialize',
  SERIALIZED: 'note:serialized',
  MARK_CLEAN: 'note:mark-clean',
  DIRTY: 'note:dirty',
  SAVE_REQUEST: 'note:save-request',
  // 元素拾取（docs/06 §5）：picked 回传元素，cancelled 表示用户按 Esc 放弃
  AI_PICK_START: 'ai:pick-start',
  AI_PICK_STOP: 'ai:pick-stop',
  AI_PICKED: 'ai:picked',
  AI_PICK_CANCELLED: 'ai:pick-cancelled',
} as const;
