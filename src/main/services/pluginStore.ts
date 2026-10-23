import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * 插件状态文件（userData/plugins.json）：启停开关 + 各插件私有存储。
 * 与 settings.json 物理分离，插件数据坏了不拖累主设置；
 * 存储键强制 plugin:<id>:<key> 前缀，插件之间天然隔离。
 */

interface PluginFileState {
  enabled: Record<string, boolean>;
  storage: Record<string, unknown>;
}

let cache: PluginFileState | null = null;

const ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
const KEY_PATTERN = /^[\w.-]{1,128}$/;

function statePath(): string {
  return path.join(app.getPath('userData'), 'plugins.json');
}

function storageKey(pluginId: string, key: string): string {
  return `plugin:${pluginId}:${key}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function load(): PluginFileState {
  if (cache) return cache;
  let state: PluginFileState = { enabled: {}, storage: {} };
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (isRecord(parsed)) {
      if (isRecord(parsed['enabled'])) {
        const enabled: Record<string, boolean> = {};
        for (const [id, value] of Object.entries(parsed['enabled'])) {
          if (typeof value === 'boolean' && ID_PATTERN.test(id)) enabled[id] = value;
        }
        state = { ...state, enabled };
      }
      if (isRecord(parsed['storage'])) {
        state = { ...state, storage: parsed['storage'] };
      }
    }
  } catch {
    // 文件缺失或损坏：回落空状态，不阻塞启动
  }
  cache = state;
  return cache;
}

/** 原子写：与 settings.ts 同一套临时文件 + rename 套路 */
function persist(): void {
  const target = statePath();
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // 临时文件可能根本没创建成功
    }
    throw new Error(`插件状态保存失败：${String(err)}`);
  }
}

function assertPluginId(pluginId: string): void {
  if (!ID_PATTERN.test(pluginId)) throw new Error(`非法插件 id：${pluginId}`);
}

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new Error(`非法存储键：${key}`);
}

export function getPluginState(): { enabled: Record<string, boolean> } {
  return { enabled: { ...load().enabled } };
}

export function setPluginEnabled(pluginId: string, enabled: boolean): void {
  assertPluginId(pluginId);
  const state = load();
  state.enabled[pluginId] = enabled === true;
  persist();
}

export function getPluginStorage(pluginId: string, key: string): unknown {
  assertPluginId(pluginId);
  assertKey(key);
  const value = load().storage[storageKey(pluginId, key)];
  return value === undefined ? null : value;
}

export function setPluginStorage(pluginId: string, key: string, value: unknown): void {
  assertPluginId(pluginId);
  assertKey(key);
  const state = load();
  state.storage[storageKey(pluginId, key)] = value ?? null;
  persist();
}
