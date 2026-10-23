/** 窗口级脏标记：渲染进程同步，主进程在关闭窗口前据此提醒。
 *
 * 【恢复副本】由未混淆编译产物逐行反构。 */

let dirty = false;

export function setWindowDirty(value: boolean): void {
  dirty = value;
}

export function isWindowDirty(): boolean {
  return dirty;
}
