import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, protocol, shell } from 'electron';
import type { MenuItemConstructorOptions, WebContents } from 'electron';
import { CH } from '../shared/ipc-channels';
import type { MenuCommand } from '../shared/types';
import { registerNoteProtocol } from './protocol';
import { registerAllIpc } from './ipc';
import { webviewPreloadPath } from './paths';
import { killAllSessions } from './services/ptyHost';
import { getLibraryRoot } from './services/settings';
import { isWindowDirty, setWindowDirty } from './window-state';

// 便携版（electron-builder portable）会把 exe 解包到临时目录运行，
// 真正的 exe 所在目录通过 PORTABLE_EXECUTABLE_DIR 提供；把 userData 指到那里，
// 让设置、缓存随 exe 一起拷贝，实现「解压即用、覆盖即升级」。
const portableDir = process.env['PORTABLE_EXECUTABLE_DIR'];
if (portableDir) {
  app.setPath('userData', join(portableDir, 'data'));
}

// 必须在 app ready 之前注册自定义协议（见 ADR-0002）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'note',
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false },
  },
]);

// GPU 进程异常退出时留痕：配合 --enable-logging 可定位「拖动窗口内容变形跟不上」类问题
app.on('child-process-gone', (_event, details) => {
  if (details.type === 'GPU') {
    console.error('[gpu] GPU 进程异常退出:', details.reason, `exitCode=${String(details.exitCode)}`);
  }
});

let mainWindow: BrowserWindow | null = null;

/** 中文应用菜单（Electron 默认菜单为英文） */
function buildAppMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' as const, label: 'HTML 笔记台' }]
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '打开笔记…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuCommand('open-note'),
        },
        {
          label: '打开文件夹…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => sendMenuCommand('open-folder'),
        },
        { type: 'separator' },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuCommand('save'),
        },
        { type: 'separator' },
        {
          label: '关闭当前笔记',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendMenuCommand('close-note'),
        },
        {
          label: '在文件管理器中显示笔记库',
          click: () => revealLibrary(),
        },
        {
          label: '重新扫描笔记库',
          accelerator: 'F5',
          click: () => sendMenuCommand('refresh-library'),
        },
        { type: 'separator' },
        {
          label: '设置…',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendMenuCommand('open-settings'),
        },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '切换侧边栏',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendMenuCommand('toggle-sidebar'),
        },
        {
          label: '切换源码模式',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => sendMenuCommand('toggle-source'),
        },
        {
          label: '终端面板',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => sendMenuCommand('toggle-terminal'),
        },
        { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭' },
      ],
    },
    {
      label: '帮助',
      submenu: [{ role: 'about', label: '关于 HTML 笔记台' }],
    },
  ];
  return Menu.buildFromTemplate(template);
}

/** 菜单命令统一转发给宿主渲染进程，由 store 决定具体行为 */
function sendMenuCommand(command: MenuCommand): void {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  win?.webContents.send(CH.MENU_COMMAND, command);
}

/** 在系统文件管理器中打开当前笔记库 */
function revealLibrary(): void {
  const root = getLibraryRoot();
  if (!root) {
    void dialog.showMessageBox({
      type: 'info',
      title: 'HTML 笔记台',
      message: '尚未选择笔记库',
      detail: '请先使用「文件 → 打开文件夹…」选择笔记库。',
    });
    return;
  }
  void shell.openPath(root);
}

/** 只允许把 http/https/mailto 交给系统浏览器，其余（file:、javascript: 等）一律拒绝 */
function openExternally(url: string): void {
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
    void shell.openExternal(url);
  }
}

/** 主窗口加固：禁止 window.open 与页面内跳转，避免笔记把整个应用窗口导航走 */
function hardenWindow(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (url === contents.getURL()) return;
    event.preventDefault();
    openExternally(url);
  });
}

/** 笔记 webview 加固：只允许加载笔记库协议，并且强制挂载我们自己的编辑注入脚本 */
function hardenWebview(contents: WebContents): void {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    // 只允许加载笔记库协议，其余来源直接拒绝挂载
    if (!(params.src ?? '').startsWith('note://')) {
      event.preventDefault();
      return;
    }
    // 不信任页面自带的 preload，统一替换为主进程提供的注入脚本
    webPreferences.preload = webviewPreloadPath();
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
  });
}

/** 关闭窗口前若仍有未保存修改，让用户明确选择退出或留下 */
function guardUnsavedOnClose(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (!isWindowDirty()) return;
    event.preventDefault();
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        title: '未保存的修改',
        message: '当前笔记有未保存的修改',
        detail: '退出后这些修改将丢失。',
        buttons: ['退出并丢失修改', '取消'],
        defaultId: 1,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          setWindowDirty(false);
          win.destroy();
        }
      });
  });
}

async function createWindow(): Promise<void> {
  setWindowDirty(false);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'HTML 笔记台',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true, // 笔记渲染容器使用 <webview>
    },
  });

  hardenWindow(mainWindow.webContents);
  hardenWebview(mainWindow.webContents);
  guardUnsavedOnClose(mainWindow);
  // 窗口销毁后置空引用，事件源（PTY 等）不能再拿到已销毁的窗口
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const devUrl = process.env['MAIN_WINDOW_VITE_DEV_SERVER_URL'] ?? process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// 单实例锁：双开会出两套文件监听与设置竞争
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      // 启动时输出一次 GPU 能力状态：gpu_compositing=software 即掉到了软件渲染（拖动窗口会变形卡顿）
      console.log('[gpu] GPU 状态:', JSON.stringify(app.getGPUFeatureStatus()));
      Menu.setApplicationMenu(buildAppMenu());
      registerNoteProtocol();
      registerAllIpc({
        // 终端输出/退出事件统一推到主窗口（渲染层只能经事件流感知 PTY）
        sendTermEvent: (event) => {
          // 退出时窗口可能已销毁而 PTY 仍在推送，此时直接丢弃，避免主进程未捕获异常
          if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
          if ('data' in event) mainWindow.webContents.send(CH.TERM_OUTPUT, event);
          else mainWindow.webContents.send(CH.TERM_EXIT, event);
        },
      });
      await createWindow();
    } catch (err) {
      console.error('startup failed:', err);
      dialog.showErrorBox('HTML 笔记台 启动失败', String(err));
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });
} else {
  app.quit();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 退出前杀掉全部 PTY 进程，防孤儿
app.on('before-quit', () => {
  killAllSessions();
});
