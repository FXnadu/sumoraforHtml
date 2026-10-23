/**
 * 命令注册表：内核动作与插件命令的统一入口。
 * 原生菜单命令、插件互调、内核能力（如打开笔记）都通过 id 查表执行。
 * 惰性激活的占位命令指向所属插件，首次执行时先激活插件再重查真实处理器；
 * 激活钩子由 registry 注入，避免本模块反向依赖 registry（循环引用）。
 */

export type CommandHandler = (args?: unknown) => unknown;

interface CommandEntry {
  id: string;
  /** 'kernel' 或插件 id */
  owner: string;
  handler: CommandHandler;
  /** 惰性占位：指向尚未激活的插件 id */
  lazyPluginId?: string;
}

const commands = new Map<string, CommandEntry>();
let activationHook: ((pluginId: string) => Promise<void>) | null = null;

export function registerCommand(id: string, owner: string, handler: CommandHandler): void {
  commands.set(id, { id, owner, handler });
}

/** 注册惰性命令占位（activation: 'onCommand' 的插件用） */
export function registerCommandStub(id: string, owner: string, lazyPluginId: string): void {
  if (commands.has(id)) return;
  commands.set(id, { id, owner, handler: () => undefined, lazyPluginId });
}

/** 由 registry 在初始化时注入：占位命令首次执行前先激活所属插件 */
export function setActivationHook(hook: (pluginId: string) => Promise<void>): void {
  activationHook = hook;
}

export async function executeCommand<T = unknown>(id: string, args?: unknown): Promise<T> {
  let entry = commands.get(id);
  if (!entry) throw new Error(`命令不存在：${id}`);
  if (entry.lazyPluginId) {
    const pluginId = entry.lazyPluginId;
    if (!activationHook) throw new Error(`命令 ${id} 尚无可用的激活通道`);
    await activationHook(pluginId);
    entry = commands.get(id);
    if (!entry || entry.lazyPluginId) {
      throw new Error(`插件 ${pluginId} 激活后未注册命令 ${id}`);
    }
  }
  return entry.handler(args) as T;
}

/** 注销某 owner 注册的全部命令（禁用插件时清理） */
export function unregisterCommandsOf(owner: string): void {
  for (const [id, entry] of commands) {
    if (entry.owner === owner) commands.delete(id);
  }
}

/** 仅供单元测试：清空命令表 */
export function clearCommandsForTest(): void {
  commands.clear();
  activationHook = null;
}
