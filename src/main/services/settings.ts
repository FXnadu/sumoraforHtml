import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types';

/** 应用设置（userData/settings.json，原子写）。
 *
 * 【恢复副本】由未混淆编译产物逐行反构。 */

let cache: Settings | null = null;

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function getSettings(): Settings {
  if (cache) return cache;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    cache = { ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) };
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  const target = settingsPath();
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // 临时文件可能根本没创建成功
    }
    throw new Error(`设置保存失败：${String(err)}`);
  }
  cache = next;
  return next;
}

export function getLibraryRoot(): string | null {
  return getSettings().libraryRoot;
}
