import { Fragment, useSyncExternalStore } from 'react';
import {
  getRegistryVersion,
  getSlotContributions,
  subscribeRegistry,
} from './registry';
import type { UiSlotId } from './types';

/**
 * 插槽渲染器：渲染挂在某个插槽上的全部插件 UI。
 * 内核组件负责摆放位置与容器排版；插件内容只允许使用全局 CSS 变量。
 */
export default function SlotHost({ slot }: { slot: UiSlotId }): JSX.Element | null {
  useSyncExternalStore(subscribeRegistry, getRegistryVersion);
  const contributions = getSlotContributions(slot);
  if (contributions.length === 0) return null;

  if (slot === 'sidebar-panel') {
    return (
      <>
        {contributions.map((entry) => (
          <details className="plugin-panel" key={`${entry.pluginId}:${entry.options.title ?? ''}`} open>
            <summary>{entry.options.title ?? entry.pluginId}</summary>
            <div className="plugin-panel-body">{entry.render()}</div>
          </details>
        ))}
      </>
    );
  }

  return (
    <>
      {contributions.map((entry) => (
        <Fragment key={entry.pluginId}>{entry.render()}</Fragment>
      ))}
    </>
  );
}

/** 内核布局用：某插槽当前是否没有任何贡献（如 right-panel 无插件时隐藏容器） */
export function useSlotEmpty(slot: UiSlotId): boolean {
  useSyncExternalStore(subscribeRegistry, getRegistryVersion);
  return getSlotContributions(slot).length === 0;
}
