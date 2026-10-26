/** IPC channel 常量。新增 channel 必须同步更新架构文档中的契约表。 */

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
  // 内嵌终端（PTY）：进程属内核，渲染层只收发数据，命令来自用户设置
  TERM_CREATE: 'term:create',
  TERM_INPUT: 'term:input',
  TERM_RESIZE: 'term:resize',
  TERM_KILL: 'term:kill',
  TERM_OUTPUT: 'term:output',
  TERM_EXIT: 'term:exit',
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
  // 元素拾取：picked 回传元素，cancelled 表示用户按 Esc 放弃
  AI_PICK_START: 'ai:pick-start',
  AI_PICK_STOP: 'ai:pick-stop',
  AI_PICKED: 'ai:picked',
  AI_PICK_CANCELLED: 'ai:pick-cancelled',
} as const;
