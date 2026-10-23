import type { ReactNode } from 'react';
import type {
  KernelEventMap,
  KernelEventName,
  MenuItemContribution,
  NoteDeskPlugin,
  PluginContext,
  PluginRuntimeState,
  SlotContributionOptions,
  UiSlotId,
} from './types';
import { offKernelEventsOf, onKernelEvent, replayKernelEventToOwner } from './events';
import { aiApi } from './ai';
import {
  clearCommandsForTest,
  executeCommand,
  registerCommand,
  registerCommandStub,
  setActivationHook,
  unregisterCommandsOf,
} from './commands';

/**
 * 插件注册表：登记、激活、启停与贡献点管理。
 * 属于内核基建（「基建的基建」），不依赖任何内核 store——
 * 内核 store 经 events.ts 发事件进来，插件经 ctx 出去。
 */

interface SlotEntry {
  pluginId: string;
  slot: UiSlotId;
  render: () => ReactNode;
  options: SlotContributionOptions;
}

interface MenuEntry extends MenuItemContribution {
  pluginId: string;
  target: 'note' | 'dir' | 'blank';
}

interface SettingSectionEntry {
  pluginId: string;
  render: () => ReactNode;
}

const plugins = new Map<string, NoteDeskPlugin>();
const activePlugins = new Set<string>();
const failedPlugins = new Set<string>();
const slots: SlotEntry[] = [];
const menuItems: MenuEntry[] = [];
const settingSections: SettingSectionEntry[] = [];
/** onNoteOpened 尚未触发时的惰性激活臂，禁用插件时需要解除 */
const lazyArms = new Map<string, () => void>();
let enabledOverrides: Record<string, boolean> = {};
let initPromise: Promise<void> | null = null;

// ── UI 订阅：SlotHost / 设置面板用 useSyncExternalStore 感知贡献变化 ──

let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRegistryVersion(): number {
  return version;
}

// ── 登记与校验 ──

const ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

/** 登记内置插件；manifest 非法直接抛错（开发期就该暴露） */
export function registerBuiltin(plugin: NoteDeskPlugin): void {
  const manifest = plugin?.manifest;
  if (!manifest || !ID_PATTERN.test(manifest.id ?? '')) {
    throw new Error(`非法插件 id：${String(manifest?.id)}`);
  }
  if (manifest.apiVersion !== 1) {
    throw new Error(`插件 ${manifest.id} 要求不支持的 API 版本：${String(manifest.apiVersion)}`);
  }
  if (typeof manifest.name !== 'string' || !manifest.name) {
    throw new Error(`插件 ${manifest.id} 缺少 name`);
  }
  const existing = plugins.get(manifest.id);
  if (existing) {
    // StrictMode 双调用或重复登记：同一插件对象幂等跳过，不同实现才报错
    if (existing !== plugin) throw new Error(`插件 id 重复：${manifest.id}`);
    return;
  }
  plugins.set(manifest.id, plugin);
}

// ── 初始化与激活 ──

/** 应用启动时调用一次：读启停状态，按 activation 策略激活 */
export function initRegistry(): Promise<void> {
  initPromise ??= (async () => {
    try {
      enabledOverrides = (await window.noteDesk.getPluginState()).enabled ?? {};
    } catch (err) {
      console.error('[plugins] 读取插件状态失败，本次会话按全部启用处理', err);
      enabledOverrides = {};
    }
    setActivationHook((pluginId) => activatePlugin(pluginId));
    for (const plugin of plugins.values()) {
      if (enabledOverrides[plugin.manifest.id] === false) continue;
      if (plugin.manifest.activation === 'onStart') {
        await activatePlugin(plugin.manifest.id);
      } else if (plugin.manifest.activation === 'onCommand') {
        registerStubs(plugin);
      } else {
        armNoteOpenedActivation(plugin.manifest.id);
      }
    }
    bump();
  })();
  return initPromise;
}

function registerStubs(plugin: NoteDeskPlugin): void {
  for (const commandId of plugin.manifest.commands ?? []) {
    registerCommandStub(
      `${plugin.manifest.id}:${commandId}`,
      plugin.manifest.id,
      plugin.manifest.id,
    );
  }
}

/** onNoteOpened 惰性激活：首个 note:opened 触发激活，并把这条事件回放给插件，保证不漏 */
function armNoteOpenedActivation(pluginId: string): void {
  const off = onKernelEvent(
    'note:opened',
    (payload) => {
      off();
      lazyArms.delete(pluginId);
      if (enabledOverrides[pluginId] === false) return;
      void activatePlugin(pluginId).then(() => {
        replayKernelEventToOwner(pluginId, 'note:opened', payload);
      });
    },
    `lazy:${pluginId}`,
  );
  lazyArms.set(pluginId, off);
}

async function activatePlugin(pluginId: string): Promise<void> {
  const plugin = plugins.get(pluginId);
  if (!plugin) throw new Error(`未登记的插件：${pluginId}`);
  if (activePlugins.has(pluginId) || failedPlugins.has(pluginId)) return;
  try {
    await plugin.activate(buildContext(plugin));
    activePlugins.add(pluginId);
  } catch (err) {
    console.error(`[plugins] 插件激活失败：${pluginId}`, err);
    failedPlugins.add(pluginId);
  }
  bump();
}

