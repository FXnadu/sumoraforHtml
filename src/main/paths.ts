import { join } from 'node:path';

/**
 * webview 注入脚本路径。
 * 与宿主 preload 相同，统一从主进程产物目录解析：
 * 开发态与打包后都在 out/preload/ 下（打包后位于 app.asar 内，Electron 可直接加载）。
 */
export function webviewPreloadPath(): string {
  return join(__dirname, '../preload/webview.js');
}
