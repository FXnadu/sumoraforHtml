/** IPC 错误信息清洗：剥掉 Electron invoke 包装的前缀。 */

export function toMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