function buildContext(plugin: NoteDeskPlugin): PluginContext {
  const id = plugin.manifest.id;
  return {
    manifest: plugin.manifest,
    commands: {
      register: (commandId, handler) => registerCommand(`${id}:${commandId}`, id, handler),
      execute: <T,>(commandId: string, args?: unknown) => executeCommand<T>(commandId, args),
    },
    events: {
      on: <K extends KernelEventName>(
        type: K,
        cb: (payload: KernelEventMap[K]) => void,
      ) => onKernelEvent(type, cb, id),
    },
    ui: {
      registerSlot: (slot, render, options = {}) => {
        slots.push({ pluginId: id, slot, render, options });
        bump();
      },
      registerContextMenuItem: (target, item) => {
        menuItems.push({ ...item, pluginId: id, target });
        bump();
      },
      registerSettingSection: (render) => {
        settingSections.push({ pluginId: id, render });
        bump();
      },
    },
    files: {
      listFiles: () => window.noteDesk.listFiles(),
      readNote: async (absPath) => {
        const result = await window.noteDesk.readFile(absPath);
        return { path: result.path, html: result.html, encoding: result.encoding };
      },
    },
    ai: aiApi,
    storage: {
      get: <T,>(key: string) => window.noteDesk.pluginStorageGet(id, key) as Promise<T | null>,
      set: (key: string, value: unknown) => window.noteDesk.pluginStorageSet(id, key, value),
    },
  };
}

// ── 启停 ──

/** 用户在设置里切换插件开关：持久化到 plugins.json，并即时生效 */
export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  await window.noteDesk.setPluginEnabled(pluginId, enabled);
  enabledOverrides = { ...enabledOverrides, [pluginId]: enabled };
  if (enabled) {
    await activatePlugin(pluginId);
  } else {
    lazyArms.get(pluginId)?.();
    lazyArms.delete(pluginId);
    deactivatePlugin(pluginId);
  }
  bump();
}

function deactivatePlugin(pluginId: string): void {
  const plugin = plugins.get(pluginId);
  if (!plugin || !activePlugins.has(pluginId)) return;
  try {
    plugin.deactivate?.();
  } catch (err) {
    console.error(`[plugins] 插件 ${pluginId} 停用时出错`, err);
  }
  activePlugins.delete(pluginId);
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    if (slots[i].pluginId === pluginId) slots.splice(i, 1);
  }
  for (let i = menuItems.length - 1; i >= 0; i -= 1) {
    if (menuItems[i].pluginId === pluginId) menuItems.splice(i, 1);
  }
  for (let i = settingSections.length - 1; i >= 0; i -= 1) {
    if (settingSections[i].pluginId === pluginId) settingSections.splice(i, 1);
  }
  unregisterCommandsOf(pluginId);
  offKernelEventsOf(pluginId);
  failedPlugins.delete(pluginId);
  bump();
}

// ── UI 查询 ──

export function getSlotContributions(
  slot: UiSlotId,
): Array<{ pluginId: string; options: SlotContributionOptions; render: () => ReactNode }> {
  return slots
    .filter((entry) => entry.slot === slot)
    .sort((a, b) => (a.options.order ?? 100) - (b.options.order ?? 100));
}

/** 右键菜单插件项；id 已加 '<插件id>:' 前缀，选中时交回 executeMenuItem */
export function getContextMenuItems(
  target: 'note' | 'dir' | 'blank',
): Array<{ id: string; label: string; danger?: boolean; separatorBefore?: boolean }> {
  return menuItems
    .filter((entry) => entry.target === target)
    .map((entry) => ({
      id: `${entry.pluginId}:${entry.id}`,
      label: entry.label,
      danger: entry.danger,
      separatorBefore: entry.separatorBefore,
    }));
}

/** 执行右键菜单插件项；返回是否命中 */
export function executeMenuItem(itemId: string): boolean {
  const entry = menuItems.find((item) => `${item.pluginId}:${item.id}` === itemId);
  if (!entry) return false;
  void entry.onSelect();
  return true;
}

export function getSettingSections(): Array<{ pluginId: string; render: () => ReactNode }> {
  return [...settingSections];
}

export function getPluginStates(): PluginRuntimeState[] {
  return [...plugins.values()].map((plugin) => ({
    manifest: plugin.manifest,
    enabled: enabledOverrides[plugin.manifest.id] !== false,
    failed: failedPlugins.has(plugin.manifest.id),
  }));
}

/** 仅供单元测试：清空全部登记与贡献，恢复初始状态 */
export function resetRegistryForTest(): void {
  for (const plugin of plugins.values()) {
    offKernelEventsOf(plugin.manifest.id);
    offKernelEventsOf(`lazy:${plugin.manifest.id}`);
  }
  plugins.clear();
  activePlugins.clear();
  failedPlugins.clear();
  slots.length = 0;
  menuItems.length = 0;
  settingSections.length = 0;
  lazyArms.clear();
  enabledOverrides = {};
  initPromise = null;
  clearCommandsForTest();
  bump();
}
