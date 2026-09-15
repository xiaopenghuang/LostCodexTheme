import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { desktop } from './storage';
import { buildCss } from '../theme/css-generator';
import type { ThemeDocument } from '../theme/types';

export interface CodexStatus {
  state: 'not-installed' | 'disconnected' | 'connected' | 'applied' | 'error';
  message: string;
  version?: string;
  verified: boolean;
  sessionActive?: boolean;
  manualExitRequired?: boolean;
}
const offline: CodexStatus = { state: 'disconnected', message: '离线编辑模式', verified: false };
export const getCodexStatus = (): Promise<CodexStatus> => desktop ? invoke('get_codex_status') : Promise.resolve(offline);
export async function startThemingSession(): Promise<CodexStatus> {
  if (!desktop) throw new Error('浏览器版仅用于编辑，请使用桌面版连接 Codex');
  return invoke('start_theming_session');
}
export async function applyTheme(document: ThemeDocument, background?: string): Promise<CodexStatus> {
  if (!desktop) throw new Error('主题已在预览中更新，连接 Codex 需要桌面版');
  return invoke('apply_theme_css', { css: buildCss(document.theme, background), customCss: document.customCss });
}
export async function restoreDefault(): Promise<CodexStatus> {
  if (!desktop) throw new Error('当前没有连接 Codex，不需要恢复');
  return invoke('restore_default');
}
export async function diagnostics(): Promise<string> {
  if (!desktop) return 'LostCodexTheme browser editor\nLive Codex integration is unavailable in a browser.';
  return invoke('get_diagnostics');
}

export async function reconnectCodex(): Promise<CodexStatus> {
  if (!desktop) throw new Error('重新连接需要桌面版');
  return invoke('reconnect_codex');
}
export async function closeEditor(): Promise<void> { if (desktop) await invoke('close_editor'); }
export async function requestEditorExit(): Promise<void> { if (desktop) await invoke('request_editor_exit'); }
export async function setEditorDirty(dirty: boolean): Promise<void> { if (desktop) await invoke('set_editor_dirty', { dirty }); }
export async function openLogsDirectory(): Promise<void> { if (desktop) await invoke('open_logs_directory'); }
export async function observeStatus(callback: (status: CodexStatus) => void): Promise<UnlistenFn> {
  if (!desktop) return () => undefined;
  return listen<CodexStatus>('lct-codex-status', event => callback(event.payload));
}
export async function observeClose(callback: () => void): Promise<UnlistenFn> {
  if (!desktop) return () => undefined;
  return listen('lct-close-requested', callback);
}
