import { ipcMain } from 'electron';
import { CH } from '../../shared/ipc-channels';
import {
  createSession,
  killSession,
  resizeSession,
  writeSession,
} from '../services/ptyHost';

/**
 * 内嵌终端 IPC。所有参数按不可信输入校验；
 * 启动命令只来自主进程设置（用户本人填写），渲染层无法指定任意命令。
 */

/** 允许的命令字符：含空格以支持参数；不含 & | < > ^ ( ) % " ' 等 cmd 元字符 */
const SAFE_COMMAND = /^[A-Za-z0-9 _.\-/\\:,=+@]{0,200}$/;

/** 设置写入时校验 CLI 命令；非法字符直接报错让界面提示 */
export function validateCliCommand(value: string): string {
  if (!SAFE_COMMAND.test(value)) {
    throw new Error('CLI 命令含有不支持的字符（仅允许字母、数字、空格与 . / \\ - _ : , = + @）');
  }
  return value;
}

export function registerTerminalIpc(): void {
  ipcMain.handle(CH.TERM_CREATE, (_evt, payload: unknown) => {
    const v = payload as { notePath?: unknown; cols?: unknown; rows?: unknown } | null;
    if (
      !v ||
      typeof v['notePath'] !== 'string' ||
      typeof v['cols'] !== 'number' ||
      typeof v['rows'] !== 'number'
    ) {
      throw new Error('参数不完整');
    }
    return createSession({ notePath: v['notePath'], cols: v['cols'], rows: v['rows'] });
  });

  ipcMain.on(CH.TERM_INPUT, (_evt, payload: unknown) => {
    const v = payload as { sessionId?: unknown; data?: unknown } | null;
    if (!v || typeof v['sessionId'] !== 'string' || typeof v['data'] !== 'string') return;
    writeSession(v['sessionId'], v['data']);
  });

  ipcMain.on(CH.TERM_RESIZE, (_evt, payload: unknown) => {
    const v = payload as { sessionId?: unknown; cols?: unknown; rows?: unknown } | null;
    if (
      !v ||
      typeof v['sessionId'] !== 'string' ||
      typeof v['cols'] !== 'number' ||
      typeof v['rows'] !== 'number'
    ) {
      return;
    }
    resizeSession(v['sessionId'], v['cols'], v['rows']);
  });

  ipcMain.handle(CH.TERM_KILL, (_evt, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('参数不完整');
    killSession(sessionId);
  });
}
