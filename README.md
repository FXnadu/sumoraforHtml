# Sumora

像 Typora 管理 Markdown 一样管理 HTML 笔记：文件树切换、应用内阅读、点文字即改，且不破坏 HTML 结构。

> ⚠️ **预览版（Preview）**
> 当前版本 `0.1.0-preview.1`，项目仍处于早期阶段：功能在快速迭代，配置格式与数据结构可能变动，部分平台（尤其是 macOS）尚未经过充分实测。欢迎试用并反馈问题，暂不建议作为唯一笔记工具存放重要数据。

---

## 功能特性

- **笔记库与文件树** —— 侧栏浏览笔记目录，支持新建、重命名、删除笔记与文件夹
- **应用内阅读** —— 通过自定义 `note://` 协议安全加载 HTML 笔记，路径守卫拒绝访问笔记库之外的文件
- **点文字即改** —— 点击正文文字直接就地编辑；脚本、样式、代码块等区域自动排除，不会误改
- **不破坏 HTML 结构** —— 保存前进行结构签名校验，只改文字内容、不动标签结构
- **源码编辑模式** —— 需要精细调整时可直接编辑 HTML 源码
- **内嵌终端** —— 内置 xterm 终端，可在笔记目录直接运行 CLI 工具；启动命令在设置中配置，由主进程校验（渲染层无法注入任意命令）
- **文件名搜索** —— 侧栏搜索面板按文件名快速过滤、定位笔记
- **中文编码兼容** —— 自动识别 UTF-8 / GBK 等编码，正确读写与显示
- **插件系统** —— 内置插件宿主（命令 / 事件 / 插槽），新插件登记即可启用
- **文件关联** —— 安装版可将 `.html` 关联到 Sumora，双击即开
- **窗口状态记忆** —— 记住窗口位置与大小

## 技术栈

| 类别 | 选型 |
| --- | --- |
| 框架 | Electron 33 + electron-vite 2 |
| 界面 | React 18 + Zustand 5 |
| 语言 | TypeScript 5 |
| 终端 | @xterm/xterm + node-pty |
| 文件 | chokidar（监听）、iconv-lite（编码）、linkedom（HTML 解析） |
| 质量 | Vitest、ESLint 9、Prettier、commitlint |

## 快速开始

### 环境要求

- Node.js ≥ 20（开发和打包需要；直接运行打包产物则无需安装）

### 开发调试

```bash
git clone https://github.com/FXnadu/sumoraforHtml.git
cd sumoraforHtml
npm install
npm run dev        # 桌面端开发模式
```

其他常用命令：

```bash
npm run dev:web    # 浏览器端预览（vite.web.config.ts）
npm run typecheck  # 类型检查（主进程 + 渲染层）
npm run lint       # ESLint 检查
npm test           # Vitest 单元测试
```

## 打包发布

```bash
npm run dist       # 先 electron-vite build，再 electron-builder 打包
```

### Windows（在 Windows 上构建）

| 产物 | 说明 |
| --- | --- |
| `release/Sumora-Setup-<版本>.exe` | 安装版：可选安装目录、创建桌面快捷方式、`.html` 文件关联 |
| `release/Sumora-Portable-<版本>.exe` | 便携版：免安装单文件 |

### macOS（必须在 Mac 上构建）

受 Electron 打包机制限制，`.dmg` 无法在 Windows / Linux 上交叉生成。在 Mac 上 clone 本仓库后执行 `npm install && npm run dist`：

| 产物 | 说明 |
| --- | --- |
| `release/Sumora-<版本>-mac.dmg` | 磁盘映像安装包 |
| `release/Sumora-<版本>-mac-<arch>.zip` | 压缩包（架构与构建机型一致：arm64 / x64） |

**未签名应用首次打开**：当前为预览版，未做 Apple 签名与公证，首次打开会被 Gatekeeper 拦截。解决方式：在应用上**右键 →「打开」**，或执行：

```bash
xattr -cr /Applications/Sumora.app
```

正式分发时需要 Apple Developer 证书签名并公证：移除 `electron-builder.yml` 中 `mac.identity: null` 一行，并通过 `CSC_LINK` / `CSC_KEY_PASSWORD` 环境变量提供证书（详见文件内注释）。

> 应用目前使用 Electron 默认图标。如需自定义，将 `build/icon.ico`（Windows）/ `build/icon.icns`（macOS）放入仓库后重新打包即可。

## 项目结构

```
src/
├── main/      # 主进程：窗口管理、note:// 协议、IPC、文件/笔记库/设置/终端服务、路径安全
├── preload/   # 预加载桥（含阅读面板 webview 注入层）
├── renderer/  # 界面：侧栏、文件树、阅读/编辑面板、源码编辑、内嵌终端、设置
├── core/      # 平台无关纯逻辑：可编辑块规则、结构签名、编码识别
├── plugins/   # 插件宿主（命令/事件/插槽）与内置插件（搜索）
└── shared/    # IPC 通道常量与共享类型
```

## 许可证

[MIT](LICENSE)
