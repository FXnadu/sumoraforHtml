/** 跨进程共享类型。主进程 / preload / 渲染进程共用，修改需同步更新架构文档 IPC 契约表。 */

/** 文件树节点 */
export interface FileNode {
  /** 绝对路径，唯一标识 */
  path: string;
  /** 文件或目录名 */
  name: string;
  type: 'file' | 'dir';
  /** 目录的子节点（type === 'dir' 时存在） */
  children?: FileNode[];
}

/** 侧栏展示形态：目录树 / 平铺文档列表 */
export type SidebarView = 'tree' | 'list';

/** 文件管理操作失败原因 */
export type FileOpErrorCode =
  | 'PATH_OUTSIDE_LIBRARY'
  | 'INVALID_NAME'
  | 'ALREADY_EXISTS'
  | 'NOT_FOUND'
  | 'WRITE_FAILED';

/**
 * 文件管理操作结果。
 * 失败不抛异常而是返回原因：这类操作直接由用户触发，界面需要把原因原样展示出来，
 * 且失败不能影响已打开的笔记状态。
 */
export type FileOpResult =
  | { ok: true; path: string }
  | { ok: false; code: FileOpErrorCode; message: string };

/** 读取结果：携带编码与换行信息，供保存时原样回写 */
export interface ReadResult {
  path: string;
  html: string;
  /** 嗅探到的编码，如 'utf-8' | 'gbk' | 'gb18030' */
  encoding: string;
  /** 换行符风格 */
  eol: '\r\n' | '\n' | '\r';
  /** 读取时是否带 UTF-8 BOM，保存时按此还原 */
  hadBom: boolean;
  /** 文件加载时算出的基线签名，渲染进程与主进程共同持有 */
  baselineSignature: string;
}

/** 保存请求 */
export interface SaveRequest {
  path: string;
  html: string;
  /** 渲染进程校验过的签名；主进程会重算并比对 */
  expectedSignature: string;
  /** 原始基线签名，用于判断结构是否被改动 */
  baselineSignature: string;
  /** 用户已确认结构变更（弹窗点过「仍然保存」） */
  structureChangeConfirmed: boolean;
  encoding: string;
  eol: '\r\n' | '\n' | '\r';
  /** 读取时是否带 BOM，保存时按此还原 */
  hadBom: boolean;
  /** 是否生成 .bak 备份（主进程会以设置为准） */
  backup: boolean;
}

/** 保存失败原因 */
export type SaveErrorCode =
  | 'PATH_OUTSIDE_LIBRARY'
  | 'STRUCTURE_CHANGED'
  | 'ENCODING_LOSSY'
  | 'WRITE_FAILED'
  | 'NOT_FOUND';

export type SaveResult =
  | { ok: true; signature: string; backupPath?: string }
  | { ok: false; code: SaveErrorCode; message: string; path: string };

/** 文件变更事件（主进程 → 渲染进程） */
export interface FileChangeEvent {
  path: string;
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  /** 是否由本应用自身保存触发 */
  fromSelf: boolean;
}

/** 应用设置 */
export interface Settings {
  libraryRoot: string | null;
  editMode: boolean;
  autoSave: boolean;
  backupOnSave: boolean;
  /** 内嵌终端面板创建会话时运行的 CLI 命令（如 'pi'、'claude'）；留空打开普通命令行 */
  cliCommand: string;
}

/** 原生菜单 → 渲染进程的命令 */
export type MenuCommand =
  | 'open-note'
  | 'open-folder'
  | 'save'
  | 'close-note'
  | 'refresh-library'
  | 'toggle-sidebar'
  | 'toggle-source'
  | 'toggle-terminal'
  | 'open-settings';

/** 打开笔记的结果；libraryRoot 可能是顺带切换后的新根目录 */
export interface PickNoteResult {
  path: string;
  libraryRoot: string;
  /** 是否顺带切换了笔记库（文件原本在库外） */
  switchedLibrary: boolean;
}

/** webview 序列化响应（请求序号用于匹配并发请求） */
export interface SerializeResponse {
  requestId: number;
  html: string;
  /** 当前 DOM 的结构签名；html 为空字符串时表示序列化失败 */
  signature: string;
  error?: string;
}

/** 默认设置 */
export const DEFAULT_SETTINGS: Settings = {
  libraryRoot: null,
  editMode: true,
  autoSave: false,
  backupOnSave: true,
  cliCommand: '',
};

// ── 元素拾取（笔记 → 终端上下文）──────────────────────────────

/** webview 拾取回传的原始载荷（notePath 由宿主侧补齐） */
export interface PickedElementPayload {
  tagName: string;
  /** 已剥离应用注入属性、超限截断的 outerHTML */
  outerHTML: string;
  truncated: boolean;
  sizeBytes: number;
}

/** 拾取结果（面板视角，含所属笔记路径） */
export interface PickedElement extends PickedElementPayload {
  notePath: string;
}

/** 终端会话创建结果 */
export interface TermSessionInfo {
  sessionId: string;
  /** 会话工作目录（笔记所在目录或笔记库根） */
  cwd: string;
  /** 用户配置的启动命令；null 表示普通命令行 */
  command: string | null;
}

/** 终端输出事件（主进程 → 渲染进程） */
export interface TermOutputEvent {
  sessionId: string;
  data: string;
}

/** 终端进程退出事件（主进程 → 渲染进程） */
export interface TermExitEvent {
  sessionId: string;
  code: number;
}
